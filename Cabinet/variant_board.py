"""r145/r147: «Доска рядом» — рядом с вариантом открывается строго доска ученика.

Доска ученика = личная доска пары «учитель ↔ ученик» (InteractiveBoard.student,
без группы) — та же, что используется на его индивидуальных уроках. Клиент не
может передать id доски: сервер выбирает её сам. Учитель группового урока или
группового «Решать вариант» выбирает ученика только из списка учеников
этого урока/сессии.
"""

from __future__ import annotations

from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .boards_api import ensure_linked_student_edit_access
from .models import InteractiveBoard, InteractiveBoardAccess, VariantLiveSession

# r145: прежние доски сессий (данные не трогаем, больше не используем).
LIVE_BOARD_MARKER = "variant-live-board:"
TEACHER_ROLES = ("teacher", "coteacher", "staff")


class VariantBoardError(Exception):
    def __init__(self, message, status=400, code="error", extra=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.extra = extra or {}


def _student_name(st):
    return (getattr(st, "full_name", "") or "").strip() or f"Ученик №{st.pk}"


def student_boards_qs(*, teacher, student):
    return (
        InteractiveBoard.objects.filter(owner=teacher, student=student, group__isnull=True, is_archived=False)
        .exclude(description__startswith=LIVE_BOARD_MARKER)
    )


def get_or_create_student_board(*, teacher, student, event=None):
    """Одна доска ученика: доска этого урока → доска его уроков → любая его → создать один раз."""
    with transaction.atomic():
        # блокируем строку ученика, чтобы параллельные запросы не создали две доски
        type(student).objects.select_for_update().filter(pk=student.pk).first()
        qs = student_boards_qs(teacher=teacher, student=student)
        board = None
        if event is not None:
            board = qs.filter(schedule_event=event).order_by("-updated_at").first()
        if board is None:
            board = qs.filter(schedule_event__isnull=False).order_by("-updated_at").first()
        if board is None:
            board = qs.order_by("-updated_at").first()
        if board is None:
            board = InteractiveBoard.objects.create(
                owner=teacher,
                title=f"Доска — {_student_name(student)}"[:255],
                student=student,
            )
        ensure_linked_student_edit_access(board)
    return board


def _pick(*, user, is_teacher, students, student_id):
    if not is_teacher:
        mine = [s for s in students if s.user_id == user.pk]
        if not mine:
            raise VariantBoardError("Нет доступа к доске.", 403, "forbidden")
        return mine[0]
    if not students:
        raise VariantBoardError("В этом уроке нет учеников.", 404, "no_students")
    if student_id not in (None, ""):
        for s in students:
            if str(s.pk) == str(student_id):
                return s
        raise VariantBoardError("Этого ученика нет в уроке.", 403, "forbidden")
    if len(students) == 1:
        return students[0]
    raise VariantBoardError("Выберите ученика.", 409, "choose_student")


def _result(board, student, students, is_teacher, source):
    out = {
        "boardId": str(board.id),
        "title": board.title or "Доска",
        "source": source,
        "studentId": student.pk,
        "studentName": _student_name(student),
    }
    if is_teacher and len(students) > 1:
        out["students"] = [{"id": s.pk, "name": _student_name(s)} for s in students]
    return out


def _students_payload(students):
    return {"students": [{"id": s.pk, "name": _student_name(s)} for s in students]}


def meeting_board(*, user, meeting_uuid, student_id=None):
    from .meeting_present import list_event_students
    from .video_meeting_service import get_meeting_by_uuid, resolve_access

    try:
        meeting = get_meeting_by_uuid(meeting_uuid)
    except Exception:
        raise VariantBoardError("Урок не найден.", 404, "not_found")
    event = meeting.schedule_event
    access = resolve_access(user, event)
    if not access.allowed or access.role not in TEACHER_ROLES + ("student",):
        raise VariantBoardError("Нет доступа к доске урока.", 403, "forbidden")
    is_teacher = access.role in TEACHER_ROLES
    students = sorted(list_event_students(event), key=lambda s: _student_name(s).lower())
    try:
        student = _pick(user=user, is_teacher=is_teacher, students=students, student_id=student_id)
    except VariantBoardError as exc:
        if exc.code == "choose_student":
            exc.extra = _students_payload(students)
        raise
    board = get_or_create_student_board(teacher=event.owner, student=student, event=event)
    return _result(board, student, students, is_teacher, "lesson")


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


def live_board(*, user, live_session=None, homework_id=None, student_id=None):
    from .variant_live import session_students

    session = _live_session(live_session=live_session, homework_id=homework_id)
    if session is None:
        raise VariantBoardError("Сессия варианта не найдена.", 404, "not_found")
    is_teacher = session.teacher_id == user.pk or user.is_staff
    if not is_teacher and session.closed_at:
        raise VariantBoardError("Учитель завершил эту сессию.", 410, "closed")
    students = session_students(session)
    try:
        student = _pick(user=user, is_teacher=is_teacher, students=students, student_id=student_id)
    except VariantBoardError as exc:
        if exc.code == "choose_student":
            exc.extra = _students_payload(students)
        raise
    if student.teacher_id != session.teacher_id:
        raise VariantBoardError("Нет доступа к доске.", 403, "forbidden")
    board = get_or_create_student_board(teacher=session.teacher, student=student)
    return _result(board, student, students, is_teacher, "live")


class VariantBoardView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        meeting = str(data.get("meeting") or "").strip()
        live_session = str(data.get("live_session") or data.get("liveSession") or "").strip()
        homework_id = data.get("homework_id") or data.get("homeworkId")
        student_id = data.get("student_id") or data.get("studentId")
        # id доски от клиента намеренно игнорируется (board/boardId не читаем).
        try:
            if meeting:
                return Response(meeting_board(user=request.user, meeting_uuid=meeting, student_id=student_id))
            if live_session or homework_id:
                return Response(live_board(
                    user=request.user, live_session=live_session or None,
                    homework_id=homework_id, student_id=student_id,
                ))
        except VariantBoardError as exc:
            return Response({"detail": str(exc), "code": exc.code, **exc.extra}, status=exc.status)
        return Response({"detail": "Не указан урок или вариант."}, status=400)
