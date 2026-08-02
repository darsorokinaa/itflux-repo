"""Publish lesson materials and homework to the student cabinet when a class ends."""

import logging
import re

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .choices import (
    AssignmentStatus,
    HomeworkStatus,
    HomeworkTaskType,
    InteractiveStatus,
    LessonStatus,
    LessonType,
    ParticipantRole,
    ParticipantStatus,
    StudentStatus,
)
from .models import (
    Homework,
    HomeworkTask,
    InteractiveAssignment,
    Lesson,
    LessonAssignment,
    LessonPlanItem,
    ScheduleEvent,
    Student,
)
from .plan_schedule import resolve_plan_item_for_event

logger = logging.getLogger(__name__)

FINISHED_STATUSES = {
    ScheduleEvent.Status.DONE,
    ScheduleEvent.Status.COMPLETED,
}

LESSON_EVENT_TYPES = (
    ScheduleEvent.EventType.INDIVIDUAL,
    ScheduleEvent.EventType.GROUP,
    ScheduleEvent.EventType.INDIVIDUAL_LESSON,
    ScheduleEvent.EventType.GROUP_LESSON,
)

_SUBJECT_ALIAS_GROUPS = (
    frozenset({"inf", "informatics"}),
    frozenset({"math", "math_base"}),
)


def _normalize_subject(value):
    return (str(value or "")).strip().lower()


def _subjects_equivalent(left, right):
    a = _normalize_subject(left)
    b = _normalize_subject(right)
    if not a or not b:
        return False
    if a == b:
        return True
    for group in _SUBJECT_ALIAS_GROUPS:
        if a in group and b in group:
            return True
    return False


def _subject_for_event(event, *, resolve=True):
    """Предмет занятия: из пункта плана / связанного плана / enrollment."""
    plan_item = None
    if getattr(event, "lesson_plan_item_id", None) and getattr(event, "lesson_plan_item", None):
        plan_item = event.lesson_plan_item
    if plan_item is None and resolve:
        try:
            plan_item, _ = resolve_plan_item_for_event(event)
        except Exception:
            plan_item = None
    plan = getattr(plan_item, "plan", None) if plan_item is not None else None
    if plan is not None:
        return _normalize_subject(getattr(plan, "subject", "") or "")
    return ""


def _student_upcoming_lesson_filter(student, group=None):
    filters = Q(student=student)
    if group is not None:
        filters |= Q(group=group)
    group_ids = list(student.groups.values_list("pk", flat=True))
    if group_ids:
        filters |= Q(group_id__in=group_ids)
    filters |= Q(
        participants__student=student,
        participants__role=ParticipantRole.STUDENT,
        participants__status__in=[ParticipantStatus.INVITED, ParticipantStatus.ACCEPTED],
    )
    return filters


def resolve_homework_due_at(*, event, student, subject=None):
    """Срок ДЗ — до начала следующего урока ученика у этого учителя (по предмету)."""
    after = event.ends_at or event.starts_at or timezone.now()
    subject = _normalize_subject(subject) or _subject_for_event(event, resolve=True)
    return suggest_homework_due_at(
        teacher=event.owner,
        student=student,
        subject=subject or None,
        after=after,
        exclude_event_id=event.pk,
        group=event.group if event.group_id else None,
    )


def suggest_homework_due_at(
    *,
    teacher,
    student,
    subject=None,
    after=None,
    exclude_event_id=None,
    group=None,
):
    """
    Следующий урок ученика у учителя.
    Если известен предмет — сначала ищем урок по этому предмету, иначе любой следующий.
    """
    after = after or timezone.now()
    subject = _normalize_subject(subject)
    qs = (
        ScheduleEvent.objects.filter(
            owner=teacher,
            starts_at__gt=after,
            event_type__in=LESSON_EVENT_TYPES,
        )
        .exclude(status=ScheduleEvent.Status.CANCELLED)
        .filter(_student_upcoming_lesson_filter(student, group))
        .select_related("lesson_plan_item", "lesson_plan_item__plan", "group", "student")
        .order_by("starts_at", "pk")
        .distinct()
    )
    if exclude_event_id:
        qs = qs.exclude(pk=exclude_event_id)

    candidates = list(qs[:40])
    if not candidates:
        return None

    if subject:
        unmarked = []
        for candidate in candidates:
            # Для кандидатов только явный FK — без тяжёлого resolve по слоту.
            cand_subject = _subject_for_event(candidate, resolve=False)
            if cand_subject and _subjects_equivalent(subject, cand_subject):
                return candidate.starts_at
            if not cand_subject:
                unmarked.append(candidate)
        if unmarked:
            return unmarked[0].starts_at
        return None

    return candidates[0].starts_at


