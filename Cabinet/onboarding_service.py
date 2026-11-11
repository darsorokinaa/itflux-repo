"""
Activation / onboarding state for teachers.

Computed from existing Cabinet tables. The visible checklist is the first day
until a result: add a student, give a variant or homework, send the link.
It hides when those three steps are done or the teacher dismisses it.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone

from .choices import (
    HomeworkStatus,
    InvitationStatus,
    StudentStatus,
    StudentSubjectStatus,
)
from .journal_models import JournalStatus, LessonJournal
from .models import (
    Homework,
    InteractiveBoard,
    LessonPlanItem,
    ScheduleEvent,
    ScheduleEventMaterial,
    Student,
    StudentInvitation,
    StudentSubject,
    VideoMeeting,
)

ACTIVATION_STEP_KEYS = (
    "student",
    "assignment",
    "share",
)

FIRST_DAY_WINDOW = timedelta(days=14)

STEP_LABELS = {
    "registered": "Зарегистрироваться",
    "student": "Добавить ученика",
    "assignment": "Выдать первый вариант или домашнее задание",
    "share": "Отправить ученику ссылку",
    "invite": "Отправить приглашение",
    "schedule": "Создать занятие",
    "subject": "Добавить предмет",
    "materials": "Подготовить материалы",
    "conduct": "Провести первое занятие",
}

CTA_BY_STEP = {
    "student": {
        "label": "Добавить ученика",
        "href": "/cabinet/students?invite=1",
        "hint": "Это займёт пару минут. После ученика можно сразу выдать вариант или домашнее задание.",
        "title": "Добавьте первого ученика",
    },
    "assignment": {
        "label": "Выдать задание",
        "href": "/cabinet?assign=1",
        "hint": "Соберите вариант в генераторе или выдайте домашнее задание — так появится первый результат.",
        "title": "Выдайте первый вариант или задание",
        "alt_label": "Собрать вариант",
        "alt_href": "/generator",
    },
    "share": {
        "label": "Отправить ссылку",
        "href": "/cabinet/students?invite=1",
        "hint": "Скопируйте ссылку и отправьте ученику, чтобы он открыл задание.",
        "title": "Отправьте ученику ссылку",
    },
}

ONBOARDING_UX_VERSION = 3

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
    return LessonJournal.objects.filter(
        teacher=teacher,
        status=JournalStatus.COMPLETED,
    ).exists()


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
    from .choices import SubmissionStatus
    from .models import HomeworkSubmission

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


def teacher_has_pending_invite(teacher: User) -> bool:
    return StudentInvitation.objects.filter(
        teacher=teacher,
        status=InvitationStatus.PENDING,
    ).exists()


def teacher_has_given_work(teacher: User) -> bool:
    """Вариант, выданный ученику, или домашнее задание не в черновике."""
    if teacher_has_assigned_homework(teacher):
        return True
    from .variant_live_models import VariantIssuance

    return VariantIssuance.objects.filter(teacher=teacher).exists()


def teacher_has_shared_access(teacher: User) -> bool:
    if teacher_has_connected_student(teacher):
        return True
    return StudentInvitation.objects.filter(teacher=teacher).exclude(
        status=InvitationStatus.CANCELLED,
    ).exists()


def checklist_dismissed(teacher: User) -> bool:
    from .storefront_models import TeacherUiDismissal

    return TeacherUiDismissal.objects.filter(
        user=teacher,
        notice_key=TeacherUiDismissal.FIRST_DAY_CHECKLIST,
    ).exists()


def _checklist_audience(teacher: User, *, has_student: bool, has_assignment: bool) -> bool:
    """Новые учителя и те, кто ещё не добавил ни ученика, ни задания."""
    joined = getattr(teacher, "date_joined", None)
    recent = bool(joined and joined >= timezone.now() - FIRST_DAY_WINDOW)
    never_started = not has_student and not has_assignment
    return recent or never_started


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
    """Return a JSON-safe payload for the teacher cabinet home.

    The three visible steps come from the database. Dismissal is the only
    stored flag, and it only hides the card.
    """
    has_student = teacher_has_student(teacher)
    has_connected = teacher_has_connected_student(teacher)
    has_pending_invite = teacher_has_pending_invite(teacher)
    has_subject = teacher_has_subject(teacher)
    has_event = teacher_has_schedule_event(teacher)
    has_materials = teacher_has_lesson_materials(teacher)
    has_conducted = teacher_has_conducted_lesson(teacher)
    has_assignment = teacher_has_given_work(teacher)
    has_share = teacher_has_shared_access(teacher)
    dismissed = checklist_dismissed(teacher)

    flags = {
        "registered": True,
        "student": has_student,
        "assignment": has_assignment,
        "share": has_share,
        "invite": has_connected,
        "schedule": has_event,
        "subject": has_subject,
        "materials": has_materials,
        "conduct": has_conducted,
    }

    if not has_student:
        next_key = "student"
    elif not has_assignment:
        next_key = "assignment"
    elif not has_share:
        next_key = "share"
    else:
        next_key = None

    activation_done = sum(1 for key in ACTIVATION_STEP_KEYS if flags[key])
    in_audience = _checklist_audience(
        teacher,
        has_student=has_student,
        has_assignment=has_assignment,
    )
    visible = bool(in_audience and not dismissed and next_key is not None)

    student_id = _first_student_id(teacher) if has_student else None
    event_id = _first_event_id(teacher) if has_event else None

    cta = None
    if next_key:
        spec = dict(CTA_BY_STEP[next_key])
        if next_key == "share" and has_pending_invite:
            spec["href"] = "/cabinet/students?tab=invites"
        spec["step"] = next_key
        cta = spec

    steps = [
        {
            "key": key,
            "label": STEP_LABELS[key],
            "done": flags[key],
        }
        for key in ACTIVATION_STEP_KEYS
    ]

    return {
        "visible": visible,
        "dismissed": dismissed,
        "completed_steps": activation_done,
        "total_steps": len(ACTIVATION_STEP_KEYS),
        "next_step": next_key,
        "cta": cta,
        "steps": steps,
        "ux_version": ONBOARDING_UX_VERSION,
        "flags": {
            "has_student": has_student,
            "has_assignment": has_assignment,
            "has_shared_access": has_share,
            "has_connected_student": has_connected,
            "has_pending_invite": has_pending_invite,
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
