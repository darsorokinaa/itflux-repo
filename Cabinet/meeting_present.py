"""Показ доски/варианта ученику во время видеоурока."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .boards_api import ensure_linked_student_edit_access
from .choices import HomeworkStatus, HomeworkTaskType
from .homework_api import (
    build_variant_open_url,
    extract_variant_id,
    issue_homework_token,
    normalize_variant_spa_url,
    serialize_assignment_payload,
)
from .models import (
    Homework,
    HomeworkSubmission,
    HomeworkTask,
    InteractiveBoard,
    InteractiveBoardAccess,
    ScheduleEvent,
    Student,
    VideoMeeting,
)
from .video_meeting_service import VideoMeetingError, assert_can_manage_meeting, resolve_access


PRESENT_KINDS = frozenset({"board", "variant"})


def append_live_variant_query(url: str, homework_id) -> str:
    """Добавить параметры live-варианта (ДЗ + live_meeting) к SPA-ссылке."""
    raw = (url or "").strip()
    if not raw or not homework_id:
        return raw
    parts = urlsplit(raw)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["cabinet_assignment"] = str(homework_id)
    query["homework_mode"] = "1"
    query["live_meeting"] = "1"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def append_meeting_query(url: str, meeting_uuid: str) -> str:
    """Добавить ?meeting=<uuid>, чтобы на вкладке материала открылся свёрнутый звонок."""
    raw = (url or "").strip()
    if not raw or not meeting_uuid:
        return raw
    parts = urlsplit(raw)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["meeting"] = str(meeting_uuid)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def list_event_students(event: ScheduleEvent) -> list[Student]:
    students: dict[int, Student] = {}
    if event.student_id and event.student:
        students[event.student_id] = event.student
    if event.group_id and event.group_id:
        for student in event.group.students.filter(status="active"):
            students[student.id] = student
    for participant in event.participants.select_related("student").all():
        student = participant.student
        if student and student.status == "active":
            students[student.id] = student
    return list(students.values())


def redact_plan_item_for_student(plan_item_json: dict | None) -> dict | None:
    """Ученику не отдаём прикреплённые материалы/ДЗ — только метаданные темы."""
    if not plan_item_json:
        return None
    return {
        "id": plan_item_json.get("id"),
        "order": plan_item_json.get("order"),
        "lesson_number": plan_item_json.get("lesson_number") or plan_item_json.get("lessonNumber"),
        "title": plan_item_json.get("title") or "",
        "topic": plan_item_json.get("topic") or "",
        "subtopic": plan_item_json.get("subtopic") or "",
        "task_number": plan_item_json.get("task_number") or plan_item_json.get("taskNumber") or "",
        "materials": [],
        "attached_interactives": [],
        "homework_materials": [],
        "homework_interactives": [],
        "materials_notes": "",
        "homework_description": "",
        "goal": "",
        "description": "",
        "teacher_comment": "",
        "linked_lesson_id": None,
        "linked_lesson_title": "",
    }


def _grant_board_access_to_event_students(board: InteractiveBoard, event: ScheduleEvent) -> None:
    ensure_linked_student_edit_access(board)
    for student in list_event_students(event):
        if not student.user_id:
            continue
        InteractiveBoardAccess.objects.update_or_create(
            board=board,
            user=student.user,
            defaults={"permission": InteractiveBoardAccess.EDIT},
        )
        if not board.student_id:
            board.student = student
            board.save(update_fields=["student", "updated_at"])


def _ensure_live_variant_homework(
    *,
    event: ScheduleEvent,
    teacher: User,
    title: str,
    variant_url: str,
) -> Homework:
    spa_url = normalize_variant_spa_url(variant_url)
    variant_id = extract_variant_id(spa_url or variant_url)
    if not variant_id:
        raise VideoMeetingError("Не удалось определить вариант по ссылке", code="invalid_variant", status=400)

    live_title = f"Вариант №{variant_id}"
    marker = f"live-meeting:{event.pk}:variant:{variant_id}"
    students = list_event_students(event)
    primary = event.student or (students[0] if students else None)
    group = event.group

    existing = (
        Homework.objects.filter(teacher=teacher, description__contains=marker)
        .prefetch_related("tasks")
        .first()
    )
    if existing:
        if existing.status == HomeworkStatus.DRAFT:
            existing.status = HomeworkStatus.ASSIGNED
            existing.save(update_fields=["status", "updated_at"])
        if (existing.title or "").strip() != live_title:
            existing.title = live_title
            existing.save(update_fields=["title", "updated_at"])
        return existing

    with transaction.atomic():
        homework = Homework.objects.create(
            teacher=teacher,
            title=live_title,
            description=f"{marker}\nПоказан на уроке {event.pk}",
            lesson_id=event.lesson_id,
            student=primary if not group else None,
            group=group,
            status=HomeworkStatus.ASSIGNED,
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.GENERATED_TASK,
            title=live_title,
            description=spa_url or variant_url,
            order=0,
        )
    return homework


def _student_open_url_for_homework(
    homework: Homework,
    student: Student,
    variant_url: str,
    *,
    live_meeting: bool = False,
) -> str:
    if not student.user_id:
        return normalize_variant_spa_url(variant_url) or variant_url
    token = issue_homework_token(homework_id=homework.id, student_user_id=student.user_id, hours=6)
    return build_variant_open_url(
        base_url=variant_url,
        homework_id=homework.id,
        token=token,
        live_meeting=live_meeting,
    )


def _resolve_roster_student_for_user(event: ScheduleEvent, user: User) -> Student | None:
    students = list_event_students(event)
    return next((s for s in students if s.user_id == user.pk), None)


def serialize_presented(meeting: VideoMeeting, *, user: User | None = None) -> dict | None:
    kind = (meeting.presented_kind or "").strip()
    if kind not in PRESENT_KINDS:
        return None
    payload = dict(meeting.presented_payload or {})
    open_url = payload.get("openUrl") or payload.get("open_url") or ""

    # Персональная ссылка на вариант для текущего ученика.
    if kind == "variant" and user is not None:
        access = resolve_access(user, meeting.schedule_event)
        if access.role == "student":
            homework_id = payload.get("homeworkId") or payload.get("homework_id")
            base_url = payload.get("variantUrl") or payload.get("variant_url") or open_url
            if homework_id and base_url:
                student = _resolve_roster_student_for_user(meeting.schedule_event, user)
                homework = Homework.objects.filter(pk=homework_id).first() if student else None
                if student and homework:
                    open_url = _student_open_url_for_homework(
                        homework,
                        student,
                        base_url,
                        live_meeting=True,
                    )

    # Учителю тоже нужны live-параметры, чтобы на странице варианта шла таблица ответов.
    if kind == "variant":
        homework_id = payload.get("homeworkId") or payload.get("homework_id")
        if homework_id:
            open_url = append_live_variant_query(open_url, homework_id)

    open_url = append_meeting_query(open_url, meeting.uuid)

    return {
        "kind": kind,
        "title": payload.get("title") or "",
        "openUrl": open_url,
        "boardId": payload.get("boardId") or payload.get("board_id"),
        "homeworkId": payload.get("homeworkId") or payload.get("homework_id"),
        "materialId": payload.get("materialId") or payload.get("material_id"),
        "variantId": payload.get("variantId") or payload.get("variant_id"),
        "presentedAt": meeting.presented_at.isoformat() if meeting.presented_at else None,
    }


def present_board(*, meeting: VideoMeeting, user: User, board_id: str) -> dict:
    assert_can_manage_meeting(user, meeting)
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError("Показать можно только во время урока", code="not_live", status=409)

    board = InteractiveBoard.objects.filter(pk=board_id, owner=meeting.schedule_event.owner).first()
    if board is None:
        board = InteractiveBoard.objects.filter(pk=board_id).first()
        if board is None:
            raise VideoMeetingError("Доска не найдена", code="not_found", status=404)
        if board.owner_id != user.pk and not user.is_staff:
            raise VideoMeetingError("Нет доступа к доске", code="forbidden", status=403)

    event = meeting.schedule_event
    if board.schedule_event_id != event.pk:
        board.schedule_event = event
        board.save(update_fields=["schedule_event", "updated_at"])
    _grant_board_access_to_event_students(board, event)

    open_url = f"/cabinet/boards/{board.id}"
    meeting.presented_kind = "board"
    meeting.presented_payload = {
        "kind": "board",
        "title": board.title or "Доска",
        "boardId": str(board.id),
        "openUrl": open_url,
    }
    meeting.presented_at = timezone.now()
    meeting.presented_by = user
    meeting.save(
        update_fields=[
            "presented_kind",
            "presented_payload",
            "presented_at",
            "presented_by",
            "updated_at",
        ]
    )
    return serialize_presented(meeting, user=user)


def present_variant(
    *,
    meeting: VideoMeeting,
    user: User,
    title: str = "",
    url: str = "",
    material_id=None,
) -> dict:
    assert_can_manage_meeting(user, meeting)
    if meeting.status != VideoMeeting.Status.LIVE:
        raise VideoMeetingError("Показать можно только во время урока", code="not_live", status=409)

    event = meeting.schedule_event
    variant_url = (url or "").strip()
    label = (title or "").strip()

    if material_id and not variant_url:
        from .models import Material

        material = Material.objects.filter(pk=material_id).first()
        if material is None:
            raise VideoMeetingError("Материал не найден", code="not_found", status=404)
        variant_url = (material.external_url or "").strip()
        label = label or material.title

    if not variant_url:
        raise VideoMeetingError("Нужна ссылка на вариант", code="invalid_variant", status=400)

    homework = _ensure_live_variant_homework(
        event=event,
        teacher=user,
        title=label,
        variant_url=variant_url,
    )
    variant_id = extract_variant_id(variant_url)
    spa = normalize_variant_spa_url(variant_url)
    live_title = f"Вариант №{variant_id}" if variant_id else (label or homework.title)
    meeting.presented_kind = "variant"
    meeting.presented_payload = {
        "kind": "variant",
        "title": live_title,
        "openUrl": spa,
        "variantUrl": spa,
        "homeworkId": homework.id,
        "variantId": variant_id,
        "materialId": material_id,
        "liveMeeting": True,
    }
    meeting.presented_at = timezone.now()
    meeting.presented_by = user
    meeting.save(
        update_fields=[
            "presented_kind",
            "presented_payload",
            "presented_at",
            "presented_by",
            "updated_at",
        ]
    )
    return serialize_presented(meeting, user=user)


def clear_presented(*, meeting: VideoMeeting, user: User) -> None:
    assert_can_manage_meeting(user, meeting)
    meeting.presented_kind = ""
    meeting.presented_payload = {}
    meeting.presented_at = None
    meeting.presented_by = None
    meeting.save(
        update_fields=[
            "presented_kind",
            "presented_payload",
            "presented_at",
            "presented_by",
            "updated_at",
        ]
    )


def _variant_tasks_answer_key(variant_id) -> list[dict]:
    if not variant_id:
        return []
    try:
        from Generator.models import VariantContent
    except Exception:
        try:
            from Generator.Generator.models import VariantContent
        except Exception:
            return []
    rows = []
    qs = (
        VariantContent.objects.filter(variant_id=variant_id)
        .select_related("task", "task__task")
        .order_by("order")
    )
    for vc in qs:
        task = vc.task
        if not task:
            continue
        number = None
        if getattr(task, "task", None) is not None:
            number = getattr(task.task, "task_number", None)
        rows.append(
            {
                "id": task.pk,
                "number": number,
                "answer": (task.answer or "").strip(),
            }
        )
    return rows


def _live_result_only_checked(result: dict | None, tasks: list[dict]) -> dict | None:
    """Учителю на live-уроке отдаём только ответы после «Проверить»."""
    if not result or not isinstance(result, dict):
        return {"checked": {}, "by_number": {}, "by_task_id": {}, "scores": {}}
    checked = result.get("checked") or {}
    if not isinstance(checked, dict) or not checked:
        return {"checked": {}, "by_number": {}, "by_task_id": {}, "scores": {}}

    checked_ids = {str(k) for k in checked.keys()}
    id_to_num = {
        str(t["id"]): str(t["number"])
        for t in tasks
        if t.get("id") is not None and t.get("number") is not None
    }
    num_to_id = {
        str(t["number"]): str(t["id"])
        for t in tasks
        if t.get("id") is not None and t.get("number") is not None
    }
    by_id = result.get("by_task_id") or result.get("byTaskId") or {}
    by_num = result.get("by_number") or result.get("byNumber") or {}
    scores = result.get("scores") or {}
    if not isinstance(by_id, dict):
        by_id = {}
    if not isinstance(by_num, dict):
        by_num = {}
    if not isinstance(scores, dict):
        scores = {}

    out_checked = {str(k): bool(v) for k, v in checked.items()}
    out_id = {}
    out_num = {}
    out_scores = {}

    for tid in checked_ids:
        if tid in by_id and by_id[tid] is not None and str(by_id[tid]).strip() != "":
            out_id[tid] = by_id[tid]
        if tid in scores:
            out_scores[tid] = scores[tid]

    for num, val in by_num.items():
        nkey = str(num)
        tid = num_to_id.get(nkey)
        if not ((tid and tid in checked_ids) or nkey in checked_ids):
            continue
        if val is None or str(val).strip() == "":
            continue
        out_num[nkey] = val
        if tid and tid not in out_id:
            out_id[tid] = val

    for tid, val in list(out_id.items()):
        num = id_to_num.get(tid)
        if num and num not in out_num:
            out_num[num] = val

    return {
        "checked": out_checked,
        "by_task_id": out_id,
        "by_number": out_num,
        "scores": out_scores,
    }


def live_variant_answers(*, meeting: VideoMeeting, user: User) -> dict:
    assert_can_manage_meeting(user, meeting)
    if meeting.presented_kind != "variant":
        return {"presented": False, "students": [], "tasks": []}
    payload = meeting.presented_payload or {}
    homework_id = payload.get("homeworkId")
    variant_id = payload.get("variantId")
    if not homework_id:
        return {
            "presented": True,
            "students": [],
            "tasks": _variant_tasks_answer_key(variant_id),
            "variantId": variant_id,
            "title": payload.get("title") or "",
        }
    homework = Homework.objects.filter(pk=homework_id).prefetch_related("tasks").first()
    if not homework:
        return {
            "presented": True,
            "students": [],
            "tasks": _variant_tasks_answer_key(variant_id),
            "variantId": variant_id,
            "title": payload.get("title") or "",
        }

    event_students = list_event_students(meeting.schedule_event)
    submissions = {
        row.student_id: row
        for row in HomeworkSubmission.objects.filter(homework=homework, student__in=event_students)
    }
    tasks = _variant_tasks_answer_key(variant_id)
    rows = []
    for student in event_students:
        submission = submissions.get(student.id)
        assignment = serialize_assignment_payload(homework=homework, submission=submission)
        rows.append(
            {
                "studentId": student.id,
                "displayName": student.full_name,
                "status": assignment.get("status"),
                "score": assignment.get("score"),
                "result": _live_result_only_checked(assignment.get("result"), tasks),
                "updatedAt": submission.updated_at.isoformat() if submission else None,
            }
        )
    return {
        "presented": True,
        "homeworkId": homework.id,
        "variantId": variant_id,
        "title": payload.get("title") or homework.title,
        "tasks": tasks,
        "students": rows,
    }
