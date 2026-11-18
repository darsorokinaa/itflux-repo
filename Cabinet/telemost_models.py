from django.db import models


class TelemostConference(models.Model):
    """Запасной звонок Яндекс Телемоста для одного VideoMeeting.

    Токен сервисного аккаунта в модель не пишем — только id конференции и ссылка.
    """

    meeting = models.OneToOneField(
        "Cabinet.VideoMeeting",
        on_delete=models.CASCADE,
        related_name="telemost_conference",
    )
    conference_id = models.CharField(max_length=128, blank=True, default="")
    join_url = models.URLField(max_length=500)
    waiting_room_level = models.CharField(max_length=32, default="PUBLIC")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Конференция Телемоста"
        verbose_name_plural = "Конференции Телемоста"

    def __str__(self):
        return f"telemost:{self.conference_id or self.pk}"
