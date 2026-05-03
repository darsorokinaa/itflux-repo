from django.db import models
from django.db.models import DO_NOTHING, CASCADE
from django.utils import timezone
import os
from uuid import uuid4
from django_ckeditor_5.fields import CKEditor5Field


def task_url(instance, filename):
    ext = filename.split('.')[-1].lower()

    level = instance.task.task.level.level
    subject = instance.task.task.subject.subject_short
    task_number = instance.task.task.task_number
    task_id = instance.task.id

    return os.path.join(
        'tasks_images',
        level,
        subject,
        f'task_{task_number}',
        f'{task_id}_{uuid4().hex[:10]}.{ext}'
    )



class Level(models.Model):
    level = models.CharField(max_length=10, db_index=True)
    level_rus = models.CharField(max_length=50, default='')
    def __str__(self):
        return self.level


class Subject(models.Model):
    subject_short = models.CharField(max_length=50, db_index=True)
    subject_name = models.CharField(max_length=200)

    def __str__(self):
        return self.subject_short

class Part(models.Model):
    part_title = models.CharField(max_length=35, blank=True, null=True)

    def __str__(self):
        return self.part_title

class TaskList(models.Model):
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    part = models.ForeignKey(Part, on_delete=CASCADE, blank=True, null=True, default=1)
    task_number = models.IntegerField()
    task_title = models.CharField(max_length=100)
    max_score = models.IntegerField(default=1)

    SUBDIVISION_CHOICES = [
        ("alg", "Алгебра"),
        ("geom", "Геометрия"),
    ]
    subdivision = models.CharField(
        max_length=20,
        blank=True,
        choices=SUBDIVISION_CHOICES,
        verbose_name="Подраздел",
        help_text="Только для математики: Алгебра / Геометрия",
    )

    class Meta:
        indexes = [
            models.Index(fields=['subject', 'level'], name='tasklist_subject_level_idx'),
        ]

    def __str__(self):
        return f'{self.subject} {self.level}: {self.task_number} - {self.task_title}'

# Банк задач
class Task(models.Model):
    task = models.ForeignKey(TaskList, on_delete=CASCADE, null=True, db_index=True)
    subtopic = models.ForeignKey(          # ← новое
        'SubTopic',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        db_index=True
    )
    task_template = CKEditor5Field("Task text", config_name='default')
    files = models.FileField(upload_to='task_files', blank=True, null=True)

    answer = CKEditor5Field("Ответ", config_name='default', blank=True)

    author = models.TextField(max_length=500, blank=True, null=True)

    max_score = models.IntegerField(default=1)

    added_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_by = models.CharField(default='ADMIN', db_index=True)

    def __str__(self):
        return f'{self.id}: {self.task_template[:100]}'

class Tags(models.Model):
    tag = models.CharField(max_length=20, null=True, blank=True, default="Экзамен")

    def __str__(self):
        return self.tag


class LinkedTaskGroup(models.Model):
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    task_numbers = models.JSONField(default=list)

    class Meta:
        unique_together = [("subject", "level")]
        verbose_name = "Связанная группа номеров"

    def __str__(self):
        return f"{self.subject} / {self.level}: {self.task_numbers}"


class TaskGroup(models.Model):
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    subtopic = models.ForeignKey(
        "SubTopic",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="task_groups",
    )

    class Meta:
        verbose_name = "Группа заданий"
        indexes = [
            models.Index(fields=['subject', 'level'], name='taskgroup_subject_level_idx'),
        ]

    def __str__(self):
        return f"Группа {self.id} ({self.subject} / {self.level})"


class TaskGroupMember(models.Model):
    task_group = models.ForeignKey(TaskGroup, on_delete=CASCADE)
    task = models.ForeignKey(Task, on_delete=CASCADE)
    task_number = models.IntegerField()

    class Meta:
        ordering = ["task_number"]
        unique_together = [("task_group", "task_number")]
        verbose_name = "Задание в группе"

    def __str__(self):
        return f"Группа {self.task_group_id}: №{self.task_number}"


