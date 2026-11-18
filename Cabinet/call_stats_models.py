from django.conf import settings
from django.db import models


class CallStatsSample(models.Model):
    """Снимок качества звонка от браузера участника (раз в 20 с).

    Только технические числа WebRTC. Никаких IP, имён, устройств и текста:
    кто — user_id, где — meeting_id.
    """

    meeting = models.ForeignKey(
        "Cabinet.VideoMeeting",
        verbose_name="Встреча",
        on_delete=models.CASCADE,
        related_name="call_stats_samples",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="Пользователь",
        on_delete=models.CASCADE,
        related_name="call_stats_samples",
    )
    created_at = models.DateTimeField("Время", auto_now_add=True, db_index=True)
    role = models.CharField("Роль", max_length=16, blank=True, default="")
    provider = models.CharField("Звонок", max_length=16, blank=True, default="")
    rtt_ms = models.PositiveIntegerField("RTT, мс", null=True, blank=True)
    jitter_ms = models.PositiveIntegerField("Джиттер, мс", null=True, blank=True)
    loss_in_pct = models.FloatField("Потери вх., %", null=True, blank=True)
    loss_out_pct = models.FloatField("Потери исх., %", null=True, blank=True)
    bitrate_in_kbps = models.PositiveIntegerField("Вх., кбит/с", null=True, blank=True)
    bitrate_out_kbps = models.PositiveIntegerField(
        "Исх., кбит/с", null=True, blank=True
    )
    audio_out_kbps = models.PositiveIntegerField(
        "Звук исх., кбит/с", null=True, blank=True
    )
    share_direction = models.CharField("Экран", max_length=8, blank=True, default="")
    share_fps = models.FloatField("Экран, к/с", null=True, blank=True)
    share_width = models.PositiveIntegerField("Ширина экрана", null=True, blank=True)
    share_height = models.PositiveIntegerField("Высота экрана", null=True, blank=True)
    quality_limitation = models.CharField(
        "Ограничение", max_length=16, blank=True, default=""
    )
    connection_type = models.CharField(
        "Соединение", max_length=8, blank=True, default=""
    )
    transport = models.CharField("Транспорт", max_length=8, blank=True, default="")
    connection_quality = models.CharField(
        "Оценка LiveKit", max_length=12, blank=True, default=""
    )
    reconnects = models.PositiveIntegerField("Переподкл.", default=0)

    class Meta:
        verbose_name = "Статистика звонка"
        verbose_name_plural = "Статистика звонков"
        ordering = ("-created_at",)
        indexes = (
            models.Index(
                fields=("meeting", "created_at"), name="callstats_meeting_created"
            ),
        )

    def __str__(self):
        return f"callstats:{self.meeting_id}:{self.user_id}:{self.pk}"
