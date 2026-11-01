"""r131: разборы по типам заданий (одна страница на номер экзамена)."""
from django.db import models

EXAM_NAMES = {"oge": "ОГЭ", "ege": "ЕГЭ"}
SUBJECT_NAMES = {"math": "Математика", "math_base": "Математика (база)", "inf": "Информатика"}


class Razbor(models.Model):
    EXAM_CHOICES = [("oge", "ОГЭ"), ("ege", "ЕГЭ")]

    exam = models.CharField("Экзамен", max_length=10, choices=EXAM_CHOICES, db_index=True)
    subject = models.CharField("Предмет (subject_short)", max_length=50, db_index=True)
    number = models.PositiveIntegerField("Номер задания")
    title = models.CharField("Заголовок", max_length=255)
    content_md = models.TextField("Текст (Markdown + LaTeX)")
    published = models.BooleanField("Опубликован", default=False, db_index=True)
    source_file = models.CharField("Файл-источник", max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Разбор"
        verbose_name_plural = "Разборы"
        ordering = ["exam", "subject", "number"]
        constraints = [
            models.UniqueConstraint(fields=["exam", "subject", "number"], name="razbor_unique_exam_subject_number"),
        ]

    def __str__(self):
        return f"{self.exam} {self.subject} №{self.number}: {self.title}"

    @property
    def path(self):
        return f"/razbor/{self.exam}/{self.subject}/{self.number}"

    @property
    def exam_name(self):
        return EXAM_NAMES.get(self.exam, self.exam.upper())

    @property
    def subject_name(self):
        return SUBJECT_NAMES.get(self.subject, self.subject)
