from django.db import models
from django.db.models import DO_NOTHING, CASCADE
from django.contrib.contenttypes.fields import GenericForeignKey, GenericRelation
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils.deconstruct import deconstructible
from django.utils.text import slugify
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


def _safe_ext(filename, fallback=".bin"):
    ext = os.path.splitext(filename or "")[1].lower()
    return ext or fallback


def lesson_cover_upload_to(instance, filename):
    return os.path.join("lessons", "covers", f"{uuid4().hex}{_safe_ext(filename, '.jpg')}")


def subject_background_upload_to(instance, filename):
    short = slugify(instance.subject_short or "subject") or "subject"
    return os.path.join("subjects", "backgrounds", short, f"{uuid4().hex}{_safe_ext(filename, '.jpg')}")


def lesson_file_resource_upload_to(instance, filename):
    return os.path.join("lessons", "resources", f"{uuid4().hex}{_safe_ext(filename)}")


def lesson_file_upload_to(instance, filename):
    return os.path.join("lessons", "files", f"{uuid4().hex}{_safe_ext(filename)}")


def lesson_archive_upload_to(instance, filename):
    return os.path.join("lessons", "archives", f"{uuid4().hex}{_safe_ext(filename, '.zip')}")


def interesting_cover_upload_to(instance, filename):
    return os.path.join("interesting", "covers", f"{uuid4().hex}{_safe_ext(filename, '.jpg')}")


def interesting_file_upload_to(instance, filename):
    return os.path.join("interesting", "files", f"{uuid4().hex}{_safe_ext(filename)}")


def interesting_archive_upload_to(instance, filename):
    return os.path.join("interesting", "archives", f"{uuid4().hex}{_safe_ext(filename, '.zip')}")


def presentation_public_pdf_upload_to(instance, filename):
    return os.path.join("lessons", "presentations", "pdf", f"{uuid4().hex}{_safe_ext(filename, '.pdf')}")


def presentation_slide_upload_to(instance, filename):
    return os.path.join("lessons", "presentations", "slides", f"{uuid4().hex}{_safe_ext(filename, '.png')}")


def presentation_original_upload_to(instance, filename):
    return os.path.join("presentations", "originals", f"{uuid4().hex}{_safe_ext(filename, '.pptx')}")


@deconstructible
class PrivateMediaStorage(FileSystemStorage):
    """
    Storage for editable source files (e.g. PPTX) outside public MEDIA_ROOT.
    """

    def __init__(self, *args, **kwargs):
        location = kwargs.pop("location", os.path.join(settings.BASE_DIR, "private_media"))
        super().__init__(location=location, base_url=None, *args, **kwargs)

    def url(self, name):  # pragma: no cover - used only in admin previews
        safe_name = str(name or "").lstrip("/")
        return f"/private-media/{safe_name}"


private_media_storage = PrivateMediaStorage()



class Level(models.Model):
    level = models.CharField(max_length=10, db_index=True)
    level_rus = models.CharField(max_length=50, default='')
    def __str__(self):
        return self.level


class Subject(models.Model):
    subject_short = models.CharField(max_length=50, db_index=True)
    subject_name = models.CharField(max_length=200)
    background_color = models.CharField(
        max_length=7,
        blank=True,
        default="",
        verbose_name="Фон предмета (HEX цвет)",
        help_text="Например, #311B41. Используется, если не задано изображение.",
    )
    background_image = models.ImageField(
        upload_to=subject_background_upload_to,
        blank=True,
        null=True,
        verbose_name="Фон предмета (картинка)",
        help_text="Декоративный фон для карточки предмета и hero-блока генератора вариантов.",
    )

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
    task_title = models.CharField(max_length=255)
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


class ActiveTaskManager(models.Manager):
    """Только задания с is_active=True (для банка, тренажёра и генерации вариантов)."""

    def get_queryset(self):
        return super().get_queryset().filter(is_active=True)


