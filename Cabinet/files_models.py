"""Модели личного файлового хранилища «Мои файлы»."""

import uuid

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models


class CabinetFileStatus(models.TextChoices):
    ACTIVE = "active", "Активный"
    TRASHED = "trashed", "В корзине"


class CabinetFilePermissionLevel(models.TextChoices):
    VIEW = "view", "Только просмотр"
    DOWNLOAD = "download", "Просмотр и скачивание"
    EDIT = "edit", "Редактирование"
    FULL = "full", "Полный доступ"


class CabinetFileRelationType(models.TextChoices):
    LESSON = "lesson", "Урок"
    PLAN_ITEM = "plan_item", "Пункт плана"
    HOMEWORK = "homework", "Домашнее задание"
    SUBMISSION = "submission", "Сдача ДЗ"
    STUDENT = "student", "Ученик"
    GROUP = "group", "Группа"
    BOARD = "board", "Интерактивная доска"
    MATERIAL = "material", "Материал"


class CabinetFileAuditAction(models.TextChoices):
    UPLOAD = "upload", "Загрузка"
    DOWNLOAD = "download", "Скачивание"
    RENAME = "rename", "Переименование"
    MOVE = "move", "Перемещение"
    COPY = "copy", "Копирование"
    TRASH = "trash", "Удаление в корзину"
    RESTORE = "restore", "Восстановление"
    PURGE = "purge", "Окончательное удаление"
    SHARE = "share", "Выдача доступа"
    UNSHARE = "unshare", "Отзыв доступа"
    VERSION = "version", "Новая версия"
    ATTACH = "attach", "Прикрепление"
    DETACH = "detach", "Открепление"
    FAVORITE = "favorite", "Избранное"
    CREATE_FOLDER = "create_folder", "Создание папки"


class CabinetFolder(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="cabinet_folders",
        verbose_name="Владелец",
    )
    name = models.CharField("Название", max_length=255)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
        verbose_name="Родительская папка",
    )
    is_favorite = models.BooleanField("В избранном", default=False)
    deleted_at = models.DateTimeField("Удалено", null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Папка файлов"
        verbose_name_plural = "Папки файлов"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["owner", "parent", "deleted_at"]),
            models.Index(fields=["owner", "name"]),
            models.Index(fields=["owner", "updated_at"]),
        ]

    def __str__(self):
        return self.name


class CabinetFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="cabinet_files",
        verbose_name="Владелец",
    )
    folder = models.ForeignKey(
        CabinetFolder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="files",
        verbose_name="Папка",
    )
    original_name = models.CharField("Исходное имя", max_length=255)
    display_name = models.CharField("Отображаемое имя", max_length=255)
    storage_key = models.CharField("Ключ хранилища", max_length=512)
    mime_type = models.CharField("MIME-тип", max_length=128, blank=True)
    extension = models.CharField("Расширение", max_length=32, blank=True, db_index=True)
    size = models.PositiveBigIntegerField("Размер", default=0)
    checksum = models.CharField("Checksum", max_length=64, blank=True, db_index=True)
    current_version = models.PositiveIntegerField("Текущая версия", default=1)
    status = models.CharField(
        "Статус",
        max_length=16,
        choices=CabinetFileStatus.choices,
        default=CabinetFileStatus.ACTIVE,
        db_index=True,
    )
    is_favorite = models.BooleanField("В избранном", default=False)
    last_accessed_at = models.DateTimeField("Последний доступ", null=True, blank=True)
    deleted_at = models.DateTimeField("Удалено", null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Файл кабинета"
        verbose_name_plural = "Файлы кабинета"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner", "folder", "status"]),
            models.Index(fields=["owner", "deleted_at"]),
            models.Index(fields=["owner", "display_name"]),
            models.Index(fields=["owner", "updated_at"]),
            models.Index(fields=["owner", "is_favorite"]),
        ]

    def __str__(self):
        return self.display_name


