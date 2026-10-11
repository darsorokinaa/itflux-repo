"""Согласованный провайдер видеовстречи.

Строка создаётся только когда включён VIDEO_FAILOVER_ENABLED.
Имена, телефоны и email сюда не пишутся.
"""

from django.conf import settings
from django.db import models


class MeetingCallRoute(models.Model):
    class Provider(models.TextChoices):
        MEET = "meet", "Текущий Jitsi"
        JAAS = "jaas", "8x8 JaaS"
        LIVEKIT = "livekit", "Собственный LiveKit"

    meeting = models.OneToOneField(
        "Cabinet.VideoMeeting",
        on_delete=models.CASCADE,
        related_name="call_route",
        verbose_name="Видеоконференция",
    )
    active_provider = models.CharField(
        "Активный провайдер",
        max_length=16,
        choices=Provider.choices,
        default=Provider.MEET,
    )
    generation = models.PositiveIntegerField("Поколение", default=1)
    switched_at = models.DateTimeField("Переключено", null=True, blank=True)
    switch_reason = models.CharField("Причина переключения", max_length=64, blank=True, default="")
    switched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="media_provider_switches",
        verbose_name="Кто переключил",
    )
    auto_switch_count = models.PositiveSmallIntegerField("Автопереключений", default=0)
    cooldown_until = models.DateTimeField("Пауза до", null=True, blank=True)
    circuit_open_until = models.DateTimeField("Circuit breaker до", null=True, blank=True)
    livekit_room = models.CharField("Комната LiveKit", max_length=255, blank=True, default="")
    revoked_user_ids = models.JSONField("Отозванные участники", default=list, blank=True)
    failure_reports = models.JSONField("Отчёты о сбоях", default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Маршрут видеосвязи"
        verbose_name_plural = "Маршруты видеосвязи"

    def __str__(self):
        return f"{self.meeting_id}: {self.active_provider}#{self.generation}"