class Variant(models.Model):
    var_subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    created_at = models.DateTimeField(default=timezone.now)
    created_by = models.CharField(max_length=100, default='ADMIN')
    share_token = models.CharField(max_length=20, blank=True, null=True)
    content = models.JSONField(default=dict, blank=True, null=True)  # {tasklist_id: count}
    def __str__(self):
        return f'Вариант {self.id} -  {self.var_subject}: {self.level}'


class VariantContent(models.Model):
    variant = models.ForeignKey(Variant, on_delete=CASCADE)
    task = models.ForeignKey(Task, on_delete=CASCADE)
    order = models.IntegerField()

    class Meta:
        ordering = ['order']
        indexes = [
            models.Index(fields=['variant', 'order'], name='vc_variant_order_idx'),
        ]

    def __str__(self):
        return f'Вариант {str(self.variant.id)} задание {self.task_id} ({self.variant.var_subject.subject_name} {self.variant.level})'

class TagsList(models.Model):
    tag = models.CharField(max_length=20)

    def __str__(self):
        return self.tag

class Tag(models.Model):
    task = models.ForeignKey(
        Task,
        on_delete=CASCADE,
        related_name='tags'
    )
    taskTag = models.ForeignKey(
        TagsList,
        on_delete=CASCADE,
        related_name='task_items',
        related_query_name='task_item'
    )

    def __str__(self):
        return f'Task: {self.task.id}: {self.taskTag.tag}'

class MarkComment(models.Model):
    MARK_LEVEL_CHOICES = [
        (1, "Недостаточно"),   # красный
        (2, "Порог"),          # оранжевый
        (3, "Средний балл"),   # жёлтый
        (4, "Высокий"),        # зелёный
    ]
    comment_text = models.TextField()
    mark_level = models.IntegerField(choices=MARK_LEVEL_CHOICES, default=0, blank=True)

    class Meta:
        verbose_name = "Комментарий к баллу"

    def __str__(self):
        return self.comment_text


class Mark(models.Model):
    score = models.IntegerField(default=0)
    score_exam = models.IntegerField(default=0)
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE, blank=True, null=True)
    comment = models.ForeignKey(MarkComment, on_delete=CASCADE, null=True, blank=True)

    class Meta:
        verbose_name = "Баллы и оценки"

    def __str__(self):
        return f"{self.subject}: {self.score} → {self.score_exam}"

class SupportInfo(models.Model):
    info_text = CKEditor5Field()
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE, blank=True, null=True)
    
    class Meta:
        verbose_name = "Справочная информация"
    def __str__(self):
        return self.info_text[:50]

class PreviewType(models.Model):
    preview_type_text = models.CharField(max_length=200)

    class Meta:
        verbose_name = "Тип подсказки"
    
    def __str__(self):
        return self.preview_type_text


class TaskPreview(models.Model):
    task_preview_text = CKEditor5Field()
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE, blank=True, null=True)
    part = models.ForeignKey(Part, on_delete=CASCADE, blank=True, null=True)
    preview_type = models.ForeignKey(PreviewType, on_delete=CASCADE, blank=True, null=True)

    class Meta:
        verbose_name = "Текст перед задачами"

# Добавь новую модель SubTopic
class SubTopic(models.Model):
    task_list = models.ForeignKey(
        TaskList,
        on_delete=CASCADE,
        related_name='subtopics'
    )
    title = models.CharField(max_length=100)
    order = models.IntegerField(default=0)

    class Meta:
        verbose_name = "Подтемы"
        ordering = ['order', 'title']
        unique_together = [('task_list', 'title')]

    def __str__(self):
        tl = self.task_list
        if tl:
            return f"{tl.subject} №{tl.task_number} {tl.level}: {self.title}"
        return self.title


