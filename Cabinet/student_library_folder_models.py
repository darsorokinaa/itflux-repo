"""Оверлей-папки выданных материалов ученика. Не путать с CabinetFolder («Мои файлы»)."""

from django.contrib.auth.models import User
from django.db import models


class StudentMaterialFolder(models.Model):
    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="student_material_folders",
        verbose_name="Учитель",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="material_folders",
        verbose_name="Ученик",
    )
    student_subject = models.ForeignKey(
        "Cabinet.StudentSubject",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="material_folders",
        verbose_name="Предмет ученика",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
        verbose_name="Родительская папка",
    )
    name = models.CharField("Название", max_length=80)
    sort_order = models.PositiveIntegerField("Порядок", default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Папка материалов ученика"
        verbose_name_plural = "Папки материалов ученика"
        ordering = ["sort_order", "name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "student", "parent", "name"],
                name="cabinet_unique_student_material_folder_name",
            ),
        ]
        indexes = [
            models.Index(fields=["teacher", "student"]),
        ]

    def __str__(self):
        return f"{self.teacher_id}:{self.student_id}:{self.name}"


class StudentMaterialPlacement(models.Model):
    """Куда учитель положил уже выданный материал. Оригинал не двигается."""

    teacher = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="student_material_placements",
        verbose_name="Учитель",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="material_placements",
        verbose_name="Ученик",
    )
    folder = models.ForeignKey(
        StudentMaterialFolder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="placements",
        verbose_name="Папка",
    )
    library_key = models.CharField("Ключ в библиотеке", max_length=64)
    source = models.CharField("Источник", max_length=20, blank=True)
    sort_order = models.PositiveIntegerField("Порядок", default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Размещение материала ученика"
        verbose_name_plural = "Размещения материалов ученика"
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "student", "library_key"],
                name="cabinet_unique_student_material_placement",
            ),
        ]
        indexes = [
            models.Index(fields=["teacher", "student"]),
            models.Index(fields=["folder"]),
        ]

    def __str__(self):
        return f"{self.library_key} → folder={self.folder_id}"
