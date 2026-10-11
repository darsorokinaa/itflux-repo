"""Короткоживущий JWT LiveKit. Секрет остаётся на backend и не пишется в логи."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from datetime import timedelta

import jwt
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

_MIN_TTL_SECONDS = 60
_MAX_TTL_SECONDS = 3600
_HEALTH_TTL_SECONDS = 20
_health_cache = {"at": 0.0, "ok": False}


class LiveKitConfigError(Exception):
    pass


def failover_enabled() -> bool:
    return bool(getattr(settings, "VIDEO_FAILOVER_ENABLED", False))


def failover_mode() -> str:
    raw = str(getattr(settings, "VIDEO_FAILOVER_MODE", "jaas_only") or "jaas_only").strip().lower()
    if raw in {"jaas_only", "livekit_only", "auto"}:
        return raw
    logger.warning("video_failover_mode_unknown value=%s", raw[:32])
    return "jaas_only"


def _setting(name: str) -> str:
    return str(getattr(settings, name, "") or "").strip()


def livekit_api_key() -> str:
    return _setting("LIVEKIT_API_KEY")


def livekit_api_secret() -> str:
    return _setting("LIVEKIT_API_SECRET")


def livekit_url() -> str:
    return _setting("LIVEKIT_URL").rstrip("/")


def livekit_http_url() -> str:
    explicit = _setting("LIVEKIT_HTTP_URL").rstrip("/")
    if explicit:
        return explicit
    url = livekit_url()
    if url.startswith("wss://"):
        return "https://" + url[len("wss://"):]
    if url.startswith("ws://"):
        return "http://" + url[len("ws://"):]
    return ""


def livekit_is_configured() -> bool:
    url = livekit_url()
    secret = livekit_api_secret()
    # Только WSS: открытый ws:// в урок не выдаём.
    return bool(livekit_api_key() and len(secret) >= 32 and url.startswith("wss://"))


def livekit_ttl_seconds(requested: int | None = None) -> int:
    if requested is None:
        try:
            raw = int(getattr(settings, "LIVEKIT_TOKEN_TTL_SECONDS", 900) or 900)
        except (TypeError, ValueError):
            raw = 900
    else:
        raw = int(requested)
    return max(_MIN_TTL_SECONDS, min(raw, _MAX_TTL_SECONDS))


def participant_identity(user_id: int) -> str:
    return f"p{int(user_id)}"


def parse_participant_identity(identity: str) -> int | None:
    text = str(identity or "").strip()
    if len(text) < 2 or not text.startswith("p") or not text[1:].isdigit():
        return None
    return int(text[1:])


def livekit_public_host() -> str:
    url = livekit_url()
    if "://" in url:
        url = url.split("://", 1)[1]
    return url.split("/", 1)[0]


def _video_grant(*, room: str, is_moderator: bool, server: bool = False) -> dict:
    if server:
        return {
            "room": room,
            "roomAdmin": True,
            "roomCreate": True,
            "roomList": False,
            "roomRecord": False,
            "roomJoin": False,
            "recorder": False,
            "ingressAdmin": False,
        }
    return {
        "room": room,
        "roomJoin": True,
        "roomCreate": False,
        "roomList": False,
        "roomRecord": False,
        "roomAdmin": bool(is_moderator),
        "canPublish": True,
        "canSubscribe": True,
        "canPublishData": False,
        "canUpdateOwnMetadata": True,
        "canPublishSources": ["camera", "microphone", "screen_share", "screen_share_audio"],
        "hidden": False,
        "recorder": False,
        "ingressAdmin": False,
    }


def _encode(payload: dict) -> str:
    token = jwt.encode(payload, livekit_api_secret(), algorithm="HS256")
    if isinstance(token, bytes):
        token = token.decode("ascii")
    return token


def generate_livekit_jwt(*, room_name: str, user, is_moderator: bool, ttl_seconds: int | None = None) -> str:
    if not livekit_is_configured():
        raise LiveKitConfigError("LiveKit не настроен")
    room = str(room_name or "").strip()
    if not room or any(ch in room for ch in "/@ \n\r"):
        raise LiveKitConfigError("Некорректная комната LiveKit")
    ttl = livekit_ttl_seconds(ttl_seconds)
    now = timezone.now()
    payload = {
        "iss": livekit_api_key(),
        "sub": participant_identity(user.pk),
        "nbf": int((now - timedelta(seconds=10)).timestamp()),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "video": _video_grant(room=room, is_moderator=is_moderator),
    }
    token = _encode(payload)
    logger.info(
        "livekit_token_issued user_id=%s room_suffix=%s moderator=%s ttl=%s",
        user.pk,
        room[-8:],
        bool(is_moderator),
        ttl,
    )
    return token


def generate_livekit_admin_jwt(*, room_name: str) -> str:
    if not livekit_is_configured():
        raise LiveKitConfigError("LiveKit не настроен")
    room = str(room_name or "").strip()
    now = timezone.now()
    payload = {
        "iss": livekit_api_key(),
        "sub": "itflux-room-service",
        "nbf": int((now - timedelta(seconds=5)).timestamp()),
        "exp": int((now + timedelta(seconds=60)).timestamp()),
        "video": _video_grant(room=room, is_moderator=True, server=True),
    }
    return _encode(payload)


def decode_livekit_jwt(token: str) -> dict:
    return jwt.decode(
        token,
        livekit_api_secret(),
        algorithms=["HS256"],
        options={"require": ["exp", "sub", "iss"]},
    )


def token_matches_room(token: str, room_name: str) -> bool:
    try:
        claims = decode_livekit_jwt(token)
    except jwt.PyJWTError:
        return False
    video = claims.get("video") if isinstance(claims.get("video"), dict) else {}
    return str(video.get("room") or "") == str(room_name or "")


def reset_health_cache() -> None:
    _health_cache["at"] = 0.0
    _health_cache["ok"] = False


def livekit_health_ok(*, force: bool = False) -> bool:
    if not livekit_is_configured():
        return False
    if not bool(getattr(settings, "VIDEO_FAILOVER_REQUIRE_HEALTH", True)):
        return True
    now = time.monotonic()
    if not force and now - _health_cache["at"] < _HEALTH_TTL_SECONDS:
        return bool(_health_cache["ok"])
    ok = False
    http_url = livekit_http_url()
    if http_url:
        req = urllib.request.Request(http_url + "/", method="GET")
        try:
            with urllib.request.urlopen(req, timeout=2) as resp:
                ok = 200 <= int(resp.status) < 300
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            logger.warning("livekit_health_failed error=%s", type(exc).__name__)
            ok = False
    _health_cache["at"] = now
    _health_cache["ok"] = ok
    return ok


def livekit_room_api(method: str, body: dict) -> bool:
    """Twirp RoomService. Секрет и JWT в лог не попадают. False — вызов не подтверждён."""
    if not livekit_is_configured():
        return False
    http_url = livekit_http_url()
    room = str(body.get("room") or "")
    if not http_url or not room or method not in {"RemoveParticipant", "DeleteRoom"}:
        return False
    try:
        token = generate_livekit_admin_jwt(room_name=room)
    except LiveKitConfigError:
        return False
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{http_url}/twirp/livekit.RoomService/{method}",
        data=data,
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return 200 <= int(resp.status) < 300
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        logger.warning("livekit_room_api_failed method=%s error=%s", method, type(exc).__name__)
        return False
