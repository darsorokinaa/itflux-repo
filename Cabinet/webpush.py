"""Web Push (VAPID) delivery for cabinet notifications — shared by teacher and student."""

from __future__ import annotations

import json
import logging
from typing import Any

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone

from .choices import NotificationChannel, NotificationStatus
from .models import Notification, PushDeliveryLog, PushSubscription
from .notification_links import resolve_notification_url

logger = logging.getLogger(__name__)


def _prefs(user):
    from .notification_dispatch import get_or_create_preferences
    return get_or_create_preferences(user)


def _vapid_private_key() -> str:
    """Normalize private key from .env (PEM with \\n, optional quotes)."""
    raw = (getattr(settings, "VAPID_PRIVATE_KEY", "") or "").strip()
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        raw = raw[1:-1].strip()
    raw = raw.replace("\\n", "\n").strip()
    return raw


def _load_vapid():
    """
    pywebpush → Vapid.from_string() не понимает PEM (только raw/DER).
    PEM из generate_vapid_keys / openssl нужно грузить через from_pem.
    """
    from py_vapid import Vapid

    key = _vapid_private_key()
    if not key:
        raise ValueError("VAPID_PRIVATE_KEY пуст")
    if "BEGIN" in key:
        return Vapid.from_pem(key.encode("utf-8"))
    return Vapid.from_string(private_key=key)


def _public_key_from_vapid(vapid) -> str:
    import base64
    from cryptography.hazmat.primitives import serialization

    raw = vapid.public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def webpush_configured() -> bool:
    if not _vapid_private_key():
        return False
    try:
        _load_vapid()
        return True
    except Exception:
        logger.warning("VAPID_PRIVATE_KEY present but cannot be loaded", exc_info=True)
        return False


def vapid_public_key() -> str:
    """
    Публичный ключ для PushManager.subscribe должен соответствовать private.
    Всегда выводим из VAPID_PRIVATE_KEY — иначе FCM отвечает ValidPkHashMismatch.
    """
    try:
        return _public_key_from_vapid(_load_vapid())
    except Exception:
        # fallback на env (старые деплои), но это как раз источник mismatch
        return (getattr(settings, "VAPID_PUBLIC_KEY", "") or "").strip()


def _vapid_claims() -> dict:
    mailto = (getattr(settings, "VAPID_ADMIN_EMAIL", "") or "").strip() or "mailto:admin@itflux.ru"
    if not mailto.startswith("mailto:"):
        mailto = f"mailto:{mailto}"
    return {"sub": mailto}


def _is_in_dnd(prefs) -> bool:
    if not getattr(prefs, "dnd_enabled", False):
        return False
    start = getattr(prefs, "dnd_start", None)
    end = getattr(prefs, "dnd_end", None)
    if not start or not end:
        return False
    now_t = timezone.localtime().time()
    if start <= end:
        return start <= now_t < end
    # Overnight window, e.g. 22:00–07:00
    return now_t >= start or now_t < end


def _priority_allows_push(priority: str, urgent: bool, prefs) -> bool:
    if _is_in_dnd(prefs):
        if urgent and getattr(prefs, "dnd_allow_urgent", True):
            return True
        if priority == "critical":
            return True
        return False
    return priority in ("critical", "important", "normal", "")


def _record_delivery(
    *,
    user: User,
    subscription: PushSubscription | None,
    notification: Notification | None,
    event_type: str,
    status: str,
    http_status: int | None = None,
    error_message: str = "",
) -> None:
    try:
        PushDeliveryLog.objects.create(
            user=user,
            subscription=subscription,
            notification=notification,
            event_type=(event_type or "")[:64],
            status=status,
            http_status=http_status,
            error_message=(error_message or "")[:500],
        )
    except Exception:
        logger.exception("Failed to write PushDeliveryLog for user %s", user.pk)


