"""Запасной звонок Яндекс Телемоста для живого урока.

Ссылку создаёт сервер от сервисного аккаунта (токен только из env).
Участники заходят гостями, без входа в Яндекс. Iframe Телемоста запрещён.
"""

from __future__ import annotations

import logging

import requests
from django.conf import settings
from django.db import transaction

from .telemost import (
    TELEMOST_API_URL,
    is_telemost_meeting_url,
    normalize_telemost_url,
    resolve_telemost_oauth_token,
)
from .telemost_models import TelemostConference
from .video_meeting_service import VideoMeetingError, assert_can_join_meeting

logger = logging.getLogger(__name__)

PROVIDER_ID = "telemost"
HTTP_CREATED = 201

_MSG_NOT_CONFIGURED = "Запасной звонок в Телемосте сейчас недоступен."
_MSG_AUTH_INVALID = (
    "Сервисный аккаунт Телемоста не настроен или токен недействителен. "
    "Обратитесь к администратору."
)
_MSG_FORBIDDEN = "Сервисный аккаунт Телемоста не имеет права создавать встречи."
_MSG_RATE_LIMITED = (
    "Слишком много запросов к Телемосту. Подождите минуту и попробуйте снова."
)
_MSG_NETWORK = "Не удалось связаться с API Телемоста. Попробуйте ещё раз."
_MSG_BAD_LINK = "Телемост вернул некорректную ссылку на встречу."
_MSG_CREATE_FAILED = "Не удалось создать встречу в Телемосте."
_MSG_NOT_OPEN = "Учитель ещё не открыл запасной звонок."
_MSG_ORG = (
    "Автоматическое создание встречи в Телемосте недоступно для этого аккаунта. "
    "Нужен сервисный аккаунт Яндекс 360 или подходящий тариф."
)

_YANDEX_STATUS_ERRORS = {
    401: (_MSG_AUTH_INVALID, "telemost_unauthorized", 502),
    403: (_MSG_FORBIDDEN, "telemost_forbidden", 502),
    429: (_MSG_RATE_LIMITED, "telemost_rate_limited", 429),
    402: (_MSG_ORG, "telemost_payment_required", 502),
}


def _env_flag(name, default=True):
    raw = getattr(settings, name, default)
    if isinstance(raw, str):
        return raw.strip().lower() not in ("0", "false", "no", "off")
    return bool(raw)


def _first_setting(*names):
    for name in names:
        value = str(getattr(settings, name, "") or "").strip()
        if value:
            return value
    return ""


def telemost_backup_token_configured():
    """Кнопка и карточка видны, только если задан токен сервисного аккаунта."""
    return bool(
        _first_setting("TELEMOST_OAUTH_TOKEN", "YANDEX_TELEMOST_OAUTH_TOKEN")
        or _first_setting("TELEMOST_REFRESH_TOKEN", "YANDEX_TELEMOST_REFRESH_TOKEN")
    )


def telemost_backup_available():
    return (
        _env_flag("TELEMOST_BACKUP_ENABLED", True)
        and telemost_backup_token_configured()
    )


def telemost_public_status(meeting=None):
    conference = None
    if meeting is not None:
        conference = getattr(meeting, "telemost_conference", None)
        if conference is None and getattr(meeting, "pk", None):
            conference = TelemostConference.objects.filter(
                meeting_id=meeting.pk
            ).first()
    return {
        "id": PROVIDER_ID,
        "available": telemost_backup_available(),
        "open": bool(conference and conference.join_url),
    }


def _payload_leaks_secret(payload, token=""):
    secrets = [
        value
        for value in (
            token,
            _first_setting("TELEMOST_OAUTH_TOKEN", "YANDEX_TELEMOST_OAUTH_TOKEN"),
            _first_setting("TELEMOST_REFRESH_TOKEN", "YANDEX_TELEMOST_REFRESH_TOKEN"),
            _first_setting("TELEMOST_CLIENT_SECRET", "YANDEX_TELEMOST_CLIENT_SECRET"),
        )
        if value
    ]
    stack = [payload]
    while secrets and stack:
        item = stack.pop()
        if isinstance(item, dict):
            stack.extend(item.values())
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
        elif isinstance(item, str) and any(secret in item for secret in secrets):
            return True
    return False


def _serialize_conference(conference):
    created = conference.created_at.isoformat() if conference.created_at else None
    return {
        "provider": PROVIDER_ID,
        "id": conference.conference_id,
        "url": conference.join_url,
        "created_at": created,
    }


def _map_yandex_error(status, code, message):
    mapped = (
        (_MSG_ORG, "telemost_org_required", 403)
        if code == "ApiRestrictedToOrganizations"
        else _YANDEX_STATUS_ERRORS.get(status)
    )
    if not mapped:
        text = message or _MSG_CREATE_FAILED
        if "OAuth" in text or "token" in text.lower() or "Bearer" in text:
            text = _MSG_CREATE_FAILED
        mapped = (text, "telemost_unavailable", 502)
    text, err, http = mapped
    return VideoMeetingError(text, code=err, status=http)


