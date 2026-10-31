"""Показ доски/варианта ученику во время видеоурока."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .boards_api import ensure_linked_student_edit_access
from .choices import HomeworkStatus, HomeworkTaskType
from .homework_api import (
    LIVE_MEETING_HOMEWORK_MARKER,
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
from .lesson_locked_scores import LOCK_KEY, grading_tasks, locked_scores, reapply_locked_scores


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
    marker = f"{LIVE_MEETING_HOMEWORK_MARKER}{event.pk}:variant:{variant_id}"
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

    # Не смешиваем показ доски с сессией синхронного материала.
    try:
        from .meeting_material_session import close_material_session

        close_material_session(meeting=meeting, user=user)
    except Exception:
        pass

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

    try:
        from .meeting_material_session import close_material_session

        close_material_session(meeting=meeting, user=user)
    except Exception:
        pass

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

    # r125: показ варианта на уроке тоже расходует лимит «вариантов на ученика в месяц».
    from . import variant_issuance

    try:
        variant_issuance.check_and_record(
            user, list_event_students(event), extract_variant_id(variant_url), source="lesson",
        )
    except variant_issuance.VariantLimitExceeded as exc:
        raise VideoMeetingError(exc.message, code=variant_issuance.LIMIT_CODE, status=403)

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
    qs = list(
        VariantContent.objects.filter(variant_id=variant_id)
        .select_related("task", "task__task")
        .order_by("order", "id")
    )
    bank_numbers = []
    for vc in qs:
        task = vc.task
        if not task:
            bank_numbers.append(None)
            continue
        number = None
        if getattr(task, "task", None) is not None:
            number = getattr(task.task, "task_number", None)
        bank_numbers.append(number)

    # Если в варианте несколько задач с одним task_number (рабочая тетрадь /
    # банк одного типа), номер из банка нельзя использовать как ключ ответа —
    # иначе один ответ «размазывается» по всем строкам. Берём порядок в варианте.
    unique_bank = {n for n in bank_numbers if n is not None}
    use_order = len(unique_bank) < sum(1 for n in bank_numbers if n is not None)

    rows = []
    ordinal = 0
    for vc, bank_number in zip(qs, bank_numbers):
        task = vc.task
        if not task:
            continue
        ordinal += 1
        display_number = ordinal if use_order else bank_number
        if display_number is None:
            display_number = ordinal
        rows.append(
            {
                "id": task.pk,
                "number": display_number,
                "bankNumber": bank_number,
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
    # При дублирующихся № не строим num→id (last-wins ломает ответы).
    number_counts: dict[str, int] = {}
    for t in tasks:
        if t.get("number") is None:
            continue
        nk = str(t["number"])
        number_counts[nk] = number_counts.get(nk, 0) + 1
    num_to_id = {}
    for t in tasks:
        if t.get("id") is None or t.get("number") is None:
            continue
        nk = str(t["number"])
        if number_counts.get(nk, 0) == 1:
            num_to_id[nk] = str(t["id"])
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
        if number_counts.get(nkey, 0) > 1:
            continue
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
        if num and number_counts.get(num, 0) == 1 and num not in out_num:
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
            "tasks": _with_grading(_variant_tasks_answer_key(variant_id), variant_id),
            "variantId": variant_id,
            "title": payload.get("title") or "",
        }
    homework = Homework.objects.filter(pk=homework_id).prefetch_related("tasks").first()
    if not homework:
        return {
            "presented": True,
            "students": [],
            "tasks": _with_grading(_variant_tasks_answer_key(variant_id), variant_id),
            "variantId": variant_id,
            "title": payload.get("title") or "",
        }

    return build_live_answers(
        homework=homework,
        variant_id=variant_id,
        students=list_event_students(meeting.schedule_event),
        title=payload.get("title") or homework.title,
    )


def build_live_answers(*, homework, variant_id, students, title="") -> dict:
    """r125: общий ответ таблицы live-ответов (урок и «Решать вариант»)."""
    # При дублях берём последнюю правку, иначе опрос показывает старый черновик.
    submissions = {}
    for row in (
        HomeworkSubmission.objects.filter(homework=homework, student__in=students)
        .order_by("updated_at", "id")
    ):
        submissions[row.student_id] = row
    tasks = _with_grading(_variant_tasks_answer_key(variant_id), variant_id)
    rows = []
    for student in students:
        submission = submissions.get(student.id)
        assignment = serialize_assignment_payload(homework=homework, submission=submission)
        rows.append(
            {
                "studentId": student.id,
                "displayName": student.full_name,
                "status": assignment.get("status"),
                "score": assignment.get("score"),
                # На уроке учителю нужны и черновик ученика, и правильные ответы в таблице.
                "result": assignment.get("result") if isinstance(assignment.get("result"), dict) else {
                    "checked": {},
                    "by_number": {},
                    "by_task_id": {},
                    "scores": {},
                },
                "updatedAt": submission.updated_at.isoformat() if submission else None,
                "lockedScores": locked_scores(submission.result_payload) if submission else {},
            }
        )
    return {
        "presented": True,
        "homeworkId": homework.id,
        "variantId": variant_id,
        "title": title or homework.title,
        "tasks": tasks,
        "students": rows,
    }


def _with_grading(tasks: list[dict], variant_id) -> list[dict]:
    """r120: часть, максимум и критерии второй части — только в учительском ответе."""
    try:
        info = {row["id"]: row for row in grading_tasks(variant_id)}
    except Exception:
        import logging
        logging.getLogger("cabinet.meeting").exception("live grading info failed variant=%s", variant_id)
        return tasks
    for task in tasks:
        extra = info.get(task.get("id"))
        if extra:
            task["part"] = extra["part"]
            task["maxScore"] = extra["maxScore"]
            if "criteria" in extra:
                task["criteria"] = extra["criteria"]
    return tasks


def live_variant_set_score(*, meeting: VideoMeeting, user: User, student_id, task_id, score) -> dict:
    """r120: учитель один раз выставляет балл за задание второй части на уроке."""
    assert_can_manage_meeting(user, meeting)
    if meeting.presented_kind != "variant":
        raise VideoMeetingError("Вариант сейчас не показан.", status=400)
    payload = meeting.presented_payload or {}
    homework_id = payload.get("homeworkId")
    variant_id = payload.get("variantId")
    if not homework_id or not variant_id:
        raise VideoMeetingError("Вариант не выдан ученикам.", status=400)
    homework = Homework.objects.filter(pk=homework_id).first()
    if homework is None:
        raise VideoMeetingError("Работа не найдена.", status=404)
    return set_locked_live_score(
        homework=homework,
        variant_id=variant_id,
        allowed_student_ids={s.id for s in list_event_students(meeting.schedule_event)},
        user=user,
        student_id=student_id,
        task_id=task_id,
        score=score,
    )


def set_locked_live_score(*, homework, variant_id, allowed_student_ids, user, student_id, task_id, score) -> dict:
    """r125: общий для урока и «Решать вариант» одноразовый балл второй части."""
    try:
        student_id = int(student_id)
        task_id = int(task_id)
    except (TypeError, ValueError):
        raise VideoMeetingError("Неверный ученик или задание.", status=400)
    if student_id not in set(allowed_student_ids):
        raise VideoMeetingError("Ученик не участвует в этой работе.", status=400)
    task = next((t for t in grading_tasks(variant_id) if t["id"] == task_id), None)
    if task is None:
        raise VideoMeetingError("Задание не входит в вариант.", status=400)
    if task["part"] != 2:
        raise VideoMeetingError("Балл вручную ставится только за вторую часть.", status=400)
    max_score = int(task["maxScore"])
    raw_score = str(score).strip() if isinstance(score, (int, str)) and not isinstance(score, bool) else ""
    if not raw_score.isdigit():
        raise VideoMeetingError(f"Балл должен быть целым числом от 0 до {max_score}.", status=400)
    value = int(raw_score)
    if value < 0 or value > max_score:
        raise VideoMeetingError(f"Балл должен быть от 0 до {max_score}.", status=400)

    from .homework_api import assign_submission_score, store_variant_scoring

    with transaction.atomic():
        submission = (
            HomeworkSubmission.objects.select_for_update()
            .filter(homework=homework, student_id=student_id)
            .order_by("-updated_at", "-id")
            .first()
        )
        if submission is None:
            raise VideoMeetingError("Ученик ещё не начал вариант.", status=400)
        result = dict(submission.result_payload) if isinstance(submission.result_payload, dict) else {}
        locks = dict(locked_scores(result))
        key = str(task_id)
        if key in locks:
            raise VideoMeetingError("Балл уже сохранён и не может быть изменён.", status=409)
        locks[key] = {
            "score": value,
            "max": max_score,
            "at": timezone.now().isoformat(),
            "by": getattr(user, "pk", None),
        }
        result[LOCK_KEY] = locks
        result = reapply_locked_scores(result)
        previous = submission.result_payload if isinstance(submission.result_payload, dict) else {}
        result = store_variant_scoring(
            result,
            homework,
            previous_snapshot=previous.get("tasks_snapshot") if isinstance(previous.get("tasks_snapshot"), list) else None,
            previous_grading=previous.get("grading_snapshot") if isinstance(previous.get("grading_snapshot"), list) else None,
        )
        submission.result_payload = result
        assign_submission_score(submission, result)
        submission.save(update_fields=["result_payload", "score", "updated_at"])
    score_out = submission.score
    try:
        score_out = float(score_out) if score_out is not None else None
    except (TypeError, ValueError):
        score_out = None
    return {
        "ok": True,
        "studentId": student_id,
        "taskId": task_id,
        "score": value,
        "maxScore": max_score,
        "lockedScores": locks,
        "total": score_out,
    }
