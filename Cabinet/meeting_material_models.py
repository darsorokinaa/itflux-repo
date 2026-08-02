"""Сессия синхронного просмотра материалов во время видеоурока."""

from __future__ import annotations

import uuid

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


class MeetingMaterialInteractionMode(models.TextChoices):
    VIEW_ONLY = "view_only", "Только просмотр"
    COLLABORATIVE = "collaborative", "Совместное управление"


class MeetingMaterialCollaborativeScope(models.TextChoices):
    ALL = "all", "Все ученики"
    SELECTED = "selected", "Выбранные ученики"


class MeetingMaterialFollowPolicy(models.TextChoices):
    STRICT = "strict", "Следовать за учителем"
    INDEPENDENT = "independent", "Самостоятельный просмотр"


class MeetingMaterialSession(models.Model):
    """
    Активный (или недавно закрытый) материал, синхронизируемый между
    преподавателем и учениками комнаты видеоурока.

    Доска и варианты живут в VideoMeeting.presented_* и сюда не попадают.
    """

    uuid = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    meeting = models.ForeignKey(
        "Cabinet.VideoMeeting",
        on_delete=models.CASCADE,
        related_name="material_sessions",
        verbose_name="Видеоурок",
    )
    material = models.ForeignKey(
        "Cabinet.Material",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="meeting_sessions",
        verbose_name="Материал",
    )
    interactive = models.ForeignKey(
        "Cabinet.Interactive",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="meeting_sessions",
        verbose_name="Интерактив",
    )
    cabinet_file = models.ForeignKey(
        "Cabinet.CabinetFile",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="meeting_sessions",
        verbose_name="Файл хранилища",
    )
    resource_kind = models.CharField(
        "Тип ресурса",
        max_length=32,
        help_text="pdf | presentation | image | text | workbook | interactive | cards | test | exercise | file | embed | notes | link",
    )
    title = models.CharField("Название", max_length=255, blank=True, default="")
    open_url = models.CharField(
        "Безопасный URL открытия",
        max_length=1024,
        blank=True,
        default="",
        help_text="Относительный или проверенный URL без приватных путей файловой системы",
    )
    content_text = models.TextField("Текстовое содержимое", blank=True, default="")
    opened_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="opened_meeting_material_sessions",
        verbose_name="Открыл",
    )
    interaction_mode = models.CharField(
        "Режим взаимодействия",
        max_length=20,
        choices=MeetingMaterialInteractionMode.choices,
        default=MeetingMaterialInteractionMode.VIEW_ONLY,
        help_text="view_only / collaborative — рисование и аннотации",
    )
    follow_policy = models.CharField(
        "Следование за ведущим",
        max_length=20,
        choices=MeetingMaterialFollowPolicy.choices,
        default=MeetingMaterialFollowPolicy.STRICT,
        help_text="strict — ученик на странице ведущего; independent — может листать сам",
    )
    controller = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="controlled_meeting_material_sessions",
        verbose_name="Кто управляет материалом",
        help_text="Ведущий глобальной позиции (учитель или соучитель)",
    )
    collaborative_scope = models.CharField(
        "Кому разрешено совместное управление",
        max_length=20,
        choices=MeetingMaterialCollaborativeScope.choices,
        default=MeetingMaterialCollaborativeScope.ALL,
    )
    collaborative_user_ids = models.JSONField(
        "User id с правом совместного управления",
        default=list,
        blank=True,
        help_text="Используется при scope=selected; пустой список при scope=all означает всех учеников урока",
    )
    independent_user_ids = models.JSONField(
        "User id в самостоятельном просмотре",
        default=list,
        blank=True,
        help_text="Персональные исключения из strict follow",
    )
    current_state = models.JSONField("Состояние материала", default=dict, blank=True)
    recent_operation_ids = models.JSONField(
        "Недавние operation_id (идемпотентность)",
        default=list,
        blank=True,
    )
    is_active = models.BooleanField("Активна", default=True, db_index=True)
    version = models.PositiveIntegerField("Версия состояния", default=1)
    opened_at = models.DateTimeField("Открыта", default=timezone.now)
    updated_at = models.DateTimeField("Обновлена", auto_now=True)
    closed_at = models.DateTimeField("Закрыта", null=True, blank=True)

    class Meta:
        verbose_name = "Сессия материала видеоурока"
        verbose_name_plural = "Сессии материалов видеоурока"
        ordering = ["-opened_at"]
        indexes = [
            models.Index(fields=["meeting", "is_active"]),
        ]

    def __str__(self):
        return f"{self.meeting_id}:{self.resource_kind}:{self.title or self.pk}"


class MeetingMaterialWork(models.Model):
    """
    Снимок совместной работы по материалу в рамках урока.
    Исходный Material / Interactive не изменяется.
    """

    session = models.ForeignKey(
        MeetingMaterialSession,
        on_delete=models.CASCADE,
        related_name="works",
        verbose_name="Сессия",
    )
    meeting = models.ForeignKey(
        "Cabinet.VideoMeeting",
        on_delete=models.CASCADE,
        related_name="material_works",
        verbose_name="Видеоурок",
    )
    title = models.CharField("Название", max_length=255, blank=True, default="")
    resource_kind = models.CharField("Тип ресурса", max_length=32, blank=True, default="")
    state = models.JSONField("Итоговое состояние", default=dict, blank=True)
    authors = models.JSONField("Авторы изменений", default=list, blank=True)
    version = models.PositiveIntegerField("Версия на момент сохранения", default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Результат работы с материалом урока"
        verbose_name_plural = "Результаты работы с материалами урока"
        ordering = ["-updated_at"]

    def __str__(self):
        return f"work:{self.session_id}:{self.pk}"
