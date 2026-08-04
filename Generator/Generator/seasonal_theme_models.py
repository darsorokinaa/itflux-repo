"""Сезонное и праздничное оформление платформы (управляется из админки)."""

from __future__ import annotations

import os
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone as dj_timezone
from django.utils.text import slugify


def seasonal_theme_upload_to(instance, filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower() or ".bin"
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}:
        ext = ".webp"
    slug = slugify(getattr(instance, "slug", None) or "theme") or "theme"
    return os.path.join("seasonal-themes", slug, f"{uuid4().hex}{ext}")


def seasonal_decoration_upload_to(instance, filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower() or ".bin"
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"}:
        ext = ".webp"
    theme_slug = "theme"
    theme = getattr(instance, "theme", None)
    if theme is not None:
        theme_slug = slugify(theme.slug or "theme") or "theme"
    return os.path.join("seasonal-themes", theme_slug, "decorations", f"{uuid4().hex}{ext}")


class SeasonalTheme(models.Model):
    """Праздничная / сезонная тема оформления."""

    class AnimationType(models.TextChoices):
        NONE = "none", "Без анимации"
        FADE_IN = "fade_in", "Лёгкое плавное появление"
        SWAY = "sway", "Медленное покачивание"
        FLOAT = "float", "Мягкое парение"
        TWINKLE = "twinkle", "Редкое мерцание"
        PATTERN_DRIFT = "pattern_drift", "Медленное движение фонового паттерна"
        SNOW = "snow", "Падающий снег"
        LEAVES = "leaves", "Падающие листья"
        CONFETTI = "confetti", "Конфетти при первом открытии"
        FLOATING_DECOR = "floating_decor", "Плавающие декоративные элементы"

    class Intensity(models.TextChoices):
        OFF = "off", "Выкл"
        MINIMAL = "minimal", "Минимальная"
        NORMAL = "normal", "Обычная"
        FESTIVE = "festive", "Праздничная"

    class PatternRepeat(models.TextChoices):
        REPEAT = "repeat", "repeat"
        REPEAT_X = "repeat-x", "repeat-x"
        REPEAT_Y = "repeat-y", "repeat-y"
        NO_REPEAT = "no-repeat", "no-repeat"

    name = models.CharField("Название", max_length=160)
    slug = models.SlugField("Код", max_length=80, unique=True)
    description = models.TextField("Описание", blank=True)
    is_active = models.BooleanField(
        "Разрешена",
        default=False,
        help_text="Черновики и отключённые темы не участвуют в автовыборе.",
    )
    is_draft = models.BooleanField("Черновик", default=True)
    priority = models.PositiveSmallIntegerField(
        "Приоритет",
        default=100,
        help_text="Чем больше число, тем выше приоритет при пересечении периодов.",
    )
    start_at = models.DateTimeField("Начало показа", null=True, blank=True)
    end_at = models.DateTimeField("Окончание показа", null=True, blank=True)
    timezone = models.CharField(
        "Часовой пояс",
        max_length=64,
        default="Europe/Moscow",
        help_text="Используется для интерпретации дат показа.",
    )
    allow_user_disable = models.BooleanField("Пользователь может отключить", default=True)
    allow_manual_selection = models.BooleanField("Можно выбрать вручную", default=True)
    is_default_seasonal_theme = models.BooleanField(
        "Основная тема периода",
        default=True,
        help_text="Участвует в автоматическом выборе по датам.",
    )

    # Фон страницы
    background_color = models.CharField("Цвет фона", max_length=32, blank=True, default="")
    background_pattern = models.ImageField(
        "Паттерн фона",
        upload_to=seasonal_theme_upload_to,
        blank=True,
        null=True,
    )
    background_pattern_mobile = models.ImageField(
        "Паттерн фона (mobile)",
        upload_to=seasonal_theme_upload_to,
        blank=True,
        null=True,
    )
    background_repeat = models.CharField(
        "Повтор паттерна",
        max_length=16,
        choices=PatternRepeat.choices,
        default=PatternRepeat.REPEAT,
    )
    background_size = models.CharField("Размер паттерна", max_length=64, blank=True, default="240px")
    background_position = models.CharField("Позиция паттерна", max_length=64, blank=True, default="center")
    background_opacity = models.FloatField("Прозрачность паттерна", default=0.18)
    background_overlay_color = models.CharField(
        "Цветовой слой поверх фона",
        max_length=32,
        blank=True,
        default="",
    )
    background_overlay_opacity = models.FloatField("Прозрачность цветового слоя", default=0.0)
    disable_background_on_low_end = models.BooleanField(
        "Отключать фон на слабых устройствах",
        default=True,
    )

    # Простые картинки оформления (одна запись — всё на виду)
    menu_background = models.ImageField(
        "Фон бокового меню",
        upload_to=seasonal_theme_upload_to,
        blank=True,
        null=True,
        help_text="Картинка/паттерн для бокового меню кабинета.",
    )
    card_pattern = models.ImageField(
        "Паттерн карточек",
        upload_to=seasonal_theme_upload_to,
        blank=True,
        null=True,
        help_text="Лёгкий паттерн поверх карточек задач/уроков.",
    )
    header_decor = models.ImageField(
        "Декор верхней панели",
        upload_to=seasonal_theme_upload_to,
        blank=True,
        null=True,
    )
    corner_image = models.ImageField(
        "Декор в углу страницы",
        upload_to=seasonal_theme_upload_to,
        blank=True,
        null=True,
        help_text="Необязательная картинка в углу экрана (не путать с кнопкой оформления).",
    )
    button_icon = models.ImageField(
        "Иконка кнопки «Оформление»",
        upload_to=seasonal_theme_upload_to,
        blank=True,
        null=True,
        help_text="Картинка на плавающей кнопке в левом нижнем углу. Если пусто — используется смайлик ниже.",
    )
    button_emoji = models.CharField(
        "Смайлик кнопки «Оформление»",
        max_length=16,
        blank=True,
        default="✦",
        help_text="Если картинка не загружена — на кнопке будет этот смайлик (вставьте с клавиатуры, напр. 🎄 🎃 🌸).",
    )
    accent_color = models.CharField(
        "Акцентный цвет",
        max_length=32,
        blank=True,
        default="",
        help_text="Например #4D8FC9",
    )
    card_border_color = models.CharField(
        "Цвет границы карточек",
        max_length=32,
        blank=True,
        default="",
    )
    card_pattern_opacity = models.FloatField(
        "Прозрачность паттерна карточек",
        default=0.12,
    )

    # Поверхности (legacy JSON) — скрыто в админке, оставлено для совместимости
    surfaces = models.JSONField("Оформление поверхностей", default=dict, blank=True)

    # Анимация
    animation_type = models.CharField(
        "Тип анимации",
        max_length=32,
        choices=AnimationType.choices,
        default=AnimationType.NONE,
    )
    animation_intensity = models.CharField(
        "Интенсивность анимации",
        max_length=16,
        choices=Intensity.choices,
        default=Intensity.MINIMAL,
    )
    animation_max_elements = models.PositiveSmallIntegerField(
        "Макс. элементов анимации",
        default=20,
    )
    animation_fps_limit = models.PositiveSmallIntegerField(
        "Ограничение FPS (сложные эффекты)",
        default=24,
    )

    # Маршруты (скрыты в простой форме админки; по умолчанию тема везде)
    include_routes = models.JSONField(
        "Показывать только на маршрутах",
        default=list,
        blank=True,
        help_text='Список префиксов/путей, например ["/cabinet", "/"]. Пусто = везде, кроме exclude.',
    )
    exclude_routes = models.JSONField(
        "Не показывать на маршрутах",
        default=list,
        blank=True,
        help_text='Например ["/cabinet/boards", "/cabinet/meetings", "/lessons"].',
    )

    # Админ-тестирование
    force_active_for_testing = models.BooleanField(
        "Принудительно активировать (тест)",
        default=False,
        help_text="Игнорирует даты; тема становится кандидатом на автовыбор для всех.",
    )
    admin_only = models.BooleanField(
        "Только для администраторов",
        default=False,
        help_text="Тема видна обычным пользователям только через предпросмотр.",
    )

    created_at = models.DateTimeField("Создано", auto_now_add=True)
    updated_at = models.DateTimeField("Обновлено", auto_now=True)

    class Meta:
        verbose_name = "Сезонная тема"
        verbose_name_plural = "Сезонные темы"
        ordering = ["-priority", "-start_at", "name"]

    def __str__(self) -> str:
        return self.name

    def clean(self) -> None:
        super().clean()
        if self.start_at and self.end_at and self.start_at > self.end_at:
            raise ValidationError({"end_at": "Дата окончания должна быть позже даты начала."})
        if self.background_opacity < 0 or self.background_opacity > 1:
            raise ValidationError({"background_opacity": "Значение от 0 до 1."})
        if self.background_overlay_opacity < 0 or self.background_overlay_opacity > 1:
            raise ValidationError({"background_overlay_opacity": "Значение от 0 до 1."})
        if self.card_pattern_opacity < 0 or self.card_pattern_opacity > 1:
            raise ValidationError({"card_pattern_opacity": "Значение от 0 до 1."})

    def compute_status(self, now=None) -> str:
        """
        Рассчитываемый статус: draft | scheduled | active | finished | disabled.
        """
        if self.is_draft:
            return "draft"
        if not self.is_active and not self.force_active_for_testing:
            return "disabled"
        if self.force_active_for_testing and self.is_active:
            return "active"
        now = now or dj_timezone.now()
        if self.start_at and now < self.start_at:
            return "scheduled"
        if self.end_at and now > self.end_at:
            return "finished"
        if self.is_active and (not self.start_at or now >= self.start_at) and (
            not self.end_at or now <= self.end_at
        ):
            return "active"
        if not self.is_active:
            return "disabled"
        return "scheduled"

    @property
    def status(self) -> str:
        return self.compute_status()

    def duplicate(self) -> "SeasonalTheme":
        """Продублировать тему вместе с декорациями (без файлов — копируются ссылки на те же файлы)."""
        decorations = list(self.decorations.all())
        self.pk = None
        self.id = None
        base_slug = f"{self.slug}-copy"
        slug = base_slug
        n = 1
        while SeasonalTheme.objects.filter(slug=slug).exists():
            n += 1
            slug = f"{base_slug}-{n}"
        self.slug = slug
        self.name = f"{self.name} (копия)"
        self.is_draft = True
        self.is_active = False
        self.force_active_for_testing = False
        self.save()
        for decor in decorations:
            decor.pk = None
            decor.id = None
            decor.theme = self
            decor.save()
        return self


class SeasonalThemeDecoration(models.Model):
    """Декоративный элемент сезонной темы."""

    class Zone(models.TextChoices):
        PAGE_BACKGROUND = "page_background", "Общий фон страницы"
        TOP_BAR = "top_bar", "Верхняя панель"
        SIDEBAR = "sidebar", "Боковое меню"
        TASK_CARDS = "task_cards", "Карточки задач"
        LESSON_CARDS = "lesson_cards", "Карточки уроков"
        DASHBOARD = "dashboard", "Дашборд"
        CATALOG = "catalog", "Каталог"
        PROFILE = "profile", "Профиль"
        LOGIN = "login", "Экран входа"
        CUSTOM_ROUTES = "custom_routes", "Конкретные маршруты"

    class Position(models.TextChoices):
        TOP_LEFT = "top-left", "Верхний левый"
        TOP_RIGHT = "top-right", "Верхний правый"
        BOTTOM_LEFT = "bottom-left", "Нижний левый"
        BOTTOM_RIGHT = "bottom-right", "Нижний правый"
        CENTER = "center", "Центр"
        CUSTOM = "custom", "Свои координаты"

    class AnimationType(models.TextChoices):
        NONE = "none", "Без анимации"
        FADE_IN = "fade_in", "Появление"
        SWAY = "sway", "Покачивание"
        FLOAT = "float", "Парение"
        TWINKLE = "twinkle", "Мерцание"

    theme = models.ForeignKey(
        SeasonalTheme,
        on_delete=models.CASCADE,
        related_name="decorations",
        verbose_name="Тема",
    )
    name = models.CharField("Название", max_length=120)
    image = models.FileField(
        "Изображение / SVG",
        upload_to=seasonal_decoration_upload_to,
        blank=True,
        null=True,
        help_text="Разрешены PNG, JPEG, WebP, GIF, AVIF; SVG — только проверенные администратором файлы.",
    )
    zone = models.CharField(
        "Зона отображения",
        max_length=32,
        choices=Zone.choices,
        default=Zone.PAGE_BACKGROUND,
    )
    custom_routes = models.JSONField(
        "Маршруты (для зоны custom_routes)",
        default=list,
        blank=True,
    )
    position = models.CharField(
        "Позиция",
        max_length=32,
        choices=Position.choices,
        default=Position.TOP_RIGHT,
    )
    offset_x = models.CharField("Отступ X", max_length=32, blank=True, default="0")
    offset_y = models.CharField("Отступ Y", max_length=32, blank=True, default="0")
    width = models.CharField("Ширина", max_length=32, blank=True, default="80px")
    height = models.CharField("Высота", max_length=32, blank=True, default="auto")
    opacity = models.FloatField("Прозрачность", default=0.85)
    z_index = models.SmallIntegerField("z-index", default=1)
    show_desktop = models.BooleanField("Показывать на компьютере", default=True)
    show_tablet = models.BooleanField("Показывать на планшете", default=True)
    show_mobile = models.BooleanField("Показывать на телефоне", default=False)
    click_url = models.CharField("Ссылка при нажатии", max_length=500, blank=True, default="")
    animation_type = models.CharField(
        "Анимация",
        max_length=32,
        choices=AnimationType.choices,
        default=AnimationType.NONE,
    )
    animation_speed = models.FloatField("Скорость анимации (сек)", default=6.0)
    animation_delay = models.FloatField("Задержка запуска (сек)", default=0.0)
    intensity = models.CharField(
        "Интенсивность",
        max_length=16,
        choices=SeasonalTheme.Intensity.choices,
        default=SeasonalTheme.Intensity.MINIMAL,
    )
    max_concurrent = models.PositiveSmallIntegerField(
        "Макс. одновременно отображаемых",
        default=1,
    )
    sort_order = models.PositiveSmallIntegerField("Порядок", default=0)
    is_active = models.BooleanField("Активен", default=True)

    class Meta:
        verbose_name = "Декор сезонной темы"
        verbose_name_plural = "Декор сезонных тем"
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"{self.theme.slug}: {self.name}"

    def clean(self) -> None:
        super().clean()
        if self.opacity < 0 or self.opacity > 1:
            raise ValidationError({"opacity": "Значение от 0 до 1."})
        if self.image:
            name = (self.image.name or "").lower()
            ext = os.path.splitext(name)[1]
            if ext == ".svg":
                # SVG допускаем только из админки; санитизация на уровне загрузки.
                pass
            elif ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}:
                raise ValidationError({"image": "Недопустимый формат файла."})
