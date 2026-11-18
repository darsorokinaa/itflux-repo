"""Запасной звонок Яндекс Телемоста для живого урока.

Ссылку создаёт сервер от сервисного аккаунта (токен только из env).
Участники заходят гостями, без входа в Яндекс. Iframe Телемоста запрещён.
"""

from __future__ import annotations

import logging

from django.db import transaction

from .telemost import is_telemost_meeting_url
from .telemost_backup_http import (
    create_public_conference,
    first_telemost_setting,
    telemost_env_flag,
)
from .telemost_models import TelemostConference
from .video_meeting_service import VideoMeetingError, assert_can_join_meeting

logger = logging.getLogger(__name__)

PROVIDER_ID = "telemost"
_MSG_NOT_CONFIGURED = "Запасной звонок в Телемосте сейчас недоступен."
_MSG_NOT_OPEN = "Учитель ещё не открыл запасной звонок."


def telemost_backup_token_configured():
    """Кнопка и карточка видны, только если задан токен сервисного аккаунта."""
    return bool(
        first_telemost_setting("TELEMOST_OAUTH_TOKEN", "YANDEX_TELEMOST_OAUTH_TOKEN")
        or first_telemost_setting(
            "TELEMOST_REFRESH_TOKEN", "YANDEX_TELEMOST_REFRESH_TOKEN"
        )
    )


def telemost_backup_available():
    return (
        telemost_env_flag("TELEMOST_BACKUP_ENABLED", True)
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


def _serialize_conference(conference):
    created = conference.created_at.isoformat() if conference.created_at else None
    return {
        "provider": PROVIDER_ID,
        "id": conference.conference_id,
        "url": conference.join_url,
        "created_at": created,
    }


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
        created_payload = create_public_conference()
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
