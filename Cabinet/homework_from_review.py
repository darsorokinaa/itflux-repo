"""Создание домашнего задания из вкладки «Проверка» — поверх существующей системы ДЗ."""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .choices import HomeworkStatus, HomeworkTaskType, ReviewSourceType
from .homework_api import (
    build_homework_review_context,
    ensure_homework_in_review_queue,
    extract_variant_id,
)
from .models import Homework, HomeworkSubmission, HomeworkTask, ReviewItem, Student
from .student_release import (
    _add_interactive_homework_task,
    _add_material_homework_task,
    _ensure_interactive_assignment,
    _record_variant_tasks_for_homework,
    suggest_homework_due_at,
)

logger = logging.getLogger(__name__)


class HomeworkFromReviewError(Exception):
    def __init__(self, message: str, code: str = "error", status: int = 400):
        self.message = message
        self.code = code
        self.status = status
        super().__init__(message)


def _parse_due_at(value) -> Optional[timezone.datetime]:
    if value is None or value == "":
        return None
    if hasattr(value, "isoformat"):
        dt = value
    else:
        dt = parse_datetime(str(value).strip())
        if dt is None:
            raise HomeworkFromReviewError("Некорректный срок выполнения.", "INVALID_DUE")
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _submission_for_review(review_item: ReviewItem) -> HomeworkSubmission:
    if review_item.source_type != ReviewSourceType.HOMEWORK:
        raise HomeworkFromReviewError(
            "Создать ДЗ можно только из проверки домашнего задания.",
            "UNSUPPORTED_SOURCE",
        )
    submission = (
        HomeworkSubmission.objects.select_related("homework", "student", "homework__teacher")
        .filter(pk=review_item.source_id)
        .first()
    )
    if not submission:
        raise HomeworkFromReviewError("Работа ученика не найдена.", "NO_SUBMISSION", 404)
    return submission


def _variant_task_meta(level: str, subject: str, variant_id: int) -> dict[str, dict]:
    """id → {number, max_score, title} для заданий варианта."""
    try:
        from Generator.models import VariantContent
    except Exception:
        try:
            from Generator.Generator.models import VariantContent
        except Exception:
            return {}

    meta = {}
    qs = (
        VariantContent.objects.filter(variant_id=variant_id)
        .select_related("task", "task__task")
        .order_by("order")
    )
    for vc in qs:
        task = vc.task
        if not task:
            continue
        tl = getattr(task, "task", None)
        meta[str(task.id)] = {
            "id": task.id,
            "number": getattr(tl, "task_number", None) or vc.order,
            "max_score": float(getattr(tl, "max_score", 1) or 1),
            "title": (getattr(tl, "task_title", None) or f"Задание {vc.order}"),
            "part_id": getattr(tl, "part_id", None),
        }
    return meta


def get_failed_generator_tasks(
    *,
    submission: HomeworkSubmission,
    level: str = "",
    subject: str = "",
    variant_id: Optional[int] = None,
    include_partial: bool = True,
) -> list[dict]:
    """
    Задания с ошибками по сохранённому result_payload.
    Статусы: incorrect | partial | unanswered.
    """
    result = submission.result_payload if isinstance(submission.result_payload, dict) else {}
    checked = result.get("checked") if isinstance(result.get("checked"), dict) else {}
    scores = result.get("scores") if isinstance(result.get("scores"), dict) else {}

    meta = {}
    if variant_id and level and subject:
        meta = _variant_task_meta(level, subject, int(variant_id))

    failed = []
    seen = set()

    for tid, ok in checked.items():
        key = str(tid)
        if key in seen:
            continue
        if ok is False:
            seen.add(key)
            info = meta.get(key) or {"id": int(tid) if str(tid).isdigit() else tid, "number": None, "title": f"Задание {tid}"}
            failed.append({
                **info,
                "task_id": key,
                "status": "incorrect",
                "score": scores.get(key, scores.get(tid)),
                "max_score": info.get("max_score"),
            })

    for tid, raw_score in scores.items():
        key = str(tid)
        if key in seen:
            continue
        try:
            score = Decimal(str(raw_score))
        except (InvalidOperation, TypeError, ValueError):
            continue
        info = meta.get(key) or {"id": int(tid) if str(tid).isdigit() else tid, "number": None, "title": f"Задание {tid}", "max_score": 1}
        max_score = Decimal(str(info.get("max_score") or 1))
        if score <= 0:
            status_label = "incorrect"
        elif score < max_score:
            if not include_partial:
                continue
            status_label = "partial"
        else:
            continue
        seen.add(key)
        failed.append({
            **info,
            "task_id": key,
            "status": status_label,
            "score": float(score),
            "max_score": float(max_score),
        })

    failed.sort(key=lambda row: (row.get("number") is None, row.get("number") or 0, str(row.get("task_id"))))
    return failed


