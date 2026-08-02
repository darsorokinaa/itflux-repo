"""Редактирование уже выданного домашнего задания."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .choices import (
    HomeworkStatus,
    HomeworkTaskType,
    InteractiveStatus,
    NotificationChannel,
    NotificationStatus,
    SubmissionStatus,
)
from .models import (
    Homework,
    HomeworkEditHistory,
    HomeworkSubmission,
    HomeworkTask,
    Interactive,
    Material,
    Notification,
    ReviewItem,
)

logger = logging.getLogger(__name__)


class HomeworkEditConflict(Exception):
    """ДЗ изменено в другой вкладке / другим пользователем."""

    def __init__(self, message: str = ""):
        super().__init__(
            message
            or "Домашнее задание было изменено в другой вкладке. Обновите страницу и повторите редактирование."
        )


class HomeworkEditNeedsConfirm(Exception):
    """Требуется подтверждение учителя перед сохранением."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def teacher_can_edit_homework(teacher, homework: Homework) -> bool:
    if teacher is None or homework is None:
        return False
    if getattr(teacher, "is_superuser", False) or getattr(teacher, "is_staff", False):
        return True
    return homework.teacher_id == getattr(teacher, "id", None)


def student_has_started_homework(homework: Homework) -> bool:
    """Есть ли сохранённые или отправленные ответы ученика."""
    for submission in homework.submissions.all():
        if submission.submitted_at:
            return True
        if (submission.answer_text or "").strip():
            return True
        if submission.attached_file:
            return True
        payload = submission.result_payload
        if isinstance(payload, dict) and payload:
            # Игнорируем служебные ключи архива
            meaningful = {
                k: v
                for k, v in payload.items()
                if k not in ("excluded_homework_task_ids", "archived_by_homework_task")
                and v not in (None, "", {}, [])
            }
            if meaningful:
                return True
    return False


def homework_is_checked_or_completed(homework: Homework) -> bool:
    if homework.status in (HomeworkStatus.CHECKED, HomeworkStatus.COMPLETED):
        return True
    if homework.submissions.filter(status=SubmissionStatus.CHECKED).exists():
        return True
    submission_ids = list(homework.submissions.values_list("id", flat=True))
    if submission_ids and ReviewItem.objects.filter(
        source_type="homework",
        source_id__in=submission_ids,
        status="checked",
    ).exists():
        return True
    return False


def _parse_due_at(raw):
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        due = raw
    else:
        due = parse_datetime(str(raw).strip())
        if due is None:
            raise ValueError("Некорректный формат срока выполнения.")
    if timezone.is_naive(due):
        due = timezone.make_aware(due, timezone.get_current_timezone())
    return due


def _parse_client_updated_at(raw) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, datetime):
        dt = raw
    else:
        dt = parse_datetime(str(raw).strip())
    if dt is None:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def _updated_at_matches(homework: Homework, expected) -> bool:
    expected_dt = _parse_client_updated_at(expected)
    if expected_dt is None:
        return False
    current = homework.updated_at
    if current is None:
        return True
    # Сравниваем с точностью до секунды (ISO с фронта часто без микросекунд)
    return abs((current - expected_dt).total_seconds()) < 1.0


def _resolve_material_id_for_task(task: HomeworkTask, homework: Homework) -> int | None:
    from .files_models import CabinetFileRelation, CabinetFileRelationType

    desc = (task.description or "").strip()
    if not desc:
        return None
    rel = (
        CabinetFileRelation.objects.filter(
            homework=homework,
            relation_type=CabinetFileRelationType.HOMEWORK,
        )
        .select_related("file")
        .first()
    )
    # Лучше искать Material по URL/имени файла среди материалов учителя
    materials = Material.objects.filter(
        Q(teacher_id=homework.teacher_id) | Q(is_public=True)
    ).filter(
        Q(external_url=desc)
        | Q(file=desc)
        | Q(title=task.title)
    )[:8]
    for material in materials:
        from .student_release import _material_resource_url

        if _material_resource_url(material) == desc or material.title == task.title:
            return material.pk
    if rel and rel.file_id:
        mat = Material.objects.filter(cabinet_file_id=rel.file_id).first()
        if mat:
            return mat.pk
    return None


