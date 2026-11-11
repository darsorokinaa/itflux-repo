"""Витринные события и скрытие карточек кабинета.

События не хранят почту, имя, телефон или IP — только user_id, если человек вошёл.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone


class StorefrontEvent(models.Model):
    class Name(models.TextChoices):
        PRICING_VIEW = "pricing_view", "Просмотр /pricing"
        TARIFF_CLICK = "tariff_click", "Клик по тарифу"
        PROMO_APPLIED = "promo_applied", "Промокод применён"
        PAYMENT_CREATED = "payment_created", "Платёж создан"

    event_name = models.CharField("Событие", max_length=32, choices=Name.choices, db_index=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="storefront_events",
        verbose_name="Пользователь",
    )
    occurred_at = models.DateTimeField("Когда", default=timezone.now, db_index=True)
    metadata = models.JSONField("Метаданные", default=dict, blank=True)
    idempotency_key = models.CharField("Идемпотентность", max_length=80, unique=True, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Событие витрины"
        verbose_name_plural = "События витрины"
        ordering = ["-occurred_at"]  # noqa: RUF012
        indexes = [  # noqa: RUF012
            models.Index(fields=["event_name", "occurred_at"], name="cab_store_evt_time_idx"),
        ]

    def __str__(self):
        return f"{self.event_name} user={self.user_id or '-'}"


class TeacherUiDismissal(models.Model):
    """Скрытие карточки кабинета. Одна запись на пользователя и ключ."""

    FIRST_DAY_CHECKLIST = "first_day_checklist"
    PREMIUM_TRIAL_TUTOR_OFFER = "premium_trial_tutor_offer"
    KEYS = (
        (FIRST_DAY_CHECKLIST, "Чеклист первого дня"),
        (PREMIUM_TRIAL_TUTOR_OFFER, "Баннер пробного Премиума"),
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ui_dismissals",
        verbose_name="Пользователь",
    )
    notice_key = models.CharField("Ключ", max_length=64, choices=KEYS)
    dismissed_at = models.DateTimeField("Скрыто", auto_now_add=True)

    class Meta:
        verbose_name = "Скрытое уведомление кабинета"
        verbose_name_plural = "Скрытые уведомления кабинета"
        constraints = [  # noqa: RUF012
            models.UniqueConstraint(fields=["user", "notice_key"], name="cab_ui_dismiss_user_key"),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.notice_key}"
