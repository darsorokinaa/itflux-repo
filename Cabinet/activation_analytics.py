"""
Internal product analytics for teacher activation.

All metrics are aggregated counts/rates. No names, emails, phones, tokens,
or room URLs are included.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any

from django.contrib.auth.models import User
from django.db.models import Count, Min, Q
from django.utils import timezone

from .activation_events import (
    ADD_STUDENT_CLICKED,
    ADD_STUDENT_CTA_VIEWED,
    CORE_ACTIVATED,
    FIRST_CABINET_OPENED,
    LESSON_CREATED,
    REPEAT_CORE,
    STUDENT_CREATED,
    STUDENT_FORM_OPENED,
    STUDENT_FORM_VALIDATION_FAILED,
    STUDENT_INVITE_ACCEPTED,
    STUDENT_INVITE_CREATED,
    STUDENT_INVITE_OPENED,
    STUDENTS_PAGE_OPENED,
    SUBJECT_CREATED,
    TEACHER_REGISTERED,
)
from .activation_models import ActivationEvent
from .choices import InvitationStatus, StudentStatus
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
    StudentInvitation,
    StudentSubject,
    VideoMeeting,
)
from .onboarding_service import (
    _ASSIGNED_HOMEWORK_STATUSES,
    _CONDUCTED_EVENT_STATUSES,
)

NUDGE_MAX_AGE_DAYS = 30

# Date of the activation-instrumentation + shortened onboarding ship.
# Cohorts before this date are "before onboarding change".
ONBOARDING_UX_CUTOVER = datetime(2026, 8, 17, tzinfo=dt_timezone.utc)

TARGET_REGISTRATION_TO_STUDENT = 50.0
TARGET_STUDENT_TO_CONNECTED = 60.0
TARGET_REGISTRATION_TO_CORE = 25.0
TARGET_CORE_TO_REPEAT = 40.0

BASELINE = {
    "registration_to_student_created": 37.6,
    "student_created_to_connected": 43.4,
    "registration_to_core": 17.0,
    "core_to_repeat": 33.3,
}


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


def _hours(delta: timedelta | None) -> float | None:
    if delta is None:
        return None
    return round(delta.total_seconds() / 3600.0, 3)


def _percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 3)
    rank = (len(ordered) - 1) * p
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    if low == high:
        return round(ordered[low], 3)
    frac = rank - low
    return round(ordered[low] + (ordered[high] - ordered[low]) * frac, 3)


def _spread(values: list[float]) -> dict[str, float | None]:
    if len(values) < 5:
        return {
            "n": len(values),
            "p25": None,
            "median": _percentile(values, 0.5) if values else None,
            "p75": None,
        }
    return {
        "n": len(values),
        "p25": _percentile(values, 0.25),
        "median": _percentile(values, 0.5),
        "p75": _percentile(values, 0.75),
    }


def _funnel_table(stages: list[tuple[str, int]], registered: int) -> list[dict[str, Any]]:
    rows = []
    prev = None
    for key, count in stages:
        rows.append(
            {
                "stage": key,
                "users": count,
                "pct_of_registrations": _pct(count, registered),
                "pct_of_previous": _pct(count, prev) if prev is not None else None,
            }
        )
        prev = count
    return rows


def _first_invite_at_by_teacher() -> dict[int, datetime]:
    rows = StudentInvitation.objects.values("teacher_id").annotate(first_at=Min("created_at"))
    return {row["teacher_id"]: row["first_at"] for row in rows}


def _first_accepted_at_by_teacher() -> dict[int, datetime]:
    rows = (
        StudentInvitation.objects.filter(
            status=InvitationStatus.ACCEPTED,
            accepted_at__isnull=False,
        )
        .values("teacher_id")
        .annotate(first_at=Min("accepted_at"))
    )
    return {row["teacher_id"]: row["first_at"] for row in rows}


def _event_firsts_by_teacher(event_names: tuple[str, ...]) -> dict[str, dict[int, datetime]]:
    out: dict[str, dict[int, datetime]] = {name: {} for name in event_names}
    rows = (
        ActivationEvent.objects.filter(event_name__in=event_names)
        .values("user_id", "event_name")
        .annotate(first_at=Min("occurred_at"))
    )
    for row in rows:
        out[row["event_name"]][row["user_id"]] = row["first_at"]
    return out


def _target_row(actual: float | None, goal: float, baseline: float) -> dict[str, Any]:
    met = actual is not None and actual >= goal
    return {
        "actual": actual,
        "goal": goal,
        "baseline": baseline,
        "met": met,
    }


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

    event_firsts = _event_firsts_by_teacher(
        (
            TEACHER_REGISTERED,
            FIRST_CABINET_OPENED,
            ADD_STUDENT_CTA_VIEWED,
            ADD_STUDENT_CLICKED,
            STUDENT_FORM_OPENED,
            STUDENT_FORM_VALIDATION_FAILED,
            STUDENT_CREATED,
            STUDENT_INVITE_CREATED,
            STUDENT_INVITE_OPENED,
            STUDENT_INVITE_ACCEPTED,
            STUDENTS_PAGE_OPENED,
            SUBJECT_CREATED,
            LESSON_CREATED,
            CORE_ACTIVATED,
            REPEAT_CORE,
        )
    )
    invites = _first_invite_at_by_teacher()
    accepted = _first_accepted_at_by_teacher()

    def _first_at(tid: int, event_name: str, fallback: dict[int, datetime] | None = None):
        at = event_firsts.get(event_name, {}).get(tid)
        if at is not None:
            return at
        if fallback is not None:
            return fallback.get(tid)
        return None

    teachers_with_events = set(
        ActivationEvent.objects.filter(user_id__in=teacher_ids).values_list("user_id", flat=True)
    )

    cabinet_opened_ids = set()
    for teacher in teachers:
        if _first_at(teacher.pk, FIRST_CABINET_OPENED) is not None:
            cabinet_opened_ids.add(teacher.pk)
            continue
        last_login = teacher.last_login
        if last_login and last_login > teacher.date_joined + timedelta(minutes=2):
            cabinet_opened_ids.add(teacher.pk)

    add_clicked_ids = set(event_firsts.get(ADD_STUDENT_CLICKED, {}))
    form_opened_ids = set(event_firsts.get(STUDENT_FORM_OPENED, {}))
    cta_viewed_ids = set(event_firsts.get(ADD_STUDENT_CTA_VIEWED, {}))
    students_page_ids = set(event_firsts.get(STUDENTS_PAGE_OPENED, {}))
    validation_ids = set(event_firsts.get(STUDENT_FORM_VALIDATION_FAILED, {}))
    invite_opened_ids = set(event_firsts.get(STUDENT_INVITE_OPENED, {}))

    n_cabinet = len(cabinet_opened_ids)
    n_cta = len(cta_viewed_ids)
    n_click = len(add_clicked_ids)
    n_form = len(form_opened_ids)
    n_invite = _count(invites)
    n_invite_opened = len(invite_opened_ids)
    n_accepted = _count(accepted) if accepted else n_connected

    first_30_stages = _funnel_table(
        [
            ("Registered", total),
            ("Cabinet opened", n_cabinet),
            ("Add student clicked", n_click),
            ("Student form opened", n_form),
            ("Student created", n_student),
            ("Invite created", n_invite),
            ("Invite opened", n_invite_opened),
            ("Invite accepted", n_accepted),
            ("Subject created", n_subject),
            ("Lesson created", n_event),
        ],
        total,
    )

    def _pair_hours(start_map, end_map, subset=None):
        values = []
        members = subset if subset is not None else teachers
        for teacher in members:
            start = start_map(teacher)
            end = end_map(teacher)
            if start and end and end >= start:
                hours = _hours(end - start)
                if hours is not None:
                    values.append(hours)
        return _spread(values)

    time_to_action = {
        "registration_to_cabinet": _pair_hours(
            lambda t: t.date_joined,
            lambda t: _first_at(t.pk, FIRST_CABINET_OPENED),
        ),
        "registration_to_add_student_click": _pair_hours(
            lambda t: t.date_joined,
            lambda t: _first_at(t.pk, ADD_STUDENT_CLICKED),
        ),
        "registration_to_student_created": _pair_hours(
            lambda t: t.date_joined,
            lambda t: _first_at(t.pk, STUDENT_CREATED, students),
        ),
        "student_created_to_invite_created": _pair_hours(
            lambda t: _first_at(t.pk, STUDENT_CREATED, students),
            lambda t: _first_at(t.pk, STUDENT_INVITE_CREATED, invites),
        ),
        "invite_created_to_invite_opened": _pair_hours(
            lambda t: _first_at(t.pk, STUDENT_INVITE_CREATED, invites),
            lambda t: _first_at(t.pk, STUDENT_INVITE_OPENED),
        ),
        "invite_opened_to_accepted": _pair_hours(
            lambda t: _first_at(t.pk, STUDENT_INVITE_OPENED),
            lambda t: _first_at(t.pk, STUDENT_INVITE_ACCEPTED, accepted),
        ),
        "accepted_to_subject": _pair_hours(
            lambda t: _first_at(t.pk, STUDENT_INVITE_ACCEPTED, accepted),
            lambda t: subjects.get(t.pk),
        ),
        "subject_to_lesson": _pair_hours(
            lambda t: subjects.get(t.pk),
            lambda t: events.get(t.pk),
        ),
        "unit": "hours",
        "note": (
            "p25/p75 только при n≥5. Invite opened недоступен ретроспективно "
            "без instrumentation events."
        ),
    }

    buckets = {
        "0_1_min": 0,
        "1_5_min": 0,
        "5_15_min": 0,
        "15_30_min": 0,
        "after_30_min": 0,
        "never_student": 0,
    }
    for teacher in teachers:
        created_at = _first_at(teacher.pk, STUDENT_CREATED, students)
        if created_at is None:
            buckets["never_student"] += 1
            continue
        delta = created_at - teacher.date_joined
        minutes = delta.total_seconds() / 60.0
        if minutes <= 1:
            buckets["0_1_min"] += 1
        elif minutes <= 5:
            buckets["1_5_min"] += 1
        elif minutes <= 15:
            buckets["5_15_min"] += 1
        elif minutes <= 30:
            buckets["15_30_min"] += 1
        else:
            buckets["after_30_min"] += 1

    never_counts = {
        "registered_never_logged_in_again": 0,
        "logged_in_no_action": 0,
        "browsed_content_only": 0,
        "opened_student_page": 0,
        "clicked_add_student": 0,
        "opened_form": 0,
        "validation_failure": 0,
        "abandoned_form": 0,
        "created_student_no_invite": 0,
        "invite_created_never_opened": 0,
        "invite_opened_not_accepted": 0,
        "accepted_no_subject": 0,
        "subject_no_lesson": 0,
        "lesson_created_or_beyond": 0,
    }
    for teacher in teachers:
        tid = teacher.pk
        has_lesson = tid in events
        has_subj = tid in subjects
        has_acc = tid in accepted or tid in connected
        has_inv_open = tid in invite_opened_ids
        has_inv = tid in invites
        has_stu = tid in students
        has_val = tid in validation_ids
        has_form = tid in form_opened_ids
        has_click = tid in add_clicked_ids
        has_stu_page = tid in students_page_ids or tid in cta_viewed_ids
        has_cabinet = tid in cabinet_opened_ids
        if has_lesson:
            never_counts["lesson_created_or_beyond"] += 1
        elif has_subj:
            never_counts["subject_no_lesson"] += 1
        elif has_acc:
            never_counts["accepted_no_subject"] += 1
        elif has_inv_open:
            never_counts["invite_opened_not_accepted"] += 1
        elif has_inv:
            never_counts["invite_created_never_opened"] += 1
        elif has_stu:
            never_counts["created_student_no_invite"] += 1
        elif has_val:
            never_counts["validation_failure"] += 1
        elif has_form:
            never_counts["abandoned_form"] += 1
        elif has_click:
            never_counts["clicked_add_student"] += 1
        elif has_stu_page:
            never_counts["opened_student_page"] += 1
        elif has_cabinet:
            never_counts["logged_in_no_action"] += 1
        else:
            never_counts["registered_never_logged_in_again"] += 1

    never_touched = {
        "total_teachers": total,
        "segments": [
            {
                "key": key,
                "count": count,
                "pct": _pct(count, total),
            }
            for key, count in never_counts.items()
        ],
        "note": (
            "Каждый учитель ровно в одном сегменте — самый дальний пройденный шаг. "
            "Шаги clicked/form/invite opened для учителей до instrumentation "
            "недоступны и схлопываются в соседний известный шаг."
        ),
        "instrumentation_teachers": len(teachers_with_events),
    }

    source_rows = (
        Profile.objects.filter(user_id__in=teacher_ids, role=Profile.Role.TEACHER)
        .values("acquisition_source")
        .annotate(teachers=Count("user_id"))
    )
    acquisition = []
    for row in source_rows:
        bucket = row["acquisition_source"] or "unknown"
        ids = list(
            Profile.objects.filter(
                user_id__in=teacher_ids,
                role=Profile.Role.TEACHER,
                acquisition_source=row["acquisition_source"],
            ).values_list("user_id", flat=True)
        )
        n = len(ids)
        n_stu = sum(1 for i in ids if i in students)
        n_core = sum(
            1
            for i in ids
            if i in video_finished
            or (i in homework and i in submissions)
            or i in journals
            or i in events_done
        )
        acquisition.append(
            {
                "source": bucket,
                "teachers": n,
                "student_created": n_stu,
                "student_created_rate": _pct(n_stu, n),
                "core": n_core,
                "core_rate": _pct(n_core, n),
            }
        )
    if not acquisition:
        acquisition = [
            {
                "source": "unknown",
                "teachers": total,
                "student_created": n_student,
                "student_created_rate": _pct(n_student, total),
                "core": core_any,
                "core_rate": _pct(core_any, total),
                "note": "UTM/source начали сохраняться с новой регистрацией. Ретроспектива не выдумывается.",
            }
        ]

    def _cohort_metrics(members: list[User]) -> dict[str, Any]:
        ids = [t.pk for t in members]
        n = len(ids)
        n_stu = sum(1 for i in ids if i in students)
        n_conn = sum(1 for i in ids if i in connected)
        n_sub = sum(1 for i in ids if i in subjects)
        n_les = sum(1 for i in ids if i in events)
        n_core = sum(
            1
            for i in ids
            if i in video_finished
            or (i in homework and i in submissions)
            or i in journals
            or i in events_done
        )
        return {
            "teachers": n,
            "student_created": {"count": n_stu, "rate": _pct(n_stu, n)},
            "connected": {"count": n_conn, "rate": _pct(n_conn, n)},
            "subject": {"count": n_sub, "rate": _pct(n_sub, n)},
            "lesson": {"count": n_les, "rate": _pct(n_les, n)},
            "core": {"count": n_core, "rate": _pct(n_core, n)},
        }

    before = [t for t in teachers if t.date_joined < ONBOARDING_UX_CUTOVER]
    after = [t for t in teachers if t.date_joined >= ONBOARDING_UX_CUTOVER]
    week_cohorts = []
    current_week = _week_start(now)
    for week, members in sorted(by_week.items(), reverse=True)[:16]:
        age_days = (now.date() - week.date()).days
        mature_enough_repeat = age_days >= 7
        row = {
            "week_start": week.date().isoformat(),
            "incomplete_week": week == current_week,
            **_cohort_metrics(members),
        }
        if not mature_enough_repeat:
            row["repeat_core"] = {
                "excluded": True,
                "note": "Когорта младше 7 дней — Repeat/D7 не сравниваем.",
            }
        week_cohorts.append(row)

    n_repeat = len(event_firsts.get(REPEAT_CORE, {})) or second_event

    student_created_rate = _pct(n_student, total)
    connected_from_student = _pct(n_connected, n_student)
    core_rate = _pct(core_any, total)
    repeat_rate = _pct(n_repeat, core_any)

    targets = {
        "registration_to_student_created": _target_row(
            student_created_rate, TARGET_REGISTRATION_TO_STUDENT, BASELINE["registration_to_student_created"]
        ),
        "student_created_to_connected": _target_row(
            connected_from_student, TARGET_STUDENT_TO_CONNECTED, BASELINE["student_created_to_connected"]
        ),
        "registration_to_core": _target_row(
            core_rate, TARGET_REGISTRATION_TO_CORE, BASELINE["registration_to_core"]
        ),
        "core_to_repeat": _target_row(
            repeat_rate, TARGET_CORE_TO_REPEAT, BASELINE["core_to_repeat"]
        ),
    }
    targets_met = sum(1 for row in targets.values() if row["met"])

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
        "dashboard_priority": "activation_funnel",
        "health": {
            "lead_with": "activation_funnel",
            "targets_met": targets_met,
            "targets_total": len(targets),
            "note": (
                "Не интерпретировать как «здоровый продукт» по одному числу. "
                "Незрелые retention-метрики и незавершённая неделя не сравниваются WoW."
            ),
        },
        "targets": targets,
        "baseline": BASELINE,
        "first_30_minutes": {
            "funnel": first_30_stages,
            "time_to_action": time_to_action,
            "time_to_student_buckets": buckets,
            "cta_viewed": {"count": n_cta, "rate": _pct(n_cta, total)},
        },
        "never_touched": never_touched,
        "acquisition": {
            "sources": acquisition,
            "note": "source → student_created → CORE. Пустой source = unknown, ретроспектива не заполняется.",
        },
        "cohort_comparison": {
            "cutover": ONBOARDING_UX_CUTOVER.date().isoformat(),
            "before_onboarding_change": _cohort_metrics(before),
            "after_onboarding_change": _cohort_metrics(after),
            "weekly": week_cohorts,
        },
        "lifecycle_reminders": {
            "enabled": False,
            "note": "Предложено, не включено. Сначала собираем события воронки.",
            "proposed_triggers": [
                {
                    "after": "hours:4",
                    "state": "no_student",
                    "copy": "Добавьте первого ученика — это займёт пару минут.",
                },
                {
                    "after": "hours:4",
                    "state": "student_no_invite_accepted",
                    "copy": "Отправьте приглашение ученику, чтобы он подключился к занятиям.",
                },
                {
                    "after": "hours:24",
                    "state": "connected_no_lesson",
                    "copy": "Создайте первое занятие в расписании.",
                },
            ],
            "rules": [
                "respect notification settings",
                "один reminder на конкретный state",
                "дедуп по event_key",
                "прекращать сразу после выполнения действия",
            ],
        },
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