class Update(models.Model):
    """Обновления платформы: заголовок, краткое описание и время добавления."""
    SHOW_CHOICES = [
        (True, "Показывать"),
        (False, "Скрыть"),
    ]
    title = models.CharField(verbose_name="Заголовок", max_length=255)
    description = models.TextField(verbose_name="Краткое описание", blank=True)
    created = models.DateTimeField(
        verbose_name="Время добавления",
        auto_now_add=True,
        editable=False,
    )
    show = models.BooleanField(
        verbose_name="Статус показа",
        default=True,
        choices=SHOW_CHOICES,
        help_text="Показывать это обновление пользователям",
    )

    class Meta:
        verbose_name = "Обновление"
        verbose_name_plural = "Обновления"
        ordering = ["-created"]

    def __str__(self):
        return f"{self.created.strftime('%Y-%m-%d %H:%M')}: {self.title}"


class Announcement(models.Model):
    """Объявление на главной странице (index)."""
    title = models.CharField(verbose_name="Заголовок", max_length=255)
    body = CKEditor5Field(verbose_name="Текст", blank=True, config_name="default")
    corner_image = models.ImageField(
        upload_to="announcements",
        blank=True,
        null=True,
        verbose_name="Картинка в углу",
        help_text="Необязательно. Нижний левый угол карточки на главной странице.",
    )
    button_label = models.CharField(verbose_name="Подпись кнопки", max_length=120, blank=True)
    button_url = models.CharField(
        verbose_name="Ссылка кнопки",
        max_length=500,
        blank=True,
        help_text="Полный URL или путь на сайте, например /oge",
    )
    background = models.ImageField(
        upload_to="announcements/bg",
        blank=True,
        null=True,
        verbose_name="Фон слайда",
        help_text="Фоновая картинка слайда на главной. Если не указана — синий градиент по умолчанию.",
    )
    theme_overlay = models.ImageField(
        upload_to="announcements/theme", blank=True, null=True,
        verbose_name="Тема: оверлей на фон",
        help_text="Картинка поверх фона сайта (repeat). Пусто = без оверлея.",
    )
    theme_header_bg = models.ImageField(
        upload_to="announcements/theme", blank=True, null=True,
        verbose_name="Тема: фон шапки",
    )
    theme_logo = models.ImageField(
        upload_to="announcements/theme", blank=True, null=True,
        verbose_name="Тема: иконка у логотипа",
    )
    theme_decor = models.ImageField(
        upload_to="announcements/theme", blank=True, null=True,
        verbose_name="Тема: декоративные элементы",
        help_text="Картинка-декор поверх контента (repeat, полупрозрачная).",
    )
    theme_worksheet_bg = models.ImageField(
        upload_to="announcements/theme", blank=True, null=True,
        verbose_name="Тема: фон рабочего листа",
        help_text="Фоновая картинка для рабочего листа (основной контентной области).",
    )
    show = models.BooleanField(verbose_name="Показывать", default=True)
    sort_order = models.PositiveSmallIntegerField(
        verbose_name="Порядок",
        default=0,
        help_text="Чем меньше число, тем выше объявление в списке",
    )
    created = models.DateTimeField(verbose_name="Создано", auto_now_add=True)

    class Meta:
        verbose_name = "Объявление"
        verbose_name_plural = "Объявления"
        ordering = ["sort_order", "-created"]

    def __str__(self):
        return self.title


class Criteria(models.Model):
    task_number = models.ForeignKey(TaskList, on_delete=CASCADE)
    criteria_text = CKEditor5Field()
    criteria_score = models.IntegerField(default=0)

    class Meta:
        verbose_name = "Критерий"
        verbose_name_plural = "Критерии"


