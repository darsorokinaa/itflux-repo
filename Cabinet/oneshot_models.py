"""Разовые всплывающие окна в кабинете (показ один раз, состояние на сервере)."""

from django.conf import settings
from django.db import models


class OneShotPopup(models.Model):
    """Модальное окно, которое показывается пользователю ровно один раз.

    Факт показа (shown_at) и закрытия (closed_at) хранится на сервере, поэтому
    на другом устройстве окно повторно не появится. Текст может зависеть от даты
    (через N дней / завтра / сегодня) и рендерится при выдаче — см. Cabinet.oneshot_popups.
    """

    class Kind(models.TextChoices):
        PREMIUM_END = "premium_end", "А: окончание акционного «Премиума»"
        PAYMENT_UNFINISHED = "payment_unfinished", "Б: оплата не завершилась"
        PRO_THANKS = "pro_thanks", "В: спасибо, «Профи»"

    class Status(models.TextChoices):
        PENDING = "pending", "Ожидает показа"
        SHOWN = "shown", "Показано"
        CLOSED = "closed", "Закрыто"
        SUPERSEDED = "superseded", "Заменено окном с более высоким приоритетом"
        EXPIRED = "expired", "Неактуально"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="oneshot_popups", verbose_name="Пользователь"
    )
    key = models.CharField("Ключ", max_length=96)
    kind = models.CharField("Тип", max_length=32, choices=Kind.choices)
    priority = models.PositiveSmallIntegerField("Приоритет", default=0)
    button_label = models.CharField("Кнопка", max_length=120)
    button_url = models.CharField("Ссылка кнопки", max_length=500)
    context = models.JSONField("Параметры текста", default=dict, blank=True)
    status = models.CharField("Статус", max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    show_until = models.DateTimeField("Показывать до", null=True, blank=True)
    shown_at = models.DateTimeField("Показано", null=True, blank=True)
    closed_at = models.DateTimeField("Закрыто", null=True, blank=True)
    close_action = models.CharField("Как закрыто", max_length=16, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Разовое окно"
        verbose_name_plural = "Разовые окна"
        constraints = [models.UniqueConstraint(fields=["user", "key"], name="uniq_oneshot_popup_user_key")]
        indexes = [models.Index(fields=["user", "status"], name="cab_oneshot_user_status_idx")]

    def __str__(self):
        return f"{self.kind} → {self.user_id} [{self.status}]"
