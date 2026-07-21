import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .choices import InvitationStatus, StudentStatus
from .models import Profile, Student, StudentInvitation


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
):
    if group is not None and group.teacher_id != teacher.id:
        raise ValueError("Группа принадлежит другому учителю")

    token = generate_invite_token()
    while StudentInvitation.objects.filter(token=token).exists():
        token = generate_invite_token()

    # Create a pre-profile student record if name is provided
    pre_student = None
    clean_first = (first_name or "").strip()
    clean_last  = (last_name  or "").strip()
    clean_email = (email or "").strip().lower()
    if clean_first:
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
        if group is not None:
            group.students.add(pre_student)

    return StudentInvitation.objects.create(
        token=token,
        teacher=teacher,
        group=group,
        first_name=clean_first,
        last_name=clean_last,
        pre_student=pre_student,
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


def resolve_invitation_for_user(token: str, user=None):
    """
    Pending → preview.
    Accepted текущим пользователем → success payload (для редиректа после регистрации).
    """
    invitation = get_invitation_by_token(token)
    if invitation is not None:
        return invitation_preview_payload(invitation)

    try:
        invitation = StudentInvitation.objects.select_related(
            "teacher", "teacher__profile", "group"
        ).get(token=token)
    except StudentInvitation.DoesNotExist:
        return None

    if (
        user is not None
        and getattr(user, "is_authenticated", False)
        and invitation.status == InvitationStatus.ACCEPTED
        and invitation.accepted_by_id == user.id
    ):
        payload = invitation_accepted_payload(invitation, user)
        if invitation.accepted_by_id:
            # student_id удобен фронту, но не обязателен
            student = (
                Student.objects.filter(teacher=invitation.teacher, user=user)
                .order_by("id")
                .first()
            )
            if student:
                payload["student_id"] = student.id
        return payload
    return None


@transaction.atomic
def accept_student_invitation(token: str, user: User):
    profile = getattr(user, "profile", None)
    if profile is None:
        raise ValueError("Профиль не найден")
    if profile.role != Profile.Role.STUDENT:
        raise ValueError("Принять приглашение может только ученик")

    invitation = get_invitation_by_token(token)
    if invitation is None:
        raise ValueError("Приглашение недействительно или истекло")

    first_name = (profile.name or user.first_name or user.username).strip()
    last_name = (profile.surname or user.last_name or "").strip()
    invite_email = (invitation.email or user.email or "").strip().lower()

    # Prefer the pre-created student profile linked to this invitation
    existing = None
    if invitation.pre_student_id:
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
        update_fields = ["user"]
        student.user = user
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

    return student, invitation


def try_accept_invite_token(user, token: str | None):
    token = (token or "").strip()
    if not token:
        return None
    try:
        student, invitation = accept_student_invitation(token, user)
        return student, invitation
    except ValueError:
        return None


def invite_accept_api_payload(student, invitation, user) -> dict:
    payload = invitation_accepted_payload(invitation, user)
    payload["student_id"] = student.id
    return payload
