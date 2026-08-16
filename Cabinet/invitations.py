import logging
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .choices import InvitationStatus, StudentStatus
from .models import Profile, Student, StudentInvitation

logger = logging.getLogger("cabinet.invitations")


class InvitationError(ValueError):
    def __init__(self, message, code="invalid"):
        super().__init__(message)
        self.code = code


def default_invite_expiry():
    return timezone.now() + timedelta(days=14)


def generate_invite_token():
    return secrets.token_urlsafe(32)


def invitation_join_path(token: str) -> str:
    """Единая пользовательская ссылка приглашения на платформу."""
    return f"/invite/{token}/"


def invitation_is_valid(invitation: StudentInvitation) -> bool:
    if invitation.status != InvitationStatus.PENDING:
        return False
    if invitation.expires_at and invitation.expires_at < timezone.now():
        return False
    return True


def mark_expired_invitations(queryset=None):
    qs = queryset or StudentInvitation.objects.filter(status=InvitationStatus.PENDING)
    qs.filter(expires_at__lt=timezone.now()).update(status=InvitationStatus.EXPIRED)


@transaction.atomic
def create_student_invitation(
    teacher,
    *,
    group=None,
    email="",
    first_name="",
    last_name="",
    direction="other",
    grade=None,
    message="",
    expires_at=None,
    existing_student=None,
):
    if group is not None and group.teacher_id != teacher.id:
        raise ValueError("Группа принадлежит другому учителю")

    token = generate_invite_token()
    while StudentInvitation.objects.filter(token=token).exists():
        token = generate_invite_token()

    # Create a pre-profile student record if name is provided.
    # Never create a second Student for the same teacher+email.
    pre_student = None
    clean_first = (first_name or "").strip()
    clean_last  = (last_name  or "").strip()
    clean_email = (email or "").strip().lower()
    if existing_student is not None:
        if existing_student.teacher_id != teacher.id:
            raise ValueError("Ученик принадлежит другому учителю")
        pre_student = existing_student
    if pre_student is None and clean_email:
        pre_student = (
            Student.objects.filter(teacher=teacher, email__iexact=clean_email)
            .exclude(status=StudentStatus.ARCHIVED)
            .order_by("id")
            .first()
        )
    if pre_student is None and clean_first:
        pre_student = Student.objects.create(
            teacher=teacher,
            first_name=clean_first,
            last_name=clean_last,
            email=clean_email,
            direction=direction or "other",
            grade=grade,
            status=StudentStatus.ACTIVE,
            user=None,
        )
    elif pre_student is not None:
        update_fields = []
        if clean_first and not pre_student.first_name:
            pre_student.first_name = clean_first
            update_fields.append("first_name")
        if clean_last and not pre_student.last_name:
            pre_student.last_name = clean_last
            update_fields.append("last_name")
        if clean_email and not pre_student.email:
            pre_student.email = clean_email
            update_fields.append("email")
        if update_fields:
            pre_student.save(update_fields=update_fields + ["updated_at"])
    if pre_student is not None and group is not None:
        group.students.add(pre_student)

    invite_pre_student = pre_student
    if pre_student is not None:
        owner_invite = (
            StudentInvitation.objects.filter(pre_student=pre_student)
            .order_by("-id")
            .first()
        )
        if owner_invite is not None:
            if owner_invite.status == InvitationStatus.PENDING and invitation_is_valid(owner_invite):
                logger.info(
                    "invitation reused pending teacher=%s invitation=%s student=%s",
                    teacher.id,
                    owner_invite.pk,
                    pre_student.pk,
                )
                return owner_invite
            invite_pre_student = None

    logger.info(
        "invitation created teacher=%s email_set=%s pre_student=%s existing_user=%s",
        teacher.id,
        bool(clean_email),
        invite_pre_student.pk if invite_pre_student else None,
        pre_student.user_id if pre_student else None,
    )

    return StudentInvitation.objects.create(
        token=token,
        teacher=teacher,
        group=group,
        first_name=clean_first,
        last_name=clean_last,
        pre_student=invite_pre_student,
        email=clean_email,
        direction=direction or "other",
        grade=grade,
        message=(message or "").strip(),
        expires_at=expires_at or default_invite_expiry(),
    )