def send_web_push_to_user(
    user: User,
    *,
    title: str,
    body: str,
    url: str = "",
    tag: str = "",
    priority: str = "normal",
    urgent: bool = False,
    payload_extra: dict | None = None,
    create_log: bool = True,
    force: bool = False,
    notification: Notification | None = None,
    event_type: str = "",
    only_endpoint: str | None = None,
) -> dict[str, Any]:
    """
    Send Web Push to all active subscriptions of the user.
    Returns {sent, active, reason, errors}.
    force=True — ignore push_enabled / DND (для тестовой кнопки).
    only_endpoint — отправить только на конкретное устройство (тест).
    """
    empty = {"sent": 0, "active": 0, "reason": "", "errors": []}
    if not webpush_configured():
        return {**empty, "reason": "not_configured"}

    prefs = _prefs(user)
    if not force and not getattr(prefs, "push_enabled", True):
        return {**empty, "reason": "push_disabled"}
    if not force and not _priority_allows_push(priority, urgent, prefs):
        return {**empty, "reason": "dnd"}

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("pywebpush is not installed — skip web push")
        return {**empty, "reason": "pywebpush_missing"}

    try:
        vapid = _load_vapid()
    except Exception as exc:
        logger.exception("Failed to load VAPID private key")
        return {**empty, "reason": "send_failed", "errors": [f"VAPID key error: {exc}"[:300]]}

    resolved_event = event_type or (
        (payload_extra or {}).get("event_type")
        or (payload_extra or {}).get("type")
        or ""
    )
    data = {
        "title": title[:120],
        "body": (body or "")[:180],
        "url": url or "/cabinet",
        "tag": tag or "",
        "role": getattr(getattr(user, "profile", None), "role", "") or "",
        "event_type": resolved_event,
    }
    if payload_extra:
        # Never put secrets / PII dumps into push payload
        for key in ("event_type", "submission_id", "event_id", "student_id", "review_id"):
            if key in payload_extra and payload_extra[key] is not None:
                data[key] = payload_extra[key]

    sent = 0
    errors: list[str] = []
    qs = PushSubscription.objects.filter(user=user, is_active=True)
    if only_endpoint:
        qs = qs.filter(endpoint=only_endpoint)
    qs = list(qs)
    if not qs:
        return {**empty, "reason": "no_devices"}

    for sub in qs:
        try:
            # Важно: у pywebpush нет аргумента vapid_public_key — публичный ключ
            # берётся из private; лишний kwargs валил TypeError на каждой отправке.
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps(data, ensure_ascii=False),
                vapid_private_key=vapid,
                vapid_claims=_vapid_claims(),
                ttl=86400,
            )
            sub.last_seen_at = timezone.now()
            sub.save(update_fields=["last_seen_at", "updated_at"])
            sent += 1
            _record_delivery(
                user=user,
                subscription=sub,
                notification=notification,
                event_type=resolved_event,
                status=PushDeliveryLog.DeliveryStatus.SENT,
                http_status=201,
            )
            if create_log:
                Notification.objects.create(
                    recipient_user=user,
                    channel=NotificationChannel.PUSH,
                    event_type=resolved_event,
                    title=title,
                    message=body or "",
                    payload={**data, "subscription_id": sub.pk},
                    status=NotificationStatus.SENT,
                    sent_at=timezone.now(),
                    is_read=True,  # push log — not shown as unread in-app duplicate
                )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            err_text = str(exc)[:300]
            errors.append(err_text)
            logger.info("Web push failed for sub %s: %s", sub.pk, exc)
            # 404/410 — endpoint мёртв; 401/403 + pkhash — подписка от другого VAPID
            low = err_text.lower()
            key_mismatch = "pkhash" in low or "mismatch" in low
            gone = status_code in (404, 410) or (status_code in (401, 403) and key_mismatch)
            # 429 / 5xx — временные ошибки, подписку не трогаем
            temporary = status_code in (429, 500, 502, 503, 504)
            if gone:
                sub.is_active = False
                sub.save(update_fields=["is_active", "updated_at"])
                _record_delivery(
                    user=user,
                    subscription=sub,
                    notification=notification,
                    event_type=resolved_event,
                    status=PushDeliveryLog.DeliveryStatus.GONE,
                    http_status=status_code,
                    error_message=err_text,
                )
            else:
                _record_delivery(
                    user=user,
                    subscription=sub,
                    notification=notification,
                    event_type=resolved_event,
                    status=PushDeliveryLog.DeliveryStatus.FAILED,
                    http_status=status_code,
                    error_message=err_text,
                )
                if create_log and not temporary:
                    Notification.objects.create(
                        recipient_user=user,
                        channel=NotificationChannel.PUSH,
                        event_type=resolved_event,
                        title=title,
                        message=body or "",
                        payload=data,
                        status=NotificationStatus.FAILED,
                        error_message=err_text[:500],
                        is_read=True,
                    )
        except Exception as exc:
            errors.append(str(exc)[:300])
            logger.exception("Unexpected web push error for user %s", user.pk)
            _record_delivery(
                user=user,
                subscription=sub,
                notification=notification,
                event_type=resolved_event,
                status=PushDeliveryLog.DeliveryStatus.FAILED,
                error_message=str(exc)[:300],
            )

    return {
        "sent": sent,
        "active": len(qs),
        "reason": "" if sent else (errors and "send_failed" or "no_devices"),
        "errors": errors,
    }


