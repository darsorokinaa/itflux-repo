"""Результаты всех вариантов одного урока для журнала.

Источник — уже выданные на этом занятии live-варианты (Homework с меткой
``live-meeting:<event>:variant:<id>`` и сдача этого ученика). Отдельная
таблица не заводится: журнал только читает существующие сдачи и попытки.

Непроверенный и незавершённый вариант не получает балл 0. Чужие ученики,
другие уроки, обычные ДЗ и «решать вариант» вне урока сюда не попадают.
"""

from __future__ import annotations

import re

from .choices import CommentVisibility
from .journal_models import AttendanceStatus
from .homework_api import LIVE_MEETING_HOMEWORK_MARKER

_LESSON_VARIANT_RE = re.compile(r"live-meeting:(\d+):variant:(\d+)")

_STATUS_LABELS = {
    "checked": "Проверено",
    "pending_review": "Ждёт проверки",
    "in_progress": "Не завершён",
    "issued": "Выдан",
}

_ATTENDANCE_PARENT = {
    AttendanceStatus.PRESENT: "Был(а) на занятии.",
    AttendanceStatus.LATE: "Немного опоздал(а).",
    AttendanceStatus.LEFT_EARLY: "Ушёл(а) чуть раньше.",
    AttendanceStatus.PARTIAL: "Был(а) часть занятия.",
    AttendanceStatus.ABSENT_EXCUSED: "Не было на занятии, причина уважительная.",
    AttendanceStatus.ABSENT_UNEXCUSED: "Не было на занятии.",
    AttendanceStatus.CANCELLED_BY_STUDENT: "Занятие не состоялось.",
    AttendanceStatus.CANCELLED_BY_TEACHER: "Занятие перенесено или не состоялось.",
    AttendanceStatus.TECHNICAL_ISSUE: "Занятие не состоялось по технической причине.",
}


def lesson_variant_marker(event_id) -> str:
    return f"{LIVE_MEETING_HOMEWORK_MARKER}{event_id}:variant:"


def lesson_variant_id_from_description(description: str, event_id) -> int | None:
    """Номер варианта, выданного именно на этом уроке. Сессии вне урока не подходят."""
    if not description or event_id is None:
        return None
    wanted = str(event_id)
    for match in _LESSON_VARIANT_RE.finditer(description):
        if match.group(1) == wanted:
            try:
                return int(match.group(2))
            except (TypeError, ValueError):
                return None
    return None


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _scoring_of(submission) -> dict:
    raw = submission.result_payload if submission and isinstance(submission.result_payload, dict) else {}
    scoring = raw.get("scoring") if isinstance(raw.get("scoring"), dict) else None
    return scoring or {}


def _has_student_answers(submission) -> bool:
    raw = submission.result_payload if submission and isinstance(submission.result_payload, dict) else {}
    if not isinstance(raw, dict):
        return False
    for key in ("by_task_id", "byTaskId", "by_number", "byNumber"):
        bucket = raw.get(key)
        if isinstance(bucket, dict) and any(str(value or "").strip() for value in bucket.values()):
            return True
    return False