def serialize_homework_for_edit(homework: Homework) -> dict:
    from .homework_api import serialize_student_task, task_is_variant

    tasks = []
    for task in homework.tasks.filter(is_active=True).order_by("order", "id").select_related(
        "interactive"
    ):
        row = serialize_student_task(task, homework=homework, homework_id=homework.id, token=None)
        material_id = None
        if task.task_type in (HomeworkTaskType.FILE, HomeworkTaskType.EXTERNAL_LINK, HomeworkTaskType.GENERATED_TASK):
            if not task_is_variant(task):
                material_id = _resolve_material_id_for_task(task, homework)
        row["material_id"] = material_id
        row["interactive_title"] = (
            task.interactive.title if task.interactive_id and task.interactive else ""
        )
        row["order"] = task.order
        row["is_active"] = task.is_active
        tasks.append(row)

    return {
        "id": homework.id,
        "title": homework.title,
        "description": homework.description or "",
        "due_at": homework.due_at.isoformat() if homework.due_at else None,
        "status": homework.status,
        "status_label": homework.get_status_display(),
        "updated_at": homework.updated_at.isoformat() if homework.updated_at else None,
        "student": homework.student_id,
        "student_name": homework.student.full_name if homework.student_id else None,
        "group": homework.group_id,
        "tasks": tasks,
        "warnings": {
            "student_started": student_has_started_homework(homework),
            "is_checked_or_completed": homework_is_checked_or_completed(homework),
        },
        "student_started_message": (
            "Ученик уже начал выполнять это домашнее задание. "
            "Изменение состава заданий может повлиять на его ответы и результаты."
        ),
        "checked_message": (
            "Домашнее задание уже завершено или проверено. "
            "Изменения могут повлиять на выставленный результат."
        ),
    }


def _archive_removed_task_answers(submission: HomeworkSubmission, removed_task_ids: list[int]) -> bool:
    """Исключить ответы по удалённым HomeworkTask из текущего результата, сохранив архив."""
    if not removed_task_ids:
        return False
    payload = dict(submission.result_payload or {})
    if not payload and not submission.answer_text and not submission.attached_file:
        excluded = list(payload.get("excluded_homework_task_ids") or [])
        for tid in removed_task_ids:
            if tid not in excluded:
                excluded.append(tid)
        payload["excluded_homework_task_ids"] = excluded
        submission.result_payload = payload
        return True

    archived = dict(payload.get("archived_by_homework_task") or {})
    for tid in removed_task_ids:
        key = str(tid)
        if key not in archived:
            archived[key] = {
                "archived_at": timezone.now().isoformat(),
                # Полный снимок не копируем — только пометка, ответы остаются в payload
                "note": "task_removed_from_homework",
            }
    payload["archived_by_homework_task"] = archived
    excluded = list(payload.get("excluded_homework_task_ids") or [])
    for tid in removed_task_ids:
        if tid not in excluded:
            excluded.append(tid)
    payload["excluded_homework_task_ids"] = excluded
    submission.result_payload = payload
    return True


def _maybe_recompute_score(submission: HomeworkSubmission, *, tasks_changed: bool) -> bool:
    if not tasks_changed:
        return False
    from .homework_api import compute_score_percent

    payload = submission.result_payload if isinstance(submission.result_payload, dict) else {}
    new_score = compute_score_percent(payload)
    if new_score is None:
        return False
    current = float(submission.score) if submission.score is not None else None
    if current is not None and abs(current - float(new_score)) < 0.01:
        return False
    submission.score = Decimal(str(new_score))
    return True


