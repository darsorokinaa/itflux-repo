"""r50: пробный период, журнал напоминаний, отписка от писем."""

from django.conf import settings
from django.db import models


class TrialGrant(models.Model):
    """Один пробный «Профи» на аккаунт (r50)."""

    teacher = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="trial_grant", verbose_name="Учитель"
    )
    plan_slug = models.CharField("Тариф", max_length=50, default="pro")
    started_at = models.DateTimeField("Начало")
    ends_at = models.DateTimeField("Окончание")
    source = models.CharField("Как включён", max_length=32, default="manual")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Пробный период"
        verbose_name_plural = "Пробные периоды"

    def __str__(self):
        return f"trial {self.plan_slug} → {self.teacher_id} до {self.ends_at:%d.%m.%Y}"


class SubscriptionReminderLog(models.Model):
    """Идемпотентный журнал напоминаний об окончании подписки/пробного периода."""

    class Status(models.TextChoices):
        DRY_RUN = "dry_run", "Пробный прогон (не отправлено)"
        SENT = "sent", "Отправлено"
        SKIPPED = "skipped", "Пропущено"
        FAILED = "failed", "Ошибка"

    teacher = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField("Тип", max_length=32)  # sub_7 / sub_3 / sub_end / trial_3 / trial_1 / trial_end
    period_end = models.DateField("Дата окончания")
    channel = models.CharField("Канал", max_length=16)  # email / in_app
    plan_slug = models.CharField(max_length=50, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices)
    detail = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Напоминание о подписке"
        verbose_name_plural = "Напоминания о подписке"
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "kind", "period_end", "channel"], name="uniq_r50_reminder"
            )
        ]


class EmailOptOut(models.Model):
    """Отписка от сервисных рассылок о подписке (ссылка в письме)."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="email_opt_out")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Отписка от писем"
        verbose_name_plural = "Отписки от писем"
