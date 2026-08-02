"""Электронный журнал успеваемости (академический). Не путать с BillingTransaction."""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.db import models

from .choices import CommentVisibility


class AttendanceStatus(models.TextChoices):
    PRESENT = "present", "Присутствовал"
    LATE = "late", "Опоздал"
    LEFT_EARLY = "left_early", "Ушёл раньше"
    PARTIAL = "partial", "Присутствовал часть урока"
    ABSENT_EXCUSED = "absent_excused", "Отсутствовал по уважительной причине"
    ABSENT_UNEXCUSED = "absent_unexcused", "Отсутствовал без предупреждения"
    CANCELLED_BY_STUDENT = "cancelled_by_student", "Отменено учеником"
    CANCELLED_BY_TEACHER = "cancelled_by_teacher", "Отменено учителем"
    TECHNICAL_ISSUE = "technical_issue", "Урок не состоялся по технической причине"
    NOT_MARKED = "not_marked", "Не отмечено"


class JournalStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    COMPLETED = "completed", "Заполнен"
    REOPENED = "reopened", "Открыт повторно"
    CANCELLED = "cancelled", "Отменён"


class RecordPublishStatus(models.TextChoices):
    DRAFT = "draft", "Черновик"
    SAVED = "saved", "Сохранено"
    PUBLISHED = "published", "Опубликовано"
    EDITED_AFTER_PUBLISH = "edited_after_publish", "Изменено после публикации"


class ScaleType(models.TextChoices):
    FIVE_POINT = "five_point", "Шкала 1–5"
    TEN_POINT = "ten_point", "Шкала 1–10"
    PERCENTAGE = "percentage", "Проценты"
    BINARY = "binary", "Да/нет"


class OverallScoreMode(models.TextChoices):
    NONE = "none", "Без общей оценки"
    FIVE_POINT = "five_point", "Оценка 1–5"
    TEN_POINT = "ten_point", "Оценка 1–10"
    PERCENTAGE = "percentage", "Проценты"
    AUTO_AVERAGE = "auto_average", "Автоматический средний результат"


class PublishMode(models.TextChoices):
    IMMEDIATE = "immediate", "Сразу после сохранения"
    MANUAL = "manual", "После ручной публикации"
    HIDDEN = "hidden", "Не показывать"


class PreviousHomeworkStatus(models.TextChoices):
    FULL = "full", "Выполнено полностью"
    PARTIAL = "partial", "Выполнено частично"
    NOT_DONE = "not_done", "Не выполнено"
    NOT_ASSIGNED = "not_assigned", "Не было задано"
    NOT_REVIEWED = "not_reviewed", "Не проверено"


class AttentionReason(models.TextChoices):
    SYSTEMATIC_ABSENCES = "systematic_absences", "Систематические пропуски"
    HOMEWORK_NOT_DONE = "homework_not_done", "Не выполняет домашние задания"
    TOPIC_DIFFICULTY = "topic_difficulty", "Трудности с темой"
    ACTIVITY_DROP = "activity_drop", "Снизилась активность"
    PARENT_CONTACT = "parent_contact", "Нужна связь с родителем"
    CUSTOM = "custom", "Индивидуальная причина"


ABSENT_ATTENDANCE = frozenset({
    AttendanceStatus.ABSENT_EXCUSED,
    AttendanceStatus.ABSENT_UNEXCUSED,
    AttendanceStatus.CANCELLED_BY_STUDENT,
    AttendanceStatus.CANCELLED_BY_TEACHER,
    AttendanceStatus.TECHNICAL_ISSUE,
})

DEFAULT_CRITERIA = (
    ("Активность", "Участие и вовлечённость на уроке", ScaleType.FIVE_POINT, True),
    ("Подготовленность", "Готовность к уроку и выполнение предыдущего материала", ScaleType.FIVE_POINT, False),
    ("Понимание темы", "Насколько ученик понял материал", ScaleType.FIVE_POINT, True),
    ("Самостоятельность", "Способность работать без подсказок", ScaleType.FIVE_POINT, True),
    ("Внимательность", "Концентрация на уроке", ScaleType.FIVE_POINT, False),
    ("Темп работы", "Скорость выполнения заданий", ScaleType.FIVE_POINT, False),
    ("Точность выполнения", "Аккуратность и правильность решений", ScaleType.FIVE_POINT, False),
    ("Работа на уроке", "Общий результат работы на занятии", ScaleType.FIVE_POINT, True),
)