def get_invitation_by_token(token: str):
    mark_expired_invitations()
    try:
        invitation = StudentInvitation.objects.select_related(
            "teacher", "teacher__profile", "group"
        ).get(token=token)
    except StudentInvitation.DoesNotExist:
        return None
    if not invitation_is_valid(invitation):
        if invitation.status == InvitationStatus.PENDING and invitation.expires_at < timezone.now():
            invitation.status = InvitationStatus.EXPIRED
            invitation.save(update_fields=["status", "updated_at"])
        return None
    return invitation


def _mask_email_hint(email: str) -> str:
    email = (email or "").strip()
    if not email or "@" not in email:
        return ""
    local, domain = email.split("@", 1)
    if len(local) <= 1:
        masked_local = "*"
    elif len(local) == 2:
        masked_local = local[0] + "*"
    else:
        masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked_local}@{domain}"


def _teacher_display_name(invitation: StudentInvitation) -> str:
    teacher_profile = getattr(invitation.teacher, "profile", None)
    if teacher_profile:
        return teacher_profile.get_display_name() or invitation.teacher.username
    return invitation.teacher.username


def invitation_preview_payload(invitation: StudentInvitation):
    return {
        "token": invitation.token,
        "status": "pending",
        "teacher_name": _teacher_display_name(invitation),
        "group_id": invitation.group_id,
        "group_title": invitation.group.title if invitation.group_id else None,
        "direction": invitation.direction,
        "direction_label": invitation.get_direction_display(),
        "grade": invitation.grade,
        "message": invitation.message,
        "email_hint": _mask_email_hint(invitation.email),
        "expires_at": invitation.expires_at.isoformat() if invitation.expires_at else None,
        "join_path": invitation_join_path(invitation.token),
    }


def invitation_accepted_payload(invitation: StudentInvitation, user=None) -> dict:
    from .telegram_connect import telegram_connected

    teacher_name = _teacher_display_name(invitation)
    group_title = invitation.group.title if invitation.group_id else None
    return {
        "token": invitation.token,
        "status": "accepted",
        "ok": True,
        "teacher_name": teacher_name,
        "group_id": invitation.group_id,
        "group_title": group_title,
        "join_path": invitation_join_path(invitation.token),
        "student_id": None,
        "teacher_id": invitation.teacher_id,
        "telegram_connected": telegram_connected(user) if user is not None else False,
        "show_telegram_connect": (
            (not telegram_connected(user)) if user is not None else True
        ),
    }


def _login_hint_for_invitation(invitation: StudentInvitation) -> str:
    if invitation.accepted_by_id:
        accepted = invitation.accepted_by
        email = (getattr(accepted, "email", "") or "").strip()
        if email:
            return _mask_email_hint(email)
        username = (getattr(accepted, "username", "") or "").strip()
        if username:
            return username[0] + "*" * max(len(username) - 1, 0)
    if invitation.email:
        return _mask_email_hint(invitation.email)
    pre = invitation.pre_student
    if pre is not None and pre.user_id and (pre.user.email or "").strip():
        return _mask_email_hint(pre.user.email)
    if pre is not None and (pre.email or "").strip():
        return _mask_email_hint(pre.email)
    return ""


def invitation_already_registered_payload(invitation: StudentInvitation) -> dict:
    return {
        "token": invitation.token,
        "status": "already_registered",
        "ok": True,
        "teacher_name": _teacher_display_name(invitation),
        "group_id": invitation.group_id,
        "group_title": invitation.group.title if invitation.group_id else None,
        "join_path": invitation_join_path(invitation.token),
        "teacher_id": invitation.teacher_id,
        "login_hint": _login_hint_for_invitation(invitation),
        "message": "Вы уже зарегистрированы. Войдите в аккаунт, чтобы продолжить.",
    }


