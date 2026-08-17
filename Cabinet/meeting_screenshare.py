"""Аннотации поверх screen share: сессии, права, векторные операции."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .meeting_screenshare_models import MeetingScreenShareSession
from .models import VideoMeeting
from .video_meeting_service import VideoMeetingError, resolve_access

logger = logging.getLogger(__name__)

MAX_RECENT_OPERATION_IDS = 400
MAX_ANNOTATIONS = 400
MAX_POINTS_PER_STROKE = 800
MAX_POINTS_PER_MESSAGE = 120
MAX_TEXT_LEN = 280
MAX_DISPLAY_NAME = 80
ALLOWED_TOOLS = frozenset({
    "pen",
    "highlighter",
    "marker",
    "line",
    "arrow",
    "rect",
    "rectangle",
    "ellipse",
    "oval",
    "text",
    "laser",
})
SHAPE_TOOLS = frozenset({"line", "arrow", "rect", "rectangle", "ellipse", "oval", "text"})
EPHEMERAL_ACTIONS = frozenset({"pointer", "stroke_preview"})
MUTATING_ACTIONS = frozenset({
    "stroke_start",
    "stroke_update",
    "stroke_end",
    "object_upsert",
    "annotation_deleted",
    "clear_mine",
    "clear_all",
})
COLOR_RE = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
MODERATOR_ROLES = frozenset({"teacher", "coteacher", "staff"})


def _clamp01(value: Any) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    if n < 0:
        return 0.0
    if n > 1:
        return 1.0
    return n


def _clamp_int(value: Any, *, lo: int, hi: int, default: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def normalize_tool(tool: Any) -> str:
    raw = str(tool or "pen").strip().lower()[:32]
    if raw == "marker":
        return "highlighter"
    if raw == "rectangle":
        return "rect"
    if raw == "oval":
        return "ellipse"
    if raw in ALLOWED_TOOLS:
        return raw
    return "pen"


def _normalize_point(raw: Any) -> dict | None:
    if isinstance(raw, dict):
        x = raw.get("x")
        y = raw.get("y")
    elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
        x, y = raw[0], raw[1]
    else:
        return None
    try:
        px = float(x)
        py = float(y)
    except (TypeError, ValueError):
        return None
    if not (px == px and py == py):  # NaN
        return None
    return {"x": _clamp01(px), "y": _clamp01(py)}


def normalize_points(raw: Any, *, limit: int = MAX_POINTS_PER_STROKE) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:limit]:
        point = _normalize_point(item)
        if point is not None:
            out.append(point)
    return out


def normalize_color(raw: Any, default: str = "#e11d48") -> str:
    value = str(raw or "").strip()
    if COLOR_RE.match(value):
        return value.lower() if len(value) != 4 else value.lower()
    return default


def normalize_annotation(raw: dict, *, author_id: int, author_role: str, display_name: str) -> dict:
    if not isinstance(raw, dict):
        raise VideoMeetingError("Некорректная аннотация", code="invalid_annotation")
    ann_id = str(raw.get("id") or raw.get("annotationId") or "").strip()[:64]
    if not ann_id:
        raise VideoMeetingError("annotation.id обязателен", code="invalid_annotation")
    tool = normalize_tool(raw.get("tool"))
    points = normalize_points(raw.get("points"))
    text = str(raw.get("text") or "")[:MAX_TEXT_LEN]
    if tool == "text" and not text.strip():
        raise VideoMeetingError("Текст не может быть пустым", code="invalid_annotation")
    if tool != "text" and len(points) < 1:
        raise VideoMeetingError("Нужна хотя бы одна точка", code="invalid_annotation")
    width = raw.get("width")
    try:
        width_n = float(width)
    except (TypeError, ValueError):
        width_n = 3.0
    width_n = max(0.5, min(24.0, width_n))
    return {
        "id": ann_id,
        "tool": tool,
        "color": normalize_color(raw.get("color")),
        "width": width_n,
        "points": points,
        "text": text,
        "completed": bool(raw.get("completed", tool in SHAPE_TOOLS or tool == "text")),
        "authorId": int(author_id),
        "authorRole": str(author_role or "")[:32],
        "displayName": str(display_name or "")[:MAX_DISPLAY_NAME],
        "createdAt": raw.get("createdAt") or raw.get("created_at"),
    }


def get_active_screenshare_session(meeting: VideoMeeting) -> MeetingScreenShareSession | None:
    return (
        MeetingScreenShareSession.objects.filter(meeting=meeting, is_active=True)
        .order_by("-started_at")
        .first()
    )


def serialize_screenshare_session(session: MeetingScreenShareSession | None) -> dict | None:
    if session is None:
        return None
    annotations = session.annotations if isinstance(session.annotations, list) else []
    return {
        "sessionId": str(session.uuid),
        "screenShareSessionId": str(session.uuid),
        "active": bool(session.is_active),
        "presenterUserId": session.presenter_user_id,
        "presenterJitsiId": session.presenter_jitsi_id or "",
        "participantsCanAnnotate": bool(session.participants_can_annotate),
        "contentWidth": session.content_width,
        "contentHeight": session.content_height,
        "version": session.version,
        "annotations": annotations,
        "annotationCount": len(annotations),
    }


def user_can_annotate(session: MeetingScreenShareSession, role: str) -> bool:
    if role in MODERATOR_ROLES:
        return True
    return bool(session.participants_can_annotate)


def _touch_operation_id(session: MeetingScreenShareSession, operation_id: str) -> bool:
    """True если operation_id уже видели (идемпотентный повтор)."""
    op_id = str(operation_id or "").strip()[:80]
    if not op_id:
        return False
    recent = list(session.recent_operation_ids or [])
    if op_id in recent:
        return True
    recent.append(op_id)
    if len(recent) > MAX_RECENT_OPERATION_IDS:
        recent = recent[-MAX_RECENT_OPERATION_IDS:]
    session.recent_operation_ids = recent
    return False


def _annotation_map(session: MeetingScreenShareSession) -> dict[str, dict]:
    items = session.annotations if isinstance(session.annotations, list) else []
    out = {}
    for item in items:
        if isinstance(item, dict) and item.get("id"):
            out[str(item["id"])] = item
    return out


def _store_annotations(session: MeetingScreenShareSession, by_id: dict[str, dict]) -> None:
    values = list(by_id.values())
    if len(values) > MAX_ANNOTATIONS:
        values = values[-MAX_ANNOTATIONS:]
    session.annotations = values


@transaction.atomic
def report_screenshare_state(
    *,
    meeting: VideoMeeting,
    user: User,
    active: bool,
    local_sharing: bool,
    presenter_jitsi_id: str = "",
    content_width=None,
    content_height=None,
) -> MeetingScreenShareSession | None:
    """
    Клиент сообщает, что в Jitsi началась/закончилась демонстрация.
    author/role с клиента не принимаются — берём из authenticated user.
    """
    access = resolve_access(user, meeting.schedule_event)
    if not access.allowed:
        raise VideoMeetingError("Нет доступа к конференции", code="forbidden", status=403)

    jitsi_id = str(presenter_jitsi_id or "").strip()[:255]
    session = (
        MeetingScreenShareSession.objects.select_for_update()
        .filter(meeting=meeting, is_active=True)
        .order_by("-started_at")
        .first()
    )

    if not active:
        if session is None:
            return None
        can_end = (
            local_sharing
            or (session.presenter_user_id and session.presenter_user_id == user.pk)
            or (jitsi_id and session.presenter_jitsi_id == jitsi_id)
            or access.role in MODERATOR_ROLES
        )
        if not can_end:
            return session
        session.is_active = False
        session.ended_at = timezone.now()
        session.save(update_fields=["is_active", "ended_at", "updated_at"])
        logger.info(
            "screenshare_ended meeting=%s session=%s user=%s",
            meeting.uuid,
            session.uuid,
            user.pk,
        )
        return session

    width = _clamp_int(content_width, lo=1, hi=8192, default=0) or None
    height = _clamp_int(content_height, lo=1, hi=8192, default=0) or None

    if session is not None:
        same_share = bool(jitsi_id) and session.presenter_jitsi_id == jitsi_id
        if not jitsi_id:
            same_share = True
        if local_sharing and session.presenter_jitsi_id and session.presenter_jitsi_id != jitsi_id:
            same_share = False
        if same_share:
            fields = []
            if local_sharing and session.presenter_user_id != user.pk:
                session.presenter_user = user
                fields.append("presenter_user")
            if jitsi_id and session.presenter_jitsi_id != jitsi_id:
                session.presenter_jitsi_id = jitsi_id
                fields.append("presenter_jitsi_id")
            if width and session.content_width != width:
                session.content_width = width
                fields.append("content_width")
            if height and session.content_height != height:
                session.content_height = height
                fields.append("content_height")
            if fields:
                fields.append("updated_at")
                session.save(update_fields=fields)
            return session
        session.is_active = False
        session.ended_at = timezone.now()
        session.save(update_fields=["is_active", "ended_at", "updated_at"])

    session = MeetingScreenShareSession.objects.create(
        meeting=meeting,
        presenter_user=user if local_sharing else None,
        presenter_jitsi_id=jitsi_id,
        participants_can_annotate=True,
        content_width=width,
        content_height=height,
        annotations=[],
        recent_operation_ids=[],
        version=1,
        is_active=True,
    )
    logger.info(
        "screenshare_started meeting=%s session=%s user=%s local=%s jitsi=%s",
        meeting.uuid,
        session.uuid,
        user.pk,
        local_sharing,
        jitsi_id,
    )
    return session


@transaction.atomic
def set_screenshare_permission(
    *,
    meeting: VideoMeeting,
    user: User,
    participants_can_annotate: bool,
    session_id: str | None = None,
) -> MeetingScreenShareSession:
    access = resolve_access(user, meeting.schedule_event)
    if access.role not in MODERATOR_ROLES:
        raise VideoMeetingError("Только преподаватель может менять права", code="forbidden", status=403)
    session = _locked_session(meeting, session_id)
    if session is None:
        raise VideoMeetingError("Нет активной демонстрации экрана", code="no_screenshare", status=409)
    session.participants_can_annotate = bool(participants_can_annotate)
    session.version = int(session.version or 1) + 1
    session.save(update_fields=["participants_can_annotate", "version", "updated_at"])
    return session


def _locked_session(meeting: VideoMeeting, session_id: str | None) -> MeetingScreenShareSession | None:
    qs = MeetingScreenShareSession.objects.select_for_update().filter(meeting=meeting, is_active=True)
    if session_id:
        try:
            sid = uuid.UUID(str(session_id))
        except (TypeError, ValueError):
            raise VideoMeetingError("Некорректный screenShareSessionId", code="invalid_session")
        qs = qs.filter(uuid=sid)
    return qs.order_by("-started_at").first()


@transaction.atomic
def apply_screenshare_operation(
    *,
    meeting: VideoMeeting,
    user: User,
    action: str,
    payload: dict,
    operation_id: str = "",
    session_id: str | None = None,
) -> dict:
    access = resolve_access(user, meeting.schedule_event)
    if not access.allowed:
        raise VideoMeetingError("Нет доступа к конференции", code="forbidden", status=403)

    action_name = str(action or "").strip()
    if action_name in ("annotation.pointer", "screenshare.pointer"):
        action_name = "pointer"
    if action_name.startswith("annotation."):
        action_name = action_name.split(".", 1)[1]
    if action_name.startswith("screenshare."):
        action_name = action_name.split(".", 1)[1]

    session = _locked_session(meeting, session_id)
    if session is None:
        raise VideoMeetingError("Нет активной демонстрации экрана", code="no_screenshare", status=409)

    claimed_session = payload.get("screenShareSessionId") or payload.get("sessionId") or session_id
    if claimed_session:
        try:
            claimed = uuid.UUID(str(claimed_session))
        except (TypeError, ValueError):
            raise VideoMeetingError("Некорректный screenShareSessionId", code="invalid_session")
        if claimed != session.uuid:
            raise VideoMeetingError("Сессия демонстрации уже сменилась", code="session_mismatch", status=409)

    display_name = _display_name(user)
    body = payload if isinstance(payload, dict) else {}

    if action_name in EPHEMERAL_ACTIONS:
        if action_name == "pointer":
            if not user_can_annotate(session, access.role):
                raise VideoMeetingError("Рисование участникам запрещено", code="forbidden", status=403)
            point = _normalize_point({"x": body.get("x"), "y": body.get("y")})
            if point is None:
                raise VideoMeetingError("Некорректные координаты", code="invalid_annotation")
            return {
                "ephemeral": True,
                "duplicate": False,
                "operation": {
                    "type": "screenshare.pointer",
                    "action": "pointer",
                    "meetingUuid": str(meeting.uuid),
                    "session_id": str(session.uuid),
                    "screenShareSessionId": str(session.uuid),
                    "author_id": user.pk,
                    "author_role": access.role,
                    "display_name": display_name,
                    "payload": point,
                },
            }
        return {"ephemeral": True, "duplicate": False, "operation": None}

    if action_name not in MUTATING_ACTIONS:
        raise VideoMeetingError("Недопустимая операция", code="unknown_action")

    if _touch_operation_id(session, operation_id):
        return {
            "duplicate": True,
            "ephemeral": False,
            "version": session.version,
            "operation": None,
        }

    can_draw = user_can_annotate(session, access.role)
    by_id = _annotation_map(session)

    if action_name in ("stroke_start", "stroke_update", "stroke_end", "object_upsert"):
        if not can_draw:
            raise VideoMeetingError("Рисование участникам запрещено", code="forbidden", status=403)
        raw = body.get("annotation") if isinstance(body.get("annotation"), dict) else body
        incoming_points = normalize_points(
            raw.get("points"),
            limit=MAX_POINTS_PER_MESSAGE if action_name == "stroke_update" else MAX_POINTS_PER_STROKE,
        )
        ann = normalize_annotation(
            {**raw, "points": incoming_points or raw.get("points") or [{"x": 0, "y": 0}]},
            author_id=user.pk,
            author_role=access.role,
            display_name=display_name,
        )
        existing = by_id.get(ann["id"])
        if existing is not None:
            if int(existing.get("authorId") or 0) != user.pk:
                raise VideoMeetingError("Нельзя изменить чужую аннотацию", code="forbidden", status=403)
            if action_name == "stroke_update":
                merged = list(existing.get("points") or [])
                merged.extend(incoming_points)
                if len(merged) > MAX_POINTS_PER_STROKE:
                    merged = merged[:MAX_POINTS_PER_STROKE]
                existing["points"] = merged
                existing["color"] = ann["color"]
                existing["width"] = ann["width"]
                existing["tool"] = ann["tool"]
                by_id[ann["id"]] = existing
                ann = existing
            elif action_name == "stroke_end":
                if incoming_points:
                    merged = list(existing.get("points") or [])
                    merged.extend(incoming_points)
                    existing["points"] = merged[:MAX_POINTS_PER_STROKE]
                existing["completed"] = True
                by_id[ann["id"]] = existing
                ann = existing
            else:
                by_id[ann["id"]] = {**existing, **ann, "authorId": user.pk}
                ann = by_id[ann["id"]]
        else:
            if action_name == "stroke_end":
                ann["completed"] = True
            if action_name == "stroke_update" and not incoming_points:
                raise VideoMeetingError("Пустое обновление штриха", code="invalid_annotation")
            by_id[ann["id"]] = ann

    elif action_name == "annotation_deleted":
        ann_id = str(body.get("id") or body.get("annotation_id") or body.get("annotationId") or "")[:64]
        existing = by_id.get(ann_id)
        if existing is None:
            session.save(update_fields=["recent_operation_ids", "updated_at"])
            return {
                "duplicate": False,
                "ephemeral": False,
                "version": session.version,
                "operation": {
                    "type": "screenshare.operation",
                    "action": "annotation_deleted",
                    "meetingUuid": str(meeting.uuid),
                    "session_id": str(session.uuid),
                    "screenShareSessionId": str(session.uuid),
                    "operation_id": str(operation_id or ""),
                    "author_id": user.pk,
                    "author_role": access.role,
                    "display_name": display_name,
                    "version": session.version,
                    "payload": {"id": ann_id},
                },
            }
        if int(existing.get("authorId") or 0) != user.pk and access.role not in MODERATOR_ROLES:
            raise VideoMeetingError("Нельзя удалить чужую аннотацию", code="forbidden", status=403)
        del by_id[ann_id]
        ann = {"id": ann_id}

    elif action_name == "clear_mine":
        by_id = {
            key: value
            for key, value in by_id.items()
            if int(value.get("authorId") or 0) != user.pk
        }
        ann = None

    elif action_name == "clear_all":
        if access.role not in MODERATOR_ROLES:
            raise VideoMeetingError("Очистить все может только преподаватель", code="forbidden", status=403)
        by_id = {}
        ann = None

    _store_annotations(session, by_id)
    session.version = int(session.version or 1) + 1
    session.save(update_fields=["annotations", "recent_operation_ids", "version", "updated_at"])

    op_payload: dict[str, Any] = {}
    if action_name in ("stroke_start", "stroke_update", "stroke_end", "object_upsert"):
        op_payload = {"annotation": by_id.get(ann["id"], ann)}
    elif action_name == "annotation_deleted":
        op_payload = {"id": ann["id"]}

    return {
        "duplicate": False,
        "ephemeral": False,
        "version": session.version,
        "operation": {
            "type": "screenshare.operation",
            "action": action_name,
            "meetingUuid": str(meeting.uuid),
            "session_id": str(session.uuid),
            "screenShareSessionId": str(session.uuid),
            "operation_id": str(operation_id or ""),
            "author_id": user.pk,
            "author_role": access.role,
            "display_name": display_name,
            "version": session.version,
            "payload": op_payload,
        },
    }


def _display_name(user: User) -> str:
    profile = getattr(user, "profile", None)
    name = (getattr(profile, "name", None) or "").strip()
    if name:
        return name[:MAX_DISPLAY_NAME]
    full = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
    if full:
        return full[:MAX_DISPLAY_NAME]
    return str(getattr(user, "username", "") or "Участник")[:MAX_DISPLAY_NAME]


def screenshare_sync_payload(meeting: VideoMeeting) -> dict:
    session = get_active_screenshare_session(meeting)
    return {
        "screenshareSession": serialize_screenshare_session(session),
    }