def notify_user_channels(
    user: User,
    *,
    title: str,
    message: str,
    payload: dict | None = None,
    in_app: bool = True,
    push: bool = True,
    push_priority: str = "important",
    urgent: bool = False,
    tag: str = "",
    skip_push_log: bool = False,
    recipient_student=None,
    recipient_teacher=None,
    event_type: str = "",
    dedup_key: str = "",
    actor: User | None = None,
    skip_actor: bool = False,
    force: bool = False,
    check_preferences: bool = True,
) -> list[Notification]:
    """
    Create in-app notification and optionally send web push for any role.

    Prefer NotificationDispatcher.notify for new code. This helper remains for
    gradual migration and respects catalog preferences when event_type is set.
    """
    payload = dict(payload or {})
    resolved_type = event_type or payload.get("event_type") or payload.get("type") or ""

    url = ""
    if isinstance(payload.get("url"), str) and payload["url"].startswith("/"):
        url = payload["url"]
    else:
        class _Tmp:
            pass
        tmp = _Tmp()
        tmp.payload = payload
        tmp.title = title
        url = resolve_notification_url(tmp) or ""
        if url:
            payload["url"] = url

    if check_preferences and resolved_type:
        from .notification_dispatch import NotificationDispatcher

        force_channels = set()
        if in_app:
            force_channels.add("in_app")
        if push:
            force_channels.add("push")
        result = NotificationDispatcher.notify(
            user,
            resolved_type,
            title=title,
            message=message,
            actor=actor,
            payload=payload,
            url=url or None,
            dedup_key=dedup_key or None,
            recipient_student=recipient_student,
            recipient_teacher=recipient_teacher,
            skip_actor=skip_actor,
            force=force,
            force_channels=force_channels or None,
            push_tag=tag,
            create_in_app=in_app,
            create_push=push,
            create_telegram=False,
        )
        return [result.in_app] if result.in_app else []

    # Legacy path without event_type
    prefs = _prefs(user)
    notes: list[Notification] = []
    in_app_note = None
    if in_app and prefs.in_app_enabled:
        in_app_note = Notification.objects.create(
            recipient_user=user,
            recipient_student=recipient_student,
            recipient_teacher=recipient_teacher,
            actor=actor,
            channel=NotificationChannel.IN_APP,
            event_type=resolved_type,
            event_key=dedup_key or "",
            title=title,
            message=message,
            payload=payload,
            status=NotificationStatus.SENT,
            sent_at=timezone.now(),
        )
        notes.append(in_app_note)

    if push and getattr(prefs, "push_enabled", True):
        send_web_push_to_user(
            user,
            title=title,
            body=message,
            url=url or "/cabinet",
            tag=tag or str(payload.get("type") or "cabinet"),
            priority=push_priority,
            urgent=urgent,
            payload_extra=payload,
            create_log=not skip_push_log,
            notification=in_app_note,
            event_type=resolved_type,
            force=force,
        )

    return notes


def upsert_subscription(
    user: User,
    *,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str = "",
    device_label: str = "",
) -> PushSubscription:
    endpoint = (endpoint or "").strip()
    p256dh = (p256dh or "").strip()
    auth = (auth or "").strip()
    if not endpoint or not p256dh or not auth:
        raise ValueError("Некорректная push-подписка")

    # Re-bind endpoint to current user (logout / switch account on same device)
    PushSubscription.objects.filter(endpoint=endpoint).exclude(user=user).update(
        is_active=False,
    )

    sub, created = PushSubscription.objects.get_or_create(
        endpoint=endpoint,
        defaults={
            "user": user,
            "p256dh": p256dh,
            "auth": auth,
            "user_agent": (user_agent or "")[:500],
            "device_label": (device_label or "")[:120],
            "is_active": True,
            "last_seen_at": timezone.now(),
        },
    )
    if not created:
        sub.user = user
        sub.p256dh = p256dh
        sub.auth = auth
        sub.user_agent = (user_agent or sub.user_agent or "")[:500]
        if device_label:
            sub.device_label = device_label[:120]
        sub.is_active = True
        sub.last_seen_at = timezone.now()
        sub.save()
    return sub


def deactivate_endpoint(endpoint: str, user: User | None = None) -> int:
    qs = PushSubscription.objects.filter(endpoint=(endpoint or "").strip())
    if user is not None:
        qs = qs.filter(user=user)
    return qs.update(is_active=False)


def deactivate_user_subscriptions(user: User) -> int:
    return PushSubscription.objects.filter(user=user, is_active=True).update(is_active=False)


def serialize_device(sub: PushSubscription) -> dict[str, Any]:
    ua = sub.user_agent or ""
    browser = "Браузер"
    device = "Устройство"
    low = ua.lower()
    if "edg/" in low:
        browser = "Edge"
    elif "chrome/" in low and "edg/" not in low:
        browser = "Chrome"
    elif "firefox/" in low:
        browser = "Firefox"
    elif "safari/" in low and "chrome/" not in low:
        browser = "Safari"
    if "iphone" in low or "ipad" in low:
        device = "iPhone/iPad"
    elif "android" in low:
        device = "Android"
    elif "mac os" in low or "macintosh" in low:
        device = "Mac"
    elif "windows" in low:
        device = "Windows"
    return {
        "id": sub.pk,
        "device_label": sub.device_label or f"{device} · {browser}",
        "browser": browser,
        "device_type": device,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
        "last_seen_at": sub.last_seen_at.isoformat() if sub.last_seen_at else None,
        "is_active": sub.is_active,
    }
