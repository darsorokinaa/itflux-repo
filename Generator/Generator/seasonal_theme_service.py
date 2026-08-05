"""Резолв активной сезонной темы, кеш и сериализация для API."""

from __future__ import annotations

import hashlib
import logging
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone as dj_timezone

from .seasonal_theme_models import SeasonalTheme, SeasonalThemeDecoration

logger = logging.getLogger(__name__)

CACHE_KEY_ACTIVE = "seasonal_theme:active_id"
CACHE_KEY_PAYLOAD_PREFIX = "seasonal_theme:payload:"
PREVIEW_SESSION_KEY = "seasonal_theme_preview_id"
PREVIEW_TOKEN_SESSION_KEY = "seasonal_theme_preview_token"

# Маршруты с высокой нагрузкой — тяжёлые эффекты отключаются на frontend,
# но также исключаются по умолчанию, если exclude_routes пуст у темы.
DEFAULT_HEAVY_ROUTE_PREFIXES = (
    "/cabinet/boards",
    "/teacher/boards",
    "/cabinet/meetings",
    "/lessons/",
    "/cabinet/interactives/",
)

DEFAULT_SURFACES: dict[str, dict[str, Any]] = {
    "task_card": {},
    "lesson_card": {},
    "material_block": {},
    "dashboard_widget": {},
    "sidebar": {},
    "top_bar": {},
    "modal": {},
    "button": {},
    "accent": {},
}


def project_now(tz_name: str | None = None):
    """Текущее время в часовом поясе проекта / темы."""
    name = (tz_name or getattr(settings, "TIME_ZONE", "Europe/Moscow") or "Europe/Moscow").strip()
    try:
        tz = ZoneInfo(name)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("Europe/Moscow")
    return dj_timezone.now().astimezone(tz)


def invalidate_seasonal_theme_cache(**_kwargs) -> None:
    # Версионируем ключи через stamp — старые CACHE_KEY_ACTIVE:* перестают читаться
    stamp = cache.get("seasonal_theme:stamp") or 0
    cache.set("seasonal_theme:stamp", int(stamp) + 1, timeout=None)


def _cache_timeout_for_theme(theme: SeasonalTheme | None) -> int:
    """TTL кеша: до ближайшего end_at / start_at или 5 минут. Negative cache — короткий."""
    if theme is None:
        return 15
    now = dj_timezone.now()
    candidates = []
    if theme.end_at and theme.end_at > now:
        candidates.append(int((theme.end_at - now).total_seconds()))
    # Также инвалидируем, когда другая тема может стартовать
    next_start = (
        SeasonalTheme.objects.filter(is_active=True, is_draft=False, start_at__gt=now)
        .order_by("start_at")
        .values_list("start_at", flat=True)
        .first()
    )
    if next_start:
        candidates.append(int((next_start - now).total_seconds()))
    if not candidates:
        return 300
    return max(30, min(min(candidates), 300))


def _theme_in_window(theme: SeasonalTheme, now=None) -> bool:
    """Проверка окна показа с учётом timezone темы."""
    if theme.force_active_for_testing and theme.is_active and not theme.is_draft:
        return True
    if not theme.is_active or theme.is_draft:
        return False
    now = now or project_now(getattr(theme, "timezone", None))
    if theme.start_at and now < theme.start_at:
        return False
    if theme.end_at and now > theme.end_at:
        return False
    return True


def _period_theme_queryset(*, include_admin_only: bool = False):
    """Темы-кандидаты текущего периода (основные + force), без черновиков."""
    qs = SeasonalTheme.objects.filter(
        Q(is_default_seasonal_theme=True) | Q(force_active_for_testing=True)
    ).exclude(is_draft=True)
    if not include_admin_only:
        qs = qs.filter(admin_only=False)
    return qs.order_by("-priority", "-start_at", "-id")


def select_active_theme(*, include_admin_only: bool = False) -> SeasonalTheme | None:
    """
    Выбор активной темы:
    1) is_active + окно дат (или force_active_for_testing)
    2) priority DESC
    3) start_at DESC (более поздний старт)
    4) id DESC
    """
    for theme in _period_theme_queryset(include_admin_only=include_admin_only):
        if _theme_in_window(theme):
            return theme
    return None