class CabinetFileVersion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.ForeignKey(
        CabinetFile,
        on_delete=models.CASCADE,
        related_name="versions",
        verbose_name="Файл",
    )
    version_number = models.PositiveIntegerField("Номер версии")
    storage_key = models.CharField("Ключ хранилища", max_length=512)
    size = models.PositiveBigIntegerField("Размер", default=0)
    checksum = models.CharField("Checksum", max_length=64, blank=True)
    comment = models.CharField("Комментарий", max_length=255, blank=True)
    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cabinet_file_versions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Версия файла"
        verbose_name_plural = "Версии файлов"
        ordering = ["-version_number"]
        unique_together = [("file", "version_number")]

    def __str__(self):
        return f"{self.file_id} v{self.version_number}"


class CabinetFilePermission(models.Model):
    """Задел для совместного доступа (этап 3)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.ForeignKey(
        CabinetFile,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="permissions",
    )
    folder = models.ForeignKey(
        CabinetFolder,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="permissions",
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_permissions",
    )
    group = models.ForeignKey(
        "Cabinet.StudentGroup",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_permissions",
    )
    level = models.CharField(
        "Уровень",
        max_length=16,
        choices=CabinetFilePermissionLevel.choices,
        default=CabinetFilePermissionLevel.VIEW,
    )
    expires_at = models.DateTimeField("Истекает", null=True, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_cabinet_file_permissions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Право на файл"
        verbose_name_plural = "Права на файлы"
        indexes = [
            models.Index(fields=["user", "expires_at"]),
            models.Index(fields=["group", "expires_at"]),
            models.Index(fields=["file"]),
            models.Index(fields=["folder"]),
        ]


class CabinetFileRelation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    file = models.ForeignKey(
        CabinetFile,
        on_delete=models.CASCADE,
        related_name="relations",
        verbose_name="Файл",
    )
    relation_type = models.CharField(
        "Тип связи",
        max_length=32,
        choices=CabinetFileRelationType.choices,
        db_index=True,
    )
    lesson = models.ForeignKey(
        "Cabinet.Lesson",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_relations",
    )
    plan_item = models.ForeignKey(
        "Cabinet.LessonPlanItem",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_relations",
    )
    homework = models.ForeignKey(
        "Cabinet.Homework",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_relations",
    )
    submission = models.ForeignKey(
        "Cabinet.HomeworkSubmission",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_relations",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_relations",
    )
    group = models.ForeignKey(
        "Cabinet.StudentGroup",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_relations",
    )
    board = models.ForeignKey(
        "Cabinet.InteractiveBoard",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_relations",
    )
    material = models.ForeignKey(
        "Cabinet.Material",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="cabinet_file_relations",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_cabinet_file_relations",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Связь файла"
        verbose_name_plural = "Связи файлов"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["file", "relation_type"]),
            models.Index(fields=["lesson"]),
            models.Index(fields=["plan_item"]),
            models.Index(fields=["homework"]),
            models.Index(fields=["submission"]),
            models.Index(fields=["student"]),
            models.Index(fields=["group"]),
            models.Index(fields=["board"]),
        ]

    def __str__(self):
        return f"{self.file_id} → {self.relation_type}"


class CabinetFileAuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cabinet_file_audit_logs",
    )
    action = models.CharField(
        "Действие",
        max_length=32,
        choices=CabinetFileAuditAction.choices,
        db_index=True,
    )
    file = models.ForeignKey(
        CabinetFile,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    folder = models.ForeignKey(
        CabinetFolder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    meta = models.JSONField("Метаданные", default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Аудит файла"
        verbose_name_plural = "Аудит файлов"
        ordering = ["-created_at"]


class UserStorageQuota(models.Model):
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="storage_quota",
        verbose_name="Пользователь",
    )
    quota_bytes = models.PositiveBigIntegerField(
        "Лимит (байт)",
        null=True,
        blank=True,
        help_text="Пусто — значение из CABINET_FILE_STORAGE_QUOTA_BYTES",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Квота хранилища"
        verbose_name_plural = "Квоты хранилища"

    def effective_quota_bytes(self) -> int:
        if self.quota_bytes is not None:
            return int(self.quota_bytes)
        return int(getattr(settings, "CABINET_FILE_STORAGE_QUOTA_BYTES", 1024 * 1024 * 1024))
