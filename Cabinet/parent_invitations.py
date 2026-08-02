"""Приглашения родителя из карточки ученика."""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .choices import ParentInvitationStatus, ParentRelationshipStatus
from .parent_models import (
    ParentAccessAuditLog,
    ParentInvitation,
    ParentStudentRelationship,
    default_parent_permissions,
)


def default_invite_expiry(days: int = 7):
    return timezone.now() + timedelta(days=max(1, min(int(days or 7), 30)))


def generate_raw_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256((raw_token or "").encode("utf-8")).hexdigest()


def generate_short_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


def invitation_accept_path(raw_token: str) -> str:
    return f"/parent/invite/accept/{raw_token}/"


def write_parent_audit(*, actor, action: str, student=None, invitation=None, relationship=None, meta=None):
    ParentAccessAuditLog.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        student=student,
        invitation=invitation,
        relationship=relationship,
        action=action,
        meta=meta or {},
    )


def merge_permissions(raw) -> dict:
    base = default_parent_permissions()
    if isinstance(raw, dict):
        for key in base:
            if key in raw:
                base[key] = bool(raw[key])
    return base


def invitation_is_valid(invitation: ParentInvitation) -> bool:
    if invitation.status != ParentInvitationStatus.PENDING:
        return False
    if invitation.expires_at and invitation.expires_at < timezone.now():
        return False
    return True


def mark_expired_parent_invitations(queryset=None):
    qs = queryset or ParentInvitation.objects.filter(status=ParentInvitationStatus.PENDING)
    qs.filter(expires_at__lt=timezone.now()).update(status=ParentInvitationStatus.EXPIRED)


@transaction.atomic
def create_parent_invitation(
    teacher: User,
    student,
    *,
    invited_name: str = "",
    invited_email: str = "",
    invited_phone: str = "",
    relationship_type: str = "other",
    permissions=None,
    expires_days: int = 7,
):
    if student.teacher_id != teacher.id:
        raise PermissionError("Ученик принадлежит другому преподавателю")

    raw_token = generate_raw_token()
    token_hash = hash_token(raw_token)
    while ParentInvitation.objects.filter(token_hash=token_hash).exists():
        raw_token = generate_raw_token()
        token_hash = hash_token(raw_token)

    short_code = generate_short_code()
    while ParentInvitation.objects.filter(short_code=short_code, status=ParentInvitationStatus.PENDING).exists():
        short_code = generate_short_code()

    invitation = ParentInvitation.objects.create(
        student=student,
        created_by=teacher,
        invited_name=(invited_name or "").strip()[:150],
        invited_email=(invited_email or "").strip().lower(),
        invited_phone=(invited_phone or "").strip()[:32],
        relationship_type=relationship_type or "other",
        token_hash=token_hash,
        short_code=short_code,
        permissions=merge_permissions(permissions),
        expires_at=default_invite_expiry(expires_days),
        last_sent_at=timezone.now(),
    )
    write_parent_audit(
        actor=teacher,
        action="invitation_created",
        student=student,
        invitation=invitation,
        meta={"email": invitation.invited_email, "expires_at": invitation.expires_at.isoformat()},
    )
    return invitation, raw_token


def get_invitation_by_raw_token(raw_token: str) -> ParentInvitation | None:
    if not raw_token:
        return None
    mark_expired_parent_invitations()
    return ParentInvitation.objects.select_related("student", "created_by", "student__teacher").filter(
        token_hash=hash_token(raw_token)
    ).first()


@transaction.atomic
def revoke_parent_invitation(teacher: User, invitation: ParentInvitation):
    if invitation.student.teacher_id != teacher.id:
        raise PermissionError("Нет доступа")
    if invitation.status != ParentInvitationStatus.PENDING:
        return invitation
    invitation.status = ParentInvitationStatus.REVOKED
    invitation.revoked_at = timezone.now()
    invitation.save(update_fields=["status", "revoked_at", "updated_at"])
    write_parent_audit(
        actor=teacher,
        action="invitation_revoked",
        student=invitation.student,
        invitation=invitation,
    )
    return invitation