def list_period_themes(request, *, include_admin_only: bool = False) -> list[dict]:
    """
    Все темы, одновременно попадающие в окно дат (для ряда кнопок FAB).
    Порядок: priority DESC, start_at DESC, id DESC.
    """
    items = []
    for theme in _period_theme_queryset(include_admin_only=include_admin_only):
        if not _theme_in_window(theme):
            continue
        items.append(
            {
                "id": theme.id,
                "name": theme.name,
                "slug": theme.slug,
                "status": theme.compute_status(),
                "allow_user_disable": theme.allow_user_disable,
                "allow_manual_selection": theme.allow_manual_selection,
                "button_icon_url": media_url(request, theme.button_icon),
                "button_emoji": (theme.button_emoji or "✦").strip() or "✦",
                "priority": theme.priority,
            }
        )
    return items


def get_cached_active_theme(*, include_admin_only: bool = False) -> SeasonalTheme | None:
    stamp = cache.get("seasonal_theme:stamp") or 0
    key = f"{CACHE_KEY_ACTIVE}:admin={int(include_admin_only)}:s={stamp}"
    theme_id = cache.get(key)

    if theme_id:
        theme = SeasonalTheme.objects.filter(pk=theme_id).first()
        if theme and _theme_in_window(theme):
            if include_admin_only or not theme.admin_only:
                return theme
        # устаревший кеш
        cache.delete(key)
    elif theme_id == 0:
        # Короткий negative cache — при протухании TTL ключ исчезнет и будет пересчёт
        return None

    theme = select_active_theme(include_admin_only=include_admin_only)
    timeout = _cache_timeout_for_theme(theme)
    cache.set(key, theme.pk if theme else 0, timeout=timeout)
    return theme


def media_url(request, field) -> str | None:
    if not field:
        return None
    try:
        url = field.url
    except (ValueError, AttributeError):
        return None
    if request is not None:
        try:
            return request.build_absolute_uri(url)
        except Exception:
            pass
    # Относительный MEDIA URL — без абсолютного серверного пути
    return url


def serialize_surface(data: dict | None) -> dict:
    data = data or {}
    out = {}
    for key in (
        "background_color",
        "pattern_url",
        "pattern_opacity",
        "border_color",
        "border_width",
        "border_radius",
        "shadow",
        "decor_url",
        "decor_position",
        "decor_size",
        "accent_color",
        "overlay_color",
        "overlay_opacity",
    ):
        if key in data and data[key] not in (None, ""):
            out[key] = data[key]
    return out


def serialize_decoration(request, decor: SeasonalThemeDecoration) -> dict:
    return {
        "id": decor.id,
        "name": decor.name,
        "image_url": media_url(request, decor.image),
        "zone": decor.zone,
        "custom_routes": list(decor.custom_routes or []),
        "position": decor.position,
        "offset_x": decor.offset_x,
        "offset_y": decor.offset_y,
        "width": decor.width,
        "height": decor.height,
        "opacity": decor.opacity,
        "z_index": decor.z_index,
        "show_desktop": decor.show_desktop,
        "show_tablet": decor.show_tablet,
        "show_mobile": decor.show_mobile,
        "click_url": decor.click_url or None,
        "animation": {
            "type": decor.animation_type,
            "speed": decor.animation_speed,
            "delay": decor.animation_delay,
            "intensity": decor.intensity,
            "max_concurrent": decor.max_concurrent,
        },
    }