def _status_and_score(submission, tasks: list[dict]) -> dict:
    """Итог только по завершённой проверке. Черновик и ожидание — без балла."""
    scoring = _scoring_of(submission)
    pending = int(scoring.get("pending_review_count") or 0)
    review = scoring.get("review_status")
    checked_count = sum(1 for row in tasks if isinstance(row, dict) and row.get("ok") is not None)
    correct_count = sum(1 for row in tasks if isinstance(row, dict) and row.get("ok") is True)
    final = review == "final" and pending == 0
    has_answers = _has_student_answers(submission)

    if scoring and not final:
        if pending or review in {"pending", "pending_review"}:
            status = "pending_review"
        elif has_answers or (submission and submission.submitted_at):
            status = "in_progress"
        else:
            status = "issued"
        return {
            "status": status,
            "status_label": _STATUS_LABELS[status],
            "score_percent": None,
            "earned_points": None,
            "max_points": None,
            "checked_count": checked_count or None,
            "correct_count": correct_count if checked_count else None,
        }

    if final and scoring.get("percentage") is not None:
        return {
            "status": "checked",
            "status_label": _STATUS_LABELS["checked"],
            "score_percent": _num(scoring.get("percentage")),
            "earned_points": _num(scoring.get("earned_points")),
            "max_points": _num(scoring.get("max_points")),
            "checked_count": scoring.get("checked_count") if scoring.get("checked_count") is not None else (checked_count or None),
            "correct_count": scoring.get("correct_count") if scoring.get("correct_count") is not None else (correct_count if checked_count else None),
        }

    if checked_count:
        return {
            "status": "checked",
            "status_label": _STATUS_LABELS["checked"],
            "score_percent": round(correct_count * 100 / checked_count, 2),
            "earned_points": None,
            "max_points": None,
            "checked_count": checked_count,
            "correct_count": correct_count,
        }

    status = "in_progress" if has_answers or (submission and submission.submitted_at) else "issued"
    return {
        "status": status,
        "status_label": _STATUS_LABELS[status],
        "score_percent": None,
        "earned_points": None,
        "max_points": None,
        "checked_count": None,
        "correct_count": None,
    }


def _variant_titles(variant_ids: list[int]) -> dict[int, str]:
    if not variant_ids:
        return {}
    try:
        from Generator.models import Variant
    except Exception:
        try:
            from Generator.Generator.models import Variant
        except Exception:
            return {}
    from .my_variants import variant_display_title

    rows = Variant.objects.filter(pk__in=variant_ids).values_list("id", "title")
    return {vid: variant_display_title(vid, title or "") for vid, title in rows}


def _student_tasks(tasks: list[dict]) -> list[dict]:
    safe = []
    for task in tasks or []:
        if not isinstance(task, dict):
            continue
        row = {
            "id": task.get("id"),
            "number": task.get("number"),
            "student_answer": task.get("student_answer") or "",
            "ok": task.get("ok"),
        }
        if task.get("variant_id"):
            row["variant_id"] = task.get("variant_id")
        safe.append(row)
    return safe


def _attempts_for(submission, *, for_student: bool) -> list[dict]:
    if submission is None:
        return []
    from .homework_attempts import serialize_attempts

    rows = []
    for attempt in serialize_attempts(submission):
        item = {
            "id": attempt.get("id"),
            "attempt_number": attempt.get("attempt_number"),
            "status": attempt.get("status"),
            "status_label": attempt.get("status_label"),
            "score": attempt.get("score") if attempt.get("is_final") else (
                attempt.get("score") if attempt.get("status") == "checked" else None
            ),
            "submitted_at": attempt.get("submitted_at"),
            "checked_at": attempt.get("checked_at"),
            "is_final": attempt.get("is_final"),
        }
        if not for_student:
            item["teacher_comment"] = attempt.get("teacher_comment") or ""
        elif attempt.get("teacher_comment"):
            item["teacher_comment"] = attempt.get("teacher_comment") or ""
        rows.append(item)
    return rows


def _public_variant(
    *,
    homework,
    variant_id,
    title: str,
    submission,
    tasks: list[dict],
    for_student: bool,
) -> dict:
    facts = _status_and_score(submission, tasks)
    visible_tasks = _student_tasks(tasks) if for_student else list(tasks or [])
    number = variant_id
    return {
        "homework_id": homework.id if homework is not None else None,
        "variant_id": variant_id,
        "variant_number": number,
        "title": title,
        "status": facts["status"],
        "status_label": facts["status_label"],
        "score_percent": facts["score_percent"],
        "earned_points": facts["earned_points"],
        "max_points": facts["max_points"],
        "checked_count": facts["checked_count"],
        "correct_count": facts["correct_count"],
        "tasks": visible_tasks,
        "attempts": _attempts_for(submission, for_student=for_student),
        "attempt_count": (
            submission.attempt_count
            if submission is not None and submission.attempt_count
            else None
        ),
        "submitted_at": (
            submission.submitted_at.isoformat()
            if submission is not None and submission.submitted_at
            else None
        ),
        "is_overdue": False,
        "submitted_late": False,
    }