def _create_variant_from_task_ids(*, level: str, subject: str, task_ids: list[int]) -> int:
    try:
        from Generator.models import Level, Subject, Task, Variant, VariantContent
    except Exception:
        from Generator.Generator.models import Level, Subject, Task, Variant, VariantContent

    try:
        from Generator.Generator.views import get_subject_for_api
    except Exception:
        def get_subject_for_api(s):
            return Subject.objects.filter(subject_short__iexact=s).first()

    subject_instance = get_subject_for_api(subject)
    level_instance = Level.objects.filter(level__iexact=level).first()
    if not subject_instance or not level_instance:
        raise HomeworkFromReviewError("Не удалось определить предмет или уровень.", "NO_SUBJECT")

    ids = []
    for tid in task_ids:
        try:
            ids.append(int(tid))
        except (TypeError, ValueError):
            continue
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HomeworkFromReviewError("Не выбраны задания для варианта.", "NO_TASKS")

    task_map = {
        t.id: t
        for t in Task.active_objects.filter(
            id__in=ids,
            task__subject=subject_instance,
            task__level=level_instance,
        )
    }
    variant = Variant.objects.create(
        var_subject=subject_instance,
        level=level_instance,
        created_by="lk_from_review",
    )
    vc_objects = []
    for order, tid in enumerate(ids, start=1):
        task = task_map.get(tid)
        if task:
            vc_objects.append(VariantContent(variant=variant, task=task, order=order))
    if not vc_objects:
        variant.delete()
        raise HomeworkFromReviewError(
            "Выбранные задания недоступны для этого предмета/уровня.",
            "INVALID_TASKS",
        )
    VariantContent.objects.bulk_create(vc_objects)
    return variant.id


def prepare_homework_from_review(*, teacher, review_item: ReviewItem) -> dict:
    """Превью формы: ученик, предмет, ошибочные задания, предложенный срок."""
    if review_item.teacher_id != teacher.id:
        raise HomeworkFromReviewError("Нет доступа к этой работе.", "FORBIDDEN", 403)

    submission = _submission_for_review(review_item)
    source_hw = submission.homework
    if source_hw.teacher_id != teacher.id:
        raise HomeworkFromReviewError("Нет доступа к этому заданию.", "FORBIDDEN", 403)
    if submission.student_id != review_item.student_id and review_item.student_id:
        # student на ReviewItem — источник истины для карточки
        pass

    student = review_item.student or submission.student
    ctx = build_homework_review_context(source_hw)
    failed = get_failed_generator_tasks(
        submission=submission,
        level=ctx.get("level") or "",
        subject=ctx.get("subject") or "",
        variant_id=ctx.get("variant_id"),
        include_partial=True,
    )
    incorrect_only = [row for row in failed if row.get("status") == "incorrect"]
    partial_only = [row for row in failed if row.get("status") == "partial"]

    suggested = suggest_homework_due_at(
        teacher=teacher,
        student=student,
        subject=ctx.get("subject") or None,
    )
    months = (
        "", "января", "февраля", "марта", "апреля", "мая", "июня",
        "июля", "августа", "сентября", "октября", "ноября", "декабря",
    )
    if suggested:
        local = timezone.localtime(suggested)
        suggested_label = (
            f"Срок установлен до следующего урока: "
            f"{local.day} {months[local.month]}, {local.strftime('%H:%M')}"
        )
    else:
        suggested = timezone.now() + timedelta(days=7)
        local = timezone.localtime(suggested)
        suggested_label = (
            f"Срок по умолчанию: {local.day} {months[local.month]}, {local.strftime('%H:%M')}"
        )

    source_tasks = list(
        source_hw.tasks.filter(is_active=True).order_by("order", "id").values(
            "id", "title", "task_type", "description", "interactive_id", "task_id", "order"
        )
    )

    default_title = f"Отработка ошибок: {source_hw.title}"
    if len(default_title) > 255:
        default_title = default_title[:252] + "…"

    return {
        "review_id": review_item.id,
        "student_id": student.id if student else None,
        "student_name": student.full_name if student else "",
        "source_homework_id": source_hw.id,
        "source_homework_title": source_hw.title,
        "lesson_id": source_hw.lesson_id,
        "student_subject_id": source_hw.student_subject_id,
        "level": ctx.get("level") or "",
        "subject": ctx.get("subject") or "",
        "has_variant": bool(ctx.get("has_variant")),
        "variant_id": ctx.get("variant_id"),
        "failed_tasks": failed,
        "incorrect_tasks": incorrect_only,
        "partial_tasks": partial_only,
        "source_homework_tasks": source_tasks,
        "suggested_due_at": suggested.isoformat() if suggested else None,
        "suggested_due_label": suggested_label,
        "default_title": default_title,
        "default_description": (
            f"Задание выдано повторно после ошибок в работе «{source_hw.title}»."
        ),
    }