def event_is_finished(event, now=None):
    now = now or timezone.now()
    if event.status == ScheduleEvent.Status.CANCELLED:
        return False
    if event.status in FINISHED_STATUSES:
        return True
    return bool(event.ends_at and event.ends_at <= now)


def target_students(event):
    students = []
    seen = set()

    if event.student_id:
        students.append(event.student)
        seen.add(event.student_id)

    if event.group_id:
        for student in event.group.students.exclude(status=StudentStatus.ARCHIVED):
            if student.id not in seen:
                students.append(student)
                seen.add(student.id)

    participant_qs = event.participants.filter(
        student__isnull=False,
        role=ParticipantRole.STUDENT,
        status__in=[ParticipantStatus.INVITED, ParticipantStatus.ACCEPTED],
    ).select_related("student")
    for participant in participant_qs:
        if participant.student_id not in seen:
            students.append(participant.student)
            seen.add(participant.student_id)

    return students


def _plan_item_has_homework(plan_item):
    if (plan_item.homework_description or "").strip():
        return True
    if plan_item.homework_materials.exists():
        return True
    if plan_item.homework_interactives.exists():
        return True
    return False


def _sync_lesson_content(lesson, plan_item, *, keep_status=False):
    lesson.title = plan_item.title or lesson.title
    lesson.topic = plan_item.topic or lesson.topic
    lesson.subtopic = plan_item.subtopic or lesson.subtopic
    lesson.task_number = plan_item.task_number or lesson.task_number
    lesson.theory_content = plan_item.goal or plan_item.planned_results or lesson.theory_content
    lesson.practice_content = plan_item.description or lesson.practice_content
    lesson.homework_description = plan_item.homework_description or lesson.homework_description
    if not keep_status:
        lesson.status = LessonStatus.PUBLISHED
    lesson.save(
        update_fields=[
            "title",
            "topic",
            "subtopic",
            "task_number",
            "theory_content",
            "practice_content",
            "homework_description",
            "status",
            "updated_at",
        ]
    )

    material_ids = list(plan_item.materials.values_list("pk", flat=True))
    lesson.materials.set(material_ids)
    return lesson


def _is_auto_materials_plan_item(plan_item):
    """Пункт из автоплана «Материалы занятия» — не должен попадать в библиотеку уроков."""
    from .plan_schedule import AUTO_MATERIALS_PLAN_DESCRIPTION

    plan = getattr(plan_item, "plan", None)
    if not plan:
        return False
    return (plan.description or "").strip() == AUTO_MATERIALS_PLAN_DESCRIPTION


def ensure_lesson_from_plan_item(plan_item, teacher):
    plan_item = (
        LessonPlanItem.objects.select_related("linked_lesson", "plan")
        .prefetch_related(
            "materials",
            "attached_interactives",
            "homework_materials",
            "homework_interactives",
        )
        .get(pk=plan_item.pk)
    )

    is_auto = _is_auto_materials_plan_item(plan_item)

    if plan_item.linked_lesson_id:
        lesson = plan_item.linked_lesson
        if is_auto:
            # Старые автоматериалы ошибочно линковались в библиотеку — убираем.
            if lesson.status != LessonStatus.ARCHIVED:
                lesson.status = LessonStatus.ARCHIVED
                lesson.save(update_fields=["status", "updated_at"])
            plan_item.linked_lesson = None
            plan_item.save(update_fields=["linked_lesson", "updated_at"])
    else:
        exam_type = getattr(plan_item.plan, "exam_type", "") or "none"
        direction = getattr(plan_item.plan, "direction", "") or "other"
        lesson = Lesson.objects.create(
            teacher=teacher,
            title=plan_item.title,
            topic=plan_item.topic,
            subtopic=plan_item.subtopic,
            task_number=plan_item.task_number,
            theory_content=plan_item.goal or plan_item.planned_results or "",
            practice_content=plan_item.description or "",
            homework_description=plan_item.homework_description or "",
            direction=direction,
            exam_type=exam_type,
            # Автоматериалы занятия: служебный урок, не в библиотеке учителя.
            status=LessonStatus.ARCHIVED if is_auto else LessonStatus.PUBLISHED,
            lesson_type=LessonType.INDIVIDUAL,
        )
        if not is_auto:
            # Для автоплана не ставим linked_lesson — иначе в материалах комнаты
            # появляется лишняя строка «Урок из библиотеки».
            plan_item.linked_lesson = lesson
            plan_item.save(update_fields=["linked_lesson", "updated_at"])

    return _sync_lesson_content(lesson, plan_item, keep_status=is_auto)