def serialize_theme(request, theme: SeasonalTheme) -> dict:
    surfaces_raw = theme.surfaces if isinstance(theme.surfaces, dict) else {}
    surfaces = {}
    for key in DEFAULT_SURFACES:
        surfaces[key] = serialize_surface(surfaces_raw.get(key) or {})

    card_pattern_url = media_url(request, theme.card_pattern)
    if not card_pattern_url:
        card_pattern_url = (surfaces_raw.get("task_card") or {}).get("pattern_url")

    decorations = [
        serialize_decoration(request, d)
        for d in theme.decorations.filter(is_active=True).order_by("sort_order", "id")
    ]

    # Угловой декор из поля темы — как простой decoration bottom-left
    corner_url = media_url(request, theme.corner_image)
    if corner_url:
        decorations = [
            {
                "id": f"corner-{theme.id}",
                "name": "Угловой декор",
                "image_url": corner_url,
                "zone": "page_background",
                "custom_routes": [],
                "position": "bottom-right",
                "offset_x": "12px",
                "offset_y": "12px",
                "width": "96px",
                "height": "auto",
                "opacity": 0.9,
                "z_index": 2,
                "show_desktop": True,
                "show_tablet": True,
                "show_mobile": False,
                "click_url": None,
                "animation": {
                    "type": "none",
                    "speed": 6,
                    "delay": 0,
                    "intensity": "minimal",
                    "max_concurrent": 1,
                },
            },
            *decorations,
        ]

    accent = (
        theme.accent_color
        or (surfaces_raw.get("accent") or {}).get("accent_color")
        or (surfaces_raw.get("task_card") or {}).get("accent_color")
    )
    border = theme.card_border_color or (surfaces_raw.get("task_card") or {}).get("border_color")

    return {
        "id": theme.id,
        "name": theme.name,
        "slug": theme.slug,
        "description": theme.description or "",
        "allow_user_disable": theme.allow_user_disable,
        "allow_manual_selection": theme.allow_manual_selection,
        "background": {
            "color": theme.background_color or None,
            "pattern_url": media_url(request, theme.background_pattern),
            "pattern_mobile_url": media_url(request, theme.background_pattern_mobile),
            "repeat": theme.background_repeat,
            "size": theme.background_size or "240px",
            "position": theme.background_position or "center",
            "opacity": theme.background_opacity,
            "overlay_color": theme.background_overlay_color or None,
            "overlay_opacity": theme.background_overlay_opacity,
            "disable_on_low_end": theme.disable_background_on_low_end,
        },
        "menu": {
            "background_url": media_url(request, theme.menu_background),
        },
        "header": {
            "decor_url": media_url(request, theme.header_decor),
        },
        "button_icon_url": media_url(request, theme.button_icon),
        "button_emoji": (theme.button_emoji or "✦").strip() or "✦",
        "hero_sticker": (
            {
                "title": (theme.hero_sticker_title or "").strip(),
                "text": (theme.hero_sticker_text or "").strip(),
                "background_color": (theme.hero_sticker_background_color or "").strip()
                or "#fff6c8",
                "title_color": (theme.hero_sticker_title_color or "").strip() or "#5a3d0c",
                "text_color": (theme.hero_sticker_text_color or "").strip() or "#4a3a1a",
            }
            if (theme.hero_sticker_title or "").strip()
            and (theme.hero_sticker_text or "").strip()
            else None
        ),
        "hero_history": (
            {
                "title": (theme.hero_history_title or "").strip(),
                "body": (theme.hero_history_body or "").strip(),
                "link_label": (
                    (theme.hero_history_link_label or "").strip()
                    or "Узнать историю праздника"
                ),
                "button_label": (
                    (theme.hero_history_button_label or "").strip() or "Понятно"
                ),
                "icon_url": media_url(request, theme.hero_history_icon),
                "image_url": media_url(request, theme.hero_history_image),
                "background_color": (theme.hero_history_background_color or "").strip()
                or "#faf6ee",
                "border_color": (theme.hero_history_border_color or "").strip()
                or "#d4a24a",
                "title_color": (theme.hero_history_title_color or "").strip()
                or "#0f2f7f",
                "text_color": (theme.hero_history_text_color or "").strip()
                or "#3b2a16",
                "button_color": (theme.hero_history_button_color or "").strip()
                or accent
                or "#1d4ed8",
                "show_corners": bool(theme.hero_history_show_corners),
                "corner_image_url": media_url(request, theme.hero_history_corner_image),
            }
            if (theme.hero_history_title or "").strip()
            and (theme.hero_history_body or "").strip()
            else None
        ),
        "surfaces": surfaces,
        "cards": {
            **serialize_surface(surfaces_raw.get("task_card") or {}),
            "pattern_url": card_pattern_url,
            "pattern_opacity": theme.card_pattern_opacity,
            "border_color": border,
            "accent_color": accent,
        },
        "animation": {
            "type": theme.animation_type,
            "intensity": theme.animation_intensity,
            "max_elements": theme.animation_max_elements,
            "fps_limit": theme.animation_fps_limit,
            "image_url": media_url(request, theme.animation_image),
        },
        "include_routes": list(theme.include_routes or []),
        "exclude_routes": list(theme.exclude_routes or []),
        "decorations": decorations,
        "status": theme.compute_status(),
    }


def list_manual_themes(request, *, is_staff: bool = False) -> list[dict]:
    now = dj_timezone.now()
    qs = SeasonalTheme.objects.filter(
        allow_manual_selection=True,
        is_active=True,
        is_draft=False,
    )
    if not is_staff:
        qs = qs.filter(admin_only=False)
    items = []
    for theme in qs.order_by("-priority", "name"):
        # Ручной выбор доступен, если тема не «завершена» давно, либо force/active
        status = theme.compute_status(now)
        if status in ("finished", "disabled", "draft") and not theme.force_active_for_testing:
            # Разрешаем manual для scheduled/active и недавно завершённых в пределах 7 дней
            if status == "finished" and theme.end_at and now - theme.end_at > timedelta(days=7):
                continue
            if status in ("disabled", "draft"):
                continue
        items.append(
            {
                "id": theme.id,
                "name": theme.name,
                "slug": theme.slug,
                "status": status,
                "allow_user_disable": theme.allow_user_disable,
                "allow_manual_selection": theme.allow_manual_selection,
                "button_icon_url": media_url(request, theme.button_icon),
                "button_emoji": (theme.button_emoji or "✦").strip() or "✦",
                "priority": theme.priority,
            }
        )
    return items


