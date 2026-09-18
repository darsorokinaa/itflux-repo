"""API тем оформления вариантов."""

from __future__ import annotations

from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .variant_theme_access import can_manage_variant_themes, can_select_variant_theme
from .variant_theme_models import VariantTheme
from .variant_theme_service import (
    ALLOWED_LAYOUTS,
    sanitize_variant_theme_config,
    serialize_variant_theme,
)


class CanManageVariantThemes(BasePermission):
    message = "Недостаточно прав для управления темами вариантов."

    def has_permission(self, request, view):
        return can_manage_variant_themes(getattr(request, "user", None))


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    raw = str(value or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _apply_theme_fields(theme: VariantTheme, data: dict, *, files=None) -> list[str]:
    errors = []
    if "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            errors.append("Укажите название")
        else:
            theme.name = name[:160]
    if "slug" in data:
        slug = str(data.get("slug") or "").strip().lower()
        if not slug:
            errors.append("Укажите код (slug)")
        else:
            theme.slug = slug[:80]
    if "description" in data:
        theme.description = str(data.get("description") or "")[:4000]
    if "layout_type" in data:
        layout = str(data.get("layout_type") or "").strip().lower()
        if layout not in ALLOWED_LAYOUTS:
            errors.append("Неизвестный layout_type")
        else:
            theme.layout_type = layout
    if "config" in data:
        raw_config = data.get("config")
        if isinstance(raw_config, str):
            import json

            try:
                raw_config = json.loads(raw_config)
            except (TypeError, ValueError):
                errors.append("Некорректный config")
                raw_config = {}
        theme.config = sanitize_variant_theme_config(raw_config)
    if "is_active" in data:
        theme.is_active = _as_bool(data.get("is_active"))
    if "is_published" in data:
        theme.is_published = _as_bool(data.get("is_published"))

    files = files or {}
    if "preview_image" in files:
        theme.preview_image = files.get("preview_image")
    if "background_image" in files:
        theme.background_image = files.get("background_image")
    if "block_background_image" in files:
        theme.block_background_image = files.get("block_background_image")
    if data.get("clear_preview_image"):
        theme.preview_image = None
    if data.get("clear_background_image"):
        theme.background_image = None
    if data.get("clear_block_background_image"):
        theme.block_background_image = None
    return errors


class VariantThemeAvailableView(APIView):
    """Каталог тем. Сейчас UI показывается только при can_select_variant_theme."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        can_select = can_select_variant_theme(user)
        can_manage = can_manage_variant_themes(user)
        qs = VariantTheme.objects.all().order_by("name", "id")
        if can_manage:
            pass
        elif can_select:
            qs = qs.filter(is_active=True, is_published=True)
        else:
            qs = qs.none()
        themes = [serialize_variant_theme(theme, request) for theme in qs]
        return Response(
            {
                "themes": themes,
                "can_select_variant_theme": can_select,
                "can_manage_variant_themes": can_manage,
            }
        )


class VariantThemeAdminListCreateView(APIView):
    permission_classes = [CanManageVariantThemes]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        themes = [
            serialize_variant_theme(theme, request)
            for theme in VariantTheme.objects.all().order_by("name", "id")
        ]
        return Response({"themes": themes})

    def post(self, request):
        data = request.data or {}
        theme = VariantTheme(
            name=str(data.get("name") or "").strip()[:160],
            slug=str(data.get("slug") or "").strip().lower()[:80],
            layout_type=VariantTheme.LayoutType.CLASSIC,
            config=sanitize_variant_theme_config({}),
        )
        errors = _apply_theme_fields(theme, data, files=request.FILES)
        if not theme.name:
            errors.append("Укажите название")
        if not theme.slug:
            errors.append("Укажите код (slug)")
        if VariantTheme.objects.filter(slug=theme.slug).exists():
            errors.append("Тема с таким кодом уже есть")
        if errors:
            return Response({"error": errors[0], "errors": errors}, status=400)
        if not theme.config:
            theme.config = sanitize_variant_theme_config({})
        theme.save()
        return Response(serialize_variant_theme(theme, request), status=201)


class VariantThemeAdminDetailView(APIView):
    permission_classes = [CanManageVariantThemes]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _get(self, pk: int):
        return VariantTheme.objects.filter(pk=pk).first()

    def get(self, request, theme_id: int):
        theme = self._get(theme_id)
        if theme is None:
            return Response({"error": "Тема не найдена"}, status=404)
        return Response(serialize_variant_theme(theme, request))

    def patch(self, request, theme_id: int):
        theme = self._get(theme_id)
        if theme is None:
            return Response({"error": "Тема не найдена"}, status=404)
        data = request.data or {}
        errors = _apply_theme_fields(theme, data, files=request.FILES)
        if "slug" in data:
            clash = VariantTheme.objects.filter(slug=theme.slug).exclude(pk=theme.pk).exists()
            if clash:
                errors.append("Тема с таким кодом уже есть")
        if errors:
            return Response({"error": errors[0], "errors": errors}, status=400)
        theme.save()
        return Response(serialize_variant_theme(theme, request))

    def delete(self, request, theme_id: int):
        theme = self._get(theme_id)
        if theme is None:
            return Response({"error": "Тема не найдена"}, status=404)
        theme.delete()
        return Response({"ok": True})
