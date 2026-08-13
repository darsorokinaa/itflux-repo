"""
Activation / onboarding state for teachers.

Computed from existing Cabinet tables. No progress rows, no extra flags.
The checklist is hidden once the teacher has actually run a first lesson.
"""

from __future__ import annotations

from typing import Any

from django.contrib.auth.models import User
from django.db.models import Q

from .choices import HomeworkStatus, StudentStatus, StudentSubjectStatus
from .journal_models import JournalStatus, LessonJournal
from .models import (
    Homework,
    InteractiveBoard,
    LessonPlanItem,
    ScheduleEvent,
    ScheduleEventMaterial,
    Student,
    StudentSubject,
    VideoMeeting,
)

ACTIVATION_STEP_KEYS = (
    "student",
    "subject",
    "schedule",
    "materials",
    "conduct",
)

STEP_LABELS = {
    "registered": "Зарегистрироваться",
    "student": "Добавить ученика",
    "subject": "Добавить предмет",
    "schedule": "Запланировать занятие",
    "materials": "Подготовить материалы",
    "conduct": "Провести первое занятие",
}

CTA_BY_STEP = {
    "student": {
        "label": "Добавить первого ученика",
        "href": "/cabinet/students?invite=1",
        "hint": "После этого можно сразу поставить занятие в расписание — ждать входа ученика не нужно.",
    },
    "subject": {
        "label": "Настроить предмет ученика",
        "href": "/cabinet/students",
        "hint": "Предмет нужен, чтобы подобрать материалы и корректно вести журнал.",
    },
    "schedule": {
        "label": "Запланировать первое занятие",
        "href": "/cabinet/schedule",
        "hint": "Материалы можно добавить сразу внутри карточки занятия.",
    },
    "materials": {
        "label": "Подготовить занятие",
        "href": "/cabinet/schedule",
        "hint": "Добавьте доску, готовый урок, интерактив, вариант или файл. Можно продолжить без материалов.",
    },
    "conduct": {
        "label": "Всё готово к первому уроку",
        "href": "/cabinet/schedule",
        "hint": "Откройте карточку занятия и начните урок в существующей комнате.",
    },
}

_ACTIVE_EVENT_STATUSES = (
    ScheduleEvent.Status.PLANNED,
    ScheduleEvent.Status.MOVED,
    ScheduleEvent.Status.DONE,
    ScheduleEvent.Status.COMPLETED,
)

_CONDUCTED_EVENT_STATUSES = (
    ScheduleEvent.Status.DONE,
    ScheduleEvent.Status.COMPLETED,
)

_ASSIGNED_HOMEWORK_STATUSES = (
    HomeworkStatus.ASSIGNED,
    HomeworkStatus.COMPLETED,
    HomeworkStatus.OVERDUE,
    HomeworkStatus.CHECKED,
)


def _teacher_students_qs(teacher: User):
    return Student.objects.filter(teacher=teacher).exclude(status=StudentStatus.ARCHIVED)


def _teacher_events_qs(teacher: User):
    return ScheduleEvent.objects.filter(owner=teacher).filter(status__in=_ACTIVE_EVENT_STATUSES)


def teacher_has_student(teacher: User) -> bool:
    return _teacher_students_qs(teacher).exists()


def teacher_has_connected_student(teacher: User) -> bool:
    return _teacher_students_qs(teacher).filter(user__isnull=False).exists()


def teacher_has_subject(teacher: User) -> bool:
    return StudentSubject.objects.filter(
        student__teacher=teacher,
        status=StudentSubjectStatus.ACTIVE,
    ).exclude(student__status=StudentStatus.ARCHIVED).exists()


def teacher_has_schedule_event(teacher: User) -> bool:
    return _teacher_events_qs(teacher).exists()


def _event_ids_with_materials(teacher: User) -> set[int]:
    events = _teacher_events_qs(teacher)
    ids = set(events.values_list("pk", flat=True))
    if not ids:
        return set()

    found: set[int] = set()
    found.update(
        ScheduleEventMaterial.objects.filter(event_id__in=ids).values_list("event_id", flat=True)
    )
    found.update(
        InteractiveBoard.objects.filter(schedule_event_id__in=ids).values_list(
            "schedule_event_id", flat=True
        )
    )
    found.update(events.filter(lesson_id__isnull=False).values_list("pk", flat=True))
    found.update(events.filter(homework_id__isnull=False).values_list("pk", flat=True))

    plan_links = list(
        events.filter(lesson_plan_item_id__isnull=False).values_list("pk", "lesson_plan_item_id")
    )
    plan_ids = [item_id for _event_id, item_id in plan_links if item_id]
    if plan_ids:
        filled_plan_ids = set(
            LessonPlanItem.objects.filter(pk__in=plan_ids)
            .filter(
                Q(materials__isnull=False)
                | Q(attached_interactives__isnull=False)
                | Q(homework_materials__isnull=False)
                | Q(homework_interactives__isnull=False)
                | Q(linked_lesson_id__isnull=False)
            )
            .values_list("pk", flat=True)
        )
        for event_id, item_id in plan_links:
            if item_id in filled_plan_ids:
                found.add(event_id)
    return found


def teacher_has_lesson_materials(teacher: User) -> bool:
    return bool(_event_ids_with_materials(teacher))


