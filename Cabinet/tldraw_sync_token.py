"""Короткий подписанный допуск к комнате tldraw.

Секрет общий с Node-сервисом services/tldraw-sync. Формат токена
должен совпадать с services/tldraw-sync/token.mjs.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from django.conf import settings

DEV_SYNC_SECRET = "itflux-tldraw-sync-dev"
DEFAULT_TTL_SECONDS = 600


def tldraw_sync_secret() -> str:
    secret = str(getattr(settings, "TLDRAW_SYNC_SECRET", "") or "").strip()
    if secret:
        return secret
    if getattr(settings, "DEBUG", False):
        return DEV_SYNC_SECRET
    return ""


def tldraw_sync_token_ttl() -> int:
    try:
        ttl = int(getattr(settings, "TLDRAW_SYNC_TOKEN_TTL_SECONDS", DEFAULT_TTL_SECONDS))
    except (TypeError, ValueError):
        ttl = DEFAULT_TTL_SECONDS
    return max(30, min(ttl, 3600))


def issue_tldraw_sync_token(*, board_id, user_id, can_edit: bool) -> str:
    secret = tldraw_sync_secret()
    if not secret:
        return ""
    payload = {
        "board_id": str(board_id),
        "user_id": int(user_id),
        "can_edit": bool(can_edit),
        "exp": int(time.time()) + tldraw_sync_token_ttl(),
    }
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    ).decode().rstrip("=")
    signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"