RECOMMENDED_CRITERION_TITLES = frozenset({
    "Активность",
    "Понимание темы",
    "Самостоятельность",
    "Работа на уроке",
})

DEFAULT_TAGS = (
    ("Отлично работал", True),
    ("Активно отвечал", True),
    ("Быстро понял тему", True),
    ("Нужна дополнительная практика", True),
    ("Были трудности", True),
    ("Невнимательность", True),
    ("Не подготовился", True),
    ("Не выполнил домашнее задание", True),
    ("Сделал заметный прогресс", True),
    ("Нужно повторить тему", True),
)

SCALE_BOUNDS = {
    ScaleType.FIVE_POINT: (Decimal("1"), Decimal("5")),
    ScaleType.TEN_POINT: (Decimal("1"), Decimal("10")),
    ScaleType.PERCENTAGE: (Decimal("0"), Decimal("100")),
    ScaleType.BINARY: (Decimal("0"), Decimal("1")),
}


class AssessmentCriterion(models.Model):
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assessment_criteria",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=100)
    description = models.CharField("Описание", max_length=500, blank=True)
    scale_type = models.CharField(
        "Шкала",
        max_length=32,
        choices=ScaleType.choices,
        default=ScaleType.FIVE_POINT,
    )
    min_value = models.DecimalField("Мин.", max_digits=6, decimal_places=2, default=Decimal("1"))
    max_value = models.DecimalField("Макс.", max_digits=6, decimal_places=2, default=Decimal("5"))
    sort_order = models.PositiveIntegerField("Порядок", default=0)
    is_active = models.BooleanField("Активен", default=True)
    is_recommended_default = models.BooleanField("В рекомендуемом наборе", default=False)
    visible_to_student = models.BooleanField("Виден ученику", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Критерий оценки"
        verbose_name_plural = "Критерии оценки"
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "title"],
                name="cabinet_unique_teacher_criterion_title",
            ),
        ]

    def __str__(self):
        return self.title


class AssessmentTemplate(models.Model):
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assessment_templates",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=255)
    criteria = models.ManyToManyField(
        AssessmentCriterion,
        through="AssessmentTemplateCriterion",
        related_name="templates",
        blank=True,
    )
    is_default = models.BooleanField("Общий шаблон по умолчанию", default=False)
    subject = models.CharField("Предмет", max_length=100, blank=True)
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assessment_templates",
        verbose_name="Ученик",
    )
    group = models.ForeignKey(
        "Cabinet.StudentGroup",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assessment_templates",
        verbose_name="Группа",
    )
    lesson_type = models.CharField("Тип урока", max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Шаблон критериев"
        verbose_name_plural = "Шаблоны критериев"
        ordering = ["title"]

    def __str__(self):
        return self.title


class AssessmentTemplateCriterion(models.Model):
    template = models.ForeignKey(
        AssessmentTemplate,
        on_delete=models.CASCADE,
        related_name="template_criteria",
    )
    criterion = models.ForeignKey(
        AssessmentCriterion,
        on_delete=models.CASCADE,
        related_name="template_links",
    )
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Критерий в шаблоне"
        verbose_name_plural = "Критерии в шаблонах"
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["template", "criterion"],
                name="cabinet_unique_template_criterion",
            ),
        ]


class JournalTag(models.Model):
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="journal_tags",
        verbose_name="Учитель",
    )
    title = models.CharField("Название", max_length=120)
    is_active = models.BooleanField("Активен", default=True)
    visible_to_student = models.BooleanField("Виден ученику", default=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Тег журнала"
        verbose_name_plural = "Теги журнала"
        ordering = ["sort_order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["teacher", "title"],
                name="cabinet_unique_teacher_journal_tag",
            ),
        ]

    def __str__(self):
        return self.title


