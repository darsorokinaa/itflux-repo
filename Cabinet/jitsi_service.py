"""Генерация JWT и отображаемых данных пользователя для Jitsi Meet."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any

import jwt
from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone

logger = logging.getLogger(__name__)


class JitsiConfigError(Exception):
    """Некорректная или неполная конфигурация Jitsi."""


def normalize_jitsi_host(value: str | None) -> str:
    """Hostname без схемы/пути/порта-хвоста — для External API и JWT `sub`."""
    host = (value or "").strip()
    if not host:
        return ""
    # https://lesson.example/ → lesson.example
    if "://" in host:
        host = host.split("://", 1)[1]
    host = host.split("/")[0].strip()
    host = host.rstrip(".")
    # [IPv6]:port не трогаем подробно; для обычных доменов снимаем :port
    if host.count(":") == 1 and not host.startswith("["):
        host = host.split(":", 1)[0]
    return host.lower()


def get_jitsi_domain() -> str:
    return normalize_jitsi_host(getattr(settings, "JITSI_DOMAIN", "") or "") or "meet.jit.si"


def get_jitsi_sub() -> str:
    """JWT `sub` должен совпадать с VirtualHost Prosody (= домен без https://)."""
    explicit = normalize_jitsi_host(getattr(settings, "JITSI_SUB", "") or "")
    return explicit or get_jitsi_domain()


def _is_public_jitsi_domain(domain: str | None = None) -> bool:
    host = normalize_jitsi_host(domain or get_jitsi_domain())
    return host in {"meet.jit.si", "8x8.vc"}


def get_jitsi_auth_mode() -> str:
    mode = (getattr(settings, "JITSI_AUTH_MODE", "none") or "none").strip().lower()
    if mode not in ("none", "jwt"):
        mode = "none"
    # Свой Jitsi без JWT → учитель зависает на «Я организатор».
    # Если APP_ID/SECRET уже заданы — включаем jwt даже при AUTH_MODE=none.
    if mode != "jwt" and not _is_public_jitsi_domain():
        app_id = (getattr(settings, "JITSI_APP_ID", "") or "").strip()
        app_secret = (getattr(settings, "JITSI_APP_SECRET", "") or "").strip()
        if app_id and app_secret:
            return "jwt"
    return mode


def get_jitsi_display_name(user: User) -> str:
    """Непустое отображаемое имя для Jitsi (join-config / JWT / prejoin)."""
    profile = getattr(user, "profile", None)
    if profile is not None:
        name = (profile.get_display_name() or "").strip()
        if name:
            return name

    full_name = (user.get_full_name() or "").strip()
    if full_name:
        return full_name

    username = str(getattr(user, "username", "") or "").strip()
    if username:
        return username

    return f"Пользователь {user.pk}"


def get_display_name(user: User) -> str:
    """Alias для совместимости; всегда непустая строка."""
    return get_jitsi_display_name(user)


def get_avatar_url(user: User, request=None) -> str:
    from .avatar_api import build_avatar_url

    return build_avatar_url(user, request, absolute=True)


def build_user_info(user: User, request=None) -> dict[str, str]:
    display_name = get_jitsi_display_name(user)
    if not display_name.strip():
        display_name = f"Пользователь {user.pk}"
    return {
        "displayName": display_name,
        "email": (user.email or "").strip(),
        "avatarUrl": get_avatar_url(user, request),
    }


def generate_jitsi_jwt(
    *,
    room_name: str,
    user: User,
    is_moderator: bool,
    request=None,
) -> str | None:
    """
    Короткоживущий JWT для собственного Jitsi (режим JITSI_AUTH_MODE=jwt).

    Формат claims совместим с token_verification Prosody (не JaaS):
    aud по умолчанию «jitsi», iss = JITSI_APP_ID, sub = JITSI_SUB или домен.
    """
    if get_jitsi_auth_mode() != "jwt":
        return None

    app_id = (getattr(settings, "JITSI_APP_ID", "") or "").strip()
    app_secret = (getattr(settings, "JITSI_APP_SECRET", "") or "").strip()
    if not app_id or not app_secret:
        raise JitsiConfigError("JITSI_APP_ID и JITSI_APP_SECRET обязательны при JITSI_AUTH_MODE=jwt")

    domain = get_jitsi_domain()
    sub = get_jitsi_sub()
    aud = (getattr(settings, "JITSI_AUD", "") or "").strip() or "jitsi"
    ttl = int(getattr(settings, "JITSI_TOKEN_TTL_SECONDS", 7200) or 7200)
    ttl = max(60, min(ttl, 86400))

    now = timezone.now()
    iat = int(now.timestamp())
    # Небольшой запас на рассинхрон часов Django/Jitsi.
    nbf = int((now - timedelta(seconds=30)).timestamp())
    exp = int((now + timedelta(seconds=ttl)).timestamp())
    user_info = build_user_info(user, request)
    display_name = user_info["displayName"]

    # Prosody token_moderation/token_affiliation ждут строки "true"/"false", не bool,
    # и affiliation="owner" — иначе учитель не получает права организатора в MUC.
    user_claims: dict[str, Any] = {
        "id": str(user.pk),
        "name": display_name,
        "email": user_info["email"],
        "avatar": user_info["avatarUrl"],
        "moderator": "true" if is_moderator else "false",
        "affiliation": "owner" if is_moderator else "member",
    }

    payload: dict[str, Any] = {
        "aud": aud,
        "iss": app_id,
        "sub": sub,
        "room": room_name,
        "iat": iat,
        "nbf": nbf,
        "exp": exp,
        "context": {
            "user": user_claims,
        },
    }

    # Не логируем APP_SECRET / сырой JWT.
    logger.info(
        "jitsi_jwt_created user_id=%s is_moderator=%s room=%s domain=%s "
        "jwt_aud=%s jwt_iss=%s jwt_sub=%s jwt_room=%s jwt_exp=%s",
        user.pk,
        bool(is_moderator),
        room_name,
        domain,
        aud,
        app_id,
        sub,
        room_name,
        datetime.fromtimestamp(exp, tz=dt_timezone.utc).isoformat(),
    )
    return jwt.encode(payload, app_secret, algorithm="HS256")


def decode_jitsi_jwt_unsafe_for_tests(token: str) -> dict[str, Any]:
    """Декодирование без проверки подписи — только для unit-тестов claims."""
    return jwt.decode(token, options={"verify_signature": False})


def jwt_expires_at(token: str) -> datetime | None:
    try:
        data = decode_jitsi_jwt_unsafe_for_tests(token)
    except jwt.PyJWTError:
        return None
    exp = data.get("exp")
    if not exp:
        return None
    return datetime.fromtimestamp(int(exp), tz=dt_timezone.utc)