def teacher_has_conducted_lesson(teacher: User) -> bool:
    if _teacher_events_qs(teacher).filter(status__in=_CONDUCTED_EVENT_STATUSES).exists():
        return True
    if VideoMeeting.objects.filter(
        schedule_event__owner=teacher,
        status=VideoMeeting.Status.FINISHED,
    ).exists():
        return True
    if VideoMeeting.objects.filter(
        schedule_event__owner=teacher,
        actual_finished_at__isnull=False,
    ).exists():
        return True
    if LessonJournal.objects.filter(
        teacher=teacher,
        status=JournalStatus.COMPLETED,
    ).exists():
        return True
    return False


def teacher_has_started_video_lesson(teacher: User) -> bool:
    return VideoMeeting.objects.filter(schedule_event__owner=teacher).filter(
        Q(status__in=(VideoMeeting.Status.LIVE, VideoMeeting.Status.FINISHED))
        | Q(actual_started_at__isnull=False)
    ).exists()


def teacher_has_assigned_homework(teacher: User) -> bool:
    return Homework.objects.filter(
        teacher=teacher,
        status__in=_ASSIGNED_HOMEWORK_STATUSES,
    ).exclude(description__contains="live-meeting:").exists()


def teacher_has_homework_submission(teacher: User) -> bool:
    from .models import HomeworkSubmission
    from .choices import SubmissionStatus

    return HomeworkSubmission.objects.filter(
        homework__teacher=teacher,
        submitted_at__isnull=False,
    ).filter(
        Q(status=SubmissionStatus.SUBMITTED) | Q(submitted_at__isnull=False)
    ).exclude(
        homework__description__contains="live-meeting:",
    ).exists()


def teacher_has_completed_journal(teacher: User) -> bool:
    return LessonJournal.objects.filter(
        teacher=teacher,
        status=JournalStatus.COMPLETED,
    ).exists()


def _first_student_id(teacher: User) -> int | None:
    row = _teacher_students_qs(teacher).order_by("created_at", "pk").values_list("pk", flat=True).first()
    return int(row) if row else None


def _first_event_id(teacher: User) -> int | None:
    row = _teacher_events_qs(teacher).order_by("starts_at", "pk").values_list("pk", flat=True).first()
    return int(row) if row else None


def _next_event_id_for_materials(teacher: User) -> int | None:
    filled = _event_ids_with_materials(teacher)
    qs = _teacher_events_qs(teacher).order_by("starts_at", "pk")
    if filled:
        qs = qs.exclude(pk__in=filled)
    row = qs.values_list("pk", flat=True).first()
    if row:
        return int(row)
    return _first_event_id(teacher)


def _href_with_student(base: str, student_id: int | None) -> str:
    if not student_id:
        return base
    sep = "&" if "?" in base else "?"
    if "students" in base:
        return f"{base}{sep}editStudent={student_id}"
    if "schedule" in base:
        return f"{base}{sep}create=1&student={student_id}"
    return base


def _href_with_event(base: str, event_id: int | None, *, prepare: bool = False) -> str:
    if not event_id:
        return base
    sep = "&" if "?" in base else "?"
    href = f"{base}{sep}event={event_id}"
    if prepare:
        href = f"{href}&prepare=1"
    return href


def build_teacher_onboarding_state(teacher: User) -> dict[str, Any]:
    """Return a JSON-safe payload for the teacher cabinet home."""
    has_student = teacher_has_student(teacher)
    has_subject = teacher_has_subject(teacher)
    has_event = teacher_has_schedule_event(teacher)
    has_materials = teacher_has_lesson_materials(teacher)
    has_conducted = teacher_has_conducted_lesson(teacher)

    flags = {
        "registered": True,
        "student": has_student,
        "subject": has_subject,
        "schedule": has_event,
        "materials": has_materials,
        "conduct": has_conducted,
    }

    activation_done = sum(1 for key in ACTIVATION_STEP_KEYS if flags[key])
    next_key = None if has_conducted else next(
        (key for key in ACTIVATION_STEP_KEYS if not flags[key]),
        None,
    )

    student_id = _first_student_id(teacher) if has_student else None
    event_id = None
    if next_key in ("materials", "conduct") or has_event:
        event_id = (
            _next_event_id_for_materials(teacher)
            if next_key == "materials"
            else _first_event_id(teacher)
        )

    cta = None
    if next_key:
        spec = dict(CTA_BY_STEP[next_key])
        href = spec["href"]
        if next_key == "subject":
            href = _href_with_student("/cabinet/students", student_id)
        elif next_key == "schedule":
            href = _href_with_student("/cabinet/schedule", student_id)
        elif next_key == "materials":
            href = _href_with_event("/cabinet/schedule", event_id, prepare=True)
        elif next_key == "conduct":
            href = _href_with_event("/cabinet/schedule", event_id, prepare=False)
        spec["href"] = href
        spec["step"] = next_key
        cta = spec

    steps = [
        {
            "key": "registered",
            "label": STEP_LABELS["registered"],
            "done": True,
        }
    ]
    steps.extend(
        {
            "key": key,
            "label": STEP_LABELS[key],
            "done": flags[key],
        }
        for key in ACTIVATION_STEP_KEYS
    )

    return {
        "visible": not has_conducted,
        "completed_steps": activation_done,
        "total_steps": len(ACTIVATION_STEP_KEYS),
        "next_step": next_key,
        "cta": cta,
        "steps": steps,
        "flags": {
            "has_student": has_student,
            "has_connected_student": teacher_has_connected_student(teacher),
            "has_subject": has_subject,
            "has_schedule_event": has_event,
            "has_materials": has_materials,
            "has_conducted_lesson": has_conducted,
        },
        "context": {
            "student_id": student_id,
            "event_id": event_id,
        },
    }
