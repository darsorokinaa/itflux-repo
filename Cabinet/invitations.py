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
    return f"/cabinet/join/{token}"


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

    return StudentInvitation.objects.create(
        token=token,
        teacher=teacher,
        group=group,
        email=(email or "").strip().lower(),
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


def invitation_preview_payload(invitation: StudentInvitation):
    teacher_profile = invitation.teacher.profile
    teacher_name = teacher_profile.get_display_name() if teacher_profile else invitation.teacher.username
    return {
        "token": invitation.token,
        "teacher_name": teacher_name,
        "group_id": invitation.group_id,
        "group_title": invitation.group.title if invitation.group_id else None,
        "direction": invitation.direction,
        "direction_label": invitation.get_direction_display(),
        "grade": invitation.grade,
        "message": invitation.message,
        "email_hint": invitation.email,
        "expires_at": invitation.expires_at.isoformat() if invitation.expires_at else None,
        "join_path": invitation_join_path(invitation.token),
    }


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

    student, created = Student.objects.get_or_create(
        teacher=invitation.teacher,
        user=user,
        defaults={
            "first_name": first_name,
            "last_name": last_name,
            "email": (user.email or "").strip().lower(),
            "direction": invitation.direction,
            "grade": invitation.grade,
            "status": StudentStatus.ACTIVE,
        },
    )

    if not created:
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

    return student, invitation


def try_accept_invite_token(user, token: str | None):
    token = (token or "").strip()
    if not token:
        return None
    try:
        student, _ = accept_student_invitation(token, user)
        return student
    except ValueError:
        return None
