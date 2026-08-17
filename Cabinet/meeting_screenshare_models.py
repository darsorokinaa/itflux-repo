"""Сессия аннотаций поверх демонстрации экрана (не доска Excalidraw)."""

from __future__ import annotations

import uuid

from django.contrib.auth.models import User
from django.db import models


class MeetingScreenShareSession(models.Model):
    """
    Контекст аннотаций для одной демонстрации экрана внутри видеоурока.

    Новая демонстрация → новый uuid (screenShareSessionId), старые штрихи
    не переносятся на чужой экран.
    """

    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    meeting = models.ForeignKey(
        "Cabinet.VideoMeeting",
        on_delete=models.CASCADE,
        related_name="screenshare_sessions",
        verbose_name="Видеоурок",
    )
    presenter_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="presented_screenshare_sessions",
        verbose_name="Кто демонстрирует",
    )
    presenter_jitsi_id = models.CharField(
        "Jitsi participant id докладчика",
        max_length=255,
        blank=True,
        default="",
    )
    participants_can_annotate = models.BooleanField(
        "Участники могут рисовать",
        default=True,
    )
    content_width = models.PositiveIntegerField(
        "Ширина демонстрируемого кадра",
        null=True,
        blank=True,
    )
    content_height = models.PositiveIntegerField(
        "Высота демонстрируемого кадра",
        null=True,
        blank=True,
    )
    annotations = models.JSONField("Аннотации", default=list, blank=True)
    recent_operation_ids = models.JSONField(
        "Недавние operation_id",
        default=list,
        blank=True,
    )
    version = models.PositiveIntegerField("Версия", default=1)
    is_active = models.BooleanField("Активна", default=True, db_index=True)
    started_at = models.DateTimeField("Начало", auto_now_add=True)
    ended_at = models.DateTimeField("Окончание", null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Сессия демонстрации экрана"
        verbose_name_plural = "Сессии демонстрации экрана"
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["meeting", "is_active"]),
        ]

    def __str__(self):
        return f"{self.meeting_id}:{self.uuid} ({'active' if self.is_active else 'ended'})"