# Банк задач
class Task(models.Model):
    task = models.ForeignKey(
        TaskList,
        on_delete=CASCADE,
        null=True,
        db_index=True,
        verbose_name="Задача",
    )
    quick_level = models.ForeignKey(
        Level,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        db_index=True,
        verbose_name="Уровень",
        help_text="Копия уровня номера задания для правки прямо в списке админки; при изменении обновляется TaskList.level.",
    )
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

    is_active = models.BooleanField("Активна", default=True, db_index=True)

    vpr_class = models.PositiveSmallIntegerField(
        "Класс",
        null=True,
        blank=True,
        db_index=True,
        help_text="Класс для ВПР (например 7, 8, 10). Только для заданий уровня ВПР.",
    )
    vpr_advanced = models.BooleanField(
        "Углублённый",
        default=False,
        db_index=True,
        help_text="Углублённый уровень (ВПР).",
    )
    vpr_basic = models.BooleanField(
        "Базовый",
        default=False,
        db_index=True,
        help_text="Базовый уровень (ВПР).",
    )

    truth_table_enabled = models.BooleanField(
        "Таблица истинности на сайте",
        default=False,
        db_index=True,
        help_text="Если включено, на странице варианта для этого задания показывается виджет таблицы истинности; ответ по-прежнему вводится строкой из 0 и 1 без подстановки правильных значений.",
    )

    tag_options = models.ManyToManyField(
        "TagOption",
        blank=True,
        related_name="tasks",
        verbose_name="Теги",
        help_text="Теги задания из справочника (сложность и др.).",
    )

    objects = models.Manager()
    active_objects = ActiveTaskManager()

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
    vpr_class = models.PositiveSmallIntegerField(
        "Класс (ВПР)",
        blank=True,
        null=True,
        help_text="Если указано — блок показывается только при совпадении класса варианта. Пусто — для всех классов ВПР.",
    )

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


class UpdateQuerySet(models.QuerySet):
    def visible(self):
        """Опубликованные обновления: show=True, сначала новые."""
        return self.filter(show=True).order_by("-created")


class Update(models.Model):
    """Обновления платформы: заголовок, краткое описание и время добавления."""
    SHOW_CHOICES = [
        (True, "Показывать"),
        (False, "Скрыть"),
    ]
    title = models.CharField(verbose_name="Заголовок", max_length=255)
    description = models.TextField(verbose_name="Краткое описание", blank=True)
    url = models.CharField(
        verbose_name="Ссылка",
        max_length=500,
        blank=True,
        default="",
        help_text="Необязательно. Полный URL или путь на сайте, например /cabinet",
    )
    link_text = models.CharField(
        verbose_name="Текст ссылки",
        max_length=120,
        blank=True,
        default="",
        help_text="Необязательно. Если пусто и указана ссылка, на сайте будет «Подробнее →».",
    )
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

    objects = UpdateQuerySet.as_manager()

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
    # Многоосевая рубрика (говорение ЕГЭ и т.п.). Пустой axis_code = legacy single-режим.
    axis_code = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
        verbose_name="Код оси",
        help_text="Пусто — старый режим одной карточки. Иначе: phonetics, q1, content…",
    )
    axis_title = models.CharField(
        max_length=200,
        blank=True,
        default="",
        verbose_name="Название оси",
    )
    axis_order = models.PositiveSmallIntegerField(
        default=0,
        verbose_name="Порядок оси",
    )
    axis_max = models.PositiveSmallIntegerField(
        default=0,
        verbose_name="Макс. балл оси",
        help_text="0 — взять max(criteria_score) по уровням оси.",
    )
    is_gate = models.BooleanField(
        default=False,
        verbose_name="Gate-ось",
        help_text="Если по этой оси 0 баллов — всё задание обнуляется (как содержание в задании 4 устной части).",
    )

    class Meta:
        verbose_name = "Критерий"
        verbose_name_plural = "Критерии"
        ordering = ("task_number", "axis_order", "-criteria_score", "id")


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