def _material_homework_task_type(material):
    if material.material_type == "task_set" or (
        material.external_url and "/variant/" in material.external_url
    ):
        return HomeworkTaskType.GENERATED_TASK
    if material.file:
        return HomeworkTaskType.FILE
    return HomeworkTaskType.EXTERNAL_LINK


def _material_resource_url(material):
    """URL ресурса для HomeworkTask — доступный ученику (не сырой /media/my-files/)."""
    from .files_services import is_blocked_media_url, material_file_url

    url = material_file_url(material, for_student=True)
    if url and not is_blocked_media_url(url):
        return url
    if material.external_url:
        return material.external_url.strip()
    # Fallback: публичный media только если это не закрытое хранилище
    if material.file:
        raw = material.file.url
        if raw and not is_blocked_media_url(raw):
            return raw
    return (material.topic or "").strip()


def _link_material_file_to_homework(homework, material):
    """Дать ученику доступ на скачивание файла материала через shared API."""
    from .files_models import CabinetFile, CabinetFileRelation, CabinetFileRelationType

    file_obj = getattr(material, "cabinet_file", None)
    if file_obj is None and material.file:
        key = (material.file.name or "").lstrip("/")
        if key:
            file_obj = CabinetFile.objects.filter(storage_key=key).first()
            if file_obj is None and key.startswith("media/"):
                file_obj = CabinetFile.objects.filter(storage_key=key[len("media/"):]).first()
    if file_obj is None:
        return

    defaults = {
        "material": material,
        "created_by": homework.teacher,
    }
    if homework.student_id:
        defaults["student"] = homework.student
    if homework.group_id:
        defaults["group"] = homework.group

    CabinetFileRelation.objects.get_or_create(
        file=file_obj,
        relation_type=CabinetFileRelationType.HOMEWORK,
        homework=homework,
        defaults=defaults,
    )


def _add_material_homework_task(homework, material, order, *, sync_existing=False):
    task_type = _material_homework_task_type(material)
    resource_url = _material_resource_url(material)
    if sync_existing:
        task, created = HomeworkTask.objects.get_or_create(
            homework=homework,
            title=material.title,
            defaults={
                "task_type": task_type,
                "description": resource_url,
                "order": order,
            },
        )
        updates = []
        if not created:
            if task.task_type != task_type:
                task.task_type = task_type
                updates.append("task_type")
            if resource_url and task.description != resource_url:
                task.description = resource_url
                updates.append("description")
            if task.order != order:
                task.order = order
                updates.append("order")
        if updates:
            task.save(update_fields=updates + ["updated_at"])
    else:
        HomeworkTask.objects.create(
            homework=homework,
            title=material.title,
            task_type=task_type,
            description=resource_url,
            order=order,
        )
    _link_material_file_to_homework(homework, material)
    return order + 1


def _add_interactive_homework_task(homework, interactive, order, *, sync_existing=False):
    if sync_existing:
        HomeworkTask.objects.get_or_create(
            homework=homework,
            task_type=HomeworkTaskType.INTERACTIVE,
            interactive=interactive,
            title=interactive.title,
            defaults={"order": order},
        )
    else:
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.INTERACTIVE,
            interactive=interactive,
            title=interactive.title,
            order=order,
        )
    return order + 1


def _sync_homework_tasks(homework, plan_item):
    order = 0
    description = (plan_item.homework_description or "").strip()
    if description:
        task, created = HomeworkTask.objects.get_or_create(
            homework=homework,
            task_type=HomeworkTaskType.TEXT,
            title="Домашнее задание",
            defaults={"description": description, "order": order},
        )
        if not created and task.description != description:
            task.description = description
            task.save(update_fields=["description"])
        order += 1

    for material in plan_item.homework_materials.all():
        order = _add_material_homework_task(homework, material, order, sync_existing=True)

    for interactive in plan_item.homework_interactives.all():
        order = _add_interactive_homework_task(homework, interactive, order, sync_existing=True)


def _ensure_interactive_assignment(*, teacher, interactive, student, lesson, plan_item):
    if interactive.status != InteractiveStatus.PUBLISHED:
        return
    assignment, created = InteractiveAssignment.objects.get_or_create(
        teacher=teacher,
        interactive=interactive,
        student=student,
        lesson_plan_item=plan_item,
        defaults={
            "lesson": lesson,
            "status": AssignmentStatus.ASSIGNED,
        },
    )
    if not created:
        updates = []
        if assignment.lesson_id != lesson.id:
            assignment.lesson = lesson
            updates.append("lesson")
        if assignment.status == AssignmentStatus.OVERDUE:
            assignment.status = AssignmentStatus.ASSIGNED
            updates.append("status")
        if updates:
            updates.append("updated_at")
            assignment.save(update_fields=updates)


