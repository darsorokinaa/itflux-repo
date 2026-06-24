"""Publish lesson materials and homework to the student cabinet when a class ends."""

import logging

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
        if material.material_type == "task_set" or (
            material.external_url and "/variant/" in material.external_url
        ):
            task_type = HomeworkTaskType.GENERATED_TASK
        elif material.file:
            task_type = HomeworkTaskType.FILE
        else:
            task_type = HomeworkTaskType.EXTERNAL_LINK
        if material.file:
            resource_url = material.file.url
        elif material.external_url:
            resource_url = material.external_url.strip()
        else:
            resource_url = (material.topic or "").strip()
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
        order += 1

    for interactive in plan_item.homework_interactives.all():
        HomeworkTask.objects.get_or_create(
            homework=homework,
            task_type=HomeworkTaskType.INTERACTIVE,
            interactive=interactive,
            title=interactive.title,
            defaults={"order": order},
        )
        order += 1


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