class JournalTeacherSettings(models.Model):
    teacher = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="journal_settings",
        verbose_name="Учитель",
    )
    overall_score_mode = models.CharField(
        max_length=32,
        choices=OverallScoreMode.choices,
        default=OverallScoreMode.AUTO_AVERAGE,
    )
    require_topic = models.BooleanField(default=False)
    require_attendance = models.BooleanField(default=True)
    require_comment = models.BooleanField(default=False)
    auto_calculate_overall = models.BooleanField(default=True)
    publish_mode = models.CharField(
        max_length=32,
        choices=PublishMode.choices,
        default=PublishMode.MANUAL,
    )
    show_results_to_student = models.BooleanField(
        "Показывать результаты ученику автоматически",
        default=True,
    )
    show_results_to_parent = models.BooleanField(default=False)
    notify_student_on_publish = models.BooleanField(default=True)
    notify_teacher_daily_digest = models.BooleanField(default=True)
    default_template = models.ForeignKey(
        AssessmentTemplate,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Настройки журнала"
        verbose_name_plural = "Настройки журнала"

    def __str__(self):
        return f"Журнал: {self.teacher_id}"


class LessonJournal(models.Model):
    schedule_event = models.OneToOneField(
        "Cabinet.ScheduleEvent",
        on_delete=models.CASCADE,
        related_name="journal",
        verbose_name="Урок расписания",
    )
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="lesson_journals",
        verbose_name="Учитель",
    )
    group = models.ForeignKey(
        "Cabinet.StudentGroup",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="lesson_journals",
        verbose_name="Группа",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="individual_lesson_journals",
        verbose_name="Ученик (индивидуальный)",
    )
    lesson_date = models.DateField("Дата урока")
    started_at = models.DateTimeField("Фактическое начало", null=True, blank=True)
    finished_at = models.DateTimeField("Фактическое окончание", null=True, blank=True)
    planned_duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    actual_duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    planned_topic = models.CharField("Плановая тема", max_length=500, blank=True)
    actual_topic = models.CharField("Фактическая тема", max_length=500, blank=True)
    lesson_summary = models.TextField("Общий итог урока", blank=True)
    material_covered = models.TextField("Фактически пройденный материал", blank=True)
    material_to_repeat = models.TextField("Материал для повторения", blank=True)
    next_lesson_plan = models.TextField("План следующего урока", blank=True)
    recommendations = models.TextField("Рекомендации", blank=True)
    status = models.CharField(
        max_length=32,
        choices=JournalStatus.choices,
        default=JournalStatus.DRAFT,
    )
    assessment_template = models.ForeignKey(
        AssessmentTemplate,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journals",
    )
    homework = models.ForeignKey(
        "Cabinet.Homework",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_assignments",
        verbose_name="Выданное ДЗ",
    )
    homework_skipped = models.BooleanField("ДЗ не выдавать", default=False)
    previous_homework = models.ForeignKey(
        "Cabinet.Homework",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_previous_refs",
    )
    previous_homework_status = models.CharField(
        max_length=32,
        choices=PreviousHomeworkStatus.choices,
        blank=True,
        default="",
    )
    overall_score_mode = models.CharField(
        max_length=32,
        choices=OverallScoreMode.choices,
        default=OverallScoreMode.AUTO_AVERAGE,
    )
    overall_score_formula = models.CharField(max_length=255, blank=True)
    version = models.PositiveIntegerField(default=1)
    edit_token = models.CharField(max_length=64, blank=True, default="")
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_lesson_journals",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_lesson_journals",
    )
    is_archived = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Журнал урока"
        verbose_name_plural = "Журналы уроков"
        ordering = ["-lesson_date", "-id"]

    def __str__(self):
        return f"Журнал #{self.pk} · {self.lesson_date}"