class Lesson(models.Model):
    class ExamType(models.TextChoices):
        NONE = "", "Без экзамена"
        OGE = "oge", "ОГЭ"
        EGE = "ege", "ЕГЭ"

    class Difficulty(models.TextChoices):
        BEGINNER = "beginner", "Beginner"
        MEDIUM = "medium", "Medium"
        ADVANCED = "advanced", "Advanced"

    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        PUBLISHED = "published", "Опубликован"
        ARCHIVED = "archived", "Архив"

    class AccessLevel(models.TextChoices):
        FREE = "free", "Бесплатный (Старт)"
        TEACHER = "teacher", "Учитель"
        PROFESSIONAL = "professional", "Профи"
        PREMIUM = "premium", "Премиум"
        CORPORATE = "corporate", "Корпоративный"
        # Legacy aliases kept for DB values until data migration remaps them.
        PAID = "paid", "Платный (legacy)"
        PRIVATE = "private", "Закрытый (legacy)"

    title = models.CharField(max_length=255, db_index=True)
    slug = models.SlugField(max_length=255, unique=True, db_index=True)
    subject = models.CharField(max_length=120, db_index=True)
    grade = models.PositiveSmallIntegerField(null=True, blank=True, db_index=True)
    level = models.CharField(max_length=120, blank=True, default="", db_index=True)
    exam_type = models.CharField(
        max_length=10,
        choices=ExamType.choices,
        blank=True,
        default=ExamType.NONE,
        db_index=True,
    )
    task_number = models.PositiveSmallIntegerField(null=True, blank=True, db_index=True)
    topic = models.CharField(max_length=255, blank=True, default="", db_index=True)
    subtopic = models.CharField(max_length=255, blank=True, default="", db_index=True)
    short_description = models.TextField(blank=True, default="")
    teacher_goal = models.TextField(blank=True, default="")
    student_result = models.TextField(blank=True, default="")
    duration_minutes = models.PositiveSmallIntegerField(null=True, blank=True)
    difficulty = models.CharField(
        max_length=20,
        choices=Difficulty.choices,
        default=Difficulty.MEDIUM,
        db_index=True,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    access_level = models.CharField(
        "Доступно с тарифа",
        max_length=20,
        choices=AccessLevel.choices,
        default=AccessLevel.FREE,
        db_index=True,
        help_text="Минимальный тариф, с которого материал доступен",
    )
    published_at = models.DateTimeField(null=True, blank=True, db_index=True)
    is_new = models.BooleanField(default=False)
    new_until = models.DateTimeField(null=True, blank=True)
    cover_image = models.ImageField(upload_to=lesson_cover_upload_to, blank=True, null=True)
    card_background_image = models.ImageField(upload_to=lesson_cover_upload_to, blank=True, null=True, verbose_name="Фон карточки (картинка)")
    card_background_color = models.CharField(max_length=7, blank=True, default="", verbose_name="Фон карточки (HEX цвет)", help_text="Например, #2B52F5")
    file = models.FileField(upload_to=lesson_file_upload_to, blank=True, null=True)
    archive = models.FileField(
        upload_to=lesson_archive_upload_to,
        blank=True,
        null=True,
        verbose_name="Архив",
        help_text="ZIP, RAR или 7Z с материалами урока",
    )
    standalone_purchase_enabled = models.BooleanField(
        "Отдельная покупка",
        default=False,
        help_text="Можно купить этот урок отдельно, даже если текущий тариф ниже требуемого.",
    )
    standalone_price = models.DecimalField(
        "Цена отдельной покупки",
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
    )
    standalone_currency = models.CharField("Валюта покупки", max_length=8, default="RUB")
    demo_enabled = models.BooleanField(
        "Демоверсия",
        default=False,
        help_text="Одноразовое демо для зарегистрированных пользователей без полного доступа.",
    )
    demo_mode = models.CharField(
        "Режим демоверсии",
        max_length=32,
        choices=[
            ("partial", "Ограниченный фрагмент"),
            ("full_watermarked", "Весь урок с водяным знаком"),
        ],
        default="full_watermarked",
        help_text="Пользователю технические названия не показываются.",
    )
    demo_page_count = models.PositiveSmallIntegerField(
        "Экранов/страниц в фрагменте",
        default=3,
    )
    demo_fragment = models.TextField("Фрагмент демоверсии", blank=True, default="")
    demo_duration_minutes = models.PositiveSmallIntegerField(
        "Длительность демо (мин)",
        default=40,
        help_text="В этом релизе demo-session всегда 40 минут.",
    )
    views_count = models.PositiveIntegerField("Просмотры", default=0, db_index=True)
    likes = GenericRelation(
        "CatalogContentLike",
        related_query_name="lesson",
        content_type_field="content_type",
        object_id_field="object_id",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-created_at", "id")
        indexes = [
            models.Index(fields=["status", "access_level"], name="lesson_status_access_idx"),
            models.Index(fields=["subject", "grade"], name="lesson_subject_grade_idx"),
            models.Index(fields=["level", "exam_type"], name="lesson_level_exam_idx"),
            models.Index(fields=["topic", "subtopic"], name="lesson_topic_subtopic_idx"),
            models.Index(fields=["difficulty"], name="lesson_difficulty_idx"),
            models.Index(fields=["task_number"], name="lesson_task_number_idx"),
        ]

    def save(self, *args, **kwargs):
        if not self.slug:
            parts = []
            if self.title:
                parts.append(self.title[:30]) # Краткое название
            if self.subject:
                parts.append(self.subject)
            if self.grade:
                parts.append(f"{self.grade}-klass")
            if self.exam_type:
                parts.append(self.exam_type)
            elif self.level:
                parts.append(self.level)
                
            raw_slug = "-".join([str(p) for p in parts if p])
            from django.utils.text import slugify
            from uuid import uuid4
            base_slug = slugify(raw_slug) or f"lesson-{uuid4().hex[:8]}"
            
            candidate = base_slug
            index = 2
            while Lesson.objects.exclude(pk=self.pk).filter(slug=candidate).exists():
                candidate = f"{base_slug}-{index}"
                index += 1
            self.slug = candidate
        super().save(*args, **kwargs)

    def clean(self):
        from django.core.exceptions import ValidationError

        errors = {}
        is_free = (self.access_level or self.AccessLevel.FREE) in (
            self.AccessLevel.FREE,
            "free",
            "",
        )
        if is_free and self.demo_enabled:
            errors["demo_enabled"] = "Демоверсия не используется для бесплатных уроков."
        if self.standalone_purchase_enabled:
            if self.standalone_price is None or self.standalone_price <= 0:
                errors["standalone_price"] = "Укажите цену больше 0 для отдельной покупки."
        if self.demo_enabled and self.demo_page_count < 1:
            errors["demo_page_count"] = "Укажите хотя бы один экран для фрагмента."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return self.title


class InterestingItem(models.Model):
    """Публичный материал раздела «Интересное»: факты и HTML-интерактивы."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        PUBLISHED = "published", "Опубликован"
        ARCHIVED = "archived", "Архив"

    class AccessLevel(models.TextChoices):
        FREE = "free", "Бесплатный (Старт)"
        TEACHER = "teacher", "Учитель"
        PROFESSIONAL = "professional", "Профи"
        PREMIUM = "premium", "Премиум"
        CORPORATE = "corporate", "Корпоративный"

    title = models.CharField("Название", max_length=255, db_index=True)
    slug = models.SlugField("Slug", max_length=255, unique=True, db_index=True)
    short_description = models.TextField("Краткое описание", blank=True, default="")
    tag = models.CharField(
        "Метка",
        max_length=80,
        blank=True,
        default="Интерактив",
        help_text="Например: Интерактив, Факт",
    )
    accent_color = models.CharField(
        "Цвет карточки",
        max_length=7,
        blank=True,
        default="#1F3A8A",
        help_text="HEX, если нет обложки. Например #1F3A8A",
    )
    status = models.CharField(
        "Статус",
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    access_level = models.CharField(
        "Доступно с тарифа",
        max_length=20,
        choices=AccessLevel.choices,
        default=AccessLevel.FREE,
        db_index=True,
    )
    cover_image = models.ImageField(
        "Обложка",
        upload_to=interesting_cover_upload_to,
        blank=True,
        null=True,
    )
    file = models.FileField(
        "Файл",
        upload_to=interesting_file_upload_to,
        blank=True,
        null=True,
        help_text="Одиночный HTML или другой файл интерактива",
    )
    archive = models.FileField(
        "Архив",
        upload_to=interesting_archive_upload_to,
        blank=True,
        null=True,
        help_text="ZIP с index.html и ресурсами интерактива",
    )
    sort_order = models.PositiveIntegerField("Порядок", default=0, db_index=True)
    views_count = models.PositiveIntegerField("Просмотры", default=0, db_index=True)
    likes = GenericRelation(
        "CatalogContentLike",
        related_query_name="interesting",
        content_type_field="content_type",
        object_id_field="object_id",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("sort_order", "-updated_at", "id")
        verbose_name = "Интересное"
        verbose_name_plural = "Интересное"
        indexes = [
            models.Index(fields=["status", "sort_order"], name="interesting_status_order_idx"),
            models.Index(fields=["status", "access_level"], name="interesting_status_access_idx"),
        ]

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.title) or f"interesting-{uuid4().hex[:8]}"
            candidate = base_slug
            index = 2
            while InterestingItem.objects.exclude(pk=self.pk).filter(slug=candidate).exists():
                candidate = f"{base_slug}-{index}"
                index += 1
            self.slug = candidate
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class CatalogContentLike(models.Model):
    """Лайк авторизованного пользователя к Lesson или InterestingItem."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="catalog_content_likes",
    )
    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField(db_index=True)
    content_object = GenericForeignKey("content_type", "object_id")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Лайк материала каталога"
        verbose_name_plural = "Лайки материалов каталога"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "content_type", "object_id"],
                name="unique_catalog_content_like",
            )
        ]
        indexes = [
            models.Index(fields=["content_type", "object_id"], name="catalog_like_target_idx"),
        ]

    def __str__(self):
        return f"like user={self.user_id} {self.content_type_id}:{self.object_id}"