def _title_for(variant_id, homework, titles: dict[int, str]) -> str:
    if variant_id and titles.get(variant_id):
        return titles[variant_id]
    if homework is not None and (homework.title or "").strip():
        return homework.title.strip()
    if variant_id:
        return f"Вариант №{variant_id}"
    return "Вариант на уроке"


def _task_answer_key(variant_id, cache: dict):
    if variant_id not in cache:
        from .meeting_present import _variant_tasks_answer_key

        cache[variant_id] = _variant_tasks_answer_key(variant_id)
    return cache[variant_id]


def _live_rows_for_student(
    homeworks,
    submissions_by_hw: dict,
    *,
    titles: dict[int, str],
    event_id,
    for_student: bool,
    task_keys: dict | None = None,
) -> list[dict]:
    keys = task_keys if task_keys is not None else {}
    rows = []
    for homework in homeworks:
        variant_id = lesson_variant_id_from_description(homework.description or "", event_id)
        if not variant_id:
            continue
        submission = submissions_by_hw.get(homework.id)
        from .journal_service import build_variant_result_payload

        tasks_key = _task_answer_key(variant_id, keys)
        built = build_variant_result_payload(
            homework=homework,
            submission=submission,
            tasks=tasks_key,
            title=_title_for(variant_id, homework, titles),
            variant_id=variant_id,
        )
        tasks = built.get("tasks") if isinstance(built.get("tasks"), list) else []
        rows.append(
            _public_variant(
                homework=homework,
                variant_id=variant_id,
                title=_title_for(variant_id, homework, titles),
                submission=submission,
                tasks=tasks,
                for_student=for_student,
            )
        )
    return rows


def lesson_variant_homeworks(event_id, teacher):
    from .models import Homework

    if not event_id or teacher is None:
        return []
    marker = lesson_variant_marker(event_id)
    return list(
        Homework.objects.filter(teacher=teacher, description__contains=marker)
        .prefetch_related("tasks")
        .order_by("id")
    )


def _submissions_for(homeworks, student_ids: list[int]) -> dict[tuple[int, int], object]:
    from .models import HomeworkSubmission

    if not homeworks or not student_ids:
        return {}
    found: dict[tuple[int, int], object] = {}
    qs = (
        HomeworkSubmission.objects.filter(
            homework_id__in=[hw.id for hw in homeworks],
            student_id__in=student_ids,
        )
        .prefetch_related("attempts")
        .order_by("homework_id", "student_id", "-updated_at", "-id")
    )
    for submission in qs:
        found.setdefault((submission.homework_id, submission.student_id), submission)
    return found


