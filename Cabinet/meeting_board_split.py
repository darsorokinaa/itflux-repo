"""Сплит «Доска рядом» внутри показанного варианта."""

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import InteractiveBoard, VideoMeeting
from .video_meeting_service import (
    VideoMeetingError,
    assert_can_manage_meeting,
    resolve_access,
)

_SPLIT_CONTROLLER_ROLES = frozenset({"teacher", "coteacher", "staff"})


def _presented_open_url(meeting, payload, user, kind):
    from .meeting_present import append_live_variant_query, append_meeting_query

    open_url = payload.get("openUrl") or payload.get("open_url") or ""
    # Персональная ссылка на вариант для текущего ученика.
    if kind == "variant" and user is not None:
        access = resolve_access(user, meeting.schedule_event)
        if access.role == "student":
            open_url = _student_variant_url(meeting, payload, user, open_url)
    # Учителю тоже нужны live-параметры, чтобы на странице варианта шла таблица ответов.
    if kind == "variant":
        homework_id = payload.get("homeworkId") or payload.get("homework_id")
        if homework_id:
            open_url = append_live_variant_query(open_url, homework_id)
    return append_meeting_query(open_url, meeting.uuid)


def _student_variant_url(meeting, payload, user, open_url):
    from .meeting_present import (
        _resolve_roster_student_for_user,
        _student_open_url_for_homework,
    )
    from .models import Homework

    homework_id = payload.get("homeworkId") or payload.get("homework_id")
    base_url = payload.get("variantUrl") or payload.get("variant_url") or open_url
    if not homework_id or not base_url:
        return open_url
    student = _resolve_roster_student_for_user(meeting.schedule_event, user)
    homework = Homework.objects.filter(pk=homework_id).first() if student else None
    if not student or not homework:
        return open_url
    return _student_open_url_for_homework(
        homework, student, base_url, live_meeting=True
    )


def _split_board(board_id):
    if not board_id:
        return None
    try:
        return (
            InteractiveBoard.objects.select_related("student", "group")
            .filter(pk=board_id, is_archived=False)
            .first()
        )
    except (ValueError, ValidationError, TypeError):
        return None


def _split_viewer_allowed(user, meeting, board, raw):
    """Учитель видит сплит; ученик — только свою доску или доску своей группы."""
    from .meeting_present import _resolve_roster_student_for_user

    access = resolve_access(user, meeting.schedule_event)
    if access.role in _SPLIT_CONTROLLER_ROLES and access.allowed:
        return True
    student = None
    if access.role == "student" and access.allowed:
        student = _resolve_roster_student_for_user(meeting.schedule_event, user)
    if student is None or board.get_permission_for(user) is None:
        return False
    return _student_matches_split_board(student, board, raw)


def _student_matches_split_board(student, board, raw):
    if raw.get("kind") == "group":
        group = board.group if board.group_id else None
        in_group = bool(
            group and group.students.filter(pk=student.pk, status="active").exists()
        )
        return in_group
    same_student = str(raw.get("studentId") or "") == str(student.pk)
    return same_student and board.student_id == student.pk and not board.group_id


def _viewer_can_see_board_split(
    meeting: VideoMeeting, user: User | None, raw: dict
) -> bool:
    """Личная доска — только её ученику, групповая — участникам группы с доступом."""
    authenticated = user is not None and getattr(user, "is_authenticated", False)
    board = _split_board(raw.get("boardId")) if authenticated else None
    if board is None:
        return False
    return _split_viewer_allowed(user, meeting, board, raw)


def _board_split_for_viewer(
    meeting: VideoMeeting, payload: dict, user: User | None
) -> dict | None:
    raw = payload.get("boardSplit")
    if not isinstance(raw, dict):
        return None
    if raw.get("open") is not True:
        return {"open": False}
    if not _viewer_can_see_board_split(meeting, user, raw):
        return {"open": False}
    kind = "group" if raw.get("kind") == "group" else "student"
    shown = {"open": True, "kind": kind, "boardId": str(raw.get("boardId"))}
    if kind == "student" and raw.get("studentId") not in (None, ""):
        shown["studentId"] = raw.get("studentId")
    return shown


def _attach_board_split(presented, meeting, payload, user, kind):
    if kind != "variant":
        return presented
    board_split = _board_split_for_viewer(meeting, payload, user)
    if board_split is not None:
        presented["boardSplit"] = board_split
    return presented


def _reject_unless_live_variant(meeting):
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError(
            "Доску рядом можно открыть только во время урока",
            code="not_live",
            status=409,
        )
    if meeting.presented_kind != "variant":
        raise VideoMeetingError(
            "Сначала покажите вариант ученикам",
            code="not_presented",
            status=409,
        )


def _split_record(resolved):
    kind = "group" if resolved.get("kind") == "group" else "student"
    split = {
        "open": True,
        "kind": kind,
        "boardId": str(resolved.get("boardId") or ""),
    }
    if not split["boardId"]:
        raise VideoMeetingError("Доска недоступна", code="not_found", status=404)
    student_id = resolved.get("studentId")
    if kind == "student" and student_id not in (None, ""):
        split["studentId"] = student_id
    return split


def _save_board_split(locked, user, split):
    payload = dict(locked.presented_payload or {})
    payload["boardSplit"] = split
    locked.presented_payload = payload
    locked.presented_at = timezone.now()
    locked.presented_by = user
    locked.save(
        update_fields=[
            "presented_payload",
            "presented_at",
            "presented_by",
            "updated_at",
        ]
    )


def set_variant_board_split(
    *, meeting: VideoMeeting, user: User, open_split: bool, pick=None
) -> dict:
    """Учитель открывает или закрывает «Доску рядом» у показанного варианта.

    Доску выбирает сервер (meeting_board). id доски от клиента не читается.
    Пока ученик не выбран (409), показ не меняется и ничего не рассылается.
    """
    from .variant_board import meeting_board

    assert_can_manage_meeting(user, meeting)
    _reject_unless_live_variant(meeting)
    choice = pick or {}
    resolved = None
    if open_split:
        # 409 choose_student выходит до записи и до рассылки.
        resolved = meeting_board(
            user=user,
            meeting_uuid=str(meeting.uuid),
            student_id=choice.get("student_id"),
            target=choice.get("target"),
        )
    with transaction.atomic():
        locked = VideoMeeting.objects.select_for_update().get(pk=meeting.pk)
        _reject_unless_live_variant(locked)
        split = {"open": False} if not open_split else _split_record(resolved)
        _save_board_split(locked, user, split)
    locked.refresh_from_db()
    from .meeting_present import serialize_presented

    return serialize_presented(locked, user=user)
