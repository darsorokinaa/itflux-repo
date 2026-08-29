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
    }
)
MAX_BODY_BYTES = 8000


def _clip(value, limit: int) -> str:
    return str(value or "")[:limit]


@csrf_exempt
@require_POST
def client_telemetry(request):
    if not rate_limit_check(request, "client_telemetry", 40, 60):
        return rate_limit_json_response("client_telemetry")

    raw = request.body or b""
    if len(raw) > MAX_BODY_BYTES:
        return JsonResponse({"ok": False, "error": "too_large"}, status=413)

    try:
        data = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return JsonResponse({"ok": False, "error": "invalid_json"}, status=400)

    if not isinstance(data, dict):
        return JsonResponse({"ok": False, "error": "invalid_json"}, status=400)

    event = _clip(data.get("event"), 64)
    if event not in ALLOWED_EVENTS:
        return JsonResponse({"ok": False, "error": "unknown_event"}, status=400)

    context = data.get("context") if isinstance(data.get("context"), dict) else {}
    extra = data.get("extra") if isinstance(data.get("extra"), dict) else {}
    user_id = getattr(getattr(request, "user", None), "pk", None) or 0

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
        json.dumps(
            {str(k)[:40]: _clip(v, 120) for k, v in list(extra.items())[:12]},
            ensure_ascii=False,
        )[:800],
        _clip(context.get("browser"), 240),
    )
    return JsonResponse({"ok": True})
