"""Отдельный провайдер Контур.Толк.

Не участвует в join-config Jitsi/8x8 и LiveKit. Ссылка выдаётся только
участнику урока, API-ключ остаётся в заголовке серверного запроса.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import timedelta, timezone as datetime_timezone
from urllib.parse import quote
from urllib import error as urllib_error
from urllib import request as urllib_request

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .kontur_talk_models import KonturTalkRoom
from .video_meeting_service import (
    VideoMeetingError,
    assert_can_join_meeting,
    lesson_meeting_subject,
)

logger = logging.getLogger(__name__)

PROVIDER = "kontur_talk"
_SPACE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_ROOM_NAME = re.compile(r"^itflux-[0-9a-f]{32}$")
_ANONYMOUS_ACCESS_DAYS = 364
_HTTP_TIMEOUT_SECONDS = 10


def kontur_talk_enabled() -> bool:
    return bool(getattr(settings, "KONTUR_TALK_ENABLED", False))


def kontur_talk_space() -> str:
    return str(getattr(settings, "KONTUR_TALK_SPACE", "") or "").strip().lower()


def kontur_talk_api_key() -> str:
    return str(getattr(settings, "KONTUR_TALK_API_KEY", "") or "").strip()


def kontur_talk_is_configured() -> bool:
    return bool(_SPACE.fullmatch(kontur_talk_space()) and kontur_talk_api_key())


def kontur_talk_public_status() -> dict:
    """Поля для страницы урока. Без ключа, домена и ссылки на комнату."""
    available = kontur_talk_enabled() and kontur_talk_is_configured()
    return {"id": PROVIDER, "available": available}


def room_name_for_meeting(meeting) -> str:
    """Стабильное имя из UUID конференции, без порядкового id урока."""
    return f"itflux-{meeting.uuid.hex}"


def issue_kontur_talk_link(*, meeting, user) -> dict:
    assert_can_join_meeting(user, meeting)
    if not kontur_talk_enabled():
        raise VideoMeetingError(
            "Контур.Толк выключен",
            code="kontur_disabled",
            status=404,
        )
    if not kontur_talk_is_configured():
        raise VideoMeetingError(
            "Контур.Толк не настроен",
            code="kontur_unavailable",
            status=503,
        )
    room = _ensure_room(meeting)
    url = _join_url(room.room_name)
    payload = {
        "provider": PROVIDER,
        "url": url,
        "roomName": room.room_name,
    }
    _reject_if_secret_leaked(payload)
    logger.info(
        "kontur_talk_link meeting_uuid=%s user_id=%s room_name=%s",
        meeting.uuid,
        user.pk,
        room.room_name,
    )
    return payload


def _ensure_room(meeting) -> KonturTalkRoom:
    expected = room_name_for_meeting(meeting)
    if not _ROOM_NAME.fullmatch(expected):
        raise VideoMeetingError(
            "Не удалось открыть комнату Контур.Толк",
            code="kontur_unavailable",
            status=503,
        )
    with transaction.atomic():
        locked = type(meeting).objects.select_for_update().get(pk=meeting.pk)
        if locked.status == "finished":
            raise VideoMeetingError("Урок завершён", code="finished", status=409)
        if locked.status == "cancelled":
            raise VideoMeetingError("Урок отменён", code="cancelled", status=409)
        if locked.status != "live":
            raise VideoMeetingError("Урок ещё не начат", code="not_live", status=409)
        room = (
            KonturTalkRoom.objects.select_for_update()
            .filter(meeting=locked)
            .first()
        )
        if room is not None and room.provisioned_at and _ROOM_NAME.fullmatch(room.room_name or ""):
            return room
        if room is None:
            room = KonturTalkRoom(meeting=locked, room_name=expected)
        elif not _ROOM_NAME.fullmatch(room.room_name or ""):
            room.room_name = expected
        _create_remote_room(room.room_name, title=_room_title(locked))
        room.provisioned_at = timezone.now()
        room.save()
        return room


def _room_title(meeting) -> str:
    event = meeting.schedule_event
    title = lesson_meeting_subject(event) if event is not None else ""
    cleaned = " ".join(str(title or "").split())
    return (cleaned or "Урок")[:120]


def _create_remote_room(room_name: str, *, title: str) -> None:
    """PUT идемпотентен для одного имени: повтор не создаёт вторую комнату."""
    if not _ROOM_NAME.fullmatch(room_name):
        raise VideoMeetingError(
            "Не удалось открыть комнату Контур.Толк",
            code="kontur_unavailable",
            status=503,
        )
    expires = timezone.now() + timedelta(days=_ANONYMOUS_ACCESS_DAYS)
    expires_iso = expires.astimezone(datetime_timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # Внешний вход и лобби включаются. moderatorKeys пустой: участники урока
    # не становятся модераторами только потому, что открыли ссылку.
    body = {
        "title": title,
        "allowAnonymous": True,
        "anonymousAccessExpirationDate": expires_iso,
        "enableLobby": True,
        "moderatorKeys": [],
    }
    raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib_request.Request(
        _api_room_url(room_name),
        data=raw,
        method="PUT",
    )
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")
    request.add_header("X-Auth-Token", kontur_talk_api_key())
    try:
        with urllib_request.urlopen(request, timeout=_HTTP_TIMEOUT_SECONDS) as response:
            status = int(getattr(response, "status", 0) or 0)
            response.read(0)
    except urllib_error.HTTPError as exc:
        logger.warning(
            "kontur_talk_room_failed room=%s status=%s",
            room_name,
            getattr(exc, "code", ""),
        )
        raise VideoMeetingError(
            "Не удалось открыть комнату Контур.Толк",
            code="kontur_unavailable",
            status=503,
        ) from None
    except urllib_error.URLError:
        logger.warning("kontur_talk_room_failed room=%s status=network", room_name)
        raise VideoMeetingError(
            "Не удалось открыть комнату Контур.Толк",
            code="kontur_unavailable",
            status=503,
        ) from None
    if status not in (200, 201):
        logger.warning("kontur_talk_room_failed room=%s status=%s", room_name, status)
        raise VideoMeetingError(
            "Не удалось открыть комнату Контур.Толк",
            code="kontur_unavailable",
            status=503,
        )


def _api_room_url(room_name: str) -> str:
    return f"https://{kontur_talk_space()}.ktalk.ru/api/Rooms/{quote(room_name, safe='')}"


def _join_url(room_name: str) -> str:
    space = kontur_talk_space()
    if not _SPACE.fullmatch(space) or not _ROOM_NAME.fullmatch(room_name):
        raise VideoMeetingError(
            "Контур.Толк не настроен",
            code="kontur_unavailable",
            status=503,
        )
    return f"https://{space}.ktalk.ru/{room_name}"


def _reject_if_secret_leaked(payload: dict) -> None:
    secret = kontur_talk_api_key()
    if secret and secret in json.dumps(payload, ensure_ascii=False):
        logger.warning("kontur_talk_link_suppressed reason=secret")
        raise VideoMeetingError(
            "Не удалось открыть комнату Контур.Толк",
            code="kontur_unavailable",
            status=503,
        )
