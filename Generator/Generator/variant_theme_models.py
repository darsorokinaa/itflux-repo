"""Темы оформления вариантов (presentation-only, не двигатель прохождения)."""

from __future__ import annotations

import os
from uuid import uuid4

from django.db import models
from django.utils.text import slugify


def variant_theme_upload_to(instance, filename: str) -> str:
    ext = os.path.splitext(filename or "")[1].lower() or ".bin"
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}:
        ext = ".webp"
    slug = slugify(getattr(instance, "slug", None) or "theme") or "theme"
    return os.path.join("variant-themes", slug, f"{uuid4().hex}{ext}")


class VariantTheme(models.Model):
    """Шаблон оформления варианта. Не хранит задания, ответы и прогресс."""

    class LayoutType(models.TextChoices):
        CLASSIC = "classic", "Классический"
        CARDS = "cards", "Карточки"
        ROUTE = "route", "Маршрут"
        GAME = "game", "Игровой"

    name = models.CharField("Название", max_length=160)
    slug = models.SlugField("Код", max_length=80, unique=True)
    description = models.TextField("Описание", blank=True, default="")
    layout_type = models.CharField(
        "Макет",
        max_length=32,
        choices=LayoutType.choices,
        default=LayoutType.CLASSIC,
        db_index=True,
    )
    config = models.JSONField(
        "Конфигурация",
        default=dict,
        blank=True,
        help_text="labels, decorations, animation, background. Без HTML/JS.",
    )
    preview_image = models.ImageField(
        "Превью",
        upload_to=variant_theme_upload_to,
        blank=True,
        null=True,
    )
    background_image = models.ImageField(
        "Фон",
        upload_to=variant_theme_upload_to,
        blank=True,
        null=True,
        help_text="Фон всей страницы варианта.",
    )
    block_background_image = models.ImageField(
        "Фон блоков",
        upload_to=variant_theme_upload_to,
        blank=True,
        null=True,
        help_text="Фон карточек: вариант, задания, таймер и оформление.",
    )
    is_active = models.BooleanField(
        "Активна",
        default=True,
        db_index=True,
        help_text="Выключенная тема не применяется к варианту (классическое оформление).",
    )
    is_published = models.BooleanField(
        "Опубликована",
        default=False,
        db_index=True,
        help_text="Показывать в пользовательском каталоге, когда выбор тем откроют учителям.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Тема варианта"
        verbose_name_plural = "Темы вариантов"
        ordering = ["name", "id"]

    def __str__(self):
        return f"{self.name} ({self.slug})"
