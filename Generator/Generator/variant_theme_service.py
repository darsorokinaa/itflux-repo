"""Сериализация и безопасная конфигурация тем вариантов."""

from __future__ import annotations

from typing import Any

from django.utils.html import strip_tags

from .variant_theme_access import can_manage_variant_themes, can_select_variant_theme
from .variant_theme_models import VariantTheme

ALLOWED_LAYOUTS = frozenset(choice[0] for choice in VariantTheme.LayoutType.choices)
ALLOWED_ANIMATIONS = frozenset(
    ("none", "falling-leaves", "snow", "floating-stars", "plane-route", "clouds")
)
ALLOWED_DECORATIONS = frozenset(("clouds", "route", "plane", "leaves", "stars", "map"))
ALLOWED_BACKGROUND_TYPES = frozenset(("none", "color", "image"))
ALLOWED_LABEL_KEYS = ("task", "tasks", "next", "previous", "finish")

DEFAULT_LABELS = {
    "task": "Задание",
    "tasks": "Задания",
    "next": "Следующее",
    "previous": "Назад",
    "finish": "Завершить вариант",
}

TRAVEL_CONFIG = {
    "background": {"type": "color", "color": "#e7f3fb"},
    "labels": {
        "task": "Остановка",
        "tasks": "Маршрут",
        "next": "Следующая остановка",
        "previous": "Вернуться",
        "finish": "Завершить путешествие",
    },
    "decorations": ["clouds", "route", "plane"],
    "animation": "plane-route",
}


def _plain_text(value: Any, *, max_len: int = 80) -> str:
    text = strip_tags(str(value or "")).replace("\x00", "").strip()
    if len(text) > max_len:
        return text[:max_len]
    return text


def _safe_color(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith("#") and len(raw) in (4, 7) and all(
        ch in "0123456789abcdefABCDEF" for ch in raw[1:]
    ):
        return raw
    return ""


def sanitize_variant_theme_config(raw: Any) -> dict:
    """Оставляем только известные ключи. Произвольный HTML/JS отбрасывается."""
    src = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}

    background = src.get("background") if isinstance(src.get("background"), dict) else {}
    bg_type = str(background.get("type") or "none").strip().lower()
    if bg_type not in ALLOWED_BACKGROUND_TYPES:
        bg_type = "none"
    bg_out = {"type": bg_type}
    color = _safe_color(background.get("color"))
    if color:
        bg_out["color"] = color
    out["background"] = bg_out

    labels_src = src.get("labels") if isinstance(src.get("labels"), dict) else {}
    labels = dict(DEFAULT_LABELS)
    for key in ALLOWED_LABEL_KEYS:
        if key in labels_src:
            cleaned = _plain_text(labels_src.get(key), max_len=60)
            if cleaned:
                labels[key] = cleaned
    out["labels"] = labels

    decorations = []
    raw_deco = src.get("decorations")
    if isinstance(raw_deco, list):
        for item in raw_deco:
            name = str(item or "").strip().lower()
            if name in ALLOWED_DECORATIONS and name not in decorations:
                decorations.append(name)
    out["decorations"] = decorations

    animation = str(src.get("animation") or "none").strip().lower()
    out["animation"] = animation if animation in ALLOWED_ANIMATIONS else "none"
    return out


def _absolute_media_url(request, file_field) -> str:
    if not file_field:
        return ""
    try:
        url = file_field.url
    except (ValueError, AttributeError):
        return ""
    if request is None:
        return url
    try:
        return request.build_absolute_uri(url)
    except Exception:
        return url


def serialize_variant_theme(theme: VariantTheme | None, request=None) -> dict | None:
    if theme is None:
        return None
    config = sanitize_variant_theme_config(theme.config)
    layout = theme.layout_type if theme.layout_type in ALLOWED_LAYOUTS else VariantTheme.LayoutType.CLASSIC
    background = dict(config.get("background") or {})
    bg_url = _absolute_media_url(request, theme.background_image)
    block_bg_url = _absolute_media_url(request, theme.block_background_image)
    if bg_url:
        background["type"] = "image"
        background["url"] = bg_url
    elif background.get("type") == "image" and not background.get("url"):
        background = {"type": "color", "color": background.get("color") or "#e7f3fb"}
    config["background"] = background
    return {
        "id": theme.id,
        "name": theme.name,
        "slug": theme.slug,
        "description": theme.description or "",
        "layout_type": layout,
        "config": config,
        "preview_image_url": _absolute_media_url(request, theme.preview_image),
        "background_image_url": bg_url,
        "block_background_image_url": block_bg_url,
        "is_active": bool(theme.is_active),
        "is_published": bool(theme.is_published),
        "created_at": theme.created_at.isoformat() if theme.created_at else None,
        "updated_at": theme.updated_at.isoformat() if theme.updated_at else None,
    }


def theme_for_variant_payload(variant, request=None) -> dict | None:
    """Тема для прохождения варианта. Неактивная/битая → None (классика)."""
    theme = getattr(variant, "theme", None)
    if theme is None or not getattr(theme, "is_active", False):
        return None
    return serialize_variant_theme(theme, request)


def parse_theme_id(raw) -> tuple[int | None, bool]:
    """Возвращает (theme_id | None, present). present=False если ключ не задавали."""
    if raw in (None, "", "null"):
        return None, True
    try:
        return int(raw), True
    except (TypeError, ValueError):
        return None, False


def resolve_theme_assignment(*, user, theme_id: int | None, allow_unpublished: bool):
    """Найти тему для назначения. None = классика."""
    if theme_id is None:
        return None, None
    theme = VariantTheme.objects.filter(pk=theme_id).first()
    if theme is None:
        return None, ("Тема не найдена", 404)
    if not theme.is_active:
        return None, ("Тема выключена", 400)
    if not allow_unpublished and not theme.is_published:
        return None, ("Тема недоступна", 403)
    return theme, None


class VariantThemeAssignmentError(Exception):
    def __init__(self, message: str, status: int = 403):
        super().__init__(message)
        self.status = status
        self.message = message


def assign_theme_from_payload(*, user, data: dict, required: bool = False):
    """Разбор theme_id из тела запроса.

    Возвращает (theme | None | Ellipsis, error_tuple | None).
    Ellipsis — поле не передано, вариант не менять.
    """
    if not isinstance(data, dict) or (
        "theme_id" not in data and "theme" not in data
    ):
        if required:
            return None, ("Укажите theme_id", 400)
        return Ellipsis, None

    if not can_select_variant_theme(user):
        return None, ("Недостаточно прав для выбора оформления варианта", 403)

    raw = data["theme_id"] if "theme_id" in data else data.get("theme")
    if isinstance(raw, dict):
        raw = raw.get("id")
    theme_id, ok = parse_theme_id(raw)
    if not ok:
        return None, ("Некорректный theme_id", 400)
    return resolve_theme_assignment(
        user=user,
        theme_id=theme_id,
        allow_unpublished=can_manage_variant_themes(user),
    )
