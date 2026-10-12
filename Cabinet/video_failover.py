"""Серверное решение о провайдере встречи.

Клиент не выбирает комнату сам. Переключение атомарно, с поколением,
и не возвращает встречу на JaaS только потому, что тот снова отвечает.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .jaas_service import get_video_provider
from .livekit_service import (
    LiveKitConfigError,
    failover_enabled,
    failover_mode,
    generate_livekit_jwt,
    livekit_health_ok,
    livekit_is_configured,
    livekit_public_host,
    livekit_room_api,
    livekit_url,
    participant_identity,
)
from .meeting_material_session import broadcast_material_event
from .video_failover_models import MeetingCallRoute

logger = logging.getLogger(__name__)

FAULT_PROVIDER = "provider_outage"
FAULT_LOCAL = "local_network"
FAULT_DEVICE = "device_permission"
FAULT_MUTE = "intentional_mute"
FAULT_OFFLINE = "platform_offline"
FAULT_PLATFORM = "platform_error"
FAULT_AUTH = "auth_denied"
ROOM_FAULTS = frozenset({FAULT_PROVIDER})
KNOWN_FAULTS = frozenset({
    FAULT_PROVIDER,
    FAULT_LOCAL,
    FAULT_DEVICE,
    FAULT_MUTE,
    FAULT_OFFLINE,
    FAULT_PLATFORM,
    FAULT_AUTH,
})
_MAX_REPORTS = 30


def _int_setting(name: str, default: int) -> int:
    try:
        return int(getattr(settings, name, default) or default)
    except (TypeError, ValueError):
        return default


def primary_provider() -> str:
    return "jaas" if get_video_provider() == "jaas" else "meet"


def _id_list(value) -> list[int]:
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            continue
    return out


def _reason(code: str) -> str:
    text = str(code or "").strip().lower()[:64]
    allowed = {
        "provider_outage",
        "admin_switch",
        "mode_livekit_only",
        "primary_restored",
        "lesson_finished",
        "participant_removed",
        "participant_disconnect",
    }
    return text if text in allowed else "unspecified"


def ensure_route(meeting) -> MeetingCallRoute:
    provider = "livekit" if failover_mode() == "livekit_only" else primary_provider()
    try:
        route, _created = MeetingCallRoute.objects.get_or_create(
            meeting=meeting,
            defaults={
                "active_provider": provider,
                "generation": 1,
                "livekit_room": meeting.room_name,
            },
        )
    except IntegrityError:
        route = MeetingCallRoute.objects.get(meeting=meeting)
    if not route.livekit_room:
        route.livekit_room = meeting.room_name
        route.save(update_fields=["livekit_room", "updated_at"])
    return route


def is_revoked(meeting, user) -> bool:
    if not failover_enabled() or user is None:
        return False
    route = MeetingCallRoute.objects.filter(meeting=meeting).first()
    if route is None:
        return False
    return int(user.pk) in _id_list(route.revoked_user_ids)


def reject_if_revoked(meeting, user) -> None:
    if not is_revoked(meeting, user):
        return
    from .video_meeting_service import VideoMeetingError

    raise VideoMeetingError(
        "Доступ к видеосвязи этого урока прекращён",
        code="access_revoked",
        status=403,
    )


def public_route(route: MeetingCallRoute | None) -> dict:
    if route is None or not failover_enabled():
        return {
            "enabled": False,
            "provider": None,
            "generation": 0,
            "switchedAt": None,
            "reason": "",
            "failoverMode": "jaas_only",
            "fallbackReady": False,
        }
    return {
        "enabled": True,
        "provider": route.active_provider,
        "generation": route.generation,
        "switchedAt": route.switched_at.isoformat() if route.switched_at else None,
        "reason": route.switch_reason or "",
        "failoverMode": failover_mode(),
        "fallbackReady": livekit_is_configured(),
    }


def annotate_join_config(payload: dict, meeting) -> dict:
    if not failover_enabled():
        return payload
    route = ensure_route(meeting)
    payload["mediaGeneration"] = route.generation
    payload["mediaProvider"] = route.active_provider
    payload["failoverMode"] = failover_mode()
    return payload


def _forced_livekit(route: MeetingCallRoute) -> bool:
    if route.active_provider != MeetingCallRoute.Provider.LIVEKIT:
        return False
    # Пустая причина — урок создан, пока режим был livekit_only, без отдельного сбоя.
    return (route.switch_reason or "") in {"", "mode_livekit_only"}


def release_forced_livekit(meeting, route: MeetingCallRoute) -> MeetingCallRoute:
    """Режим livekit_only не оставляет урок на резерве после возврата 8x8 основным."""
    if failover_mode() == "livekit_only" or not _forced_livekit(route):
        return route
    primary = primary_provider()
    applied = False
    with transaction.atomic():
        locked = MeetingCallRoute.objects.select_for_update().get(pk=route.pk)
        if failover_mode() == "livekit_only" or not _forced_livekit(locked):
            return locked
        now = timezone.now()
        locked.generation = int(locked.generation) + 1
        locked.active_provider = primary
        locked.switched_at = now
        locked.switch_reason = "primary_restored"
        locked.save()
        applied = True
        route = locked
    if applied:
        logger.info(
            "video_provider_restored meeting=%s provider=%s generation=%s",
            meeting.uuid,
            route.active_provider,
            route.generation,
        )
        broadcast_material_event(meeting.uuid, {
            "type": "media.provider_changed",
            "provider": route.active_provider,
            "generation": route.generation,
            "reason": route.switch_reason,
            "meetingUuid": str(meeting.uuid),
        })
    return route


def maybe_livekit_credentials(*, meeting, user, is_moderator: bool, request) -> dict | None:
    """None — оставить текущий JaaS/Jitsi. Словарь — все участники идут в LiveKit."""
    if not failover_enabled():
        return None
    from .rate_limit import rate_limit_check
    from .video_meeting_service import VideoMeetingError

    mode = failover_mode()
    route = release_forced_livekit(meeting, ensure_route(meeting))
    use_livekit = mode == "livekit_only" or route.active_provider == MeetingCallRoute.Provider.LIVEKIT
    if mode == "livekit_only" and route.active_provider != MeetingCallRoute.Provider.LIVEKIT:
        route, _applied = switch_provider(
            meeting=meeting,
            target="livekit",
            reason="mode_livekit_only",
            actor=user,
            expected_generation=None,
            automatic=False,
        )
        use_livekit = True
    if not use_livekit:
        return None
    if request is not None and not rate_limit_check(request, "livekit_token", 40, 60):
        raise VideoMeetingError("Слишком много запросов на подключение", code="RATE_LIMITED", status=429)
    if not livekit_is_configured():
        raise VideoMeetingError("Резервная видеосвязь не настроена", code="livekit_unavailable", status=503)
    room = route.livekit_room or meeting.room_name
    try:
        token = generate_livekit_jwt(room_name=room, user=user, is_moderator=is_moderator)
    except LiveKitConfigError as exc:
        raise VideoMeetingError("Резервная видеосвязь не настроена", code="livekit_unavailable", status=503) from exc
    return {
        "provider": "livekit",
        "jwt": token,
        "auth_mode": "jwt",
        "domain": livekit_public_host(),
        "app_id": "",
        "external_room_name": room,
        "script_url": "",
        "livekit_url": livekit_url(),
    }


def _parse_at(value: str) -> datetime | None:
    parsed = parse_datetime(str(value or ""))
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _recent_provider_reports(reports: list, now: datetime) -> list[dict]:
    window = now - timedelta(seconds=_int_setting("VIDEO_FAILOVER_FAILURE_WINDOW_SECONDS", 90))
    recent = []
    for row in reports:
        if not isinstance(row, dict):
            continue
        if row.get("fault") != FAULT_PROVIDER or not row.get("confirmed"):
            continue
        at = _parse_at(row.get("at") or "")
        if at is None or at < window:
            continue
        recent.append(row)
    return recent


def _auto_switch_allowed(route: MeetingCallRoute, user, access, now: datetime) -> bool:
    if failover_mode() != "auto":
        return False
    if route.active_provider == MeetingCallRoute.Provider.LIVEKIT:
        return False
    if route.auto_switch_count >= _int_setting("VIDEO_FAILOVER_MAX_AUTO_SWITCHES", 1):
        return False
    if route.cooldown_until and route.cooldown_until > now:
        return False
    if route.circuit_open_until and route.circuit_open_until > now:
        return False
    recent = _recent_provider_reports(route.failure_reports or [], now)
    if access.is_moderator and any(
        int(row.get("userId") or 0) == int(user.pk) and row.get("attemptsExhausted")
        for row in recent
    ):
        return True
    users = {int(row.get("userId") or 0) for row in recent if row.get("attemptsExhausted")}
    users.discard(0)
    return len(users) >= _int_setting("VIDEO_FAILOVER_MIN_REPORTERS", 2)


def _open_circuit(meeting) -> None:
    with transaction.atomic():
        route = MeetingCallRoute.objects.select_for_update().get(meeting=meeting)
        route.circuit_open_until = timezone.now() + timedelta(
            seconds=_int_setting("VIDEO_FAILOVER_SWITCH_COOLDOWN_SECONDS", 120)
        )
        route.save(update_fields=["circuit_open_until", "updated_at"])


def switch_provider(
    *,
    meeting,
    target: str,
    reason: str,
    actor,
    expected_generation: int | None,
    automatic: bool,
):
    from .video_meeting_service import VideoMeetingError

    normalized = "livekit" if target == "livekit" else primary_provider()
    if automatic and normalized != "livekit":
        raise VideoMeetingError(
            "Автоматический возврат на прежний видеосервис отключён",
            code="switch_blocked",
            status=409,
        )
    if normalized == "livekit" and not livekit_is_configured():
        raise VideoMeetingError("Резервная видеосвязь не настроена", code="livekit_unavailable", status=503)

    if automatic:
        current = MeetingCallRoute.objects.get(meeting=meeting)
        if current.active_provider == normalized:
            return current, False
        if not _auto_switch_allowed(current, actor, _access(actor, meeting), timezone.now()):
            return current, False
        if not livekit_health_ok():
            _open_circuit(meeting)
            raise VideoMeetingError(
                "Резервная видеосвязь сейчас недоступна",
                code="livekit_unhealthy",
                status=503,
            )

    applied = False
    with transaction.atomic():
        route = MeetingCallRoute.objects.select_for_update().get(meeting=meeting)
        if route.active_provider == normalized:
            return route, False
        if expected_generation is not None and int(route.generation) != int(expected_generation):
            raise VideoMeetingError(
                "Состояние видеосвязи уже изменилось",
                code="generation_conflict",
                status=409,
            )
        if automatic and not _auto_switch_allowed(route, actor, _access(actor, meeting), timezone.now()):
            return route, False
        now = timezone.now()
        route.generation = int(route.generation) + 1
        route.active_provider = normalized
        route.switched_at = now
        route.switch_reason = _reason(reason)
        route.switched_by = actor if getattr(actor, "pk", None) else None
        route.cooldown_until = now + timedelta(
            seconds=_int_setting("VIDEO_FAILOVER_SWITCH_COOLDOWN_SECONDS", 120)
        )
        if automatic:
            route.auto_switch_count = int(route.auto_switch_count) + 1
        if normalized == "livekit" and not route.livekit_room:
            route.livekit_room = meeting.room_name
        route.save()
        applied = True

    if applied:
        logger.info(
            "video_provider_switched meeting=%s provider=%s generation=%s reason=%s automatic=%s",
            meeting.uuid,
            route.active_provider,
            route.generation,
            route.switch_reason,
            automatic,
        )
        broadcast_material_event(meeting.uuid, {
            "type": "media.provider_changed",
            "provider": route.active_provider,
            "generation": route.generation,
            "reason": route.switch_reason,
            "meetingUuid": str(meeting.uuid),
        })
    return route, applied


def _access(user, meeting):
    from .video_meeting_service import resolve_access

    return resolve_access(user, meeting.schedule_event)


def report_fault(*, meeting, user, fault: str, confirmed: bool, attempts_exhausted: bool, code: str, generation: int | None):
    from .video_meeting_service import VideoMeetingError

    if not failover_enabled():
        return {**public_route(None), "switched": False, "roomAction": "none"}
    kind = str(fault or "").strip()
    if kind not in KNOWN_FAULTS:
        raise VideoMeetingError("Неизвестный тип сбоя", code="invalid_fault", status=400)
    access = _access(user, meeting)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)
    if meeting.status != "live":
        raise VideoMeetingError("Урок ещё не начат", code="not_live", status=409)

    switched = False
    with transaction.atomic():
        route = ensure_route(meeting)
        route = MeetingCallRoute.objects.select_for_update().get(pk=route.pk)
        if generation is not None and int(generation) > int(route.generation):
            raise VideoMeetingError("Некорректное поколение", code="generation_conflict", status=409)
        reports = list(route.failure_reports or [])
        reports.append({
            "userId": int(user.pk),
            "fault": kind,
            "confirmed": bool(confirmed) and kind == FAULT_PROVIDER,
            "attemptsExhausted": bool(attempts_exhausted) and kind == FAULT_PROVIDER,
            "moderator": bool(access.is_moderator),
            "at": timezone.now().isoformat(),
            "code": str(code or "")[:64],
        })
        route.failure_reports = reports[-_MAX_REPORTS:]
        route.save(update_fields=["failure_reports", "updated_at"])

    room_action = "none"
    if kind in {FAULT_DEVICE, FAULT_MUTE, FAULT_OFFLINE, FAULT_AUTH, FAULT_PLATFORM}:
        room_action = "none"
    elif kind == FAULT_LOCAL:
        room_action = "local_only"
    elif kind == FAULT_PROVIDER and failover_mode() == "auto":
        try:
            route, switched = switch_provider(
                meeting=meeting,
                target="livekit",
                reason="provider_outage",
                actor=user,
                expected_generation=None,
                automatic=True,
            )
        except VideoMeetingError as exc:
            if exc.code in {"livekit_unavailable", "livekit_unhealthy", "switch_blocked"}:
                route = MeetingCallRoute.objects.get(meeting=meeting)
                switched = False
                room_action = "unavailable"
            else:
                raise
        else:
            room_action = "switch" if switched else "none"
    route = MeetingCallRoute.objects.get(meeting=meeting)
    payload = public_route(route)
    payload.update({
        "switched": switched,
        "roomAction": room_action if kind != FAULT_LOCAL else "local_only",
    })
    return payload


def normalize_switch_target(target: str) -> str:
    raw = str(target or "").strip().lower()
    if raw == "livekit":
        return "livekit"
    if raw in {"jaas", "meet", "primary", "jaas_only"}:
        return primary_provider()
    from .video_meeting_service import VideoMeetingError

    raise VideoMeetingError("Неизвестный провайдер", code="invalid_provider", status=400)


def admin_switch(*, meeting, user, target: str, expected_generation: int | None):
    from .video_meeting_service import VideoMeetingError, assert_can_manage_meeting

    if not failover_enabled():
        raise VideoMeetingError("Резервная видеосвязь выключена", code="failover_disabled", status=409)
    assert_can_manage_meeting(user, meeting)
    ensure_route(meeting)
    route, applied = switch_provider(
        meeting=meeting,
        target=normalize_switch_target(target),
        reason="admin_switch",
        actor=user,
        expected_generation=expected_generation,
        automatic=False,
    )
    payload = public_route(route)
    payload["switched"] = applied
    payload["roomAction"] = "switch" if applied else "none"
    return payload


def disconnect_participant(*, meeting, actor, target_user_id: int, block_rejoin: bool):
    from .video_meeting_service import VideoMeetingError, assert_can_manage_meeting

    if not failover_enabled():
        raise VideoMeetingError("Резервная видеосвязь выключена", code="failover_disabled", status=409)
    access = assert_can_manage_meeting(actor, meeting)
    if not access.is_moderator:
        raise VideoMeetingError("Недостаточно прав", code="forbidden", status=403)
    try:
        target_id = int(target_user_id)
    except (TypeError, ValueError):
        raise VideoMeetingError("Участник не найден", code="not_found", status=404)
    if target_id == int(actor.pk):
        raise VideoMeetingError("Чтобы выйти, завершите своё участие", code="invalid_target", status=400)
    owner_id = meeting.schedule_event.owner_id
    if target_id == owner_id and not (actor.is_staff or actor.is_superuser):
        raise VideoMeetingError("Недостаточно прав", code="forbidden", status=403)

    from django.contrib.auth.models import User

    target = User.objects.filter(pk=target_id).first()
    if target is None:
        raise VideoMeetingError("Участник не найден", code="not_found", status=404)
    target_access = _access(target, meeting)
    if not target_access.allowed and target_id not in _attendance_ids(meeting):
        raise VideoMeetingError("Участник не найден", code="not_found", status=404)
    if target_access.is_moderator and not (actor.is_staff or actor.is_superuser):
        raise VideoMeetingError("Недостаточно прав", code="forbidden", status=403)

    route = ensure_route(meeting)
    if block_rejoin:
        with transaction.atomic():
            locked = MeetingCallRoute.objects.select_for_update().get(pk=route.pk)
            revoked = _id_list(locked.revoked_user_ids)
            if target_id not in revoked:
                revoked.append(target_id)
            locked.revoked_user_ids = revoked[-200:]
            locked.save(update_fields=["revoked_user_ids", "updated_at"])
            route = locked
    room = route.livekit_room or meeting.room_name
    removed = False
    if route.active_provider == MeetingCallRoute.Provider.LIVEKIT:
        removed = livekit_room_api("RemoveParticipant", {
            "room": room,
            "identity": participant_identity(target_id),
        })
    logger.info(
        "video_participant_disconnect meeting=%s actor=%s target=%s removed=%s blocked=%s",
        meeting.uuid,
        actor.pk,
        target_id,
        removed,
        bool(block_rejoin),
    )
    return {
        "removed": removed,
        "rejoinBlocked": bool(block_rejoin),
        "provider": route.active_provider,
        "generation": route.generation,
    }


def _attendance_ids(meeting) -> set[int]:
    from .models import MeetingAttendance

    return set(
        MeetingAttendance.objects.filter(meeting=meeting).values_list("user_id", flat=True)
    )


def revoke_removed_schedule_participant(participant) -> None:
    if not failover_enabled():
        return
    event = participant.event
    meeting = getattr(event, "video_meeting", None)
    if meeting is None:
        return
    user_id = participant.user_id
    if not user_id and participant.student_id:
        user_id = getattr(participant.student, "user_id", None)
    if not user_id:
        user_id = participant.teacher_id
    if not user_id or user_id == event.owner_id:
        return
    route = MeetingCallRoute.objects.filter(meeting=meeting).first()
    if route is None:
        return
    with transaction.atomic():
        locked = MeetingCallRoute.objects.select_for_update().get(pk=route.pk)
        revoked = _id_list(locked.revoked_user_ids)
        if int(user_id) not in revoked:
            revoked.append(int(user_id))
        locked.revoked_user_ids = revoked[-200:]
        locked.switch_reason = "participant_removed"
        locked.save(update_fields=["revoked_user_ids", "switch_reason", "updated_at"])
        room = locked.livekit_room or meeting.room_name
        provider = locked.active_provider
    if provider == MeetingCallRoute.Provider.LIVEKIT:
        livekit_room_api("RemoveParticipant", {
            "room": room,
            "identity": participant_identity(int(user_id)),
        })
    logger.info(
        "video_participant_revoked meeting=%s user_id=%s",
        meeting.uuid,
        user_id,
    )


def close_livekit_room_if_any(meeting) -> None:
    if not failover_enabled():
        return
    route = MeetingCallRoute.objects.filter(meeting=meeting).first()
    if route is None:
        return
    room = route.livekit_room or meeting.room_name
    if route.active_provider == MeetingCallRoute.Provider.LIVEKIT and room:
        livekit_room_api("DeleteRoom", {"room": room})
    logger.info("video_livekit_close_requested meeting=%s", meeting.uuid)
