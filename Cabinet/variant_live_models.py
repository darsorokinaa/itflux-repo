"""r125: решение варианта вне урока (live-сессии) и учёт выдачи вариантов ученикам."""

import uuid

from django.contrib.auth.models import User
from django.db import models


class VariantLiveSession(models.Model):
    """Учитель открыл вариант для решения «в реальном времени» по ссылке."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name="variant_live_sessions")
    variant_id = models.PositiveIntegerField("Вариант", db_index=True)
    variant_url = models.CharField("Ссылка на вариант", max_length=500)
    title = models.CharField("Название", max_length=255, blank=True)
    homework = models.ForeignKey(
        "Cabinet.Homework",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="variant_live_sessions",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="variant_live_sessions",
        help_text="Если указан — подключиться может только этот ученик",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Live-решение варианта"
        verbose_name_plural = "Live-решения вариантов"

    def __str__(self):
        return f"{self.variant_id} / {self.teacher_id} / {self.pk}"


class VariantIssuance(models.Model):
    """Выдача варианта ученику в календарном месяце (МСК) — для лимитов тарифа."""

    SOURCE_HOMEWORK = "homework"
    SOURCE_LIVE_SOLVE = "live_solve"
    SOURCE_LESSON = "lesson"
    SOURCE_CHOICES = (
        (SOURCE_HOMEWORK, "Домашнее задание"),
        (SOURCE_LIVE_SOLVE, "Решение по ссылке"),
        (SOURCE_LESSON, "Показ на уроке"),
    )

    teacher = models.ForeignKey(User, on_delete=models.CASCADE, related_name="variant_issuances")
    student = models.ForeignKey("Cabinet.Student", on_delete=models.CASCADE, related_name="variant_issuances")
    variant_id = models.PositiveIntegerField()
    month = models.CharField(max_length=7, help_text="YYYY-MM по Москве")
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "student", "variant_id", "month"],
                name="uniq_variant_issuance_month",
            )
        ]
        indexes = [models.Index(fields=["teacher", "student", "month"], name="variant_iss_t_s_m")]
        verbose_name = "Выдача варианта"
        verbose_name_plural = "Выдачи вариантов"
