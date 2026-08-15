"""API Web Push: VAPID key, subscribe/unsubscribe, devices, test."""

from __future__ import annotations

from django.db.models import Q
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import PushSubscription, Profile
from .notifications import get_or_create_preferences
from .webpush import (
    deactivate_endpoint,
    serialize_device,
    send_web_push_to_user,
    upsert_subscription,
    vapid_public_key,
    webpush_configured,
)


def _home_path_for(user) -> str:
    profile = getattr(user, "profile", None)
    if profile is not None and profile.role == Profile.Role.STUDENT:
        return "/cabinet/student"
    return "/cabinet"


class PushVapidPublicKeyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "configured": webpush_configured(),
            "public_key": vapid_public_key() if webpush_configured() else "",
        })


class PushSubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not webpush_configured():
            return Response(
                {"error": "Web Push пока не настроен на сервере."},
                status=503,
            )
        data = request.data or {}
        subscription = data.get("subscription") or data
        endpoint = subscription.get("endpoint") or ""
        keys = subscription.get("keys") or {}
        mode = str(data.get("mode") or "enable").strip().lower()
        activate = mode != "sync"
        try:
            sub = upsert_subscription(
                request.user,
                endpoint=endpoint,
                p256dh=keys.get("p256dh") or data.get("p256dh") or "",
                auth=keys.get("auth") or data.get("auth") or "",
                user_agent=request.META.get("HTTP_USER_AGENT", ""),
                device_label=(data.get("device_label") or "")[:120],
                activate=activate,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)

        prefs = get_or_create_preferences(request.user)
        # Только явное «Включить» поднимает глобальный канал. Тихая синхронизация
        # после deploy не должна включать то, что пользователь выключил.
        if activate and not prefs.push_enabled:
            prefs.push_enabled = True
            prefs.save(update_fields=["push_enabled", "updated_at"])

        return Response({
            "ok": True,
            "device": serialize_device(sub),
            "push_enabled": prefs.push_enabled,
            "disabled_by_user": bool(sub.disabled_by_user),
            "synced": not activate,
        })


class PushUnsubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        endpoint = data.get("endpoint") or ""
        device_id = data.get("device_id") or data.get("id")
        reason = str(data.get("reason") or "user").strip().lower()
        by_user = reason == "user"
        if device_id:
            updated = PushSubscription.objects.filter(
                pk=device_id,
                user=request.user,
            ).update(is_active=False, disabled_by_user=by_user)
        else:
            updated = deactivate_endpoint(endpoint, user=request.user, by_user=by_user)
        return Response({"ok": True, "deactivated": updated})


class PushDevicesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        current_endpoint = (request.query_params.get("endpoint") or "").strip() or None
        qs = PushSubscription.objects.filter(user=request.user)
        if current_endpoint:
            qs = qs.filter(Q(is_active=True) | Q(endpoint=current_endpoint))
        else:
            qs = qs.filter(is_active=True)
        devices = [
            serialize_device(sub, current_endpoint=current_endpoint)
            for sub in qs.order_by("-is_active", "-updated_at")[:20]
        ]
        prefs = get_or_create_preferences(request.user)
        return Response({
            "configured": webpush_configured(),
            "push_enabled": prefs.push_enabled,
            "devices": devices,
            "active_count": sum(1 for d in devices if d["is_active"]),
        })


class PushTestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not webpush_configured():
            return Response({"error": "Web Push не настроен."}, status=503)
        home = _home_path_for(request.user)
        data = request.data or {}
        # Тест только текущему пользователю; опционально — только текущее устройство.
        only_endpoint = (data.get("endpoint") or "").strip() or None
        all_devices = bool(data.get("all_devices"))
        result = send_web_push_to_user(
            request.user,
            title="Тестовое уведомление",
            body="Если вы видите это сообщение, уведомления подключены правильно.",
            url=home,
            tag="push-test",
            priority="important",
            create_log=False,
            force=True,
            event_type="push_test",
            only_endpoint=None if all_devices else only_endpoint,
        )
        sent = int(result.get("sent") or 0)
        if sent <= 0:
            reason = result.get("reason") or "send_failed"
            errors = result.get("errors") or []
            messages = {
                "no_devices": (
                    "На этом устройстве нет активной подписки. "
                    "Сначала нажмите «Включить на этом устройстве»."
                ),
                "pywebpush_missing": "На сервере не установлен pywebpush (pip install pywebpush).",
                "not_configured": "Web Push не настроен (VAPID-ключи).",
                "send_failed": (
                    "Сервер не смог отправить уведомление. Подробности записаны в журнал. "
                    "Подписка могла устареть — включите уведомления повторно."
                ),
            }
            error = messages.get(reason, messages["send_failed"])
            detail = (errors[0] if errors else "") or ""
            if "pkhash" in detail.lower() or "mismatch" in detail.lower():
                error = (
                    "Подписка устарела. Включите уведомления повторно "
                    "(hard refresh, затем «Включить на этом устройстве»)."
                )
            elif "410" in detail or "404" in detail:
                error = "Подписка устарела. Включите уведомления повторно."
            return Response(
                {"error": error, "reason": reason, "errors": errors[:3]},
                status=400,
            )
        return Response({
            "ok": True,
            "sent": sent,
            "message": "Тестовое уведомление отправлено",
        })