def notify_students_homework_assigned(homework: Homework) -> int:
    """Уведомление ученику о новом ДЗ (in-app + push + telegram по prefs)."""
    import html

    from .homework_api import _homework_recipient_students
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher
    from .telegram_connect import platform_path_url
    from Generator.telegram_utils import escape_telegram_html

    due_label = ""
    if homework.due_at:
        local = timezone.localtime(homework.due_at)
        months = (
            "", "января", "февраля", "марта", "апреля", "мая", "июня",
            "июля", "августа", "сентября", "октября", "ноября", "декабря",
        )
        due_label = f"{local.day} {months[local.month]}, {local.strftime('%H:%M')}"

    title = "Новое домашнее задание"
    if due_label:
        message = (
            f"Вам выдано новое домашнее задание: {homework.title}. "
            f"Срок выполнения: {due_label}."
        )
    else:
        message = f"Вам выдано новое домашнее задание: {homework.title}."

    assignment_path = f"/cabinet/student/assignments/{homework.id}"
    cabinet_url = platform_path_url(assignment_path)
    tg_text = (
        f"{escape_telegram_html(title)}\n\n"
        f"{escape_telegram_html(message)}\n\n"
        f'<a href="{html.escape(cabinet_url, quote=True)}">Открыть задание</a>'
    )
    actor = getattr(homework, "teacher", None)
    sent = 0
    for student in _homework_recipient_students(homework):
        user = student.user if student and student.user_id else None
        if user is None:
            continue
        result = NotificationDispatcher.notify(
            user,
            NotificationEventType.HOMEWORK_ASSIGNED,
            title=title,
            message=message,
            actor=actor if getattr(actor, "pk", None) else None,
            related_object=homework,
            payload={
                "type": NotificationEventType.HOMEWORK_ASSIGNED,
                "event_type": NotificationEventType.HOMEWORK_ASSIGNED,
                "homework_id": homework.id,
                "url": assignment_path,
            },
            url=assignment_path,
            dedup_key=f"homework_assigned:{homework.id}:{user.pk}",
            recipient_student=student,
            skip_actor=True,
            create_telegram=True,
            telegram_text=tg_text,
            push_tag=f"hw-assigned-{homework.id}",
        )
        if not result.skipped:
            sent += 1
    return sent


