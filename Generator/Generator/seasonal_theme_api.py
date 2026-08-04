"""API сезонного оформления."""

from __future__ import annotations

from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .seasonal_theme_models import SeasonalTheme
from .seasonal_theme_service import (
    PREVIEW_SESSION_KEY,
    PREVIEW_TOKEN_SESSION_KEY,
    make_preview_token,
    resolve_effective_theme,
    resolve_user_preference,
    verify_preview_token,
)


def _preview_theme_id_from_request(request) -> int | None:
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated or not user.is_staff:
        return None
    session = getattr(request, "session", None)
    if session is None:
        return None
    theme_id = session.get(PREVIEW_SESSION_KEY)
    token = session.get(PREVIEW_TOKEN_SESSION_KEY)
    if not theme_id or not token:
        return None
    try:
        theme_id = int(theme_id)
    except (TypeError, ValueError):
        return None
    if not verify_preview_token(theme_id, user.id, token):
        return None
    return theme_id


class SeasonalThemeCurrentView(APIView):
    """Текущее оформление с учётом дат, prefs и preview."""

    permission_classes = [AllowAny]

    def get(self, request):
        preference = resolve_user_preference(request.user)
        # Гость может передать preference через query (синхрон с localStorage)
        if not getattr(request.user, "is_authenticated", False):
            q_mode = (request.query_params.get("mode") or "").strip().lower()
            if q_mode in ("auto", "default", "manual"):
                preference = {
                    **preference,
                    "mode": q_mode,
                }
            if "animations_enabled" in request.query_params:
                raw = str(request.query_params.get("animations_enabled")).lower()
                preference["animations_enabled"] = raw in ("1", "true", "yes")
            if q_mode == "manual":
                raw_id = request.query_params.get("theme_id") or request.query_params.get(
                    "selected_theme_id"
                )
                try:
                    preference["selected_theme_id"] = int(raw_id) if raw_id else None
                except (TypeError, ValueError):
                    preference["selected_theme_id"] = None

        preview_id = _preview_theme_id_from_request(request)
        payload = resolve_effective_theme(
            request,
            preference=preference,
            preview_theme_id=preview_id,
        )
        return Response(payload)


class SeasonalThemePreferenceView(APIView):
    """Сохранение пользовательского выбора оформления."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(resolve_user_preference(request.user))

    def patch(self, request):
        from Cabinet.models import SeasonalThemePreference

        data = request.data or {}
        pref, _ = SeasonalThemePreference.objects.get_or_create(user=request.user)

        mode = data.get("mode")
        if mode is not None:
            mode = str(mode).strip().lower()
            if mode not in {
                SeasonalThemePreference.Mode.AUTO,
                SeasonalThemePreference.Mode.DEFAULT,
                SeasonalThemePreference.Mode.MANUAL,
            }:
                return Response({"error": "Некорректный mode"}, status=400)
            pref.mode = mode

        if "animations_enabled" in data:
            pref.animations_enabled = bool(data.get("animations_enabled"))

        if "selected_theme_id" in data or "selected_seasonal_theme" in data:
            raw = data.get("selected_theme_id", data.get("selected_seasonal_theme"))
            if raw in (None, "", 0, "0"):
                pref.selected_theme = None
            else:
                try:
                    theme_id = int(raw)
                except (TypeError, ValueError):
                    return Response({"error": "Некорректный selected_theme_id"}, status=400)
                theme = SeasonalTheme.objects.filter(pk=theme_id).first()
                if theme is None:
                    return Response({"error": "Тема не найдена"}, status=404)
                if not theme.allow_manual_selection or not theme.is_active or theme.is_draft:
                    return Response({"error": "Тему нельзя выбрать вручную"}, status=400)
                if theme.admin_only and not request.user.is_staff:
                    return Response({"error": "Тема недоступна"}, status=403)
                pref.selected_theme = theme
                if pref.mode != SeasonalThemePreference.Mode.MANUAL:
                    pref.mode = SeasonalThemePreference.Mode.MANUAL

        if pref.mode == SeasonalThemePreference.Mode.DEFAULT:
            # Обычное оформление — тема не нужна
            pref.selected_theme = None
        elif pref.mode == SeasonalThemePreference.Mode.AUTO:
            pref.selected_theme = None

        pref.save()
        preview_id = _preview_theme_id_from_request(request)
        payload = resolve_effective_theme(
            request,
            preference=resolve_user_preference(request.user),
            preview_theme_id=preview_id,
        )
        return Response({"ok": True, **payload})


class SeasonalThemePreviewStartView(APIView):
    """Включить предпросмотр темы (только staff)."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        data = request.data or {}
        raw = data.get("theme_id") or data.get("id")
        try:
            theme_id = int(raw)
        except (TypeError, ValueError):
            return Response({"error": "Укажите theme_id"}, status=400)
        theme = SeasonalTheme.objects.filter(pk=theme_id).first()
        if theme is None:
            return Response({"error": "Тема не найдена"}, status=404)

        token = make_preview_token(theme.id, request.user.id)
        request.session[PREVIEW_SESSION_KEY] = theme.id
        request.session[PREVIEW_TOKEN_SESSION_KEY] = token
        request.session.modified = True

        payload = resolve_effective_theme(
            request,
            preference=resolve_user_preference(request.user),
            preview_theme_id=theme.id,
        )
        return Response({"ok": True, **payload})


class SeasonalThemePreviewStopView(APIView):
    """Завершить предпросмотр."""

    permission_classes = [IsAdminUser]

    def post(self, request):
        request.session.pop(PREVIEW_SESSION_KEY, None)
        request.session.pop(PREVIEW_TOKEN_SESSION_KEY, None)
        request.session.modified = True
        payload = resolve_effective_theme(
            request,
            preference=resolve_user_preference(request.user),
            preview_theme_id=None,
        )
        return Response({"ok": True, **payload})