def assign_homework_manually(*, teacher, student, plan_item, due_at=None):
    """
    Выдать ДЗ ученику из пункта плана без завершённого занятия в расписании.
    """
    plan_item = (
        LessonPlanItem.objects.select_related("plan", "linked_lesson")
        .prefetch_related(
            "homework_materials",
            "homework_interactives",
            "attached_interactives",
        )
        .get(pk=plan_item.pk)
    )
    plan = plan_item.plan
    if plan.teacher_id and plan.teacher_id != teacher.id:
        raise PermissionError("Нет доступа к этому пункту плана.")

    if not _plan_item_has_homework(plan_item):
        raise ValueError("В выбранном занятии нет домашнего задания.")

    lesson = ensure_lesson_from_plan_item(plan_item, teacher)

    homework, hw_created = Homework.objects.get_or_create(
        teacher=teacher,
        lesson_plan_item=plan_item,
        student=student,
        defaults={
            "title": f"ДЗ: {plan_item.title}",
            "description": plan_item.homework_description or "",
            "lesson": lesson,
            "status": HomeworkStatus.ASSIGNED,
            "due_at": due_at,
        },
    )
    if not hw_created:
        homework.title = f"ДЗ: {plan_item.title}"
        homework.description = plan_item.homework_description or homework.description
        homework.lesson = lesson
        homework.due_at = due_at
        if homework.status == HomeworkStatus.DRAFT:
            homework.status = HomeworkStatus.ASSIGNED
        homework.save(
            update_fields=[
                "title",
                "description",
                "lesson",
                "due_at",
                "status",
                "updated_at",
            ]
        )
    _sync_homework_tasks(homework, plan_item)

    for interactive in plan_item.attached_interactives.all():
        _ensure_interactive_assignment(
            teacher=teacher,
            interactive=interactive,
            student=student,
            lesson=lesson,
            plan_item=plan_item,
        )
    for interactive in plan_item.homework_interactives.all():
        _ensure_interactive_assignment(
            teacher=teacher,
            interactive=interactive,
            student=student,
            lesson=lesson,
            plan_item=plan_item,
        )

    _record_variant_tasks_for_homework(homework, student, teacher)
    from .homework_api import ensure_homework_in_review_queue
    from .homework_from_review import notify_students_homework_assigned

    ensure_homework_in_review_queue(homework, student)
    try:
        notify_students_homework_assigned(homework)
    except Exception:
        logger.exception("Failed to notify students about homework %s", homework.pk)
    return homework


def assign_custom_homework(
    *,
    teacher,
    student,
    title,
    description="",
    material_ids=None,
    interactive_ids=None,
    due_at=None,
):
    """Выдать дополнительное ДЗ ученику без привязки к плану."""
    from .models import Interactive, Material

    title = (title or "").strip()
    description = (description or "").strip()
    material_ids = [int(pk) for pk in (material_ids or []) if pk]
    interactive_ids = [int(pk) for pk in (interactive_ids or []) if pk]

    if not title:
        raise ValueError("Укажите название задания.")

    if not description and not material_ids and not interactive_ids:
        raise ValueError("Добавьте описание или материалы к заданию.")

    materials = []
    if material_ids:
        materials = list(
            Material.objects.filter(pk__in=material_ids).filter(
                Q(is_public=True) | Q(teacher=teacher) | Q(teacher__isnull=True, is_public=True)
            )
        )
        if len(materials) != len(set(material_ids)):
            raise ValueError("Некоторые материалы недоступны.")

    interactives = []
    if interactive_ids:
        interactives = list(
            Interactive.objects.filter(pk__in=interactive_ids, teacher=teacher).exclude(
                status=InteractiveStatus.ARCHIVED
            )
        )
        if len(interactives) != len(set(interactive_ids)):
            raise ValueError("Некоторые интерактивы недоступны.")

    homework = Homework.objects.create(
        teacher=teacher,
        student=student,
        title=title,
        description=description,
        status=HomeworkStatus.ASSIGNED,
        due_at=due_at,
    )

    order = 0
    if description:
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.TEXT,
            title="Домашнее задание",
            description=description,
            order=order,
        )
        order += 1

    for material in materials:
        order = _add_material_homework_task(homework, material, order)

    for interactive in interactives:
        order = _add_interactive_homework_task(homework, interactive, order)
        _ensure_interactive_assignment(
            teacher=teacher,
            interactive=interactive,
            student=student,
            lesson=None,
            plan_item=None,
        )

    _record_variant_tasks_for_homework(homework, student, teacher)
    from .homework_api import ensure_homework_in_review_queue

    ensure_homework_in_review_queue(homework, student)
    return homework