@transaction.atomic
def create_homework_from_review(
    *,
    teacher,
    review_item: ReviewItem,
    title: str,
    description: str = "",
    due_at=None,
    mode: str = "assign",  # assign | draft
    generator_task_ids: Optional[list] = None,
    include_incorrect: bool = False,
    include_partial: bool = False,
    source_homework_task_ids: Optional[list] = None,
    material_ids: Optional[list] = None,
    interactive_ids: Optional[list] = None,
    comment: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """
    Создать новое ДЗ для ученика из проверяемой работы.
    Старая попытка (submission) не изменяется.
    """
    if review_item.teacher_id != teacher.id:
        raise HomeworkFromReviewError("Нет доступа к этой работе.", "FORBIDDEN", 403)

    key = (idempotency_key or "").strip()[:128]
    if key:
        existing = Homework.objects.filter(teacher=teacher, idempotency_key=key).first()
        if existing:
            return {
                "homework": existing,
                "created": False,
                "idempotent": True,
                "notified": 0,
                "tasks_count": existing.tasks.filter(is_active=True).count(),
            }

    submission = _submission_for_review(review_item)
    source_hw = submission.homework
    if source_hw.teacher_id != teacher.id:
        raise HomeworkFromReviewError("Нет доступа к этому заданию.", "FORBIDDEN", 403)

    student = review_item.student or submission.student
    if not student or student.teacher_id != teacher.id:
        raise HomeworkFromReviewError(
            "Ученик не принадлежит этому учителю.",
            "FORBIDDEN",
            403,
        )

    title = (title or "").strip()
    if not title:
        raise HomeworkFromReviewError("Укажите название задания.", "NO_TITLE")

    due = _parse_due_at(due_at)
    if due is not None and due < timezone.now() - timedelta(minutes=1):
        raise HomeworkFromReviewError("Нельзя создать ДЗ со сроком в прошлом.", "DUE_IN_PAST")

    ctx = build_homework_review_context(source_hw)
    level = ctx.get("level") or ""
    subject = ctx.get("subject") or ""
    variant_id = ctx.get("variant_id")

    selected_gen_ids: list[int] = []
    if generator_task_ids:
        for tid in generator_task_ids:
            try:
                selected_gen_ids.append(int(tid))
            except (TypeError, ValueError):
                continue
    elif include_incorrect or include_partial:
        failed = get_failed_generator_tasks(
            submission=submission,
            level=level,
            subject=subject,
            variant_id=variant_id,
            include_partial=True,
        )
        for row in failed:
            status_label = row.get("status")
            if status_label == "incorrect" and include_incorrect:
                try:
                    selected_gen_ids.append(int(row["task_id"]))
                except (TypeError, ValueError, KeyError):
                    continue
            elif status_label == "partial" and include_partial:
                try:
                    selected_gen_ids.append(int(row["task_id"]))
                except (TypeError, ValueError, KeyError):
                    continue

    selected_gen_ids = list(dict.fromkeys(selected_gen_ids))

    material_ids = [int(pk) for pk in (material_ids or []) if pk]
    interactive_ids = [int(pk) for pk in (interactive_ids or []) if pk]
    source_task_pks = []
    for tid in source_homework_task_ids or []:
        try:
            source_task_pks.append(int(tid))
        except (TypeError, ValueError):
            continue

    description = (description or "").strip()
    if comment:
        note = (comment or "").strip()
        if note:
            description = f"{description}\n\n{note}".strip() if description else note

    has_content = bool(
        selected_gen_ids or material_ids or interactive_ids or source_task_pks or description
    )
    if not has_content:
        raise HomeworkFromReviewError(
            "Добавьте задания с ошибками, материалы или описание.",
            "NO_CONTENT",
        )

    status_value = (
        HomeworkStatus.ASSIGNED if mode != "draft" else HomeworkStatus.DRAFT
    )

    homework = Homework.objects.create(
        teacher=teacher,
        student=student,
        title=title,
        description=description,
        lesson=source_hw.lesson,
        lesson_plan_item=None,
        student_subject=source_hw.student_subject,
        group=None,
        due_at=due,
        status=status_value,
        source_review_item=review_item,
        source_homework=source_hw,
        created_from_review=True,
        idempotency_key=key or None,
    )

    order = 0
    if selected_gen_ids and level and subject:
        new_variant_id = _create_variant_from_task_ids(
            level=level, subject=subject, task_ids=selected_gen_ids
        )
        variant_url = f"/{level}/{subject}/variant/{new_variant_id}"
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.GENERATED_TASK,
            title="Задания для отработки",
            description=variant_url,
            order=order,
        )
        order += 1
    elif selected_gen_ids:
        raise HomeworkFromReviewError(
            "Не удалось определить предмет/уровень для создания варианта.",
            "NO_SUBJECT",
        )

    if source_task_pks:
        for src in source_hw.tasks.filter(pk__in=source_task_pks, is_active=True).order_by(
            "order", "id"
        ):
            # Не дублируем исходный вариант целиком, если уже собрали новый из ошибок
            if selected_gen_ids and extract_variant_id(src.description or ""):
                continue
            HomeworkTask.objects.create(
                homework=homework,
                task_type=src.task_type,
                title=src.title,
                description=src.description or "",
                interactive=src.interactive,
                task_id=src.task_id or "",
                order=order,
            )
            if src.interactive_id:
                _ensure_interactive_assignment(
                    teacher=teacher,
                    interactive=src.interactive,
                    student=student,
                    lesson=source_hw.lesson,
                    plan_item=None,
                )
            order += 1

    if material_ids:
        from .models import Material
        from django.db.models import Q

        materials = list(
            Material.objects.filter(pk__in=material_ids).filter(
                Q(is_public=True) | Q(teacher=teacher) | Q(teacher__isnull=True, is_public=True)
            )
        )
        if len(materials) != len(set(material_ids)):
            raise HomeworkFromReviewError("Некоторые материалы недоступны.", "BAD_MATERIALS")
        for material in materials:
            order = _add_material_homework_task(homework, material, order)

    if interactive_ids:
        from .choices import InteractiveStatus
        from .models import Interactive

        interactives = list(
            Interactive.objects.filter(pk__in=interactive_ids, teacher=teacher).exclude(
                status=InteractiveStatus.ARCHIVED
            )
        )
        if len(interactives) != len(set(interactive_ids)):
            raise HomeworkFromReviewError("Некоторые интерактивы недоступны.", "BAD_INTERACTIVES")
        for interactive in interactives:
            order = _add_interactive_homework_task(homework, interactive, order)
            _ensure_interactive_assignment(
                teacher=teacher,
                interactive=interactive,
                student=student,
                lesson=source_hw.lesson,
                plan_item=None,
            )

    _record_variant_tasks_for_homework(homework, student, teacher)

    notified = 0
    if status_value == HomeworkStatus.ASSIGNED:
        ensure_homework_in_review_queue(homework, student)
        notified = notify_students_homework_assigned(homework)

    # Гарантия: исходная попытка не тронута
    submission.refresh_from_db()

    return {
        "homework": homework,
        "created": True,
        "idempotent": False,
        "notified": notified,
        "tasks_count": homework.tasks.filter(is_active=True).count(),
        "generator_task_ids": selected_gen_ids,
    }
