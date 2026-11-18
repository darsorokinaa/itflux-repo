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
    clear_telemost_token_cache,
    is_telemost_meeting_url,
    normalize_telemost_url,
    parse_api_error,
    request_conference,
    resolve_telemost_oauth_token,
)
from .telemost_models import TelemostConference
from .video_meeting_service import VideoMeetingError, assert_can_join_meeting

logger = logging.getLogger(__name__)

PROVIDER_ID = "telemost"

# Сообщения без технических деталей токена и без упоминания личного аккаунта.
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
    if not _env_flag("TELEMOST_BACKUP_ENABLED", True):
        return False
    return telemost_backup_token_configured()


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
    if not secrets:
        return False

    def walk(item):
        if isinstance(item, dict):
            return any(walk(value) for value in item.values())
        if isinstance(item, (list, tuple)):
            return any(walk(value) for value in item)
        if isinstance(item, str):
            return any(secret in item for secret in secrets)
        return False

    return walk(payload)


def _serialize_conference(conference):
    return {
        "provider": PROVIDER_ID,
        "id": conference.conference_id,
        "url": conference.join_url,
        "created_at": conference.created_at.isoformat()
        if conference.created_at
        else None,
    }


def _map_yandex_error(status, code, message):
    if code == "ApiRestrictedToOrganizations":
        return VideoMeetingError(_MSG_ORG, code="telemost_org_required", status=403)
    if status == 401:
        return VideoMeetingError(
            _MSG_AUTH_INVALID, code="telemost_unauthorized", status=502
        )
    if status == 403:
        return VideoMeetingError(_MSG_FORBIDDEN, code="telemost_forbidden", status=502)
    if status == 429:
        return VideoMeetingError(
            _MSG_RATE_LIMITED, code="telemost_rate_limited", status=429
        )
    if status == 402:
        return VideoMeetingError(_MSG_ORG, code="telemost_payment_required", status=502)
    text = message or _MSG_CREATE_FAILED
    # Не пробрасываем сырой ответ API клиенту, если он не из нашего словаря.
    if "OAuth" in text or "token" in text.lower() or "Bearer" in text:
        text = _MSG_CREATE_FAILED
    return VideoMeetingError(text, code="telemost_unavailable", status=502)


def _create_public_conference():
    """Только PUBLIC, без cohost и без CalDAV — не привязываем к личному календарю."""
    last_error = VideoMeetingError(
        _MSG_CREATE_FAILED, code="telemost_unavailable", status=502
    )
    refreshed = False

    for _attempt in range(2):
        token, error = resolve_telemost_oauth_token(force_refresh=refreshed)
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

        if response.status_code == 201:
            try:
                data = response.json()
            except ValueError:
                raise VideoMeetingError(
                    _MSG_BAD_LINK, code="telemost_bad_response", status=502
                )
            if _payload_leaks_secret(data, token=token):
                logger.error("Telemost API response contained a secret; discarded")
                raise VideoMeetingError(
                    _MSG_BAD_LINK, code="telemost_bad_response", status=502
                )
            join_url = normalize_telemost_url((data.get("join_url") or "").strip())
            conference_id = str(data.get("id") or "").strip()
            if not is_telemost_meeting_url(join_url):
                raise VideoMeetingError(
                    _MSG_BAD_LINK, code="telemost_bad_response", status=502
                )
            return {"id": conference_id, "join_url": join_url}

        code, message, _body = parse_api_error(response)
        logger.warning(
            "Telemost backup API error status=%s code=%s",
            response.status_code,
            code or "unknown",
        )
        last_error = _map_yandex_error(response.status_code, code, message)

        can_refresh = bool(
            _first_setting("TELEMOST_REFRESH_TOKEN", "YANDEX_TELEMOST_REFRESH_TOKEN")
            and _first_setting("TELEMOST_CLIENT_ID", "YANDEX_TELEMOST_CLIENT_ID")
            and _first_setting(
                "TELEMOST_CLIENT_SECRET", "YANDEX_TELEMOST_CLIENT_SECRET"
            )
        )
        if response.status_code in (401, 403) and not refreshed and can_refresh:
            clear_telemost_token_cache()
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

    created_payload = None
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
            {
                "type": "telemost.opened",
                "provider": PROVIDER_ID,
            },
        )
    except Exception:
        logger.warning("Failed to broadcast telemost.opened", exc_info=True)