def invitation_wrong_account_payload(invitation: StudentInvitation) -> dict:
    return {
        "token": invitation.token,
        "status": "wrong_account",
        "ok": False,
        "teacher_name": _teacher_display_name(invitation),
        "group_id": invitation.group_id,
        "group_title": invitation.group.title if invitation.group_id else None,
        "join_path": invitation_join_path(invitation.token),
        "teacher_id": invitation.teacher_id,
        "message": (
            "Эта ссылка предназначена для другого аккаунта. "
            "Выйдите из текущего аккаунта или продолжите под ним, "
            "если учитель разрешает привязку."
        ),
    }


def _student_for_invitation_user(invitation: StudentInvitation, user) -> Student | None:
    if user is None or not getattr(user, "id", None):
        return None
    if invitation.pre_student_id:
        pre = invitation.pre_student
        if pre and pre.user_id == user.id:
            return pre
    return (
        Student.objects.filter(teacher=invitation.teacher, user=user)
        .order_by("id")
        .first()
    )


def _invitation_has_registered_student(invitation: StudentInvitation) -> bool:
    if invitation.status == InvitationStatus.ACCEPTED and invitation.accepted_by_id:
        return True
    pre = invitation.pre_student
    if pre is not None and pre.user_id:
        return True
    email = (invitation.email or "").strip()
    if email:
        return Student.objects.filter(
            teacher=invitation.teacher,
            email__iexact=email,
            user__isnull=False,
        ).exclude(status=StudentStatus.ARCHIVED).exists()
    return False


def resolve_invitation_for_user(token: str, user=None):
    """
    Pending → preview (или already_registered, если ученик уже есть).
    Accepted текущим пользователем → success payload.
    Accepted / занят другим → already_registered или wrong_account.
    """
    mark_expired_invitations()
    try:
        invitation = StudentInvitation.objects.select_related(
            "teacher",
            "teacher__profile",
            "group",
            "pre_student",
            "pre_student__user",
            "accepted_by",
        ).get(token=token)
    except StudentInvitation.DoesNotExist:
        return None

    authenticated = bool(user is not None and getattr(user, "is_authenticated", False))

    if invitation.status == InvitationStatus.PENDING:
        if invitation.expires_at and invitation.expires_at < timezone.now():
            invitation.status = InvitationStatus.EXPIRED
            invitation.save(update_fields=["status", "updated_at"])
        else:
            if _invitation_has_registered_student(invitation):
                if authenticated:
                    linked = _student_for_invitation_user(invitation, user)
                    if linked is not None:
                        payload = invitation_accepted_payload(invitation, user)
                        payload["student_id"] = linked.id
                        payload["already_member"] = True
                        return payload
                    profile = getattr(user, "profile", None)
                    if profile and profile.role != Profile.Role.STUDENT:
                        payload = invitation_wrong_account_payload(invitation)
                        payload["message"] = "Войдите как ученик, чтобы принять приглашение."
                        return payload
                    return invitation_wrong_account_payload(invitation)
                return invitation_already_registered_payload(invitation)
            payload = invitation_preview_payload(invitation)
            if authenticated:
                profile = getattr(user, "profile", None)
                if profile and profile.role == Profile.Role.STUDENT:
                    payload["can_accept"] = True
                elif profile:
                    payload["wrong_role"] = True
                    payload["message"] = "Войдите как ученик, чтобы принять приглашение."
            return payload

    if invitation.status == InvitationStatus.ACCEPTED:
        if authenticated and invitation.accepted_by_id == user.id:
            payload = invitation_accepted_payload(invitation, user)
            student = _student_for_invitation_user(invitation, user)
            if student:
                payload["student_id"] = student.id
            return payload
        if authenticated:
            linked = _student_for_invitation_user(invitation, user)
            if linked is not None:
                payload = invitation_accepted_payload(invitation, user)
                payload["student_id"] = linked.id
                payload["already_member"] = True
                return payload
            return invitation_wrong_account_payload(invitation)
        return invitation_already_registered_payload(invitation)

    return {
        "token": invitation.token,
        "status": invitation.status,
        "ok": False,
        "teacher_name": _teacher_display_name(invitation),
        "message": (
            "Срок действия приглашения истёк."
            if invitation.status == InvitationStatus.EXPIRED
            else "Приглашение недоступно."
        ),
    }


