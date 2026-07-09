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


def resolve_homework_due_at(*, event, student):
    """Срок ДЗ — до начала следующего урока ученика у этого учителя."""
    after = event.ends_at or event.starts_at or timezone.now()
    group = event.group if event.group_id else None
    next_event = (
        ScheduleEvent.objects.filter(
            owner=event.owner,
            starts_at__gt=after,
            event_type__in=LESSON_EVENT_TYPES,
        )
        .exclude(status=ScheduleEvent.Status.CANCELLED)
        .exclude(pk=event.pk)
        .filter(_student_upcoming_lesson_filter(student, group))
        .order_by("starts_at", "pk")
        .first()
    )
    return next_event.starts_at if next_event else None


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


def _sync_lesson_content(lesson, plan_item):
    lesson.title = plan_item.title or lesson.title
    lesson.topic = plan_item.topic or lesson.topic
    lesson.subtopic = plan_item.subtopic or lesson.subtopic
    lesson.task_number = plan_item.task_number or lesson.task_number
    lesson.theory_content = plan_item.goal or plan_item.planned_results or lesson.theory_content
    lesson.practice_content = plan_item.description or lesson.practice_content
    lesson.homework_description = plan_item.homework_description or lesson.homework_description
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

    if plan_item.linked_lesson_id:
        lesson = plan_item.linked_lesson
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
            status=LessonStatus.PUBLISHED,
            lesson_type=LessonType.INDIVIDUAL,
        )
        plan_item.linked_lesson = lesson
        plan_item.save(update_fields=["linked_lesson", "updated_at"])

    return _sync_lesson_content(lesson, plan_item)


def _material_homework_task_type(material):
    if material.material_type == "task_set" or (
        material.external_url and "/variant/" in material.external_url
    ):
        return HomeworkTaskType.GENERATED_TASK
    if material.file:
        return HomeworkTaskType.FILE
    return HomeworkTaskType.EXTERNAL_LINK


def _material_resource_url(material):
    if material.file:
        return material.file.url
    if material.external_url:
        return material.external_url.strip()
    return (material.topic or "").strip()


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
    return homework


def _extract_variant_id_from_url(url):
    """Извлечь ID варианта из URL вида /ege/math/variant/12345."""
    m = re.search(r'/variant/(\d+)', str(url or ''))
    return int(m.group(1)) if m else None


def _record_variant_tasks_for_homework(homework, student, teacher):
    """Сохранить ID задач из всех вариантов, прикреплённых к ДЗ, в историю ученика."""
    try:
        from Generator.models import VariantContent  # noqa: PLC0415
        from .models import StudentTaskHistory

        variant_ids = []
        for hw_task in homework.tasks.all():
            vid = _extract_variant_id_from_url(hw_task.description)
            if vid:
                variant_ids.append(vid)
            # Проверяем также ссылку у прикреплённого материала
            if hw_task.material:
                vid = _extract_variant_id_from_url(hw_task.material.external_url)
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


def homework_options_for_student(*, teacher, student):
    """Пункты плана с ДЗ для выдачи конкретному ученику."""
    from .choices import EnrollmentStatus, GroupStatus
    from .models import LessonPlanEnrollment

    enrollment = (
        LessonPlanEnrollment.objects.filter(
            teacher=teacher,
            student=student,
        )
        .exclude(status__in=[EnrollmentStatus.CANCELLED, EnrollmentStatus.COMPLETED])
        .select_related("plan")
        .order_by("-created_at")
        .first()
    )
    if not enrollment:
        group_ids = list(
            student.groups.filter(status=GroupStatus.ACTIVE).values_list("pk", flat=True)
        )
        if group_ids:
            enrollment = (
                LessonPlanEnrollment.objects.filter(
                    teacher=teacher,
                    group_id__in=group_ids,
                )
                .exclude(status__in=[EnrollmentStatus.CANCELLED, EnrollmentStatus.COMPLETED])
                .select_related("plan")
                .order_by("-created_at")
                .first()
            )

    if not enrollment:
        return {
            "enrollment_id": None,
            "plan_id": None,
            "plan_title": "",
            "items": [],
            "allow_custom": True,
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

    return {
        "enrollment_id": enrollment.pk,
        "plan_id": enrollment.plan_id,
        "plan_title": enrollment.plan.title,
        "items": items,
        "allow_custom": True,
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
