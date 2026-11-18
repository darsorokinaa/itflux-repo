"""Заявка с лендинга онлайн-академии."""

from django.db import models
from django.db.models import Q


class AcademyLead(models.Model):
    """Заявка на бесплатную диагностику. Сырой IP не хранится — только хеш."""

    class Grade(models.IntegerChoices):
        G9 = 9, "9"
        G10 = 10, "10"
        G11 = 11, "11"

    class Subject(models.TextChoices):
        OGE_INF = "oge_inf", "ОГЭ информатика"
        EGE_INF = "ege_inf", "ЕГЭ информатика"

    class Status(models.TextChoices):
        NEW = "new", "новая"
        CONTACTED = "contacted", "связались"
        DIAGNOSTIC_SCHEDULED = "diagnostic_scheduled", "диагностика назначена"
        ENROLLED = "enrolled", "записался"
        DECLINED = "declined", "отказ"

    student_name = models.CharField("Имя ученика", max_length=200)
    parent_name = models.CharField("Имя родителя", max_length=200, blank=True, default="")
    grade = models.PositiveSmallIntegerField("Класс", choices=Grade.choices, db_index=True)
    subject = models.CharField("Предмет", max_length=16, choices=Subject.choices, db_index=True)
    contact = models.CharField("Контакт", max_length=80)
    comment = models.TextField("Комментарий", blank=True, default="")
    consent = models.BooleanField("Согласие на обработку ПД", default=False)
    consent_at = models.DateTimeField("Время согласия")
    consent_text_version = models.CharField("Версия текста согласия", max_length=64)
    status = models.CharField(
        "Статус",
        max_length=32,
        choices=Status.choices,
        default=Status.NEW,
        db_index=True,
    )
    notes = models.TextField("Заметки", blank=True, default="")
    utm_source = models.CharField(max_length=32, blank=True, default="")
    utm_medium = models.CharField(max_length=32, blank=True, default="")
    utm_campaign = models.CharField(max_length=64, blank=True, default="")
    utm_content = models.CharField(max_length=64, blank=True, default="")
    utm_term = models.CharField(max_length=64, blank=True, default="")
    referrer = models.CharField("Реферер", max_length=500, blank=True, default="")
    ip_hash = models.CharField("Хеш IP", max_length=64, blank=True, default="")
    created_at = models.DateTimeField("Создана", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлена", auto_now=True)

    class Meta:
        verbose_name = "Заявка академии"
        verbose_name_plural = "Заявки академии"
        ordering = ("-created_at",)
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(grade=9, subject="oge_inf")
                    | Q(grade__in=[10, 11], subject="ege_inf")
                ),
                name="academy_lead_grade_subject",
            ),
        ]

    def __str__(self):
        return f"{self.student_name} ({self.get_grade_display()}, {self.get_subject_display()})"
