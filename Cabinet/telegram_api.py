"""API подключения Telegram и настроек уведомлений."""

from __future__ import annotations

import json
import logging

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .telegram_connect import (
    bind_telegram_account,
    create_telegram_connect_link,
    disconnect_telegram,
    send_test_telegram_notification,
    telegram_status_payload,
    update_notification_preferences,
)

logger = logging.getLogger(__name__)


class TelegramStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(telegram_status_payload(request.user))


class TelegramConnectLinkView(APIView):
    """По запросу пользователя создаёт короткоживущую deep-link (токен не показывается в UI)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            payload = create_telegram_connect_link(request.user)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
        return Response({"ok": True, **payload})


class TelegramDisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        disconnect_telegram(request.user)
        return Response({"ok": True, **telegram_status_payload(request.user)})


class TelegramTestNotificationView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            send_test_telegram_notification(request.user)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
        return Response({"ok": True})


class NotificationPreferencesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(telegram_status_payload(request.user))

    def patch(self, request):
        try:
            payload = update_notification_preferences(request.user, request.data or {})
        except (ValueError, TypeError) as exc:
            return Response({"error": str(exc)}, status=400)
        return Response({"ok": True, **payload})


def _webhook_secret_ok(request) -> bool:
    expected = (getattr(settings, "TELEGRAM_WEBHOOK_SECRET", "") or "").strip()
    if not expected:
        # Без секрета принимаем только если явно разрешено в DEBUG.
        return bool(getattr(settings, "DEBUG", False))
    provided = (
        request.headers.get("X-Telegram-Bot-Api-Secret-Token")
        or request.META.get("HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN")
        or ""
    ).strip()
    return provided == expected


def _extract_start_token(text: str) -> str:
    text = (text or "").strip()
    if not text.startswith("/start"):
        return ""
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return ""
    return parts[1].strip()


@csrf_exempt
@require_http_methods(["POST"])
def telegram_bot_webhook(request):
    if not _webhook_secret_ok(request):
        return HttpResponse(status=403)

    try:
        update = json.loads(request.body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JsonResponse({"ok": False}, status=400)

    message = update.get("message") or update.get("edited_message") or {}
    text = message.get("text") or ""
    chat = message.get("chat") or {}
    from_user = message.get("from") or {}
    chat_id = chat.get("id")
    start_token = _extract_start_token(text)

    if start_token and chat_id is not None:
        try:
            user = bind_telegram_account(
                token=start_token,
                chat_id=str(chat_id),
                username=from_user.get("username") or "",
            )
            reply = (
                "Telegram подключён.\n\n"
                "Здесь будут приходить напоминания об уроках и заданиях."
            )
            from Generator.telegram_utils import send_telegram_message

            send_telegram_message(reply, chat_id=str(chat_id))
            logger.info("Telegram linked for user_id=%s chat_id=%s", user.id, chat_id)
        except ValueError as exc:
            from Generator.telegram_utils import send_telegram_message

            send_telegram_message(str(exc), chat_id=str(chat_id))
        except Exception:
            logger.exception("Telegram webhook bind failed")

    return JsonResponse({"ok": True})
