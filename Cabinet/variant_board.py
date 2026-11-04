"""r145: «Доска рядом» — общая доска рядом с вариантом (урок и «Решать вариант»)."""

from __future__ import annotations

from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .boards_api import ensure_linked_student_edit_access
from .models import InteractiveBoard, InteractiveBoardAccess, VariantLiveSession

LIVE_BOARD_MARKER = "variant-live-board:"


class VariantBoardError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _payload(board, source):
    return {"boardId": str(board.id), "title": board.title or "Доска", "source": source}


def meeting_board(*, user, meeting_uuid):
    from .meeting_present import _grant_board_access_to_event_students
    from .video_meeting_service import VideoMeetingError, get_meeting_by_uuid, resolve_access

    try:
        meeting = get_meeting_by_uuid(meeting_uuid)
    except VideoMeetingError:
        raise VariantBoardError("Урок не найден.", 404)
    except Exception:
        raise VariantBoardError("Урок не найден.", 404)
    event = meeting.schedule_event
    access = resolve_access(user, event)
    if not access.allowed or access.role not in ("teacher", "coteacher", "staff", "student"):
        raise VariantBoardError("Нет доступа к доске урока.", 403)
    with transaction.atomic():
        board = None
        if meeting.presented_kind == "board":
            payload = meeting.presented_payload or {}
            board_id = payload.get("boardId") or payload.get("board_id")
            if board_id:
                board = InteractiveBoard.objects.filter(pk=board_id, is_archived=False).first()
        if board is None:
            board = (
                InteractiveBoard.objects.select_for_update()
                .filter(schedule_event=event, owner=event.owner, is_archived=False)
                .order_by("-updated_at")
                .first()
            )
        if board is None:
            board = InteractiveBoard.objects.create(
                owner=event.owner,
                title="Доска урока",
                schedule_event=event,
                student=event.student if event.student_id else None,
            )
        if board.schedule_event_id != event.pk:
            board.schedule_event = event
            board.save(update_fields=["schedule_event", "updated_at"])
        _grant_board_access_to_event_students(board, event)
    return _payload(board, "lesson")


def _live_session(*, live_session=None, homework_id=None):
    qs = VariantLiveSession.objects.select_related("teacher", "student")
    session = None
    if live_session:
        try:
            session = qs.filter(pk=live_session).first()
        except Exception:
            session = None
    if session is None and homework_id:
        try:
            session = qs.filter(homework_id=int(homework_id)).first()
        except (TypeError, ValueError):
            session = None
    return session


def live_board(*, user, live_session=None, homework_id=None):
    from .student_api import resolve_roster_students
    from .variant_live import session_students

    session = _live_session(live_session=live_session, homework_id=homework_id)
    if session is None:
        raise VariantBoardError("Сессия варианта не найдена.", 404)
    student_user = None
    if session.teacher_id != user.pk and not user.is_staff:
        if session.closed_at:
            raise VariantBoardError("Учитель завершил эту сессию.", 410)
        allowed = {s.pk for s in session_students(session)}
        roster = resolve_roster_students(user).filter(teacher=session.teacher)
        if session.student_id:
            roster = roster.filter(pk=session.student_id)
        mine = roster.filter(pk__in=allowed).first() if allowed else None
        if mine is None:
            raise VariantBoardError("Нет доступа к доске этого варианта.", 403)
        student_user = user
    marker = f"{LIVE_BOARD_MARKER}{session.pk}"
    with transaction.atomic():
        board = (
            InteractiveBoard.objects.select_for_update()
            .filter(owner=session.teacher, description__startswith=marker, is_archived=False)
            .order_by("created_at")
            .first()
        )
        if board is None:
            board = InteractiveBoard.objects.create(
                owner=session.teacher,
                title=(f"Доска · {session.title}" if session.title else "Доска к варианту")[:255],
                description=f"{marker}\nОбщая доска к варианту (решение по ссылке)",
                student=session.student if session.student_id else None,
            )
        ensure_linked_student_edit_access(board)
        if student_user is not None:
            InteractiveBoardAccess.objects.update_or_create(
                board=board, user=student_user, defaults={"permission": InteractiveBoardAccess.EDIT},
            )
    return _payload(board, "live")


class VariantBoardView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        meeting = str(data.get("meeting") or "").strip()
        live_session = str(data.get("live_session") or data.get("liveSession") or "").strip()
        homework_id = data.get("homework_id") or data.get("homeworkId")
        try:
            if meeting:
                return Response(meeting_board(user=request.user, meeting_uuid=meeting))
            if live_session or homework_id:
                return Response(live_board(user=request.user, live_session=live_session or None, homework_id=homework_id))
        except VariantBoardError as exc:
            return Response({"detail": str(exc)}, status=exc.status)
        return Response({"detail": "Не указан урок или вариант."}, status=400)
