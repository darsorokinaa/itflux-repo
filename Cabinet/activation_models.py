"""Server-side activation analytics events. No names, emails, phones, or tokens."""

from django.conf import settings
from django.db import models
from django.utils import timezone


class ActivationEvent(models.Model):
    class Kind(models.TextChoices):
        INTENT = "intent", "Intent"
        CONFIRMED = "confirmed", "Confirmed"

    event_name = models.CharField("Событие", max_length=64, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="activation_events",
        verbose_name="Пользователь",
    )
    role = models.CharField("Роль", max_length=20, blank=True)
    occurred_at = models.DateTimeField("Когда", default=timezone.now, db_index=True)
    session_key = models.CharField("Сессия", max_length=64, blank=True)
    object_type = models.CharField("Тип объекта", max_length=32, blank=True)
    object_id = models.PositiveBigIntegerField("ID объекта", null=True, blank=True)
    source = models.CharField("Источник", max_length=64, blank=True)
    metadata = models.JSONField("Метаданные", default=dict, blank=True)
    kind = models.CharField(
        "Достоверность",
        max_length=16,
        choices=Kind.choices,
        db_index=True,
    )
    idempotency_key = models.CharField("Идемпотентность", max_length=160, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Событие активации"
        verbose_name_plural = "События активации"
        indexes = [
            models.Index(fields=["user", "event_name", "occurred_at"]),
            models.Index(fields=["event_name", "occurred_at"]),
        ]

    def __str__(self):
        return f"{self.event_name} user={self.user_id}"