def _student_facing_change(changed_fields: list[str], tasks_added, tasks_removed) -> bool:
    facing = {
        "title",
        "description",
        "due_at",
        "tasks",
        "tasks_order",
        "materials",
        "interactives",
    }
    if tasks_added or tasks_removed:
        return True
    return any(f in facing for f in changed_fields)


def notify_students_homework_edited(
    homework: Homework,
    *,
    history: HomeworkEditHistory | None = None,
) -> int:
    """
    Уведомление ученику об изменении ДЗ.
    Дедупликация через event_key (history.id) и prefs.notify_homework.
    """
    import html

    from .homework_api import _homework_recipient_students
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher
    from .telegram_connect import platform_path_url
    from Generator.telegram_utils import escape_telegram_html

    title = "Домашнее задание изменено"
    message = (
        f"Учитель изменил домашнее задание «{homework.title}». "
        f"Проверьте обновлённые задания и срок выполнения."
    )
    assignment_path = f"/cabinet/student/assignments/{homework.id}"
    history_id = history.id if history else None
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

        if history_id:
            dedup_key = f"homework_edited:{homework.id}:{user.pk}:h{history_id}"
        else:
            # Fallback: one per minute window
            bucket = timezone.now().strftime("%Y%m%d%H%M")
            dedup_key = f"homework_edited:{homework.id}:{user.pk}:{bucket}"

        result = NotificationDispatcher.notify(
            user,
            NotificationEventType.HOMEWORK_EDITED,
            title=title,
            message=message,
            actor=actor if getattr(actor, "pk", None) else None,
            related_object=homework,
            payload={
                "type": NotificationEventType.HOMEWORK_EDITED,
                "event_type": NotificationEventType.HOMEWORK_EDITED,
                "homework_id": homework.id,
                "history_id": history_id,
                "url": assignment_path,
            },
            url=assignment_path,
            dedup_key=dedup_key,
            recipient_student=student,
            skip_actor=True,
            create_telegram=True,
            telegram_text=tg_text,
            push_tag=f"hw-edited-{homework.id}-{history_id or 'x'}",
        )
        if not result.skipped:
            sent += 1
    return sent


def _load_materials(teacher, material_ids: list[int]) -> list[Material]:
    if not material_ids:
        return []
    materials = list(
        Material.objects.filter(pk__in=material_ids).filter(
            Q(is_public=True) | Q(teacher=teacher) | Q(teacher__isnull=True, is_public=True)
        )
    )
    if len(materials) != len(set(material_ids)):
        raise ValueError("Некоторые материалы недоступны.")
    by_id = {m.pk: m for m in materials}
    return [by_id[pk] for pk in material_ids if pk in by_id]


def _load_interactives(teacher, interactive_ids: list[int]) -> list[Interactive]:
    if not interactive_ids:
        return []
    interactives = list(
        Interactive.objects.filter(pk__in=interactive_ids, teacher=teacher).exclude(
            status=InteractiveStatus.ARCHIVED
        )
    )
    if len(interactives) != len(set(interactive_ids)):
        raise ValueError("Некоторые интерактивы недоступны.")
    by_id = {i.pk: i for i in interactives}
    return [by_id[pk] for pk in interactive_ids if pk in by_id]