def copy_homework_to_students(
    *,
    teacher,
    source_homework,
    students,
    due_at=None,
    keep_due_at=False,
):
    """
    Скопировать ДЗ (задачи + описание) и выдать другим ученикам.
    На каждого ученика — отдельная запись Homework (как при групповой выдаче).
    """
    from django.utils.dateparse import parse_datetime

    from .choices import StudentStatus
    from .homework_api import is_live_meeting_homework
    from .models import Student

    if source_homework.teacher_id != teacher.id:
        raise PermissionError("Нет доступа к этому заданию.")
    if is_live_meeting_homework(source_homework):
        raise ValueError("Вариант с урока нельзя копировать как домашнее задание.")

    if isinstance(due_at, str) and due_at.strip():
        parsed = parse_datetime(due_at.strip())
        if parsed is None:
            raise ValueError("Некорректный срок сдачи.")
        due_at = parsed

    if keep_due_at and due_at is None:
        due_at = source_homework.due_at

    recipient_ids = []
    for raw in students or []:
        try:
            recipient_ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    recipient_ids = list(dict.fromkeys(recipient_ids))
    if not recipient_ids:
        raise ValueError("Выберите хотя бы одного ученика.")

    recipients = list(
        Student.objects.filter(
            teacher=teacher,
            pk__in=recipient_ids,
            status=StudentStatus.ACTIVE,
        )
    )
    if not recipients:
        raise ValueError("Не найдены активные ученики для назначения.")

    source_tasks = list(
        source_homework.tasks.filter(is_active=True).order_by("order", "id")
    )
    if not source_tasks and not (source_homework.description or "").strip():
        raise ValueError("В исходном задании нет содержимого для копирования.")

    created = []
    errors = []
    for student in recipients:
        try:
            homework = Homework.objects.create(
                teacher=teacher,
                student=student,
                title=source_homework.title,
                description=source_homework.description or "",
                lesson=source_homework.lesson,
                # Не копируем lesson_plan_item — иначе get_or_create по плану
                # может конфликтовать с уже выданным пунктом плана.
                lesson_plan_item=None,
                student_subject=source_homework.student_subject,
                group=None,
                due_at=due_at,
                status=HomeworkStatus.ASSIGNED,
            )
            for src in source_tasks:
                HomeworkTask.objects.create(
                    homework=homework,
                    task_type=src.task_type,
                    title=src.title,
                    description=src.description or "",
                    interactive=src.interactive,
                    task_id=src.task_id or "",
                    order=src.order,
                )
                if src.interactive_id:
                    _ensure_interactive_assignment(
                        teacher=teacher,
                        interactive=src.interactive,
                        student=student,
                        lesson=source_homework.lesson,
                        plan_item=None,
                    )
            _record_variant_tasks_for_homework(homework, student, teacher)
            from .homework_api import ensure_homework_in_review_queue
            from .homework_from_review import notify_students_homework_assigned

            ensure_homework_in_review_queue(homework, student)
            try:
                notify_students_homework_assigned(homework)
            except Exception:
                logger.exception("Failed to notify students about homework %s", homework.pk)
            created.append(homework)
        except Exception as exc:
            errors.append({"student_id": student.pk, "error": str(exc)})

    if not created and errors:
        raise ValueError(errors[0].get("error") or "Не удалось скопировать задание.")

    return {"homeworks": created, "errors": errors}


def _record_variant_tasks_for_homework(homework, student, teacher):
    """Сохранить ID задач из всех вариантов, прикреплённых к ДЗ, в историю ученика."""
    try:
        from Generator.models import VariantContent  # noqa: PLC0415

        from .homework_api import extract_variant_id
        from .models import StudentTaskHistory

        variant_ids = []
        for hw_task in homework.tasks.filter(is_active=True):
            vid = extract_variant_id(hw_task.description)
            if vid:
                variant_ids.append(vid)
            # Проверяем также ссылку у прикреплённого материала (если поле есть)
            material = getattr(hw_task, "material", None)
            if material is not None:
                vid = extract_variant_id(getattr(material, "external_url", "") or "")
                if vid:
                    variant_ids.append(vid)

        task_ids = list(
            VariantContent.objects.filter(variant_id__in=variant_ids)
            .values_list('task_id', flat=True)
            .distinct()
        )

        for task_id in task_ids:
            StudentTaskHistory.objects.get_or_create(
                student=student,
                generator_task_id=task_id,
                defaults={'teacher': teacher, 'homework': homework},
            )
    except Exception:
        logging.getLogger(__name__).exception(
            "Failed to record task history for homework %s", homework.pk
        )