def request_conference(token, payload):
    return requests.post(
        TELEMOST_API_URL,
        headers={
            "Authorization": f"OAuth {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20,
    )


def _resolve_backup_token(*, force_refresh=False):
    explicit = _first_setting("TELEMOST_OAUTH_TOKEN", "YANDEX_TELEMOST_OAUTH_TOKEN")
    if explicit and not force_refresh:
        return explicit, None
    return resolve_telemost_oauth_token(force_refresh=force_refresh)


def _parse_created_conference(response, token):
    try:
        data = response.json()
    except ValueError as exc:
        raise VideoMeetingError(
            _MSG_BAD_LINK, code="telemost_bad_response", status=502
        ) from exc
    if _payload_leaks_secret(data, token=token):
        logger.error("Telemost API response contained a secret; discarded")
        raise VideoMeetingError(_MSG_BAD_LINK, code="telemost_bad_response", status=502)
    join_url = normalize_telemost_url((data.get("join_url") or "").strip())
    if not is_telemost_meeting_url(join_url):
        raise VideoMeetingError(_MSG_BAD_LINK, code="telemost_bad_response", status=502)
    return {"id": str(data.get("id") or "").strip(), "join_url": join_url}


def _can_refresh_token():
    return bool(
        _first_setting("TELEMOST_REFRESH_TOKEN", "YANDEX_TELEMOST_REFRESH_TOKEN")
        and _first_setting("TELEMOST_CLIENT_ID", "YANDEX_TELEMOST_CLIENT_ID")
        and _first_setting("TELEMOST_CLIENT_SECRET", "YANDEX_TELEMOST_CLIENT_SECRET")
    )


def _create_public_conference():
    """Только PUBLIC, без cohost и без CalDAV — не привязываем к личному календарю."""
    last_error = VideoMeetingError(
        _MSG_CREATE_FAILED, code="telemost_unavailable", status=502
    )
    refreshed = False
    for _attempt in range(2):
        token, error = _resolve_backup_token(force_refresh=refreshed)
        if not token:
            if refreshed:
                raise last_error
            raise VideoMeetingError(
                _MSG_NOT_CONFIGURED if not error else _MSG_AUTH_INVALID,
                code="telemost_not_configured",
                status=503,
            )
        try:
            response = request_conference(token, {"waiting_room_level": "PUBLIC"})
        except requests.RequestException:
            logger.warning("Telemost backup API request failed", exc_info=True)
            raise VideoMeetingError(
                _MSG_NETWORK, code="telemost_network", status=502
            ) from None
        if response.status_code == HTTP_CREATED:
            return _parse_created_conference(response, token)
        try:
            body = response.json()
            code = body.get("error") or body.get("message") or ""
        except ValueError:
            code = ""
        logger.warning(
            "Telemost backup API error status=%s code=%s",
            response.status_code,
            code or "unknown",
        )
        last_error = _map_yandex_error(response.status_code, code, "")
        if (
            response.status_code in (401, 403)
            and not refreshed
            and _can_refresh_token()
        ):
            refreshed = True
            continue
        raise last_error
    raise last_error


def issue_telemost_backup_link(meeting, *, user, can_create):
    """Возвращает существующую конференцию или создаёт новую (только создатель)."""
    assert_can_join_meeting(user, meeting)
    existing = TelemostConference.objects.filter(meeting=meeting).first()
    if existing and is_telemost_meeting_url(existing.join_url):
        return _serialize_conference(existing), False
    if not can_create:
        raise VideoMeetingError(_MSG_NOT_OPEN, code="telemost_not_open", status=409)
    if not telemost_backup_available():
        raise VideoMeetingError(
            _MSG_NOT_CONFIGURED,
            code="telemost_not_configured",
            status=503,
        )
    with transaction.atomic():
        locked = type(meeting).objects.select_for_update().get(pk=meeting.pk)
        existing = TelemostConference.objects.filter(meeting=locked).first()
        if existing and is_telemost_meeting_url(existing.join_url):
            return _serialize_conference(existing), False
        created_payload = _create_public_conference()
        conference = TelemostConference.objects.create(
            meeting=locked,
            conference_id=created_payload["id"],
            join_url=created_payload["join_url"],
            waiting_room_level="PUBLIC",
        )
    return _serialize_conference(conference), True


def broadcast_telemost_opened(meeting):
    try:
        from .meeting_material_session import broadcast_material_event

        broadcast_material_event(
            meeting.uuid,
            {"type": "telemost.opened", "provider": PROVIDER_ID},
        )
    except Exception:
        logger.warning("Failed to broadcast telemost.opened", exc_info=True)