def _normalize_stored(item: dict, *, for_student: bool) -> dict | None:
    if not isinstance(item, dict):
        return None
    from .journal_service import _refresh_variant_result_verdicts

    refreshed = _refresh_variant_result_verdicts(item) or item
    tasks = refreshed.get("tasks") if isinstance(refreshed.get("tasks"), list) else []
    variant_id = refreshed.get("variant_id") or refreshed.get("variantId")
    try:
        variant_id = int(variant_id) if variant_id not in (None, "") else None
    except (TypeError, ValueError):
        variant_id = None
    status = refreshed.get("status") if refreshed.get("status") in _STATUS_LABELS else ""
    checked_count = refreshed.get("checked_count")
    if checked_count is None:
        checked_count = sum(1 for row in tasks if isinstance(row, dict) and row.get("ok") is not None)
    score = _num(refreshed.get("score_percent"))
    if not status:
        status = "checked" if checked_count else ("in_progress" if tasks else "issued")
    if status != "checked":
        score = None
    elif not checked_count and score == 0:
        score = None
        status = "in_progress"
    title = (refreshed.get("title") or "").strip()
    if not title and not variant_id and not tasks and score is None:
        return None
    if not title:
        title = f"Вариант №{variant_id}" if variant_id else "Вариант на уроке"
    visible_tasks = _student_tasks(tasks) if for_student else [row for row in tasks if isinstance(row, dict)]
    return {
        "homework_id": refreshed.get("homework_id") or refreshed.get("homeworkId"),
        "variant_id": variant_id,
        "variant_number": variant_id,
        "title": title,
        "status": status,
        "status_label": refreshed.get("status_label") or _STATUS_LABELS.get(status, status),
        "score_percent": score,
        "earned_points": _num(refreshed.get("earned_points")) if status == "checked" else None,
        "max_points": _num(refreshed.get("max_points")) if status == "checked" else None,
        "checked_count": checked_count or None,
        "correct_count": (
            refreshed.get("correct_count")
            if status == "checked" and refreshed.get("correct_count") is not None
            else (sum(1 for row in tasks if isinstance(row, dict) and row.get("ok") is True) if status == "checked" and checked_count else None)
        ),
        "tasks": visible_tasks,
        "attempts": [
            attempt for attempt in (refreshed.get("attempts") or []) if isinstance(attempt, dict)
        ] if not for_student else [
            {
                "id": attempt.get("id"),
                "attempt_number": attempt.get("attempt_number"),
                "status": attempt.get("status"),
                "status_label": attempt.get("status_label"),
                "score": attempt.get("score"),
                "submitted_at": attempt.get("submitted_at"),
                "is_final": attempt.get("is_final"),
                "teacher_comment": attempt.get("teacher_comment") or "",
            }
            for attempt in (refreshed.get("attempts") or [])
            if isinstance(attempt, dict)
        ],
        "attempt_count": refreshed.get("attempt_count"),
        "submitted_at": refreshed.get("submitted_at"),
        "is_overdue": False,
        "submitted_late": False,
        "from_snapshot": True,
    }


def _stored_variants(raw, *, for_student: bool) -> list[dict]:
    if not isinstance(raw, dict) or not raw:
        return []
    nested = raw.get("lesson_variants")
    if isinstance(nested, list) and nested:
        source = nested
    else:
        source = [raw]
    out = []
    for item in source:
        normalized = _normalize_stored(item, for_student=for_student)
        if normalized:
            out.append(normalized)
    return out