@transaction.atomic
def accept_parent_invitation(user: User, invitation: ParentInvitation):
    from .models import Profile

    mark_expired_parent_invitations(ParentInvitation.objects.filter(pk=invitation.pk))
    invitation.refresh_from_db()
    if invitation.status == ParentInvitationStatus.EXPIRED or (
        invitation.expires_at and invitation.expires_at < timezone.now()
    ):
        invitation.status = ParentInvitationStatus.EXPIRED
        invitation.save(update_fields=["status", "updated_at"])
        raise ValueError("Срок действия ссылки истёк")
    if invitation.status == ParentInvitationStatus.REVOKED:
        raise ValueError("Приглашение отозвано")
    if invitation.status == ParentInvitationStatus.ACCEPTED:
        raise ValueError("Ссылка уже использована")
    if invitation.status != ParentInvitationStatus.PENDING:
        raise ValueError("Приглашение недоступно")

    profile = getattr(user, "profile", None)
    if profile is None:
        raise ValueError("Профиль не найден")
    if profile.role == Profile.Role.TEACHER:
        raise ValueError(
            "Аккаунт преподавателя не может принять приглашение родителя. "
            "Выйдите и войдите или зарегистрируйтесь как родитель."
        )
    # Нельзя «перепрошить» аккаунт ученика в родителя.
    from .models import Student as StudentModel

    if StudentModel.objects.filter(user=user).exists():
        raise ValueError(
            "Аккаунт ученика не может принять приглашение родителя. "
            "Зарегистрируйтесь отдельным аккаунтом родителя."
        )
    if profile.role != Profile.Role.PARENT:
        profile.role = Profile.Role.PARENT
        profile.save(update_fields=["role", "updated_at"])

    invitation = (
        ParentInvitation.objects.select_for_update()
        .filter(pk=invitation.pk)
        .first()
    )
    if invitation is None:
        raise ValueError("Приглашение недоступно")
    if invitation.status != ParentInvitationStatus.PENDING:
        raise ValueError("Ссылка уже использована или недоступна")

    now = timezone.now()
    rel, created = ParentStudentRelationship.objects.get_or_create(
        parent=user,
        student=invitation.student,
        defaults={
            "status": ParentRelationshipStatus.ACTIVE,
            "relationship_type": invitation.relationship_type,
            "invited_by": invitation.created_by,
            "invitation": invitation,
            "permissions": merge_permissions(invitation.permissions),
            "confirmed_at": now,
        },
    )
    if not created:
        rel.status = ParentRelationshipStatus.ACTIVE
        rel.relationship_type = invitation.relationship_type
        rel.invited_by = invitation.created_by
        rel.invitation = invitation
        rel.permissions = merge_permissions(invitation.permissions)
        rel.confirmed_at = now
        rel.revoked_at = None
        rel.save()

    invitation.status = ParentInvitationStatus.ACCEPTED
    invitation.accepted_by = user
    invitation.accepted_at = now
    invitation.save(update_fields=["status", "accepted_by", "accepted_at", "updated_at"])

    write_parent_audit(
        actor=user,
        action="invitation_accepted",
        student=invitation.student,
        invitation=invitation,
        relationship=rel,
    )
    return rel


@transaction.atomic
def revoke_parent_access(teacher: User, relationship: ParentStudentRelationship):
    if relationship.student.teacher_id != teacher.id:
        raise PermissionError("Нет доступа")
    relationship.status = ParentRelationshipStatus.REVOKED
    relationship.revoked_at = timezone.now()
    relationship.save(update_fields=["status", "revoked_at", "updated_at"])
    write_parent_audit(
        actor=teacher,
        action="access_revoked",
        student=relationship.student,
        relationship=relationship,
    )
    return relationship


@transaction.atomic
def suspend_parent_access(teacher: User, relationship: ParentStudentRelationship):
    if relationship.student.teacher_id != teacher.id:
        raise PermissionError("Нет доступа")
    relationship.status = ParentRelationshipStatus.SUSPENDED
    relationship.save(update_fields=["status", "updated_at"])
    write_parent_audit(
        actor=teacher,
        action="access_suspended",
        student=relationship.student,
        relationship=relationship,
    )
    return relationship


@transaction.atomic
def update_parent_permissions(teacher: User, relationship: ParentStudentRelationship, permissions: dict):
    if relationship.student.teacher_id != teacher.id:
        raise PermissionError("Нет доступа")
    relationship.permissions = merge_permissions(permissions)
    relationship.save(update_fields=["permissions", "updated_at"])
    write_parent_audit(
        actor=teacher,
        action="permissions_updated",
        student=relationship.student,
        relationship=relationship,
        meta={"permissions": relationship.permissions},
    )
    return relationship