class CatalogContentViewDedup(models.Model):
    """Окно дедупликации просмотров (один раз на user/visitor за 30 минут)."""

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField(db_index=True)
    content_object = GenericForeignKey("content_type", "object_id")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="catalog_content_views",
    )
    visitor_key = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
        help_text="Хеш cookie посетителя; IP не храним",
    )
    viewed_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        verbose_name = "Просмотр материала каталога"
        verbose_name_plural = "Просмотры материалов каталога"
        indexes = [
            models.Index(
                fields=["content_type", "object_id", "user", "viewed_at"],
                name="catalog_view_user_idx",
            ),
            models.Index(
                fields=["content_type", "object_id", "visitor_key", "viewed_at"],
                name="catalog_view_visitor_idx",
            ),
        ]

    def __str__(self):
        return f"view {self.content_type_id}:{self.object_id} at {self.viewed_at}"


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


class TagType(models.Model):
    """Тип тегов в справочнике: сложность, затем другие категории."""

    slug = models.SlugField("Код", max_length=50, unique=True, db_index=True)
    name = models.CharField("Название", max_length=100)
    description = models.TextField("Описание", blank=True)
    order = models.PositiveSmallIntegerField("Порядок", default=0)

    class Meta:
        ordering = ("order", "id")
        verbose_name = "Тип тегов"
        verbose_name_plural = "Типы тегов"

    def __str__(self):
        return self.name


