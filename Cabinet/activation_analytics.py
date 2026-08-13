"""
Internal product analytics for teacher activation.

All metrics are aggregated counts/rates. No names, emails, phones, tokens,
or room URLs are included.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from django.contrib.auth.models import User
from django.db.models import Min, Q
from django.utils import timezone

from .choices import StudentStatus
from .journal_models import JournalStatus, LessonJournal
from .models import (
    Homework,
    HomeworkSubmission,
    InteractiveBoard,
    LessonPlanItem,
    Profile,
    ScheduleEvent,
    ScheduleEventMaterial,
    Student,
    StudentSubject,
    VideoMeeting,
)
from .onboarding_service import (
    _ASSIGNED_HOMEWORK_STATUSES,
    _CONDUCTED_EVENT_STATUSES,
)

NUDGE_MAX_AGE_DAYS = 30


def _teacher_qs():
    return User.objects.filter(profile__role=Profile.Role.TEACHER)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


def _week_start(dt: datetime) -> datetime:
    local = timezone.localtime(dt)
    monday = (local - timedelta(days=local.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return monday


def _pct(part: int, whole: int) -> float | None:
    if whole <= 0:
        return None
    return round(100.0 * part / whole, 1)


def _first_event_at_by_teacher() -> dict[int, datetime]:
    rows = (
        ScheduleEvent.objects.exclude(
            status__in=(ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.DRAFT)
        )
        .values("owner_id")
        .annotate(first_at=Min("created_at"))
    )
    return {row["owner_id"]: row["first_at"] for row in rows}


def _first_student_at_by_teacher() -> dict[int, datetime]:
    rows = (
        Student.objects.exclude(status=StudentStatus.ARCHIVED)
        .values("teacher_id")
        .annotate(first_at=Min("created_at"))
    )
    return {row["teacher_id"]: row["first_at"] for row in rows}


def _first_connected_at_by_teacher() -> dict[int, datetime]:
    rows = (
        Student.objects.filter(user__isnull=False)
        .exclude(status=StudentStatus.ARCHIVED)
        .values("teacher_id")
        .annotate(first_at=Min("created_at"))
    )
    return {row["teacher_id"]: row["first_at"] for row in rows}


def _first_subject_at_by_teacher() -> dict[int, datetime]:
    rows = (
        StudentSubject.objects.filter(status="active")
        .values("student__teacher_id")
        .annotate(first_at=Min("created_at"))
    )
    return {row["student__teacher_id"]: row["first_at"] for row in rows}


def _first_material_at_by_teacher() -> dict[int, datetime]:
    result: dict[int, datetime] = {}

    def _merge(owner_id: int, at: datetime | None) -> None:
        if owner_id is None or at is None:
            return
        prev = result.get(owner_id)
        if prev is None or at < prev:
            result[owner_id] = at

    material_event_ids = ScheduleEventMaterial.objects.values_list("event_id", flat=True).distinct()
    for row in (
        ScheduleEvent.objects.filter(pk__in=material_event_ids)
        .values("owner_id")
        .annotate(first_at=Min("created_at"))
    ):
        _merge(row["owner_id"], row["first_at"])

    board_event_ids = InteractiveBoard.objects.filter(
        schedule_event_id__isnull=False
    ).values_list("schedule_event_id", flat=True)
    for row in (
        ScheduleEvent.objects.filter(pk__in=board_event_ids)
        .values("owner_id")
        .annotate(first_at=Min("created_at"))
    ):
        _merge(row["owner_id"], row["first_at"])

    plan_ids = LessonPlanItem.objects.filter(
        Q(materials__isnull=False)
        | Q(attached_interactives__isnull=False)
        | Q(homework_materials__isnull=False)
        | Q(homework_interactives__isnull=False)
        | Q(linked_lesson_id__isnull=False)
    ).values_list("pk", flat=True)
    for row in (
        ScheduleEvent.objects.filter(lesson_plan_item_id__in=plan_ids)
        .values("owner_id")
        .annotate(first_at=Min("created_at"))
    ):
        _merge(row["owner_id"], row["first_at"])

    for row in (
        ScheduleEvent.objects.filter(Q(lesson_id__isnull=False) | Q(homework_id__isnull=False))
        .exclude(status__in=(ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.DRAFT))
        .values("owner_id")
        .annotate(first_at=Min("created_at"))
    ):
        _merge(row["owner_id"], row["first_at"])
    return result


def _first_video_started_at_by_teacher() -> dict[int, datetime]:
    rows = (
        VideoMeeting.objects.filter(
            Q(status__in=(VideoMeeting.Status.LIVE, VideoMeeting.Status.FINISHED))
            | Q(actual_started_at__isnull=False)
        )
        .values("schedule_event__owner_id")
        .annotate(first_at=Min("actual_started_at"), first_created=Min("created_at"))
    )
    out: dict[int, datetime] = {}
    for row in rows:
        at = row["first_at"] or row["first_created"]
        if row["schedule_event__owner_id"] and at:
            out[row["schedule_event__owner_id"]] = at
    return out


def _first_video_finished_at_by_teacher() -> dict[int, datetime]:
    rows = (
        VideoMeeting.objects.filter(
            Q(status=VideoMeeting.Status.FINISHED) | Q(actual_finished_at__isnull=False)
        )
        .values("schedule_event__owner_id")
        .annotate(first_at=Min("actual_finished_at"), first_created=Min("created_at"))
    )
    out: dict[int, datetime] = {}
    for row in rows:
        at = row["first_at"] or row["first_created"]
        if row["schedule_event__owner_id"] and at:
            out[row["schedule_event__owner_id"]] = at
    return out


def _first_homework_assigned_at_by_teacher() -> dict[int, datetime]:
    rows = (
        Homework.objects.filter(status__in=_ASSIGNED_HOMEWORK_STATUSES)
        .exclude(description__contains="live-meeting:")
        .values("teacher_id")
        .annotate(first_at=Min("created_at"))
    )
    return {row["teacher_id"]: row["first_at"] for row in rows}


def _first_submission_at_by_teacher() -> dict[int, datetime]:
    rows = (
        HomeworkSubmission.objects.filter(submitted_at__isnull=False)
        .exclude(homework__description__contains="live-meeting:")
        .values("homework__teacher_id")
        .annotate(first_at=Min("submitted_at"))
    )
    return {row["homework__teacher_id"]: row["first_at"] for row in rows}


def _first_journal_at_by_teacher() -> dict[int, datetime]:
    rows = (
        LessonJournal.objects.filter(status=JournalStatus.COMPLETED)
        .values("teacher_id")
        .annotate(first_at=Min("completed_at"), first_updated=Min("updated_at"))
    )
    out: dict[int, datetime] = {}
    for row in rows:
        at = row["first_at"] or row["first_updated"]
        if row["teacher_id"] and at:
            out[row["teacher_id"]] = at
    return out


def _first_event_completed_at_by_teacher() -> dict[int, datetime]:
    rows = (
        ScheduleEvent.objects.filter(status__in=_CONDUCTED_EVENT_STATUSES)
        .values("owner_id")
        .annotate(first_at=Min("updated_at"))
    )
    return {row["owner_id"]: row["first_at"] for row in rows}


def _activation_at(
    video_finished: dict[int, datetime],
    submissions: dict[int, datetime],
    homework: dict[int, datetime],
    journals: dict[int, datetime],
    events_done: dict[int, datetime],
    teacher_id: int,
) -> datetime | None:
    """Earliest meaningful activation timestamp for a teacher."""
    candidates = []
    if teacher_id in video_finished:
        candidates.append(video_finished[teacher_id])
    if teacher_id in submissions and teacher_id in homework:
        candidates.append(max(homework[teacher_id], submissions[teacher_id]))
    if teacher_id in journals:
        candidates.append(journals[teacher_id])
    if teacher_id in events_done:
        candidates.append(events_done[teacher_id])
    if not candidates:
        return None
    return min(candidates)


def build_activation_report(*, now=None) -> dict[str, Any]:
    now = now or timezone.now()
    teachers = list(_teacher_qs().only("id", "date_joined"))
    teacher_ids = [t.pk for t in teachers]
    total = len(teacher_ids)

    students = _first_student_at_by_teacher()
    connected = _first_connected_at_by_teacher()
    subjects = _first_subject_at_by_teacher()
    events = _first_event_at_by_teacher()
    materials = _first_material_at_by_teacher()
    video_started = _first_video_started_at_by_teacher()
    video_finished = _first_video_finished_at_by_teacher()
    homework = _first_homework_assigned_at_by_teacher()
    submissions = _first_submission_at_by_teacher()
    journals = _first_journal_at_by_teacher()
    events_done = _first_event_completed_at_by_teacher()

    def _count(mapping: dict[int, datetime]) -> int:
        return sum(1 for tid in teacher_ids if tid in mapping)

    n_student = _count(students)
    n_connected = _count(connected)
    n_subject = _count(subjects)
    n_event = _count(events)
    n_material = _count(materials)
    n_video_started = _count(video_started)
    n_video_finished = _count(video_finished)
    n_homework = _count(homework)
    n_submission = _count(submissions)
    n_journal = _count(journals)

    core_video = n_video_finished
    core_hw_cycle = sum(1 for tid in teacher_ids if tid in homework and tid in submissions)
    core_other = sum(
        1
        for tid in teacher_ids
        if tid not in video_finished
        and not (tid in homework and tid in submissions)
        and (tid in journals or tid in events_done)
    )
    core_any = sum(
        1
        for tid in teacher_ids
        if tid in video_finished
        or (tid in homework and tid in submissions)
        or tid in journals
        or tid in events_done
    )

    day7 = now - timedelta(days=7)
    day30 = now - timedelta(days=30)
    new_7 = [t for t in teachers if t.date_joined >= day7]
    new_30 = [t for t in teachers if t.date_joined >= day30]

    def _rate_for(subset: list[User], mapping: dict[int, datetime]) -> dict[str, Any]:
        n = len(subset)
        hit = sum(1 for t in subset if t.pk in mapping)
        return {"teachers": n, "count": hit, "rate": _pct(hit, n)}

    cohorts: list[dict[str, Any]] = []
    by_week: dict[datetime, list[User]] = {}
    for teacher in teachers:
        key = _week_start(teacher.date_joined)
        by_week.setdefault(key, []).append(teacher)
    for week, members in sorted(by_week.items(), reverse=True)[:16]:
        ids = [t.pk for t in members]
        n = len(ids)
        cohorts.append(
            {
                "week_start": week.date().isoformat(),
                "teachers": n,
                "added_student": sum(1 for i in ids if i in students),
                "created_event": sum(1 for i in ids if i in events),
                "added_material": sum(1 for i in ids if i in materials),
                "conducted_lesson": sum(
                    1 for i in ids if i in video_finished or i in events_done or i in journals
                ),
                "assigned_homework": sum(1 for i in ids if i in homework),
                "received_submission": sum(1 for i in ids if i in submissions),
            }
        )

    mature = [t for t in teachers if t.date_joined <= now - timedelta(days=7)]
    reg_return_7 = 0
    for teacher in mature:
        joined = teacher.date_joined
        window_end = joined + timedelta(days=7)
        timestamps = []
        for mapping in (students, events, materials, video_started, homework, submissions, journals):
            at = mapping.get(teacher.pk)
            if at and joined < at <= window_end:
                timestamps.append(at)
        if timestamps:
            reg_return_7 += 1

    activated = []
    for teacher in teachers:
        at = _activation_at(
            video_finished, submissions, homework, journals, events_done, teacher.pk
        )
        if at is not None:
            activated.append((teacher, at))

    act_mature = [(t, at) for t, at in activated if at <= now - timedelta(days=7)]
    act_return_7 = 0
    second_event = 0
    second_homework = 0
    for teacher, first_at in act_mature:
        window_end = first_at + timedelta(days=7)
        later = []
        for mapping in (events, video_started, homework, submissions, journals, events_done):
            at = mapping.get(teacher.pk)
            if at and at > first_at and at <= window_end:
                later.append(at)
        if later:
            act_return_7 += 1
        event_count = ScheduleEvent.objects.filter(
            owner=teacher,
            created_at__gt=first_at,
        ).exclude(
            status__in=(ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.DRAFT)
        ).count()
        total_events = ScheduleEvent.objects.filter(owner_id=teacher.pk).exclude(
            status__in=(ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.DRAFT)
        ).count()
        if total_events >= 2 or event_count >= 1:
            second_event += 1
        total_hw = Homework.objects.filter(
            teacher_id=teacher.pk,
            status__in=_ASSIGNED_HOMEWORK_STATUSES,
        ).exclude(description__contains="live-meeting:").count()
        if total_hw >= 2:
            second_homework += 1

    return {
        "generated_at": _iso(now),
        "teachers_total": total,
        "new_teachers_7d": len(new_7),
        "new_teachers_30d": len(new_30),
        "funnel": {
            "registered": total,
            "first_student": {"count": n_student, "rate": _pct(n_student, total)},
            "first_student_connected": {"count": n_connected, "rate": _pct(n_connected, total)},
            "first_subject": {"count": n_subject, "rate": _pct(n_subject, total)},
            "first_schedule_event": {"count": n_event, "rate": _pct(n_event, total)},
            "first_lesson_material": {"count": n_material, "rate": _pct(n_material, total)},
            "first_video_lesson_started": {
                "count": n_video_started,
                "rate": _pct(n_video_started, total),
            },
            "first_video_lesson_finished": {
                "count": n_video_finished,
                "rate": _pct(n_video_finished, total),
            },
            "first_homework_assigned": {"count": n_homework, "rate": _pct(n_homework, total)},
            "first_homework_submission": {
                "count": n_submission,
                "rate": _pct(n_submission, total),
            },
            "first_journal_completed": {"count": n_journal, "rate": _pct(n_journal, total)},
        },
        "new_teachers": {
            "7d": {
                "teachers": len(new_7),
                "first_student": _rate_for(new_7, students),
                "created_event": _rate_for(new_7, events),
                "added_material": _rate_for(new_7, materials),
                "conducted_lesson": _rate_for(
                    new_7, {**video_finished, **events_done, **journals}
                ),
            },
            "30d": {
                "teachers": len(new_30),
                "first_student": _rate_for(new_30, students),
                "created_event": _rate_for(new_30, events),
                "added_material": _rate_for(new_30, materials),
                "conducted_lesson": _rate_for(
                    new_30, {**video_finished, **events_done, **journals}
                ),
            },
        },
        "activation_rate": {
            "first_event_over_registered": _pct(n_event, total),
            "core": _pct(core_any, total),
        },
        "core_activation": {
            "video_lesson": {"count": core_video, "rate": _pct(core_video, total)},
            "homework_cycle": {"count": core_hw_cycle, "rate": _pct(core_hw_cycle, total)},
            "other_work_cycle": {"count": core_other, "rate": _pct(core_other, total)},
            "any": {"count": core_any, "rate": _pct(core_any, total)},
        },
        "cohorts_weekly": cohorts,
        "retention": {
            "registration_d7": {
                "eligible": len(mature),
                "returned": reg_return_7,
                "rate": _pct(reg_return_7, len(mature)),
                "note": "Повторное действие на дни 1–7 после регистрации. Учителя младше 7 дней исключены.",
            },
            "activation_d7": {
                "eligible": len(act_mature),
                "returned": act_return_7,
                "rate": _pct(act_return_7, len(act_mature)),
                "second_event": second_event,
                "second_homework": second_homework,
                "note": "Повторное действие в течение 7 дней после first_activation_at. Не путать с D7 от регистрации.",
            },
        },
    }
