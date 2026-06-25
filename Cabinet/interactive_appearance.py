"""Предустановленные фоны, стили карточек и звуковые пакеты для интерактивов."""

from pathlib import Path

from django.conf import settings
from django.core.files import File

from Cabinet.models import InteractiveBackground, InteractiveCardStyle, InteractiveSoundPack

BACKGROUNDS = [
    {
        "slug": "light-gray",
        "name": "Светло-серый",
        "css_background": "#E8EDF4",
        "text_tone": "dark",
        "sort_order": 1,
        "is_default": True,
    },
    {
        "slug": "soft-blue",
        "name": "Нежно-голубой",
        "css_background": "linear-gradient(135deg, #DBEAFE 0%, #E0E7FF 100%)",
        "text_tone": "dark",
        "sort_order": 2,
    },
    {
        "slug": "soft-violet",
        "name": "Лавандовый",
        "css_background": "linear-gradient(135deg, #EDE9FE 0%, #F3E8FF 100%)",
        "text_tone": "dark",
        "sort_order": 3,
    },
    {
        "slug": "warm-sand",
        "name": "Тёплый песок",
        "css_background": "linear-gradient(135deg, #FEF3C7 0%, #FFEDD5 100%)",
        "text_tone": "dark",
        "sort_order": 4,
    },
    {
        "slug": "mint-fresh",
        "name": "Мятный",
        "css_background": "linear-gradient(135deg, #D1FAE5 0%, #ECFDF5 100%)",
        "text_tone": "dark",
        "sort_order": 5,
    },
    {
        "slug": "navy-dark",
        "name": "Тёмно-синий",
        "css_background": "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
        "text_tone": "light",
        "sort_order": 6,
    },
    {
        "slug": "grid-blue",
        "name": "Сетка (как в кабинете)",
        "css_background": (
            "linear-gradient(rgba(43, 82, 245, 0.05) 1px, transparent 1px), "
            "linear-gradient(90deg, rgba(43, 82, 245, 0.05) 1px, transparent 1px), "
            "#F4F7FB"
        ),
        "text_tone": "dark",
        "sort_order": 7,
    },
]

IMAGE_BACKGROUNDS = [
    {
        "slug": "cosmos",
        "name": "Космос",
        "text_tone": "light",
        "sort_order": 10,
    },
    {
        "slug": "potok",
        "name": "Цифровой поток",
        "text_tone": "light",
        "sort_order": 11,
    },
    {
        "slug": "robots",
        "name": "Роботы",
        "text_tone": "light",
        "sort_order": 12,
    },
    {
        "slug": "school",
        "name": "Школа",
        "text_tone": "light",
        "sort_order": 13,
    },
    {
        "slug": "summer",
        "name": "Лето",
        "text_tone": "light",
        "sort_order": 14,
    },
    {
        "slug": "forrest",
        "name": "Лес",
        "text_tone": "light",
        "sort_order": 15,
    },
]

CARD_STYLES = [
    {
        "slug": "classic",
        "name": "Классика",
        "css_class": "ix-cards--classic",
        "description": "Белые карточки с мягкой тенью",
        "sort_order": 1,
        "is_default": True,
    },
    {
        "slug": "rounded",
        "name": "Скруглённые",
        "css_class": "ix-cards--rounded",
        "description": "Больше скругления и объёма",
        "sort_order": 2,
    },
    {
        "slug": "flat",
        "name": "Плоские",
        "css_class": "ix-cards--flat",
        "description": "Рамка без тени",
        "sort_order": 3,
    },
    {
        "slug": "bold",
        "name": "Акцентные",
        "css_class": "ix-cards--bold",
        "description": "Яркая рамка и крупный текст",
        "sort_order": 4,
    },
    {
        "slug": "glass",
        "name": "Стекло",
        "css_class": "ix-cards--glass",
        "description": "Полупрозрачные карточки на градиенте",
        "sort_order": 5,
    },
    {
        "slug": "notebook",
        "name": "Тетрадь",
        "css_class": "ix-cards--notebook",
        "description": "Бумажный фон с линейкой",
        "sort_order": 6,
    },
]