class TagOption(models.Model):
    """Элемент справочника тегов (бейдж с цветом для UI)."""

    class BadgeStyle(models.TextChoices):
        GREEN = "green", "Зелёный"
        YELLOW = "yellow", "Жёлтый"
        RED = "red", "Красный"
        NEUTRAL = "neutral", "Нейтральный"
        BLUE = "blue", "Синий"

    tag_type = models.ForeignKey(
        TagType,
        on_delete=models.CASCADE,
        related_name="options",
        verbose_name="Тип тега",
    )
    slug = models.SlugField("Код", max_length=50)
    emoji = models.CharField("Эмодзи", max_length=16, blank=True, default="")
    title = models.CharField("Подпись", max_length=120)
    badge_style = models.CharField(
        "Стиль бейджа",
        max_length=20,
        choices=BadgeStyle.choices,
        default=BadgeStyle.NEUTRAL,
    )
    order = models.PositiveSmallIntegerField("Порядок", default=0)
    is_active = models.BooleanField("Активен", default=True)

    class Meta:
        ordering = ("tag_type", "order", "id")
        verbose_name = "Тег (справочник)"
        verbose_name_plural = "Теги (справочник)"
        constraints = [
            models.UniqueConstraint(
                fields=["tag_type", "slug"],
                name="uniq_generator_tagoption_type_slug",
            ),
        ]

    def __str__(self):
        prefix = f"{self.emoji} " if self.emoji else ""
        return f"{prefix}{self.title} ({self.tag_type.name})"