def check_variant_tasks_overlap(*, student, variant_id):
    """Вернуть список ID задач варианта, которые уже были выданы ученику ранее.

    Returns:
        list[int] — Generator task IDs, которые уже встречались в истории ученика.
    """
    try:
        from Generator.models import VariantContent  # noqa: PLC0415
        from .models import StudentTaskHistory

        task_ids = list(
            VariantContent.objects.filter(variant_id=variant_id)
            .values_list('task_id', flat=True)
        )
        already_seen = list(
            StudentTaskHistory.objects.filter(
                student=student,
                generator_task_id__in=task_ids,
            ).values_list('generator_task_id', flat=True)
        )
        return already_seen
    except Exception:
        logging.getLogger(__name__).exception(
            "check_variant_tasks_overlap failed for student %s variant %s",
            getattr(student, 'pk', student),
            variant_id,
        )
        return []


def _active_enrollment_for_homework(
    *,
    teacher,
    student,
    student_subject_id=None,
    schedule_event=None,
):
    """
    Enrollment для выдачи ДЗ: как get_active_enrollment для урока —
    учитываем предмет занятия, иначе берём непривязанный/последний план.
    """
    from .choices import EnrollmentStatus, GroupStatus
    from .models import LessonPlanEnrollment

    if schedule_event is not None:
        if getattr(schedule_event, "student_subject_id", None) and not student_subject_id:
            student_subject_id = schedule_event.student_subject_id
        # Прямая привязка урока к пункту плана — приоритетнее «последнего» enrollment.
        plan_item = getattr(schedule_event, "lesson_plan_item", None)
        if plan_item is not None and plan_item.plan_id:
            linked = (
                LessonPlanEnrollment.objects.filter(
                    teacher=teacher,
                    student=student,
                    plan_id=plan_item.plan_id,
                )
                .exclude(status__in=[EnrollmentStatus.CANCELLED, EnrollmentStatus.COMPLETED])
                .select_related("plan", "student_subject")
                .order_by("-created_at")
                .first()
            )
            if linked:
                return linked

    qs = (
        LessonPlanEnrollment.objects.filter(teacher=teacher, student=student)
        .exclude(status__in=[EnrollmentStatus.CANCELLED, EnrollmentStatus.COMPLETED])
        .select_related("plan", "student_subject")
    )
    if student_subject_id:
        subject_qs = qs.filter(student_subject_id=student_subject_id)
        if subject_qs.exists():
            qs = subject_qs
        else:
            qs = qs.filter(student_subject__isnull=True)
    else:
        unbound = qs.filter(student_subject__isnull=True)
        # Если все enrollment с предметом — не отбрасываем их при отсутствии subject_id.
        if unbound.exists():
            qs = unbound

    enrollment = qs.order_by("-created_at").first()
    if enrollment:
        return enrollment

    group_ids = list(
        student.groups.filter(status=GroupStatus.ACTIVE).values_list("pk", flat=True)
    )
    if not group_ids:
        return None
    return (
        LessonPlanEnrollment.objects.filter(
            teacher=teacher,
            group_id__in=group_ids,
        )
        .exclude(status__in=[EnrollmentStatus.CANCELLED, EnrollmentStatus.COMPLETED])
        .select_related("plan", "student_subject")
        .order_by("-created_at")
        .first()
    )


def student_can_receive_plan_item_homework(*, teacher, student, plan_item, student_subject_id=None):
    """Пункт плана доступен ученику через активный enrollment (с учётом предмета)."""
    from .choices import EnrollmentStatus, GroupStatus
    from .models import LessonPlanEnrollment

    qs = LessonPlanEnrollment.objects.filter(
        teacher=teacher,
        plan_id=plan_item.plan_id,
    ).exclude(status__in=[EnrollmentStatus.CANCELLED, EnrollmentStatus.COMPLETED])

    student_match = qs.filter(student=student)
    if student_subject_id:
        subject_qs = student_match.filter(student_subject_id=student_subject_id)
        if subject_qs.exists():
            return True
        if student_match.filter(student_subject__isnull=True).exists():
            return True
    elif student_match.exists():
        return True

    group_ids = list(
        student.groups.filter(status=GroupStatus.ACTIVE).values_list("pk", flat=True)
    )
    if group_ids and qs.filter(group_id__in=group_ids).exists():
        return True
    return False