SOUND_PACKS = [
    {
        "slug": "soft",
        "name": "Мягкие",
        "description": "Тихие плавные звуки",
        "config": {
            "flip": {"freq": 520, "type": "sine", "duration": 0.08, "volume": 0.12},
            "correct": {"freq": 660, "type": "sine", "duration": 0.14, "volume": 0.16},
            "wrong": {"freq": 220, "type": "sine", "duration": 0.18, "volume": 0.14},
            "next": {"freq": 440, "type": "sine", "duration": 0.04, "volume": 0.08},
            "end": {"freq": 520, "type": "sine", "duration": 0.2, "volume": 0.14},
            "tap": {"freq": 440, "type": "sine", "duration": 0.04, "volume": 0.08},
        },
        "sort_order": 1,
        "is_default": True,
    },
    {
        "slug": "crisp",
        "name": "Чёткие",
        "description": "Короткие клики",
        "config": {
            "flip": {"freq": 740, "type": "triangle", "duration": 0.05, "volume": 0.14},
            "correct": {"freq": 880, "type": "triangle", "duration": 0.1, "volume": 0.18},
            "wrong": {"freq": 180, "type": "triangle", "duration": 0.12, "volume": 0.16},
            "next": {"freq": 600, "type": "triangle", "duration": 0.03, "volume": 0.1},
            "end": {"freq": 660, "type": "triangle", "duration": 0.16, "volume": 0.16},
            "tap": {"freq": 600, "type": "triangle", "duration": 0.03, "volume": 0.1},
        },
        "sort_order": 2,
    },
    {
        "slug": "arcade",
        "name": "Игровые",
        "description": "Яркие ретро-звуки",
        "config": {
            "flip": {"freq": 420, "type": "square", "duration": 0.06, "volume": 0.1},
            "correct": {"freq": 784, "type": "square", "duration": 0.12, "volume": 0.14},
            "wrong": {"freq": 160, "type": "square", "duration": 0.2, "volume": 0.12},
            "next": {"freq": 520, "type": "square", "duration": 0.04, "volume": 0.09},
            "end": {"freq": 620, "type": "square", "duration": 0.18, "volume": 0.12},
            "tap": {"freq": 520, "type": "square", "duration": 0.04, "volume": 0.09},
        },
        "sort_order": 3,
    },
    {
        "slug": "silent",
        "name": "Без звука",
        "description": "Звуковые эффекты отключены",
        "config": {},
        "sort_order": 4,
    },
]


def _background_image_source_dirs():
    media_root = Path(settings.MEDIA_ROOT)
    legacy_root = Path(settings.BASE_DIR) / "Generator" / "media"
    for root in (media_root, legacy_root):
        candidate = root / "cabinet" / "interactive-backgrounds"
        if candidate.is_dir():
            yield candidate


def _find_background_image_file(slug):
    for base_dir in _background_image_source_dirs():
        slug_dir = base_dir / slug
        if not slug_dir.is_dir():
            continue
        for path in sorted(slug_dir.iterdir()):
            if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                return path
    return None


def _attach_background_image(background, slug):
    source = _find_background_image_file(slug)
    if not source:
        return
    with source.open("rb") as handle:
        background.background_image.save(source.name, File(handle), save=True)


def seed_interactive_appearance():
    """Создаёт или обновляет пресеты оформления интерактивов."""
    for item in BACKGROUNDS:
        InteractiveBackground.objects.update_or_create(
            slug=item["slug"],
            defaults={k: v for k, v in item.items() if k != "slug"},
        )
    for item in IMAGE_BACKGROUNDS:
        background, created = InteractiveBackground.objects.update_or_create(
            slug=item["slug"],
            defaults={
                **{k: v for k, v in item.items() if k != "slug"},
                "css_background": "",
            },
        )
        if created or not background.background_image:
            _attach_background_image(background, item["slug"])
    for item in CARD_STYLES:
        InteractiveCardStyle.objects.update_or_create(
            slug=item["slug"],
            defaults={k: v for k, v in item.items() if k != "slug"},
        )
    for item in SOUND_PACKS:
        InteractiveSoundPack.objects.update_or_create(
            slug=item["slug"],
            defaults={k: v for k, v in item.items() if k != "slug"},
        )