class PedagogicalRecommendation(models.Model):
    LEVEL_CHOICES = [
        ("VPR", "ВПР"),
        ("OGE", "ОГЭ"),
        ("EGE", "ЕГЭ"),
    ]

    subject = models.CharField("Предмет", max_length=100)
    exam_level = models.CharField("Уровень", max_length=10, choices=LEVEL_CHOICES)

    topic = models.CharField("Тема", max_length=255, blank=True)
    subtopic = models.CharField("Подтема", max_length=255, blank=True)
    skill_group = models.CharField("Группа навыка", max_length=255, blank=True)

    short_recommendation = models.TextField("Краткая рекомендация")
    detailed_recommendation = models.TextField("Подробная рекомендация", blank=True)
    next_lesson_action = models.TextField("Действие на следующее занятие", blank=True)

    student_hint = models.TextField("Подсказка для ученика", blank=True)
    parent_hint = models.TextField("Пояснение для родителя", blank=True)
    teacher_hint = models.TextField("Комментарий для учителя", blank=True)

    priority = models.PositiveSmallIntegerField("Приоритет", default=100)
    is_active = models.BooleanField("Активно", default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Педагогическая рекомендация"
        verbose_name_plural = "Педагогические рекомендации"
        indexes = [
            models.Index(fields=["subject", "exam_level"]),
            models.Index(fields=["topic", "subtopic"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self):
        return f"{self.subject} · {self.exam_level} · {self.subtopic or self.topic or '—'}"


class ReportConclusionTemplate(models.Model):
    RESULT_LEVEL_CHOICES = [
        ("very_low", "Очень низкий"),
        ("low", "Низкий"),
        ("medium", "Средний"),
        ("high", "Высокий"),
    ]

    subject = models.CharField("Предмет", max_length=100, blank=True)
    exam_level = models.CharField("Уровень", max_length=10, blank=True)

    result_level = models.CharField(
        "Уровень результата",
        max_length=20,
        choices=RESULT_LEVEL_CHOICES,
    )

    min_percent = models.PositiveSmallIntegerField("Минимальный процент", default=0)
    max_percent = models.PositiveSmallIntegerField("Максимальный процент", default=100)

    text_template = models.TextField("Шаблон вывода")

    is_active = models.BooleanField("Активно", default=True)
    priority = models.PositiveSmallIntegerField("Приоритет", default=100)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Шаблон вывода отчёта"
        verbose_name_plural = "Шаблоны выводов отчёта"
        indexes = [
            models.Index(fields=["result_level", "is_active"]),
            models.Index(fields=["subject", "exam_level"]),
        ]

    def __str__(self):
        return f"{self.result_level} {self.min_percent}-{self.max_percent}% ({self.subject or '—'})"


class ReportNextStepTemplate(models.Model):
    CONDITION_CHOICES = [
        ("many_skipped", "Много пропущенных заданий"),
        ("many_errors", "Много ошибок"),
        ("low_percent", "Низкий процент"),
        ("medium_percent", "Средний процент"),
        ("high_percent", "Высокий процент"),
        ("slow_first_task", "Долго решал первое задание"),
        ("default", "По умолчанию"),
    ]

    subject = models.CharField("Предмет", max_length=100, blank=True)
    exam_level = models.CharField("Уровень", max_length=10, blank=True)
    condition_type = models.CharField("Условие", max_length=50, choices=CONDITION_CHOICES)

    text = models.TextField("Текст шага")
    priority = models.PositiveSmallIntegerField("Приоритет", default=100)
    is_active = models.BooleanField("Активно", default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Шаг «Что сделать дальше»"
        verbose_name_plural = "Шаги «Что сделать дальше»"
        indexes = [
            models.Index(fields=["condition_type", "is_active"]),
            models.Index(fields=["subject", "exam_level"]),
        ]

    def __str__(self):
        return f"{self.get_condition_type_display()} — {self.text[:50]}"


# Сезонное / праздничное оформление (импорт для Django model discovery)
from .seasonal_theme_models import SeasonalTheme, SeasonalThemeDecoration  # noqa: E402,F401