"""API Web Push: VAPID key, subscribe/unsubscribe, devices, test."""

from __future__ import annotations

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
        try:
            sub = upsert_subscription(
                request.user,
                endpoint=endpoint,
                p256dh=keys.get("p256dh") or data.get("p256dh") or "",
                auth=keys.get("auth") or data.get("auth") or "",
                user_agent=request.META.get("HTTP_USER_AGENT", ""),
                device_label=(data.get("device_label") or "")[:120],
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)

        prefs = get_or_create_preferences(request.user)
        if not prefs.push_enabled:
            prefs.push_enabled = True
            prefs.save(update_fields=["push_enabled", "updated_at"])

        return Response({
            "ok": True,
            "device": serialize_device(sub),
            "push_enabled": True,
        })


class PushUnsubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        endpoint = data.get("endpoint") or ""
        device_id = data.get("device_id") or data.get("id")
        if device_id:
            updated = PushSubscription.objects.filter(
                pk=device_id,
                user=request.user,
            ).update(is_active=False)
        else:
            updated = deactivate_endpoint(endpoint, user=request.user)
        return Response({"ok": True, "deactivated": updated})


class PushDevicesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        devices = [
            serialize_device(sub)
            for sub in PushSubscription.objects.filter(user=request.user).order_by("-updated_at")[:20]
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
        sent = send_web_push_to_user(
            request.user,
            title="Тестовое уведомление",
            body="Если вы видите это сообщение, уведомления подключены правильно.",
            url=home,
            tag="push-test",
            priority="important",
            create_log=True,
        )
        if sent <= 0:
            return Response(
                {"error": "Нет активных устройств или не удалось отправить."},
                status=400,
            )
        return Response({"ok": True, "sent": sent})
