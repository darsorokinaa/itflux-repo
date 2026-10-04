"""Короткоживущий JWT для Jitsi as a Service (8x8).

Private key читается только здесь, на backend. В ответ API, HTML и логи он не попадает.
Роль moderator задаёт вызывающий код по моделям урока, не по полю из запроса.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from pathlib import Path
from typing import Any

import jwt
from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone

from .jitsi_service import JitsiConfigError, build_user_info

logger = logging.getLogger(__name__)

JAAS_DOMAIN = "8x8.vc"
JAAS_JWT_ISS = "chat"
JAAS_JWT_AUD = "jitsi"
_MIN_TTL_SECONDS = 60
_MAX_TTL_SECONDS = 4 * 3600


def get_video_provider() -> str:
    """meet — текущий Jitsi (meet.jit.si или свой хост). jaas — 8x8."""
    raw = str(getattr(settings, "VIDEO_PROVIDER", "") or "meet").strip().lower()
    if raw == "jaas":
        return "jaas"
    if raw and raw != "meet":
        logger.warning("video_provider_unknown value=%s fallback=meet", raw[:32])
    return "meet"


def _setting(name: str) -> str:
    return str(getattr(settings, name, "") or "").strip()


def get_jaas_app_id() -> str:
    return _setting("JAAS_APP_ID")


def get_jaas_api_key_id() -> str:
    return _setting("JAAS_API_KEY_ID")


def jaas_kid() -> str:
    """kid из консоли 8x8. Если в переменной только хвост ключа — дополняем App ID."""
    key_id = get_jaas_api_key_id()
    app_id = get_jaas_app_id()
    if not key_id:
        return ""
    if "/" in key_id:
        return key_id
    if not app_id:
        return key_id
    return f"{app_id}/{key_id}"


def normalize_jaas_private_key(raw: str) -> str:
    """PEM из env/файла. Литеральные \\n и JSON выгрузки 8x8 приводятся к PEM."""
    text = str(raw or "").strip()
    if not text:
        return ""
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("JaaS private key JSON is unreadable")
            return ""
        if not isinstance(data, dict):
            return ""
        text = str(data.get("privateKey") or data.get("private_key") or "").strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {'"', "'"}:
        text = text[1:-1].strip()
    text = text.replace("\\n", "\n").strip()
    return text


def load_jaas_private_key() -> str:
    inline = normalize_jaas_private_key(getattr(settings, "JAAS_PRIVATE_KEY", "") or "")
    if inline:
        return inline
    path = _setting("JAAS_PRIVATE_KEY_PATH")
    if not path:
        return ""
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError:
        logger.warning("JaaS private key file is unreadable")
        return ""
    return normalize_jaas_private_key(raw)


def jaas_ttl_seconds(requested: int | None = None) -> int:
    if requested is None:
        try:
            raw = int(getattr(settings, "JAAS_TOKEN_TTL_SECONDS", 7200) or 7200)
        except (TypeError, ValueError):
            raw = 7200
    else:
        raw = int(requested)
    return max(_MIN_TTL_SECONDS, min(raw, _MAX_TTL_SECONDS))


def jaas_is_configured() -> bool:
    key = load_jaas_private_key()
    return bool(get_jaas_app_id() and get_jaas_api_key_id() and _looks_like_private_key(key))


def _looks_like_private_key(key: str) -> bool:
    return "PRIVATE KEY" in key and "BEGIN" in key


def _require_jaas() -> tuple[str, str, str]:
    app_id = get_jaas_app_id()
    kid = jaas_kid()
    private_key = load_jaas_private_key()
    if not app_id or not kid or not _looks_like_private_key(private_key):
        raise JitsiConfigError("JaaS не настроен")
    return app_id, kid, private_key


def jaas_external_room_name(local_room: str) -> str:
    """Полное имя комнаты External API. Локальная часть — уже сохранённый room_name урока."""
    app_id = get_jaas_app_id()
    local = str(local_room or "").strip().strip("/")
    if not app_id or not local:
        return local
    prefix = f"{app_id}/"
    if local.startswith(prefix):
        return local
    return f"{app_id}/{local}"


def jaas_script_url() -> str:
    app_id = get_jaas_app_id()
    if not app_id:
        return ""
    return f"https://{JAAS_DOMAIN}/{app_id}/external_api.js"


def jaas_client_config(local_room: str) -> dict[str, str]:
    """Публичные поля для фронтенда. Без ключа и без JWT."""
    app_id = get_jaas_app_id()
    return {
        "domain": JAAS_DOMAIN,
        "appId": app_id,
        "externalRoomName": jaas_external_room_name(local_room),
        "scriptUrl": jaas_script_url(),
    }


def _moderator_claim(is_moderator: bool) -> str:
    # 8x8 / Prosody token_moderation сравнивают строку, не JSON-bool.
    return "true" if is_moderator else "false"


def generate_jaas_jwt(
    *,
    room_name: str,
    user: User,
    is_moderator: bool,
    request=None,
    role: str = "",
    lesson_id: Any = "",
    ttl_seconds: int | None = None,
) -> str:
    """RS256 JWT, ограниченный одной комнатой урока."""
    app_id, kid, private_key = _require_jaas()
    local_room = str(room_name or "").strip()
    if not local_room or "/" in local_room:
        raise JitsiConfigError("JaaS не настроен")

    ttl = jaas_ttl_seconds(ttl_seconds)
    now = timezone.now()
    user_info = build_user_info(user, request)
    user_claims: dict[str, Any] = {
        "id": str(user.pk),
        "name": user_info["displayName"],
        "moderator": _moderator_claim(is_moderator),
    }
    email = str(user_info.get("email") or "").strip()
    avatar = str(user_info.get("avatarUrl") or "").strip()
    if email:
        user_claims["email"] = email
    if avatar:
        user_claims["avatar"] = avatar

    payload: dict[str, Any] = {
        "aud": JAAS_JWT_AUD,
        "iss": JAAS_JWT_ISS,
        "sub": app_id,
        "room": local_room,
        "nbf": int((now - timedelta(seconds=30)).timestamp()),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "context": {
            "user": user_claims,
            "features": {
                "livestreaming": "false",
                "recording": "false",
                "transcription": "false",
                "outbound-call": "false",
            },
        },
    }
    try:
        token = jwt.encode(
            payload,
            private_key,
            algorithm="RS256",
            headers={"kid": kid, "typ": "JWT"},
        )
    except Exception as exc:
        logger.warning("JaaS token signing failed error=%s", type(exc).__name__)
        raise JitsiConfigError("JaaS не настроен") from exc
    if isinstance(token, bytes):
        token = token.decode("ascii")
    logger.info(
        "JaaS token issued lesson_id=%s user_id=%s role=%s",
        lesson_id if lesson_id not in (None, "") else "",
        user.pk,
        role or ("moderator" if is_moderator else "participant"),
    )
    return token
