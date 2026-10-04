"""Lightweight client stability telemetry. No PII beyond session user id in logs."""

from __future__ import annotations

import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .rate_limit import rate_limit_check, rate_limit_json_response

logger = logging.getLogger(__name__)

ALLOWED_EVENTS = frozenset(
    {
        "material_ws_closed",
        "material_ws_reconnect",
        "board_ws_closed",
        "board_ws_reconnect",
        "jitsi_connection_failed",
        "chunk_load_failed",
        "service_worker_update_failed",
        "board_payload_large",
        "board_full_state_requested",
        "board_full_state_received",
        "board_error",
        "board_health_sample",
        "board_iframe_mount",
        "board_iframe_unmount",
        "board_iframe_key_change",
        "board_iframe_lifecycle",
        "board_iframe_health",
        "board_document_mount",
        "board_document_unload",
        "board_document_pagehide",
        "board_document_pageshow",
        "board_document_visibility",
        "board_sync_status",
        "board_canvas_geometry",
        "api_timeout",
        "PWA_BACKGROUND",
        "PWA_FOREGROUND",
        "RESUME_START",
        "RESUME_AUTH_OK",
        "RESUME_AUTH_FAIL",
        "RESUME_REALTIME_START",
        "RESUME_REALTIME_OK",
        "RESUME_REALTIME_FAIL",
        "RESUME_JITSI_START",
        "RESUME_JITSI_OK",
        "RESUME_JITSI_FAIL",
        "RESUME_BOARD_START",
        "RESUME_BOARD_OK",
        "RESUME_BOARD_FAIL",
        "RESUME_READY",
        "RESUME_TIMEOUT",
        "MANUAL_RECONNECT_CLICK",
        "MANUAL_RELOAD_CLICK",
        "APP_FATAL_ERROR",
        "APP_UNHANDLED_REJECTION",
        "APP_RENDER_ERROR",
        "MAIN_THREAD_STALL",
        "collaboration_connect_start",
        "collaboration_connected",
        "collaboration_disconnected",
        "collaboration_reconnect",
        "collaboration_error",
        "participant_join",
        "participant_leave",
        "initial_state_received",
        "screen_share_started",
        "screen_share_stopped",
        "pip_requested",
        "pip_opened",
        "pip_failed",
        "pip_closed",
        "JITSI_DUPLICATE",
        "RESOURCE_SNAPSHOT",
        "SW_INSTALL",
        "SW_ACTIVATE",
        "SW_CONTROLLER_CHANGE",
        "SW_NAVIGATION_FETCH",
        "SW_UPDATE_FOUND",
        "APP_HARD_RELOAD",
        "APP_HARD_RELOAD_BLOCKED_LIVE_SESSION",
        "CHUNK_RECOVERY_BLOCKED_LIVE_SESSION",
    }
)
MAX_BODY_BYTES = 8000
EXTRA_LOG_KEYS = 24
EXTRA_LOG_CHARS = 1600


def _clip(value, limit: int) -> str:
    if value is None:
        return ""
    return str(value)[:limit]


def extra_for_log(extra, limit_keys: int = EXTRA_LOG_KEYS, value_limit: int = 120) -> dict:
    if not isinstance(extra, dict):
        return {}
    logged = {}
    for key, value in list(extra.items())[:limit_keys]:
        logged[str(key)[:40]] = _clip(value, value_limit)
    return logged


@csrf_exempt
@require_POST
def client_telemetry(request):
    if not rate_limit_check(request, "client_telemetry", 40, 60):
        limited = rate_limit_json_response("client_telemetry")
        limited["Retry-After"] = "60"
        return limited

    raw = request.body or b""
    if len(raw) > MAX_BODY_BYTES:
        return JsonResponse({"ok": False, "error": "too_large"}, status=413)

    try:
        data = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return JsonResponse({"ok": False, "error": "invalid_json"}, status=400)

    if not isinstance(data, dict):
        return JsonResponse({"ok": False, "error": "invalid_json"}, status=400)

    raw_events = data.get("events")
    if isinstance(raw_events, list):
        items = [item for item in raw_events[:20] if isinstance(item, dict)]
    elif data.get("event"):
        items = [data]
    else:
        return JsonResponse({"ok": False, "error": "unknown_event"}, status=400)

    user_id = getattr(getattr(request, "user", None), "pk", None) or 0
    accepted = 0
    rejected = 0
    for item in items:
        event = _clip(item.get("event"), 64)
        if event not in ALLOWED_EVENTS:
            rejected += 1
            continue
        context = item.get("context") if isinstance(item.get("context"), dict) else {}
        if not context and isinstance(data.get("context"), dict) and item is not data:
            context = data.get("context")
        extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}
        logger.info(
            "mobile_telemetry event=%s user_id=%s page=%s online=%s conn=%s vis=%s "
            "viewport=%s screen=%s os=%s extra=%s ua=%s",
            event,
            user_id,
            _clip(context.get("page"), 160),
            context.get("online"),
            _clip(context.get("connection"), 16),
            _clip(context.get("visibility"), 16),
            _clip(context.get("viewport"), 32),
            _clip(context.get("screen"), 32),
            _clip(context.get("os"), 64),
            json.dumps(extra_for_log(extra), ensure_ascii=False)[:EXTRA_LOG_CHARS],
            _clip(context.get("browser"), 240),
        )
        accepted += 1

    if accepted == 0:
        return JsonResponse({"ok": False, "error": "unknown_event", "rejected": rejected}, status=400)
    return JsonResponse({"ok": True, "accepted": accepted, "rejected": rejected})