def homework_options_for_student(
    *,
    teacher,
    student,
    student_subject_id=None,
    schedule_event=None,
):
    """Пункты плана с ДЗ для выдачи конкретному ученику."""
    enrollment = _active_enrollment_for_homework(
        teacher=teacher,
        student=student,
        student_subject_id=student_subject_id,
        schedule_event=schedule_event,
    )

    if not enrollment:
        suggested = suggest_homework_due_at(
            teacher=teacher,
            student=student,
            subject=None,
            after=timezone.now(),
        )
        return {
            "enrollment_id": None,
            "plan_id": None,
            "plan_title": "",
            "items": [],
            "allow_custom": True,
            "preferred_plan_item_id": None,
            "suggested_due_at": suggested.isoformat() if suggested else None,
            "suggested_due_source": "next_lesson" if suggested else None,
        }

    assigned = {
        hw.lesson_plan_item_id: hw
        for hw in Homework.objects.filter(
            teacher=teacher,
            student=student,
            lesson_plan_item__plan=enrollment.plan,
        ).exclude(status=HomeworkStatus.ARCHIVED)
    }

    items = []
    plan_items = (
        enrollment.plan.items.prefetch_related("homework_materials", "homework_interactives")
        .order_by("order")
    )
    for plan_item in plan_items:
        if not _plan_item_has_homework(plan_item):
            continue
        hw = assigned.get(plan_item.pk)
        summary = (plan_item.homework_description or "").strip()
        if not summary:
            parts = []
            mat_count = plan_item.homework_materials.count()
            int_count = plan_item.homework_interactives.count()
            if mat_count:
                parts.append(f"{mat_count} материал(ов)")
            if int_count:
                parts.append(f"{int_count} интерактив(ов)")
            summary = ", ".join(parts) if parts else "Домашнее задание"
        items.append({
            "id": plan_item.pk,
            "order": plan_item.order,
            "title": plan_item.title,
            "topic": plan_item.topic or "",
            "homework_summary": summary[:200],
            "assigned": hw is not None,
            "homework_id": hw.pk if hw else None,
            "homework_status": hw.status if hw else None,
        })

    subject = _normalize_subject(getattr(enrollment.plan, "subject", "") or "")
    suggested = suggest_homework_due_at(
        teacher=teacher,
        student=student,
        subject=subject or None,
        after=timezone.now(),
    )

    preferred_plan_item_id = None
    if schedule_event is not None:
        event_item_id = getattr(schedule_event, "lesson_plan_item_id", None)
        if event_item_id and any(item["id"] == event_item_id for item in items):
            preferred_plan_item_id = event_item_id
        else:
            # Пункт текущего урока может быть без материалов ДЗ в списке —
            # всё равно подсветим его, если он из того же плана.
            if event_item_id:
                for plan_item in enrollment.plan.items.filter(pk=event_item_id):
                    preferred_plan_item_id = plan_item.pk
                    break

    return {
        "enrollment_id": enrollment.pk,
        "plan_id": enrollment.plan_id,
        "plan_title": enrollment.plan.title,
        "plan_subject": subject or "",
        "items": items,
        "allow_custom": True,
        "preferred_plan_item_id": preferred_plan_item_id,
        "suggested_due_at": suggested.isoformat() if suggested else None,
        "suggested_due_source": "next_lesson" if suggested else None,
    }


def release_for_student(event, student, plan_item, lesson):
    teacher = event.owner
    assignment, created = LessonAssignment.objects.get_or_create(
        teacher=teacher,
        lesson=lesson,
        student=student,
        defaults={
            "due_at": event.ends_at,
            "status": AssignmentStatus.COMPLETED,
        },
    )
    if not created:
        assignment.due_at = event.ends_at
        assignment.status = AssignmentStatus.COMPLETED
        assignment.save(update_fields=["due_at", "status", "updated_at"])

    if _plan_item_has_homework(plan_item):
        due_at = resolve_homework_due_at(event=event, student=student)
        homework, hw_created = Homework.objects.get_or_create(
            teacher=teacher,
            lesson_plan_item=plan_item,
            student=student,
            defaults={
                "title": f"ДЗ: {plan_item.title}",
                "description": plan_item.homework_description or "",
                "lesson": lesson,
                "status": HomeworkStatus.ASSIGNED,
                "due_at": due_at,
                "student_subject": event.student_subject if event.student_subject_id else None,
            },
        )
        if not hw_created:
            homework.title = f"ДЗ: {plan_item.title}"
            homework.description = plan_item.homework_description or homework.description
            homework.lesson = lesson
            homework.due_at = due_at
            if homework.status == HomeworkStatus.DRAFT:
                homework.status = HomeworkStatus.ASSIGNED
            update_fields = [
                "title",
                "description",
                "lesson",
                "due_at",
                "status",
                "updated_at",
            ]
            if event.student_subject_id and homework.student_subject_id != event.student_subject_id:
                homework.student_subject_id = event.student_subject_id
                update_fields.append("student_subject")
            homework.save(update_fields=update_fields)
        _sync_homework_tasks(homework, plan_item)
        # Как при ручной выдаче: сразу показать ДЗ в разделе «Проверка».
        from .homework_api import ensure_homework_in_review_queue
        from .homework_from_review import notify_students_homework_assigned

        ensure_homework_in_review_queue(homework, student)
        # Уведомляем только при первой выдаче (dedup внутри dispatcher тоже есть).
        if hw_created:
            try:
                notify_students_homework_assigned(homework)
            except Exception:
                logger.exception("Failed to notify students about homework %s", homework.pk)
        if event.homework_id != homework.id:
            event.homework = homework
            event.save(update_fields=["homework", "updated_at"])

    for interactive in plan_item.attached_interactives.all():
        _ensure_interactive_assignment(
            teacher=teacher,
            interactive=interactive,
            student=student,
            lesson=lesson,
            plan_item=plan_item,
        )
    for interactive in plan_item.homework_interactives.all():
        _ensure_interactive_assignment(
            teacher=teacher,
            interactive=interactive,
            student=student,
            lesson=lesson,
            plan_item=plan_item,
        )

    return assignment