def _merge(live: list[dict], stored: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for item in live:
        key = item.get("variant_id") or f"hw-{item.get('homework_id')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    for item in stored:
        key = item.get("variant_id") or f"hw-{item.get('homework_id')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def load_lesson_variant_results(journal, students, *, for_student: bool = False) -> dict[int, list[dict]]:
    """Варианты урока по каждому ученику. Ключ — id ученика, не общий список группы."""
    student_list = [student for student in students if student is not None]
    if journal is None or not student_list:
        return {}
    event_id = journal.schedule_event_id
    homeworks = lesson_variant_homeworks(event_id, journal.teacher) if event_id else []
    variant_ids = []
    for homework in homeworks:
        vid = lesson_variant_id_from_description(homework.description or "", event_id)
        if vid and vid not in variant_ids:
            variant_ids.append(vid)
    titles = _variant_titles(variant_ids)
    student_ids = [student.id for student in student_list]
    submissions = _submissions_for(homeworks, student_ids)
    task_keys: dict = {}
    by_student_records = {
        record.student_id: record
        for record in journal.student_records.all()
        if record.student_id in student_ids
    }
    out = {}
    for student in student_list:
        own = {
            homework_id: submission
            for (homework_id, student_id), submission in submissions.items()
            if student_id == student.id
        }
        live = _live_rows_for_student(
            homeworks,
            own,
            titles=titles,
            event_id=event_id,
            for_student=for_student,
            task_keys=task_keys,
        )
        record = by_student_records.get(student.id)
        stored = _stored_variants(getattr(record, "variant_result", None), for_student=for_student) if record else []
        out[student.id] = _merge(live, stored)
    return out


def lesson_variant_results_for_record(record, *, for_student: bool = False) -> list[dict]:
    if record is None:
        return []
    mapped = load_lesson_variant_results(record.journal, [record.student], for_student=for_student)
    return mapped.get(record.student_id, [])


def snapshot_variants_for_storage(variants: list[dict]) -> dict | None:
    """Плоский снимок для старого поля variant_result и полный список рядом."""
    clean = []
    for item in variants or []:
        if not isinstance(item, dict):
            continue
        row = {key: value for key, value in item.items() if key != "lesson_variants"}
        clean.append(row)
    if not clean:
        return None
    primary = next(
        (item for item in reversed(clean) if item.get("status") == "checked" and item.get("score_percent") is not None),
        clean[-1],
    )
    stored = {key: value for key, value in primary.items() if key != "lesson_variants"}
    stored["lesson_variants"] = clean
    stored["variantId"] = primary.get("variant_id")
    stored["homeworkId"] = primary.get("homework_id")
    return stored


def countable_score(variant: dict | None):
    if not isinstance(variant, dict):
        return None
    if variant.get("status") != "checked":
        return None
    return _num(variant.get("score_percent"))


def _format_score_line(variant: dict) -> str:
    title = variant.get("title") or "Вариант"
    if variant.get("status") == "checked" and variant.get("score_percent") is not None:
        score = _num(variant.get("score_percent"))
        score_text = f"{score:g}%" if score is not None else ""
        points = ""
        if variant.get("earned_points") is not None and variant.get("max_points"):
            points = f"{_num(variant.get('earned_points')):g} из {_num(variant.get('max_points')):g}, "
        elif variant.get("correct_count") is not None and variant.get("checked_count"):
            points = f"{variant.get('correct_count')}/{variant.get('checked_count')}, "
        return f"• {title} — проверено, {points}{score_text}".rstrip(", ")
    label = variant.get("status_label") or "без итога"
    return f"• {title} — {label}, балл не выставлен"


def build_lesson_parent_report(record, variants: list[dict]) -> dict:
    """Текст, который учитель копирует или скачивает сам. Никуда не отправляется."""
    from .telegram_cabinet import _teacher_name
    from .telegram_connect import platform_path_url

    student = record.student
    journal = record.journal
    roster_name = f"{student.first_name or ''} {student.last_name or ''}".strip()
    name = roster_name or student.full_name or student.first_name or "ученик"
    topic = (journal.actual_topic or journal.planned_topic or "занятие").strip() or "занятие"
    when = journal.lesson_date.strftime("%d.%m") if journal.lesson_date else ""
    lines = [
        "Здравствуйте!",
        "",
        f"Короткая сводка по занятию ({name}).",
        "",
        f"{when} — «{topic}»".strip(),
    ]
    attendance = _ATTENDANCE_PARENT.get(record.attendance_status)
    if attendance:
        lines.append(attendance)
    if record.overall_score is not None:
        score = str(record.overall_score).rstrip("0").rstrip(".")
        lines.append(f"Оценка за занятие: {score}.")
    lines.append("")
    if variants:
        lines.append("Варианты на уроке:")
        for variant in variants:
            lines.append(_format_score_line(variant))
    else:
        lines.append("На этом занятии варианты не выдавались.")
    recommendation = (record.recommendation or "").strip()
    if recommendation:
        lines.extend(["", f"Рекомендация: {recommendation}"])
    comment = (record.teacher_comment or "").strip()
    if comment and record.comment_visibility == CommentVisibility.STUDENT_AND_PARENT:
        lines.extend(["", comment])
    teacher_name = _teacher_name(journal.teacher)
    if teacher_name:
        lines.extend(["", f"— {teacher_name}"])
    lines.extend(["", f"Кабинет: {platform_path_url('/cabinet/student/results')}"])
    text = "\n".join(lines).strip() + "\n"
    date_bit = journal.lesson_date.isoformat() if journal.lesson_date else "urok"
    return {
        "text": text,
        "filename": f"otchet-roditelyu-{date_bit}.txt",
        "delivery": "manual",
    }
