"""r125: «Решать вариант» вне урока — ученик решает по ссылке, учитель видит ответы live."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .choices import HomeworkStatus, HomeworkTaskType
from .homework_api import (
    LIVE_MEETING_HOMEWORK_MARKER,
    build_variant_open_url,
    extract_variant_id,
    issue_homework_token,
    normalize_variant_spa_url,
)
from .meeting_present import append_live_variant_query, build_live_answers, set_locked_live_score
from .models import Homework, HomeworkSubmission, HomeworkTask, Profile, Student, VariantLiveSession
from .video_meeting_service import VideoMeetingError
from . import variant_issuance

SESSION_MARKER = f"{LIVE_MEETING_HOMEWORK_MARKER}solve:"


class LiveSolveError(Exception):
    def __init__(self, message, *, code="error", status=400, extra=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.extra = extra or {}

    def response(self):
        payload = {"detail": self.message, "error": self.message, "code": self.code, **self.extra}
        return Response(payload, status=self.status)


def _role(user):
    # Свежая роль из БД: объект request.user может нести закэшированный профиль.
    if not getattr(user, "pk", None):
        return ""
    return Profile.objects.filter(user_id=user.pk).values_list("role", flat=True).first() or ""


def is_teacher(user) -> bool:
    return _role(user) == Profile.Role.TEACHER


def session_marker(session_id, variant_id) -> str:
    return f"{SESSION_MARKER}{session_id}:variant:{variant_id}"


def join_path(session) -> str:
    return f"/variant-live/{session.pk}"


def teacher_url(session) -> str:
    base = append_live_variant_query(session.variant_url, session.homework_id)
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}live_session={session.pk}"


def _roster_students(teacher):
    return Student.objects.filter(teacher=teacher).exclude(status="archived")


def session_students(session) -> list[Student]:
    """Кто подключился (есть сдача) + выбранный ученик."""
    students: dict[int, Student] = {}
    if session.student_id and session.student:
        students[session.student_id] = session.student
    if session.homework_id:
        ids = (
            HomeworkSubmission.objects.filter(homework_id=session.homework_id)
            .values_list("student_id", flat=True)
        )
        for st in Student.objects.filter(pk__in=list(ids), teacher=session.teacher):
            students.setdefault(st.pk, st)
    return sorted(students.values(), key=lambda s: (s.full_name or "").lower())


def serialize_session(session, *, with_counts=True) -> dict:
    data = {
        "id": str(session.pk),
        "variantId": session.variant_id,
        "variantUrl": session.variant_url,
        "title": session.title or f"Вариант №{session.variant_id}",
        "homeworkId": session.homework_id,
        "studentId": session.student_id,
        "studentName": session.student.full_name if session.student_id and session.student else "",
        "createdAt": session.created_at.isoformat() if session.created_at else None,
        "closedAt": session.closed_at.isoformat() if session.closed_at else None,
        "joinPath": join_path(session),
        "teacherUrl": teacher_url(session),
    }
    if with_counts:
        data["studentsCount"] = len(session_students(session))
    return data


def create_session(*, teacher, variant_url: str, title: str = "", student_id=None) -> VariantLiveSession:
    if not is_teacher(teacher):
        raise LiveSolveError("Создать live-решение может только преподаватель.", code="forbidden", status=403)
    spa = normalize_variant_spa_url(variant_url or "")
    variant_id = extract_variant_id(spa or variant_url or "")
    if not spa or not variant_id:
        raise LiveSolveError("Не удалось определить вариант по ссылке.", code="invalid_variant")
    student = None
    if student_id not in (None, "", 0, "0"):
        try:
            student = _roster_students(teacher).filter(pk=int(student_id)).first()
        except (TypeError, ValueError):
            student = None
        if student is None:
            raise LiveSolveError("Ученик не найден в вашем списке.", code="student_not_found", status=404)
    live_title = (title or "").strip()[:255] or f"Вариант №{variant_id}"
    with transaction.atomic():
        if student is not None:
            variant_issuance.check_and_record(teacher, [student], variant_id, source="live_solve")
        session = VariantLiveSession.objects.create(
            teacher=teacher,
            variant_id=variant_id,
            variant_url=spa,
            title=live_title,
            student=student,
        )
        homework = Homework.objects.create(
            teacher=teacher,
            title=f"Вариант №{variant_id}",
            description=f"{session_marker(session.pk, variant_id)}\nРешение по ссылке (live)",
            student=student,
            group=None,
            status=HomeworkStatus.ASSIGNED,
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.GENERATED_TASK,
            title=f"Вариант №{variant_id}",
            description=spa,
            order=0,
        )
        session.homework = homework
        session.save(update_fields=["homework"])
    return session


def get_session(session_id) -> VariantLiveSession:
    session = (
        VariantLiveSession.objects.select_related("teacher", "student", "homework")
        .filter(pk=session_id)
        .first()
    )
    if session is None:
        raise LiveSolveError("Ссылка недействительна или сессия удалена.", code="not_found", status=404)
    return session


def _own(session, user):
    if session.teacher_id != user.pk:
        raise LiveSolveError("Нет доступа к этой сессии.", code="forbidden", status=403)


def join_session(*, session, user) -> dict:
    if session.teacher_id == user.pk:
        return {"role": "teacher", "openUrl": teacher_url(session), "session": serialize_session(session)}
    if session.closed_at:
        raise LiveSolveError("Учитель завершил эту сессию. Попросите новую ссылку.", code="closed", status=410)
    from .student_api import resolve_roster_students

    students = resolve_roster_students(user).filter(teacher=session.teacher)
    if session.student_id:
        students = students.filter(pk=session.student_id)
    student = students.first()
    if student is None:
        msg = (
            "Эта ссылка выдана другому ученику."
            if session.student_id and resolve_roster_students(user).filter(teacher=session.teacher).exists()
            else "Вы не в списке учеников этого преподавателя. Попросите учителя добавить вас и откройте ссылку снова."
        )
        raise LiveSolveError(msg, code="not_student", status=403)
    homework = session.homework
    if homework is None:
        raise LiveSolveError("Сессия повреждена: нет задания.", code="broken", status=409)
    try:
        variant_issuance.check_and_record(session.teacher, [student], session.variant_id, source="live_solve")
    except variant_issuance.VariantLimitExceeded:
        # Ученику не показываем детали тарифа учителя.
        raise LiveSolveError(
            "Сейчас нельзя открыть этот вариант: у преподавателя исчерпан лимит вариантов на месяц. Напишите учителю.",
            code=variant_issuance.LIMIT_CODE,
            status=403,
        )
    from .homework_api import _get_or_create_submission

    _get_or_create_submission(homework, student)
    token = issue_homework_token(homework_id=homework.id, student_user_id=user.pk, hours=12) if user.pk else None
    open_url = build_variant_open_url(base_url=session.variant_url, homework_id=homework.id, token=token, live_meeting=True)
    return {
        "role": "student",
        "openUrl": open_url,
        "session": {"id": str(session.pk), "title": session.title, "variantId": session.variant_id},
    }


def session_answers(*, session, user) -> dict:
    _own(session, user)
    if session.homework is None:
        return {"presented": True, "students": [], "tasks": [], "variantId": session.variant_id, "title": session.title}
    payload = build_live_answers(
        homework=session.homework,
        variant_id=session.variant_id,
        students=session_students(session),
        title=session.title,
    )
    payload["sessionId"] = str(session.pk)
    payload["closedAt"] = session.closed_at.isoformat() if session.closed_at else None
    return payload


def session_set_score(*, session, user, student_id, task_id, score) -> dict:
    _own(session, user)
    if session.homework is None:
        raise LiveSolveError("Сессия повреждена: нет задания.", code="broken", status=409)
    try:
        return set_locked_live_score(
            homework=session.homework,
            variant_id=session.variant_id,
            allowed_student_ids={s.id for s in session_students(session)},
            user=user,
            student_id=student_id,
            task_id=task_id,
            score=score,
        )
    except VideoMeetingError as exc:
        raise LiveSolveError(exc.message, code=exc.code, status=exc.status)


def student_quota_rows(teacher, variant_id) -> list[dict]:
    rows = []
    for st in _roster_students(teacher).filter(status="active").order_by("last_name", "first_name"):
        q = variant_issuance.quota(teacher, st, variant_id=variant_id)
        q["displayName"] = st.full_name
        q["hasAccount"] = bool(st.user_id)
        rows.append(q)
    return rows


# ---------------------------------------------------------------- API


def _guard(fn):
    def wrapper(self, request, *args, **kwargs):
        try:
            return fn(self, request, *args, **kwargs)
        except LiveSolveError as exc:
            return exc.response()
        except variant_issuance.VariantLimitExceeded as exc:
            return Response(exc.to_dict(), status=status.HTTP_403_FORBIDDEN)

    return wrapper


class VariantLiveListView(APIView):
    permission_classes = [IsAuthenticated]

    @_guard
    def get(self, request):
        if not is_teacher(request.user):
            raise LiveSolveError("Только для преподавателя.", code="forbidden", status=403)
        qs = VariantLiveSession.objects.filter(teacher=request.user).select_related("student")
        vid = request.query_params.get("variant_id")
        if vid and str(vid).isdigit():
            qs = qs.filter(variant_id=int(vid))
        return Response({"sessions": [serialize_session(s) for s in qs[:100]]})

    @_guard
    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        session = create_session(
            teacher=request.user,
            variant_url=data.get("variantUrl") or data.get("variant_url") or "",
            title=data.get("title") or "",
            student_id=data.get("studentId") or data.get("student_id"),
        )
        return Response({"session": serialize_session(session)}, status=status.HTTP_201_CREATED)


class VariantLiveDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @_guard
    def get(self, request, session_id):
        session = get_session(session_id)
        if session.teacher_id == request.user.pk:
            return Response({"session": serialize_session(session), "role": "teacher"})
        return Response(
            {
                "role": "student",
                "session": {
                    "id": str(session.pk),
                    "title": session.title,
                    "variantId": session.variant_id,
                    "closed": bool(session.closed_at),
                },
            }
        )

    @_guard
    def delete(self, request, session_id):
        session = get_session(session_id)
        _own(session, request.user)
        if not session.closed_at:
            session.closed_at = timezone.now()
            session.save(update_fields=["closed_at"])
        return Response({"session": serialize_session(session)})


class VariantLiveJoinView(APIView):
    permission_classes = [IsAuthenticated]

    @_guard
    def post(self, request, session_id):
        return Response(join_session(session=get_session(session_id), user=request.user))


class VariantLiveAnswersView(APIView):
    permission_classes = [IsAuthenticated]

    @_guard
    def get(self, request, session_id):
        return Response(session_answers(session=get_session(session_id), user=request.user))


class VariantLiveScoreView(APIView):
    permission_classes = [IsAuthenticated]

    @_guard
    def post(self, request, session_id):
        data = request.data if isinstance(request.data, dict) else {}
        return Response(
            session_set_score(
                session=get_session(session_id),
                user=request.user,
                student_id=data.get("studentId"),
                task_id=data.get("taskId"),
                score=data.get("score"),
            )
        )


class VariantIssueQuotaView(APIView):
    permission_classes = [IsAuthenticated]

    @_guard
    def get(self, request):
        if not is_teacher(request.user):
            raise LiveSolveError("Только для преподавателя.", code="forbidden", status=403)
        vid = request.query_params.get("variant_id")
        variant_id = int(vid) if vid and str(vid).isdigit() else None
        limit = variant_issuance.per_student_limit(request.user)
        plan = variant_issuance.plan_for(request.user)
        return Response(
            {
                "limit": limit,
                "planSlug": getattr(plan, "slug", ""),
                "planName": getattr(plan, "name", ""),
                "upgradeUrl": variant_issuance.UPGRADE_URL,
                "month": variant_issuance.current_month(),
                "students": student_quota_rows(request.user, variant_id),
            }
        )