def resolve_user_preference(user) -> dict:
    """Читает SeasonalThemePreference из Cabinet, если пользователь авторизован."""
    default = {
        "mode": "auto",
        "selected_theme_id": None,
        "animations_enabled": True,
    }
    if not user or not getattr(user, "is_authenticated", False):
        return default
    try:
        from Cabinet.models import SeasonalThemePreference

        pref, _ = SeasonalThemePreference.objects.get_or_create(user=user)
        selected_id = pref.selected_theme_id
        # Если ручная тема удалена/отключена — откат на auto
        if pref.mode == SeasonalThemePreference.Mode.MANUAL:
            theme = None
            if selected_id:
                theme = SeasonalTheme.objects.filter(pk=selected_id).first()
            if (
                theme is None
                or not theme.is_active
                or theme.is_draft
                or not theme.allow_manual_selection
            ):
                pref.mode = SeasonalThemePreference.Mode.AUTO
                pref.selected_theme = None
                pref.save(update_fields=["mode", "selected_theme", "updated_at"])
                selected_id = None
        return {
            "mode": pref.mode,
            "selected_theme_id": selected_id,
            "animations_enabled": pref.animations_enabled,
        }
    except Exception:
        logger.exception("Failed to load SeasonalThemePreference")
        return default


def resolve_effective_theme(
    request,
    *,
    preference: dict | None = None,
    preview_theme_id: int | None = None,
) -> dict:
    """
    Итоговый payload для frontend.
    """
    user = getattr(request, "user", None)
    is_staff = bool(user and user.is_authenticated and user.is_staff)
    preference = preference or resolve_user_preference(user)

    preview_theme = None
    if preview_theme_id and is_staff:
        preview_theme = SeasonalTheme.objects.filter(pk=preview_theme_id).first()

    mode = preference.get("mode") or "auto"
    animations_enabled = bool(preference.get("animations_enabled", True))
    theme = None
    effective_mode = mode

    if preview_theme is not None:
        theme = preview_theme
        effective_mode = "preview"
    elif mode == "default":
        theme = None
        effective_mode = "default"
    elif mode == "manual":
        selected_id = preference.get("selected_theme_id")
        if selected_id:
            theme = SeasonalTheme.objects.filter(
                pk=selected_id,
                is_active=True,
                is_draft=False,
                allow_manual_selection=True,
            ).first()
            if theme and theme.admin_only and not is_staff:
                theme = None
        if theme is None:
            theme = get_cached_active_theme(include_admin_only=is_staff)
            effective_mode = "auto"
        else:
            effective_mode = "manual"
    else:
        theme = get_cached_active_theme(include_admin_only=is_staff)
        effective_mode = "auto"

    user_can_disable = True
    if theme is not None:
        user_can_disable = bool(theme.allow_user_disable)

    payload = {
        "mode": effective_mode,
        "preference_mode": mode,
        "theme": serialize_theme(request, theme) if theme else None,
        "user_can_disable": user_can_disable,
        "animations_enabled": animations_enabled,
        "available_themes": list_manual_themes(request, is_staff=is_staff),
        "period_themes": list_period_themes(request, include_admin_only=is_staff),
        "preview": (
            {
                "active": True,
                "theme_id": preview_theme.id,
                "theme_name": preview_theme.name,
            }
            if preview_theme is not None
            else {"active": False}
        ),
        "server_time": dj_timezone.now().isoformat(),
    }
    return payload


def make_preview_token(theme_id: int, user_id: int) -> str:
    raw = f"{theme_id}:{user_id}:{settings.SECRET_KEY}:seasonal-preview"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def verify_preview_token(theme_id: int, user_id: int, token: str) -> bool:
    if not token:
        return False
    return token == make_preview_token(theme_id, user_id)


@receiver(post_save, sender=SeasonalTheme)
@receiver(post_delete, sender=SeasonalTheme)
@receiver(post_save, sender=SeasonalThemeDecoration)
@receiver(post_delete, sender=SeasonalThemeDecoration)
def _on_seasonal_theme_change(sender, **kwargs):
    invalidate_seasonal_theme_cache()