class StudentLessonRecord(models.Model):
    journal = models.ForeignKey(
        LessonJournal,
        on_delete=models.CASCADE,
        related_name="student_records",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="lesson_records",
        verbose_name="Ученик",
    )
    attendance_status = models.CharField(
        max_length=32,
        choices=AttendanceStatus.choices,
        default=AttendanceStatus.NOT_MARKED,
    )
    late_minutes = models.PositiveIntegerField(null=True, blank=True)
    attended_minutes = models.PositiveIntegerField(null=True, blank=True)
    overall_score = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
    )
    overall_score_manual = models.BooleanField(default=False)
    overall_score_explanation = models.CharField(max_length=500, blank=True)
    teacher_comment = models.TextField("Комментарий ученику", blank=True)
    comment_visibility = models.CharField(
        "Видимость комментария",
        max_length=32,
        choices=CommentVisibility.choices,
        default=CommentVisibility.STUDENT_ONLY,
        help_text="Старые комментарии по умолчанию только ученику; родителю не открываются автоматически.",
    )
    private_note = models.TextField("Приватная заметка", blank=True)
    recommendation = models.TextField("Рекомендации", blank=True)
    strengths = models.TextField("Сильные стороны", blank=True)
    difficulties = models.TextField("Трудности", blank=True)
    variant_result = models.JSONField(
        "Результат варианта на уроке",
        default=dict,
        blank=True,
        help_text="Подробные ответы live-варианта: задания, ответы ученика, верно/неверно, %",
    )
    visible_to_student = models.BooleanField(default=True)
    visible_to_parent = models.BooleanField(default=False)
    requires_attention = models.BooleanField(default=False)
    publish_status = models.CharField(
        max_length=32,
        choices=RecordPublishStatus.choices,
        default=RecordPublishStatus.DRAFT,
    )
    published_at = models.DateTimeField(null=True, blank=True)
    last_notified_at = models.DateTimeField(null=True, blank=True)
    fields_touched = models.JSONField(default=dict, blank=True)
    tags = models.ManyToManyField(
        JournalTag,
        through="StudentLessonRecordTag",
        related_name="student_records",
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Запись ученика по уроку"
        verbose_name_plural = "Записи учеников по урокам"
        ordering = ["student_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["journal", "student"],
                name="cabinet_unique_journal_student_record",
            ),
        ]

    def __str__(self):
        return f"Record journal={self.journal_id} student={self.student_id}"


class StudentLessonRecordTag(models.Model):
    record = models.ForeignKey(
        StudentLessonRecord,
        on_delete=models.CASCADE,
        related_name="tag_links",
    )
    tag = models.ForeignKey(
        JournalTag,
        on_delete=models.CASCADE,
        related_name="record_links",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["record", "tag"],
                name="cabinet_unique_record_tag",
            ),
        ]


class StudentCriterionScore(models.Model):
    student_record = models.ForeignKey(
        StudentLessonRecord,
        on_delete=models.CASCADE,
        related_name="criterion_scores",
    )
    criterion = models.ForeignKey(
        AssessmentCriterion,
        on_delete=models.PROTECT,
        related_name="scores",
    )
    value = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
    )
    is_not_applicable = models.BooleanField("Не оценивалось", default=False)
    comment = models.CharField(max_length=500, blank=True)

    class Meta:
        verbose_name = "Оценка по критерию"
        verbose_name_plural = "Оценки по критериям"
        constraints = [
            models.UniqueConstraint(
                fields=["student_record", "criterion"],
                name="cabinet_unique_record_criterion_score",
            ),
        ]


class JournalAttentionMarker(models.Model):
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="journal_attention_markers",
    )
    student = models.ForeignKey(
        "Cabinet.Student",
        on_delete=models.CASCADE,
        related_name="attention_markers",
    )
    reason = models.CharField(max_length=64, choices=AttentionReason.choices)
    custom_reason = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True)
    note = models.TextField(blank=True)
    source_record = models.ForeignKey(
        StudentLessonRecord,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attention_markers",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Маркер внимания"
        verbose_name_plural = "Маркеры внимания"
        ordering = ["-updated_at"]


class JournalAuditLog(models.Model):
    journal = models.ForeignKey(
        LessonJournal,
        on_delete=models.CASCADE,
        related_name="audit_logs",
        null=True,
        blank=True,
    )
    student_record = models.ForeignKey(
        StudentLessonRecord,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_audit_actions",
    )
    action = models.CharField(max_length=64)
    field_name = models.CharField(max_length=128, blank=True)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Аудит журнала"
        verbose_name_plural = "Аудит журнала"
        ordering = ["-created_at"]


class JournalEditLock(models.Model):
    journal = models.OneToOneField(
        LessonJournal,
        on_delete=models.CASCADE,
        related_name="edit_lock",
    )
    holder = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="journal_edit_locks",
    )
    tab_token = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Блокировка редактирования журнала"
        verbose_name_plural = "Блокировки редактирования журнала"