@transaction.atomic
def update_issued_homework(
    *,
    homework: Homework,
    teacher,
    data: dict,
) -> dict:
    """
    Обновить выданное ДЗ. Использует select_for_update и проверку updated_at.
    """
    from .homework_api import (
        _homework_recipient_students,
        build_homework_review_context,
        ensure_homework_in_review_queue,
    )
    from .student_release import (
        _add_interactive_homework_task,
        _add_material_homework_task,
        _ensure_interactive_assignment,
        _record_variant_tasks_for_homework,
    )

    # Перечитываем под блокировкой (без select_related — nullable FK дают OUTER JOIN,
    # а PostgreSQL запрещает FOR UPDATE на nullable стороне outer join).
    homework = (
        Homework.objects.select_for_update()
        .prefetch_related("tasks", "submissions")
        .get(pk=homework.pk)
    )

    if not teacher_can_edit_homework(teacher, homework):
        raise PermissionError("Нет доступа к этому домашнему заданию.")
    if homework.status == HomeworkStatus.ARCHIVED:
        raise ValueError("Нельзя изменить архивное домашнее задание.")

    # Игнорируем попытки подмены владельца / ученика
    data = dict(data or {})
    data.pop("teacher", None)
    data.pop("teacher_id", None)
    data.pop("student", None)
    data.pop("student_id", None)
    data.pop("assignment_id", None)
    data.pop("homework_id", None)

    expected_updated_at = data.get("updated_at") or data.get("expected_updated_at")
    if expected_updated_at is None:
        raise ValueError("Укажите updated_at для защиты от одновременного редактирования.")
    if not _updated_at_matches(homework, expected_updated_at):
        raise HomeworkEditConflict()

    student_started = student_has_started_homework(homework)
    is_checked = homework_is_checked_or_completed(homework)
    confirm_started = data.get("confirm_student_started") in (True, "1", "true", "yes")
    confirm_checked = data.get("confirm_checked_edit") in (True, "1", "true", "yes")

    tasks_payload = data.get("tasks")
    if tasks_payload is not None and not isinstance(tasks_payload, list):
        raise ValueError("Некорректный список заданий.")

    # Предварительно вычислим, меняется ли состав заданий
    tasks_composition_change = False
    if tasks_payload is not None:
        current_active_ids = set(
            homework.tasks.filter(is_active=True).values_list("id", flat=True)
        )
        keep_ids = set()
        for item in tasks_payload:
            if not isinstance(item, dict):
                continue
            tid = item.get("id")
            if tid is not None:
                try:
                    keep_ids.add(int(tid))
                except (TypeError, ValueError):
                    raise ValueError("Некорректный идентификатор задания.") from None
            elif item.get("material_id") or item.get("interactive_id") or (
                item.get("task_type") == "text" or item.get("description") or item.get("title")
            ):
                tasks_composition_change = True
        if keep_ids != current_active_ids:
            tasks_composition_change = True
        # Порядок
        if not tasks_composition_change and keep_ids == current_active_ids:
            ordered = []
            for item in tasks_payload:
                if isinstance(item, dict) and item.get("id") is not None:
                    ordered.append(int(item["id"]))
            current_ordered = list(
                homework.tasks.filter(is_active=True)
                .order_by("order", "id")
                .values_list("id", flat=True)
            )
            if ordered and ordered != current_ordered:
                tasks_composition_change = True  # для предупреждения о составе/порядке

    if student_started and tasks_composition_change and not confirm_started:
        raise HomeworkEditNeedsConfirm(
            "needs_confirm_student_started",
            "Ученик уже начал выполнять это домашнее задание. "
            "Изменение состава заданий может повлиять на его ответы и результаты.",
        )
    if is_checked and not confirm_checked:
        raise HomeworkEditNeedsConfirm(
            "needs_confirm_checked",
            "Домашнее задание уже завершено или проверено. "
            "Изменения могут повлиять на выставленный результат.",
        )

    changed_fields: list[str] = []
    tasks_added_meta: list[dict] = []
    tasks_removed_meta: list[dict] = []
    old_due_at = homework.due_at
    new_due_at = old_due_at

    # --- Поля Homework ---
    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            raise ValueError("Укажите название задания.")
        if title != homework.title:
            homework.title = title
            changed_fields.append("title")

    if "description" in data:
        description = (data.get("description") or "").strip()
        if description != (homework.description or ""):
            homework.description = description
            changed_fields.append("description")

    if "due_at" in data:
        new_due_at = _parse_due_at(data.get("due_at"))
        if new_due_at != old_due_at:
            homework.due_at = new_due_at
            changed_fields.append("due_at")

    # Снимок результата до правок (для истории)
    previous_score = None
    previous_result_meta = {}
    primary_submission = homework.submissions.order_by("-submitted_at", "-id").first()
    if primary_submission:
        previous_score = primary_submission.score
        previous_result_meta = {
            "submission_id": primary_submission.id,
            "status": primary_submission.status,
            "score": float(primary_submission.score) if primary_submission.score is not None else None,
            "teacher_comment": (primary_submission.teacher_comment or "")[:500],
            "submitted_at": (
                primary_submission.submitted_at.isoformat()
                if primary_submission.submitted_at
                else None
            ),
        }

    removed_task_ids: list[int] = []
    tasks_changed = False

    if tasks_payload is not None:
        active_tasks = {
            t.id: t for t in homework.tasks.filter(is_active=True)
        }
        keep_ids: set[int] = set()
        order_updates: list[tuple[HomeworkTask, int, dict]] = []
        new_items: list[dict] = []

        for idx, item in enumerate(tasks_payload):
            if not isinstance(item, dict):
                raise ValueError("Некорректный элемент списка заданий.")
            order = item.get("order")
            try:
                order = int(order) if order is not None else idx
            except (TypeError, ValueError):
                order = idx

            tid = item.get("id")
            if tid is not None:
                try:
                    tid = int(tid)
                except (TypeError, ValueError) as exc:
                    raise ValueError("Некорректный идентификатор задания.") from exc
                task = active_tasks.get(tid) or homework.tasks.filter(
                    pk=tid, homework=homework
                ).first()
                if task is None or task.homework_id != homework.id:
                    raise ValueError("Задание недоступно или не принадлежит этому ДЗ.")
                if not task.is_active:
                    # Реактивация ранее исключённого
                    task.is_active = True
                    tasks_changed = True
                    tasks_added_meta.append({"id": task.id, "title": task.title, "reactivated": True})
                keep_ids.add(task.id)
                field_updates = {}
                if "title" in item and (item.get("title") or "").strip():
                    new_title = str(item.get("title") or "").strip()
                    if new_title != task.title:
                        field_updates["title"] = new_title
                if "description" in item:
                    new_desc = str(item.get("description") or "")
                    if new_desc != (task.description or ""):
                        field_updates["description"] = new_desc
                order_updates.append((task, order, field_updates))
            else:
                new_items.append({**item, "order": order})

        # Soft-remove missing
        for tid, task in active_tasks.items():
            if tid not in keep_ids:
                task.is_active = False
                task.save(update_fields=["is_active"])
                removed_task_ids.append(tid)
                tasks_removed_meta.append({"id": tid, "title": task.title})
                tasks_changed = True

        for task, order, field_updates in order_updates:
            updates = []
            if task.order != order:
                task.order = order
                updates.append("order")
                if "tasks_order" not in changed_fields:
                    changed_fields.append("tasks_order")
            for key, value in field_updates.items():
                setattr(task, key, value)
                updates.append(key)
                if key not in changed_fields:
                    changed_fields.append(f"task_{key}")
            if not task.is_active:
                task.is_active = True
                updates.append("is_active")
            if updates:
                task.save(update_fields=list(dict.fromkeys(updates)))
                tasks_changed = True

        # Добавление новых
        for item in new_items:
            order = int(item.get("order") or 0)
            material_id = item.get("material_id")
            interactive_id = item.get("interactive_id")
            text = (item.get("description") or item.get("text") or "").strip()
            text_title = (item.get("title") or item.get("text_title") or "").strip()

            if material_id:
                materials = _load_materials(teacher, [int(material_id)])
                material = materials[0]
                _add_material_homework_task(homework, material, order)
                created = (
                    homework.tasks.filter(is_active=True, title=material.title)
                    .order_by("-id")
                    .first()
                )
                if created and created.order != order:
                    created.order = order
                    created.save(update_fields=["order"])
                tasks_added_meta.append(
                    {"title": material.title, "material_id": material.id}
                )
                tasks_changed = True
            elif interactive_id:
                interactives = _load_interactives(teacher, [int(interactive_id)])
                interactive = interactives[0]
                _add_interactive_homework_task(homework, interactive, order)
                created = (
                    homework.tasks.filter(
                        is_active=True,
                        interactive=interactive,
                        task_type=HomeworkTaskType.INTERACTIVE,
                    )
                    .order_by("-id")
                    .first()
                )
                if created and created.order != order:
                    created.order = order
                    created.save(update_fields=["order"])
                for student in _homework_recipient_students(homework):
                    _ensure_interactive_assignment(
                        teacher=teacher,
                        interactive=interactive,
                        student=student,
                        lesson=None,
                        plan_item=None,
                    )
                tasks_added_meta.append(
                    {"title": interactive.title, "interactive_id": interactive.id}
                )
                tasks_changed = True
            elif text or text_title:
                title = text_title or "Дополнительное задание"
                HomeworkTask.objects.create(
                    homework=homework,
                    task_type=HomeworkTaskType.TEXT,
                    title=title,
                    description=text,
                    order=order,
                    is_active=True,
                )
                tasks_added_meta.append({"title": title, "task_type": "text"})
                tasks_changed = True
            else:
                raise ValueError("Не удалось добавить задание: укажите материал, интерактив или текст.")

        if tasks_changed and "tasks" not in changed_fields:
            changed_fields.append("tasks")

        # Не оставляем ДЗ без активных заданий и без описания
        active_count = homework.tasks.filter(is_active=True).count()
        if active_count == 0 and not (homework.description or "").strip():
            raise ValueError("Домашнее задание должно содержать описание или хотя бы одно задание.")

    if not changed_fields and not tasks_added_meta and not tasks_removed_meta:
        # Нет изменений — просто вернуть текущее состояние
        return {
            "ok": True,
            "unchanged": True,
            "homework": serialize_homework_for_edit(homework),
            "message": "Домашнее задание обновлено",
            "notified_students": 0,
            "review": build_homework_review_context(homework),
        }

    # Ответы: архивируем исключённые задания, пересчитываем баллы при необходимости
    score_recomputed = False
    for submission in homework.submissions.select_for_update().all():
        dirty = False
        if removed_task_ids:
            if _archive_removed_task_answers(submission, removed_task_ids):
                dirty = True
        if _maybe_recompute_score(submission, tasks_changed=tasks_changed):
            dirty = True
            score_recomputed = True
        # Статус checked/completed не сбрасываем; комментарии сохраняем
        if dirty:
            submission.save(
                update_fields=["result_payload", "score", "updated_at"]
            )

    homework.save()
    # Обновить review title если изменилось название
    if "title" in changed_fields:
        for submission in homework.submissions.all():
            ReviewItem.objects.filter(
                source_type="homework", source_id=submission.id
            ).update(title=homework.title)

    history = HomeworkEditHistory.objects.create(
        homework=homework,
        actor=teacher,
        changed_fields=changed_fields,
        tasks_added=tasks_added_meta,
        tasks_removed=tasks_removed_meta,
        old_due_at=old_due_at,
        new_due_at=homework.due_at,
        previous_score=previous_score,
        previous_result_meta=previous_result_meta,
    )

    # Индексация вариантов / очередь проверки
    for student in _homework_recipient_students(homework):
        _record_variant_tasks_for_homework(homework, student, teacher)
        ensure_homework_in_review_queue(homework, student)

    notified = 0
    if _student_facing_change(changed_fields, tasks_added_meta, tasks_removed_meta):
        notified = notify_students_homework_edited(homework, history=history)

    # Перечитываем после save
    homework.refresh_from_db()
    return {
        "ok": True,
        "unchanged": False,
        "homework": serialize_homework_for_edit(homework),
        "message": "Домашнее задание обновлено",
        "notified_students": notified,
        "score_recomputed": score_recomputed,
        "history_id": history.id,
        "review": build_homework_review_context(homework),
    }