def _load_invitation_for_accept(token: str) -> StudentInvitation:
    mark_expired_invitations()
    try:
        invitation = StudentInvitation.objects.select_related(
            "teacher", "teacher__profile", "group", "pre_student", "accepted_by"
        ).get(token=token)
    except StudentInvitation.DoesNotExist as exc:
        raise InvitationError("Приглашение недействительно или истекло", code="invalid") from exc
    return invitation


@transaction.atomic
def accept_student_invitation(token: str, user: User):
    profile = getattr(user, "profile", None)
    if profile is None:
        raise InvitationError("Профиль не найден", code="wrong_role")
    if profile.role != Profile.Role.STUDENT:
        raise InvitationError("Принять приглашение может только ученик", code="wrong_role")

    invitation = _load_invitation_for_accept(token)

    # Блокируем строку, чтобы два параллельных accept не приняли один токен.
    # of=("self",) — иначе PostgreSQL ругается на OUTER JOIN от select_related.
    invitation = (
        StudentInvitation.objects.select_for_update(of=("self",))
        .select_related("teacher", "teacher__profile", "group", "pre_student", "accepted_by")
        .filter(pk=invitation.pk)
        .first()
    )
    if invitation is None:
        raise InvitationError("Приглашение недействительно или истекло", code="invalid")

    if invitation.status == InvitationStatus.ACCEPTED:
        if invitation.accepted_by_id == user.id:
            student = _student_for_invitation_user(invitation, user)
            if student is None:
                raise InvitationError("Приглашение недействительно или истекло", code="invalid")
            logger.info(
                "invitation reused by owner invitation=%s user=%s student=%s",
                invitation.pk,
                user.id,
                student.pk,
            )
            return student, invitation
        raise InvitationError(
            "Эта ссылка предназначена для другого аккаунта. "
            "Выйдите из текущего аккаунта или продолжите под ним, "
            "если учитель разрешает привязку.",
            code="wrong_account",
        )

    if invitation.status != InvitationStatus.PENDING:
        raise InvitationError("Приглашение уже использовано или недоступно", code="already_used")
    if invitation.expires_at and invitation.expires_at < timezone.now():
        invitation.status = InvitationStatus.EXPIRED
        invitation.save(update_fields=["status", "updated_at"])
        raise InvitationError("Приглашение недействительно или истекло", code="expired")

    if invitation.pre_student_id and invitation.pre_student and invitation.pre_student.user_id:
        if invitation.pre_student.user_id == user.id:
            student = invitation.pre_student
            invitation.status = InvitationStatus.ACCEPTED
            invitation.accepted_by = user
            invitation.accepted_at = timezone.now()
            invitation.save(update_fields=["status", "accepted_by", "accepted_at", "updated_at"])
            if invitation.group_id:
                invitation.group.students.add(student)
            logger.info(
                "invitation accepted existing student invitation=%s user=%s student=%s",
                invitation.pk,
                user.id,
                student.pk,
            )
            return student, invitation
        raise InvitationError(
            "Эта ссылка предназначена для другого аккаунта. "
            "Выйдите из текущего аккаунта или продолжите под ним, "
            "если учитель разрешает привязку.",
            code="wrong_account",
        )

    first_name = (profile.name or user.first_name or user.username).strip()
    last_name = (profile.surname or user.last_name or "").strip()
    invite_email = (invitation.email or user.email or "").strip().lower()

    already_linked = (
        Student.objects.filter(teacher=invitation.teacher, user=user)
        .exclude(status=StudentStatus.ARCHIVED)
        .order_by("id")
        .first()
    )

    # Prefer the pre-created student profile linked to this invitation
    existing = None
    if already_linked:
        existing = already_linked
    elif invitation.pre_student_id:
        try:
            existing = Student.objects.get(
                pk=invitation.pre_student_id,
                teacher=invitation.teacher,
                user__isnull=True,
            )
        except Student.DoesNotExist:
            existing = None

    if existing is None and invite_email:
        existing = (
            Student.objects.filter(
                teacher=invitation.teacher,
                email__iexact=invite_email,
                user__isnull=True,
            )
            .exclude(status=StudentStatus.ARCHIVED)
            .first()
        )

    if existing:
        student = existing
        created = False
        update_fields = []
        if not student.user_id:
            student.user = user
            update_fields.append("user")
        if invite_email and not student.email:
            student.email = invite_email
            update_fields.append("email")
        if first_name and not student.first_name:
            student.first_name = first_name
            update_fields.append("first_name")
        if last_name and not student.last_name:
            student.last_name = last_name
            update_fields.append("last_name")
        if invitation.direction and student.direction != invitation.direction:
            student.direction = invitation.direction
            update_fields.append("direction")
        if invitation.grade and student.grade != invitation.grade:
            student.grade = invitation.grade
            update_fields.append("grade")
        if student.status == StudentStatus.ARCHIVED:
            student.status = StudentStatus.ACTIVE
            update_fields.append("status")
        if update_fields:
            student.save(update_fields=list(dict.fromkeys(update_fields)) + ["updated_at"])
    else:
        student, created = Student.objects.get_or_create(
            teacher=invitation.teacher,
            user=user,
            defaults={
                "first_name": first_name,
                "last_name": last_name,
                "email": invite_email or (user.email or "").strip().lower(),
                "direction": invitation.direction,
                "grade": invitation.grade,
                "status": StudentStatus.ACTIVE,
            },
        )

    if not created and not existing:
        update_fields = []
        if invitation.direction and student.direction != invitation.direction:
            student.direction = invitation.direction
            update_fields.append("direction")
        if invitation.grade and student.grade != invitation.grade:
            student.grade = invitation.grade
            update_fields.append("grade")
        if student.status == StudentStatus.ARCHIVED:
            student.status = StudentStatus.ACTIVE
            update_fields.append("status")
        if not student.user_id:
            student.user = user
            update_fields.append("user")
        if update_fields:
            student.save(update_fields=update_fields + ["updated_at"])

    if invitation.group_id:
        invitation.group.students.add(student)

    invitation.status = InvitationStatus.ACCEPTED
    invitation.accepted_by = user
    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=["status", "accepted_by", "accepted_at", "updated_at"])
    logger.info(
        "invitation accepted invitation=%s user=%s student=%s created=%s",
        invitation.pk,
        user.id,
        student.pk,
        created,
    )

    try:
        from .telegram_connect import send_invite_welcome_if_connected

        send_invite_welcome_if_connected(
            user,
            teacher_name=_teacher_display_name(invitation),
            group_title=invitation.group.title if invitation.group_id else None,
        )
    except Exception:
        # Приветствие в Telegram не должно ломать принятие приглашения.
        pass

    if not already_linked:
        try:
            from .teacher_notifications import notify_teacher_new_student

            notify_teacher_new_student(teacher=invitation.teacher, student=student)
        except Exception:
            pass

    return student, invitation


def try_accept_invite_token(user, token: str | None):
    token = (token or "").strip()
    if not token:
        return None
    try:
        student, invitation = accept_student_invitation(token, user)
        return student, invitation
    except InvitationError as exc:
        logger.info(
            "invitation accept skipped user=%s code=%s",
            getattr(user, "id", None),
            exc.code,
        )
        return None
    except ValueError:
        return None


def invite_accept_api_payload(student, invitation, user) -> dict:
    payload = invitation_accepted_payload(invitation, user)
    payload["student_id"] = student.id
    return payload