class ErrorReport(models.Model):
    ERROR_TYPES = [
        ("typo", "Опечатка"),
        ("wrong_condition", "Неверное условие"),
        ("wrong_answer", "Не сходится ответ"),
        ("other", "Другое"),
    ]

    subject = models.CharField(max_length=50, verbose_name="Предмет")
    level = models.CharField(max_length=10, verbose_name="Уровень")
    task_number = models.IntegerField(null=True, blank=True, verbose_name="Номер задания")
    task_id = models.IntegerField(null=True, blank=True, verbose_name="ID задачи")
    variant_id = models.IntegerField(null=True, blank=True, verbose_name="ID варианта")
    error_type = models.CharField(max_length=30, choices=ERROR_TYPES, verbose_name="Тип ошибки")
    comment = models.TextField(blank=True, default="", verbose_name="Комментарий")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Дата отправки")
    is_fixed = models.BooleanField(default=False, verbose_name="Исправлено")
    digest_sent = models.BooleanField(default=False, verbose_name="Отправлено в дайджест")

    class Meta:
        verbose_name = "Сообщение об ошибке"
        verbose_name_plural = "Сообщения об ошибках"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Ошибка №{self.task_number} ({self.subject} {self.level}) — {self.get_error_type_display()}"


class LessonRoom(models.Model):
    """Комната урока по ссылке из ЛК (JWT): идентификатор и снимок полезной нагрузки токена."""

    room_id = models.CharField(max_length=200, unique=True, db_index=True)
    jwt_payload = models.JSONField(default=dict, blank=True)
    lesson_ended_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Урок завершён",
        help_text="После установки вход по той же ссылке (комната) запрещён.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Комната урока (ЛК)"
        verbose_name_plural = "Комнаты уроков (ЛК)"

    def __str__(self):
        return f"LessonRoom {self.room_id}"


def username_for_created_by(request):
    """Строка для поля created_by: логин авторизованного пользователя или ADMIN."""
    if request is None:
        return "ADMIN"
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        name = (getattr(user, "username", None) or "").strip()
        if name:
            return name[:100]
    return "ADMIN"

class LessonStudentsAnswer(models.Model):
    room_id = models.CharField(max_length=200, db_index=True, blank=True, default="")
    variant_id = models.PositiveIntegerField(default=0, db_index=True)
    task_number = models.CharField(max_length=32, blank=True, default="")
    teacher = models.CharField(max_length=200, blank=True, default="")
    student = models.CharField(max_length=200, blank=True, default="")
    answer = models.TextField(blank=True, default="")
    is_correct = models.BooleanField(default=False)
    is_empty = models.BooleanField(default=False)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ответ ученика на уроке"
        verbose_name_plural = "Ответы учеников на уроке"
        indexes = [
            models.Index(fields=["room_id", "variant_id"], name="lesson_answer_room_variant_idx"),
            models.Index(fields=["variant_id", "task_number"], name="lesson_answer_variant_task_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["room_id", "variant_id", "task_number", "student"],
                name="lesson_answer_unique_per_student_task",
            )
        ]

    def __str__(self):
        task = self.task_number or "?"
        return f"room={self.room_id} variant={self.variant_id} task={task} student={self.student}"


class LessonStudentResult(models.Model):
    room_id = models.CharField(max_length=200, db_index=True, blank=True, default="")
    variant_id = models.PositiveIntegerField(default=0, db_index=True)
    teacher = models.CharField(max_length=200, blank=True, default="")
    student = models.CharField(max_length=200, blank=True, default="")
    total_tasks = models.PositiveIntegerField(default=0)
    correct_count = models.PositiveIntegerField(default=0)
    wrong_count = models.PositiveIntegerField(default=0)
    empty_count = models.PositiveIntegerField(default=0)
    teacher_comment = models.TextField(blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Результат ученика в уроке"
        verbose_name_plural = "Результаты учеников в уроке"
        indexes = [
            models.Index(fields=["room_id", "variant_id"], name="lesson_result_room_variant_idx"),
            models.Index(fields=["room_id", "student"], name="lesson_result_room_student_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["room_id", "variant_id", "student"],
                name="lesson_result_unique_per_student",
            )
        ]

    def __str__(self):
        return (
            f"room={self.room_id} variant={self.variant_id} student={self.student} "
            f"{self.correct_count}/{self.total_tasks}"
        )