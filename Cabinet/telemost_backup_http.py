"""HTTP-запросы к API Телемоста для запасного звонка."""

from __future__ import annotations

import logging
import os

import requests
from django.conf import settings

from .telemost import (
    TELEMOST_API_URL,
    is_telemost_meeting_url,
    normalize_telemost_url,
    resolve_telemost_oauth_token,
)
from .video_meeting_service import VideoMeetingError

logger = logging.getLogger(__name__)

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


def first_telemost_setting(*names):
    """Сначала settings (в т.ч. override в тестах), иначе переменная окружения."""
    for name in names:
        if hasattr(settings, name):
            value = str(getattr(settings, name) or "").strip()
        else:
            value = str(os.environ.get(name, "") or "").strip()
        if value:
            return value
    return ""


def telemost_env_flag(name, default=True):
    if hasattr(settings, name):
        raw = getattr(settings, name)
    elif name in os.environ:
        raw = os.environ.get(name)
    else:
        raw = default
    if isinstance(raw, str):
        return raw.strip().lower() not in ("0", "false", "no", "off")
    return bool(raw)


def _token_secrets(token=""):
    return [
        value
        for value in (
            token,
            first_telemost_setting(
                "TELEMOST_OAUTH_TOKEN", "YANDEX_TELEMOST_OAUTH_TOKEN"
            ),
            first_telemost_setting(
                "TELEMOST_REFRESH_TOKEN", "YANDEX_TELEMOST_REFRESH_TOKEN"
            ),
            first_telemost_setting(
                "TELEMOST_CLIENT_SECRET", "YANDEX_TELEMOST_CLIENT_SECRET"
            ),
        )
        if value
    ]


def _payload_leaks_secret(payload, token=""):
    secrets = _token_secrets(token)
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
    explicit = first_telemost_setting(
        "TELEMOST_OAUTH_TOKEN", "YANDEX_TELEMOST_OAUTH_TOKEN"
    )
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
        first_telemost_setting(
            "TELEMOST_REFRESH_TOKEN", "YANDEX_TELEMOST_REFRESH_TOKEN"
        )
        and first_telemost_setting("TELEMOST_CLIENT_ID", "YANDEX_TELEMOST_CLIENT_ID")
        and first_telemost_setting(
            "TELEMOST_CLIENT_SECRET", "YANDEX_TELEMOST_CLIENT_SECRET"
        )
    )


def _retry_with_refresh(status, already_refreshed):
    return status in (401, 403) and not already_refreshed and _can_refresh_token()


def _post_public_conference(token):
    try:
        return request_conference(token, {"waiting_room_level": "PUBLIC"})
    except requests.RequestException:
        logger.warning("Telemost backup API request failed", exc_info=True)
        raise VideoMeetingError(
            _MSG_NETWORK, code="telemost_network", status=502
        ) from None


def _error_from_response(response):
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
    return _map_yandex_error(response.status_code, code, "")


def _missing_token_error(error):
    return VideoMeetingError(
        _MSG_NOT_CONFIGURED if not error else _MSG_AUTH_INVALID,
        code="telemost_not_configured",
        status=503,
    )


def create_public_conference():
    """Только PUBLIC, без cohost и без CalDAV — не привязываем к личному календарю."""
    last_error = VideoMeetingError(
        _MSG_CREATE_FAILED, code="telemost_unavailable", status=502
    )
    refreshed = False
    for _attempt in range(2):
        token, error = _resolve_backup_token(force_refresh=refreshed)
        if not token:
            raise last_error if refreshed else _missing_token_error(error)
        response = _post_public_conference(token)
        if response.status_code == HTTP_CREATED:
            return _parse_created_conference(response, token)
        last_error = _error_from_response(response)
        if not _retry_with_refresh(response.status_code, refreshed):
            raise last_error
        refreshed = True
    raise last_error
