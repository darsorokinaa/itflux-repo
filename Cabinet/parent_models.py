"""Связь родитель ↔ ученик и приглашения в кабинет родителя."""

from __future__ import annotations

from django.conf import settings
from django.db import models

from .choices import (
    ParentInvitationStatus,
    ParentRelationshipStatus,
    ParentRelationshipType,
)


def default_parent_permissions() -> dict:
    return {
        "view_schedule": True,
        "view_homework": True,
        "view_results": True,
        "view_journal": True,
        "view_attendance": True,
        "view_comments": True,
        "view_billing": False,
        "receive_notifications": True,
    }


class ParentStudentRelationship(models.Model):
    parent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="parent_children",
        verbose_name="Родитель",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="parent_links",
        verbose_name="Ученик",
    )
    status = models.CharField(
        max_length=20,
        choices=ParentRelationshipStatus.choices,
        default=ParentRelationshipStatus.PENDING,
        db_index=True,
    )
    relationship_type = models.CharField(
        max_length=20,
        choices=ParentRelationshipType.choices,
        default=ParentRelationshipType.OTHER,
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="parent_relationships_created",
        verbose_name="Пригласил",
    )
    invitation = models.ForeignKey(
        "Cabinet.ParentInvitation",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="relationships",
        verbose_name="Приглашение",
    )
    permissions = models.JSONField(
        "Разрешения",
        default=default_parent_permissions,
        blank=True,
    )
    confirmed_at = models.DateTimeField("Подтверждено", null=True, blank=True)
    revoked_at = models.DateTimeField("Отозвано", null=True, blank=True)
    last_activity_at = models.DateTimeField("Последняя активность", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Связь родитель–ученик"
        verbose_name_plural = "Связи родитель–ученик"
        constraints = [
            models.UniqueConstraint(
                fields=["parent", "student"],
                name="cabinet_unique_parent_student",
            ),
        ]
        indexes = [
            models.Index(fields=["parent", "status"]),
            models.Index(fields=["student", "status"]),
        ]

    def __str__(self):
        return f"{self.parent_id} → student {self.student_id} ({self.status})"

    def has_permission(self, key: str) -> bool:
        if self.status != ParentRelationshipStatus.ACTIVE:
            return False
        perms = self.permissions if isinstance(self.permissions, dict) else {}
        return bool(perms.get(key, False))


class ParentInvitation(models.Model):
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="parent_invitations",
        verbose_name="Ученик",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="parent_invitations_created",
        verbose_name="Создал",
    )
    invited_name = models.CharField("Имя родителя", max_length=150, blank=True)
    invited_email = models.EmailField("Email", blank=True)
    invited_phone = models.CharField("Телефон", max_length=32, blank=True)
    relationship_type = models.CharField(
        max_length=20,
        choices=ParentRelationshipType.choices,
        default=ParentRelationshipType.OTHER,
    )
    token_hash = models.CharField("Хеш токена", max_length=64, unique=True, db_index=True)
    short_code = models.CharField("Короткий код", max_length=12, blank=True, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=ParentInvitationStatus.choices,
        default=ParentInvitationStatus.PENDING,
        db_index=True,
    )
    permissions = models.JSONField(
        "Разрешения",
        default=default_parent_permissions,
        blank=True,
    )
    expires_at = models.DateTimeField("Действует до")
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="parent_invitations_accepted",
        verbose_name="Принял",
    )
    accepted_at = models.DateTimeField("Принято", null=True, blank=True)
    revoked_at = models.DateTimeField("Отозвано", null=True, blank=True)
    last_sent_at = models.DateTimeField("Последняя отправка", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Приглашение родителя"
        verbose_name_plural = "Приглашения родителей"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Parent invite → student {self.student_id} ({self.status})"


class ParentAccessAuditLog(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="parent_access_audit_actions",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="parent_access_audit_logs",
        null=True,
        blank=True,
    )
    invitation = models.ForeignKey(
        ParentInvitation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    relationship = models.ForeignKey(
        ParentStudentRelationship,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=64)
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Аудит доступа родителя"
        verbose_name_plural = "Аудит доступов родителей"
        ordering = ["-created_at"]