def _resolve_plan_item_for_release(event):
    plan_item, _ = resolve_plan_item_for_event(event)
    if plan_item:
        return plan_item
    if event.lesson_plan_item_id:
        return event.lesson_plan_item
    linked = event.plan_items.order_by("order", "id").first()
    if linked:
        return linked
    return None


def release_for_event(event):
    if not event_is_finished(event):
        return []

    plan_item = _resolve_plan_item_for_release(event)
    if not plan_item and event.lesson_id:
        return _release_legacy_lesson(event)

    if not plan_item:
        return []

    lesson = ensure_lesson_from_plan_item(plan_item, event.owner)
    event_updates = []
    if event.lesson_id != lesson.id:
        event.lesson = lesson
        event_updates.append("lesson")
    if event.lesson_plan_item_id != plan_item.id:
        event.lesson_plan_item = plan_item
        event_updates.append("lesson_plan_item")
    if event_updates:
        event_updates.append("updated_at")
        event.save(update_fields=event_updates)

    released = []
    for student in target_students(event):
        released.append(release_for_student(event, student, plan_item, lesson))
    return released


def _release_legacy_lesson(event):
    lesson = event.lesson
    if not lesson:
        return []
    released = []
    for student in target_students(event):
        assignment, created = LessonAssignment.objects.get_or_create(
            teacher=event.owner,
            lesson=lesson,
            student=student,
            defaults={
                "due_at": event.ends_at,
                "status": AssignmentStatus.COMPLETED,
            },
        )
        if not created:
            assignment.status = AssignmentStatus.COMPLETED
            assignment.due_at = event.ends_at
            assignment.save(update_fields=["status", "due_at", "updated_at"])
        released.append(assignment)
    return released


def release_due_events_for_students(students):
    if isinstance(students, Student):
        student_list = [students]
    else:
        student_list = list(students)
    if not student_list:
        return []

    student_ids = [student.id for student in student_list]
    group_ids = list({
        group.id
        for student in student_list
        for group in student.groups.all()
    })

    filters = Q(student_id__in=student_ids)
    if group_ids:
        filters |= Q(group_id__in=group_ids)

    events = (
        ScheduleEvent.objects.filter(filters)
        .exclude(status=ScheduleEvent.Status.CANCELLED)
        .filter(
            Q(status__in=FINISHED_STATUSES)
            | Q(ends_at__lte=timezone.now())
        )
        .select_related("owner", "student", "group", "lesson", "lesson_plan_item")
        .prefetch_related(
            "participants",
            "group__students",
            "plan_items",
            "plan_items__materials",
            "plan_items__attached_interactives",
            "plan_items__homework_materials",
            "plan_items__homework_interactives",
            "plan_items__linked_lesson",
            "lesson_plan_item__materials",
            "lesson_plan_item__attached_interactives",
            "lesson_plan_item__homework_materials",
            "lesson_plan_item__homework_interactives",
            "lesson_plan_item__linked_lesson",
            "series__lesson_plan_item",
        )
        .distinct()
    )

    released = []
    for event in events:
        try:
            with transaction.atomic():
                released.extend(release_for_event(event))
        except Exception:
            logger.exception("Failed to release student materials for event #%s", event.pk)
    return released


class StudentReleaseService:
    event_is_finished = staticmethod(event_is_finished)
    release_for_event = staticmethod(release_for_event)
    release_due_events_for_students = staticmethod(release_due_events_for_students)
