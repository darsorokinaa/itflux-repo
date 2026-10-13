"""Комната Контур.Толк, привязанная к одной видеоконференции.

Имя комнаты выводится из UUID VideoMeeting. API-ключ здесь не хранится.
"""

from django.db import models


class KonturTalkRoom(models.Model):
    meeting = models.OneToOneField(
        "Cabinet.VideoMeeting",
        on_delete=models.CASCADE,
        related_name="kontur_talk_room",
        verbose_name="Видеоконференция",
    )
    room_name = models.CharField("Имя комнаты", max_length=64, unique=True)
    provisioned_at = models.DateTimeField("Создана в Контур.Толк", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Комната Контур.Толк"
        verbose_name_plural = "Комнаты Контур.Толк"

    def __str__(self):
        return self.room_name
