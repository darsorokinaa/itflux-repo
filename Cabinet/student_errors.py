"""Банк ошибок ученика: агрегация задач с ошибками и выдача работы над ошибками как ДЗ."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Optional

from django.db import transaction
from django.db.models import Prefetch
from django.utils import timezone

from .choices import HomeworkStatus, HomeworkTaskType, ReviewSourceType
from .homework_api import (
    build_homework_review_context,
    ensure_homework_in_review_queue,
)
from .homework_from_review import (
    HomeworkFromReviewError,
    _create_variant_from_task_ids,
    _parse_due_at,
    get_failed_generator_tasks,
    notify_students_homework_assigned,
    student_answer_matches_expected,
)
from .models import Homework, HomeworkSubmission, HomeworkTask, ReviewItem, Student
from .student_release import _record_variant_tasks_for_homework, suggest_homework_due_at


def _subject_label(subject_short: str) -> str:
    if not subject_short:
        return "Без предмета"
    try:
        from Generator.models import Subject
    except Exception:
        try:
            from Generator.Generator.models import Subject
        except Exception:
            return subject_short
    row = Subject.objects.filter(subject_short__iexact=subject_short).first()
    if row and getattr(row, "subject_name", None):
        return row.subject_name
    return subject_short


def _level_label(level: str) -> str:
    key = (level or "").strip().lower()
    mapping = {
        "ege": "ЕГЭ",
        "oge": "ОГЭ",
        "base": "База",
        "prof": "Профиль",
    }
    return mapping.get(key, level or "")


def _answer_value(raw) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict) and "text" in raw:
        return str(raw.get("text") or "")
    return str(raw)


def _attachment_list(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        filename = str(item.get("filename") or url.rsplit("/", 1)[-1] or "Файл")
        out.append(
            {
                "url": url,
                "filename": filename,
                "uploaded_at": item.get("uploaded_at"),
            }
        )
    return out


def _payload_by_task_or_number(
    by_id: dict,
    by_num: dict,
    *,
    task_id: str,
    number,
    number_unique: bool,
):
    """Как в cabinetReviewUtils: сначала task_id, потом номер если уникален."""
    tid = str(task_id)
    if isinstance(by_id, dict) and tid in by_id:
        value = by_id[tid]
        if isinstance(value, list):
            return value
        if str(value or "").strip() != "":
            return value
    if not number_unique or number is None:
        return None
    if not isinstance(by_num, dict):
        return None
    keys = [str(number)]
    try:
        keys.append(str(int(number)))
    except (TypeError, ValueError):
        pass
    for key in keys:
        if key in by_num:
            return by_num[key]
    return None


def _file_url(field) -> str:
    if not field:
        return ""
    try:
        url = field.url
    except Exception:
        return ""
    return str(url or "")


def _load_generator_tasks(task_ids: list[int]) -> dict[int, Any]:
    if not task_ids:
        return {}
    try:
        from Generator.models import Task
    except Exception:
        try:
            from Generator.Generator.models import Task
        except Exception:
            return {}
    qs = Task.objects.filter(id__in=task_ids).select_related("task", "subtopic")
    return {t.id: t for t in qs}


def _process_condition_html(raw: str) -> str:
    text = str(raw or "")
    if not text.strip():
        return ""
    try:
        from Generator.latex_utils import process_latex
    except Exception:
        try:
            from Generator.Generator.latex_utils import process_latex
        except Exception:
            return text
    try:
        return process_latex(text, for_browser=True)
    except Exception:
        return text


def _enrich_error_row(
    *,
    row: dict,
    submission: HomeworkSubmission,
    number_counts: dict[str, int],
    generator_tasks: dict[int, Any],
    variant_id,
    variant_path: str,
) -> dict:
    """Добавить условие, ответ ученика, файлы и комментарии учителя."""
    payload = submission.result_payload if isinstance(submission.result_payload, dict) else {}
    task_id = str(row.get("task_id") or "")
    number = row.get("number")
    num_key = str(number) if number is not None else ""
    number_unique = bool(num_key) and number_counts.get(num_key, 0) <= 1

    by_task_id = payload.get("by_task_id") or payload.get("byTaskId") or {}
    by_number = payload.get("by_number") or payload.get("byNumber") or {}
    comments_by_id = payload.get("comments_by_task_id") or payload.get("commentsByTaskId") or {}
    comments_by_num = payload.get("comments_by_number") or payload.get("commentsByNumber") or {}
    attachments_by_id = payload.get("attachments_by_task_id") or payload.get("attachmentsByTaskId") or {}
    attachments_by_num = payload.get("attachments_by_number") or payload.get("attachmentsByNumber") or {}
    teacher_att_by_id = (
        payload.get("teacher_attachments_by_task_id")
        or payload.get("teacherAttachmentsByTaskId")
        or {}
    )
    teacher_att_by_num = (
        payload.get("teacher_attachments_by_number")
        or payload.get("teacherAttachmentsByNumber")
        or {}
    )

    student_answer = _answer_value(
        _payload_by_task_or_number(
            by_task_id,
            by_number,
            task_id=task_id,
            number=number,
            number_unique=number_unique,
        )
    )
    # Legacy: by_task_id keyed by bank number
    if not student_answer.strip() and number_unique and num_key and num_key != task_id:
        student_answer = _answer_value(by_task_id.get(num_key))

    task_comment = str(
        _payload_by_task_or_number(
            comments_by_id,
            comments_by_num,
            task_id=task_id,
            number=number,
            number_unique=number_unique,
        )
        or ""
    ).strip()

    attachments = _attachment_list(
        _payload_by_task_or_number(
            attachments_by_id,
            attachments_by_num,
            task_id=task_id,
            number=number,
            number_unique=number_unique,
        )
    )
    teacher_attachments = _attachment_list(
        _payload_by_task_or_number(
            teacher_att_by_id,
            teacher_att_by_num,
            task_id=task_id,
            number=number,
            number_unique=number_unique,
        )
    )

    overall_comment = (
        (submission.teacher_comment or "").strip()
        or str(payload.get("teacher_comment") or payload.get("review_comment") or "").strip()
    )

    gen_pk = None
    try:
        gen_pk = int(row.get("id") or task_id)
    except (TypeError, ValueError):
        gen_pk = None
    gen_task = generator_tasks.get(gen_pk) if gen_pk is not None else None

    condition_html = ""
    condition_file_url = ""
    author = ""
    correct_answer_html = ""
    subtopic_id = None
    subtopic_title = ""
    if gen_task is not None:
        condition_html = _process_condition_html(getattr(gen_task, "task_template", "") or "")
        condition_file_url = _file_url(getattr(gen_task, "files", None))
        author = str(getattr(gen_task, "author", "") or "")
        correct_raw = str(getattr(gen_task, "answer", "") or "")
        if correct_raw.strip():
            correct_answer_html = _process_condition_html(correct_raw)
        st = getattr(gen_task, "subtopic", None)
        if st is not None:
            subtopic_id = getattr(st, "id", None) or getattr(gen_task, "subtopic_id", None)
            subtopic_title = str(getattr(st, "title", "") or "").strip()
        elif getattr(gen_task, "subtopic_id", None):
            subtopic_id = gen_task.subtopic_id

    return {
        **row,
        "variant_id": variant_id,
        "variant_path": variant_path or "",
        "condition_html": condition_html,
        "condition_file_url": condition_file_url or None,
        "author": author or None,
        "student_answer": student_answer,
        "correct_answer_html": correct_answer_html or None,
        "attachments": attachments,
        "teacher_attachments": teacher_attachments,
        "task_comment": task_comment,
        "teacher_comment": overall_comment,
        "subtopic_id": subtopic_id,
        "subtopic_title": subtopic_title or None,
    }


def collect_student_errors(
    *,
    teacher,
    student: Student,
    include_partial: bool = True,
    include_details: bool = True,
) -> dict[str, Any]:
    """
    Задачи с ошибками по всем сданным ДЗ ученика у этого учителя.
    Группировка: предмет (+ уровень). Дубликаты task_id внутри последнего случая.

    include_details=False — лёгкий ответ только со счётчиками (для бейджа вкладки).
    """
    if student.teacher_id != teacher.id:
        raise HomeworkFromReviewError("Ученик не принадлежит этому учителю.", "FORBIDDEN", 403)

    submissions = list(
        HomeworkSubmission.objects.filter(
            student=student,
            homework__teacher=teacher,
        )
        .exclude(result_payload={})
        .exclude(result_payload__isnull=True)
        .select_related("homework", "homework__student_subject")
        .prefetch_related(
            Prefetch(
                "homework__tasks",
                queryset=HomeworkTask.objects.filter(is_active=True).order_by("order", "id"),
            )
        )
        .order_by("-submitted_at", "-id")
    )

    submission_ids = [s.id for s in submissions]
    review_by_submission = {
        r.source_id: r.id
        for r in ReviewItem.objects.filter(
            teacher=teacher,
            source_type=ReviewSourceType.HOMEWORK,
            source_id__in=submission_ids,
        ).only("id", "source_id")
    }

    # key: (subject, level, task_id) → row (newest first wins)
    by_task: dict[tuple[str, str, str], dict] = {}
    pending_ids: list[int] = []

    for submission in submissions:
        homework = submission.homework
        ctx = build_homework_review_context(homework)
        subject = (ctx.get("subject") or "").strip()
        level = (ctx.get("level") or "").strip()
        if not subject:
            continue

        failed = get_failed_generator_tasks(
            submission=submission,
            level=level,
            subject=subject,
            variant_id=ctx.get("variant_id"),
            include_partial=include_partial,
        )
        number_counts: dict[str, int] = {}
        for row in failed:
            nk = str(row.get("number")) if row.get("number") is not None else ""
            if nk:
                number_counts[nk] = number_counts.get(nk, 0) + 1

        occurred_at = submission.submitted_at or submission.updated_at or homework.updated_at
        for row in failed:
            task_id = str(row.get("task_id") or "")
            if not task_id:
                continue
            key = (subject, level, task_id)
            if key in by_task:
                continue
            try:
                pending_ids.append(int(row.get("id") or task_id))
            except (TypeError, ValueError):
                pass
            base = {
                "task_id": task_id,
                "id": row.get("id"),
                "number": row.get("number"),
                "title": row.get("title") or f"Задание {task_id}",
                "status": row.get("status"),
                "score": row.get("score"),
                "max_score": row.get("max_score"),
                "part_id": row.get("part_id"),
                "subject": subject,
                "level": level,
                "source_homework_id": homework.id,
                "source_homework_title": homework.title,
                "submission_id": submission.id,
                "review_id": review_by_submission.get(submission.id),
                "occurred_at": occurred_at.isoformat() if occurred_at else None,
            }
            if include_details:
                base["_submission"] = submission
                base["_number_counts"] = number_counts
                base["_variant_id"] = ctx.get("variant_id")
                base["_variant_path"] = ctx.get("variant_path") or ""
            by_task[key] = base

    if include_details:
        generator_tasks = _load_generator_tasks(list(dict.fromkeys(pending_ids)))
        for key, row in list(by_task.items()):
            submission = row.pop("_submission", None)
            number_counts = row.pop("_number_counts", {}) or {}
            variant_id = row.pop("_variant_id", None)
            variant_path = row.pop("_variant_path", "") or ""
            if submission is None:
                continue
            enriched = _enrich_error_row(
                row=row,
                submission=submission,
                number_counts=number_counts,
                generator_tasks=generator_tasks,
                variant_id=variant_id,
                variant_path=variant_path,
            )
            # Эталон в таблице — Task.answer. Если он совпадает с ответом ученика,
            # не держим строку в журнале ошибок из‑за stale checked=false.
            if enriched.get("status") == "incorrect":
                gen_pk = None
                try:
                    gen_pk = int(enriched.get("id") or enriched.get("task_id") or 0)
                except (TypeError, ValueError):
                    gen_pk = None
                gen_task = generator_tasks.get(gen_pk) if gen_pk else None
                expected = str(getattr(gen_task, "answer", "") or "") if gen_task is not None else ""
                if student_answer_matches_expected(
                    enriched.get("student_answer"),
                    expected,
                    subject=enriched.get("subject") or "",
                ):
                    del by_task[key]
                    continue
            by_task[key] = enriched

    groups_map: dict[tuple[str, str], list[dict]] = {}
    for (subject, level, _tid), row in by_task.items():
        groups_map.setdefault((subject, level), []).append(row)

    subjects = []
    for (subject, level), tasks in sorted(
        groups_map.items(),
        key=lambda item: (_subject_label(item[0][0]).lower(), item[0][1], item[0][0]),
    ):
        tasks.sort(
            key=lambda t: (
                t.get("number") is None,
                t.get("number") or 0,
                str(t.get("task_id")),
            )
        )
        if include_details:
            subjects.append(
                {
                    "subject": subject,
                    "subject_label": _subject_label(subject),
                    "level": level,
                    "level_label": _level_label(level),
                    "tasks_count": len(tasks),
                    "tasks": tasks,
                }
            )
        else:
            subjects.append(
                {
                    "subject": subject,
                    "subject_label": _subject_label(subject),
                    "level": level,
                    "level_label": _level_label(level),
                    "tasks_count": len(tasks),
                }
            )

    total_errors = sum(g["tasks_count"] for g in subjects)
    result = {
        "student": {
            "id": student.id,
            "full_name": student.full_name,
        },
        "subjects": subjects,
        "total_errors": total_errors,
    }
    if not include_details:
        return result

    suggested = suggest_homework_due_at(teacher=teacher, student=student, subject=None)
    if not suggested:
        suggested = timezone.now() + timedelta(days=7)

    result.update(
        {
            "suggested_due_at": suggested.isoformat() if suggested else None,
            "default_title": "Работа над ошибками",
            "default_description": "Задания для отработки ошибок.",
        }
    )
    return result


@transaction.atomic
def create_homework_from_student_errors(
    *,
    teacher,
    student: Student,
    generator_task_ids: Optional[list] = None,
    selected_tasks: Optional[list] = None,
    title: str = "",
    description: str = "",
    due_at=None,
    mode: str = "assign",
    comment: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """
    Создать ДЗ из выбранных ошибочных задач.
    Если задачи из разных предметов/уровней — отдельное ДЗ на каждую группу.
    """
    if student.teacher_id != teacher.id:
        raise HomeworkFromReviewError("Ученик не принадлежит этому учителю.", "FORBIDDEN", 403)

    bank = collect_student_errors(teacher=teacher, student=student, include_partial=True)
    bank_index: dict[str, dict] = {}
    for group in bank["subjects"]:
        for task in group["tasks"]:
            # уникальный ключ: subject|level|task_id
            bank_index[f"{group['subject']}|{group['level']}|{task['task_id']}"] = {
                **task,
                "subject": group["subject"],
                "level": group["level"],
            }
            # также по одному task_id, если нет коллизий
            bank_index.setdefault(str(task["task_id"]), {
                **task,
                "subject": group["subject"],
                "level": group["level"],
            })

    resolved: list[dict] = []
    seen_task_keys: set[str] = set()

    if selected_tasks:
        for item in selected_tasks:
            if not isinstance(item, dict):
                continue
            subject = str(item.get("subject") or "").strip()
            level = str(item.get("level") or "").strip()
            tid = str(item.get("task_id") or item.get("id") or "").strip()
            if not tid:
                continue
            key = f"{subject}|{level}|{tid}" if subject else tid
            row = bank_index.get(key) or bank_index.get(tid)
            if not row:
                continue
            full_key = f"{row['subject']}|{row['level']}|{row['task_id']}"
            if full_key in seen_task_keys:
                continue
            seen_task_keys.add(full_key)
            resolved.append(row)
    elif generator_task_ids:
        for tid in generator_task_ids:
            key = str(tid)
            row = bank_index.get(key)
            if not row:
                continue
            full_key = f"{row['subject']}|{row['level']}|{row['task_id']}"
            if full_key in seen_task_keys:
                continue
            seen_task_keys.add(full_key)
            resolved.append(row)

    if not resolved:
        raise HomeworkFromReviewError(
            "Выберите задания с ошибками из банка ученика.",
            "NO_TASKS",
        )

    title = (title or "").strip() or bank.get("default_title") or "Работа над ошибками"
    description = (description or "").strip()
    if comment:
        note = (comment or "").strip()
        if note:
            description = f"{description}\n\n{note}".strip() if description else note

    due = _parse_due_at(due_at)
    if due is not None and due < timezone.now() - timedelta(minutes=1):
        raise HomeworkFromReviewError("Нельзя создать ДЗ со сроком в прошлом.", "DUE_IN_PAST")

    status_value = HomeworkStatus.ASSIGNED if mode != "draft" else HomeworkStatus.DRAFT

    # Группировка по предмету+уровню
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in resolved:
        groups.setdefault((row["subject"], row["level"]), []).append(row)

    key_base = (idempotency_key or "").strip()[:100]
    created_homeworks = []
    total_notified = 0

    for idx, ((subject, level), tasks) in enumerate(groups.items()):
        task_ids = []
        for row in tasks:
            try:
                task_ids.append(int(row["task_id"]))
            except (TypeError, ValueError):
                continue
        task_ids = list(dict.fromkeys(task_ids))
        if not task_ids:
            continue

        source_hw_id = tasks[0].get("source_homework_id")
        source_hw = Homework.objects.filter(pk=source_hw_id, teacher=teacher).first() if source_hw_id else None
        review_id = tasks[0].get("review_id")
        review_item = ReviewItem.objects.filter(pk=review_id, teacher=teacher).first() if review_id else None

        hw_title = title
        if len(groups) > 1:
            label = _subject_label(subject)
            level_lbl = _level_label(level)
            suffix = f"{label}" + (f" ({level_lbl})" if level_lbl else "")
            hw_title = f"{title}: {suffix}"
            if len(hw_title) > 255:
                hw_title = hw_title[:252] + "…"

        key = ""
        if key_base:
            key = f"{key_base}:{subject}:{level}:{idx}"[:128]
            existing = Homework.objects.filter(teacher=teacher, idempotency_key=key).first()
            if existing:
                created_homeworks.append(
                    {
                        "homework": existing,
                        "created": False,
                        "idempotent": True,
                        "subject": subject,
                        "level": level,
                        "tasks_count": existing.tasks.filter(is_active=True).count(),
                    }
                )
                continue

        if not due:
            due_for_hw = suggest_homework_due_at(
                teacher=teacher, student=student, subject=subject or None
            ) or (timezone.now() + timedelta(days=7))
        else:
            due_for_hw = due

        homework = Homework.objects.create(
            teacher=teacher,
            student=student,
            title=hw_title,
            description=description,
            lesson=source_hw.lesson if source_hw else None,
            lesson_plan_item=None,
            student_subject=source_hw.student_subject if source_hw else None,
            group=None,
            due_at=due_for_hw,
            status=status_value,
            source_review_item=review_item,
            source_homework=source_hw,
            created_from_review=True,
            idempotency_key=key or None,
        )

        new_variant_id = _create_variant_from_task_ids(
            level=level, subject=subject, task_ids=task_ids
        )
        variant_url = f"/{level}/{subject}/variant/{new_variant_id}"
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.GENERATED_TASK,
            title="Задания для отработки",
            description=variant_url,
            order=0,
        )
        _record_variant_tasks_for_homework(homework, student, teacher)

        notified = 0
        if status_value == HomeworkStatus.ASSIGNED:
            ensure_homework_in_review_queue(homework, student)
            notified = notify_students_homework_assigned(homework)
        total_notified += notified

        created_homeworks.append(
            {
                "homework": homework,
                "created": True,
                "idempotent": False,
                "subject": subject,
                "level": level,
                "tasks_count": homework.tasks.filter(is_active=True).count(),
                "generator_task_ids": task_ids,
                "notified": notified,
            }
        )

    if not created_homeworks:
        raise HomeworkFromReviewError(
            "Не удалось создать домашнее задание из выбранных задач.",
            "CREATE_FAILED",
        )

    primary = created_homeworks[0]["homework"]
    return {
        "homeworks": created_homeworks,
        "homework": primary,
        "created": any(h.get("created") for h in created_homeworks),
        "idempotent": all(h.get("idempotent") for h in created_homeworks),
        "notified": total_notified,
        "tasks_count": sum(h.get("tasks_count") or 0 for h in created_homeworks),
        "count": len(created_homeworks),
        "message": (
            "Работа над ошибками выдана ученику"
            if status_value == HomeworkStatus.ASSIGNED
            else "Черновик работы над ошибками сохранён"
        ),
    }
