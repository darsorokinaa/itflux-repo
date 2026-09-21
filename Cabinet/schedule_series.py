"""Generate recurring schedule events from a series."""

from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
import zoneinfo

from .choices import ParticipantRole, ParticipantStatus, RecurrenceType, SeriesStatus
from .models import ScheduleEvent, ScheduleEventParticipant, ScheduleEventSeries

DEFAULT_HORIZON_DAYS = 90
WEEKDAY_MAP = {0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6}  # Mon=0 in Python weekday()


def _series_tz(series):
    try:
        return zoneinfo.ZoneInfo(series.timezone or "Europe/Moscow")
    except Exception:
        return zoneinfo.ZoneInfo("Europe/Moscow")


def _combine(series, d: date):
    tz = _series_tz(series)
    if getattr(series, "all_day", False):
        start = timezone.make_aware(datetime.combine(d, time.min), tz)
        end = timezone.make_aware(datetime.combine(d + timedelta(days=1), time.min), tz)
        return start, end
    start = timezone.make_aware(datetime.combine(d, series.start_time), tz)
    end = timezone.make_aware(datetime.combine(d, series.end_time), tz)
    if end <= start:
        end += timedelta(days=1)
    return start, end


def _normalize_weekdays(raw, fallback=None):
    days = []
    for value in raw or []:
        try:
            day = int(value)
        except (TypeError, ValueError):
            continue
        if 0 <= day <= 6:
            days.append(day)
    if days:
        return sorted(set(days))
    if fallback is None:
        return []
    return [fallback]


def _weekdays_for_series(series):
    if series.recurrence_type == RecurrenceType.WEEKDAYS:
        return [0, 1, 2, 3, 4]
    if series.recurrence_type in (
        RecurrenceType.CUSTOM_WEEKDAYS,
        RecurrenceType.CUSTOM,
        RecurrenceType.WEEKLY,
        RecurrenceType.BIWEEKLY,
    ):
        fallback = series.start_date.weekday() if series.start_date else None
        return _normalize_weekdays(series.recurrence_weekdays, fallback=fallback)
    return []


def _excluded_date_set(raw):
    excluded = set()
    for value in raw or []:
        if isinstance(value, date) and not isinstance(value, datetime):
            excluded.add(value)
            continue
        text = str(value or "").strip()[:10]
        if not text:
            continue
        try:
            excluded.add(date.fromisoformat(text))
        except ValueError:
            continue
    return excluded


def _week_step_for_series(series):
    if series.recurrence_type == RecurrenceType.BIWEEKLY:
        return 2
    if series.recurrence_type in (
        RecurrenceType.WEEKLY,
        RecurrenceType.CUSTOM_WEEKDAYS,
        RecurrenceType.CUSTOM,
        RecurrenceType.WEEKDAYS,
    ):
        return max(1, series.recurrence_interval or 1)
    return 1


def iter_occurrence_dates(
    *,
    start_date: date,
    recurrence_type: str,
    date_from: date,
    date_to: date,
    recurrence_until=None,
    recurrence_count=None,
    recurrence_interval=1,
    recurrence_weekdays=None,
    excluded_dates=None,
):
    """Даты серии без материализации тысяч лет вперёд: только [date_from, date_to]."""
    excluded = _excluded_date_set(excluded_dates)
    if recurrence_type in ("", RecurrenceType.NONE, None):
        if date_from <= start_date <= date_to and start_date not in excluded:
            yield start_date
        return

    end = min(date_to, recurrence_until or date_to)
    if end < start_date or date_to < start_date:
        return
    count = 0
    max_count = recurrence_count
    interval = max(1, recurrence_interval or 1)

    if recurrence_type == RecurrenceType.DAILY:
        d = start_date
        while d < date_from:
            d += timedelta(days=interval)
        while d <= end:
            if max_count and count >= max_count:
                break
            if d >= date_from and d not in excluded:
                yield d
                count += 1
            elif d >= date_from:
                count += 1
            d += timedelta(days=interval)
        return

    if recurrence_type in (
        RecurrenceType.WEEKLY,
        RecurrenceType.WEEKDAYS,
        RecurrenceType.CUSTOM_WEEKDAYS,
        RecurrenceType.BIWEEKLY,
        RecurrenceType.CUSTOM,
    ):
        if recurrence_type == RecurrenceType.WEEKDAYS:
            weekdays = [0, 1, 2, 3, 4]
        else:
            weekdays = _normalize_weekdays(recurrence_weekdays, fallback=start_date.weekday())
        week_step = 2 if recurrence_type == RecurrenceType.BIWEEKLY else interval
        d = max(start_date, date_from)
        # Count occurrences before date_from so recurrence_count stays correct.
        if max_count:
            cursor = start_date
            while cursor < d:
                if cursor.weekday() in weekdays:
                    weeks_from_start = (cursor - start_date).days // 7
                    if weeks_from_start % week_step == 0 and cursor not in excluded:
                        count += 1
                    elif weeks_from_start % week_step == 0:
                        count += 1
                cursor += timedelta(days=1)
        while d <= end:
            if max_count and count >= max_count:
                break
            if d.weekday() in weekdays:
                weeks_from_start = (d - start_date).days // 7
                if weeks_from_start % week_step == 0:
                    if d not in excluded:
                        yield d
                    count += 1
            d += timedelta(days=1)
        return

    if recurrence_type == RecurrenceType.MONTHLY:
        d = start_date
        while d < date_from:
            month = d.month + interval
            year = d.year + (month - 1) // 12
            month = ((month - 1) % 12) + 1
            day = min(start_date.day, 28)
            d = date(year, month, day)
        while d <= end:
            if max_count and count >= max_count:
                break
            if d >= date_from:
                if d not in excluded:
                    yield d
                count += 1
            month = d.month + interval
            year = d.year + (month - 1) // 12
            month = ((month - 1) % 12) + 1
            day = min(start_date.day, 28)
            d = date(year, month, day)


def _iter_dates(series, date_from: date, date_to: date):
    yield from iter_occurrence_dates(
        start_date=series.start_date,
        recurrence_type=series.recurrence_type,
        date_from=date_from,
        date_to=date_to,
        recurrence_until=series.recurrence_until,
        recurrence_count=series.recurrence_count,
        recurrence_interval=series.recurrence_interval,
        recurrence_weekdays=series.recurrence_weekdays,
        excluded_dates=getattr(series, "excluded_dates", None),
    )


def generate_events_for_series(series, date_from=None, date_to=None, *, copy_participants_from=None):
    """Generate ScheduleEvent instances for series in [date_from, date_to]. Skips duplicates."""
    if series.status != SeriesStatus.ACTIVE:
        return []

    today = timezone.localdate()
    if date_from is None:
        date_from = today
    if date_to is None:
        date_to = today + timedelta(days=DEFAULT_HORIZON_DAYS)
        if series.recurrence_until:
            date_to = min(date_to, series.recurrence_until)

    existing = set(
        ScheduleEvent.objects.filter(series=series).values_list("starts_at", flat=True)
    )
    created = []

    with transaction.atomic():
        for d in _iter_dates(series, date_from, date_to):
            starts_at, ends_at = _combine(series, d)
            if starts_at in existing:
                continue
            if ScheduleEvent.objects.filter(series=series, starts_at=starts_at).exists():
                continue

            event = ScheduleEvent.objects.create(
                owner=series.teacher,
                series=series,
                title=series.title,
                description=series.description,
                topic=series.topic,
                starts_at=starts_at,
                ends_at=ends_at,
                event_type=series.event_type,
                format=series.format,
                group=series.group,
                student_subject=series.student_subject,
                lesson=series.lesson,
                homework=series.homework,
                timezone=series.timezone,
                telemost_url=series.meeting_url,
                meeting_provider=series.meeting_provider,
                teacher_comment=series.teacher_comment,
                status=ScheduleEvent.Status.PLANNED,
                is_recurring_instance=series.recurrence_type != RecurrenceType.NONE,
                original_start_at=starts_at,
                reminder_minutes=series.reminder_minutes,
                location=getattr(series, "location", "") or "",
                location_lat=getattr(series, "location_lat", None),
                location_lng=getattr(series, "location_lng", None),
                location_place_id=getattr(series, "location_place_id", "") or "",
                travel_before_minutes=getattr(series, "travel_before_minutes", 0) or 0,
                travel_after_minutes=getattr(series, "travel_after_minutes", 0) or 0,
                all_day=bool(getattr(series, "all_day", False)),
                visibility=getattr(series, "visibility", None) or "public",
            )
            _ensure_organizer(event, series.teacher)
            if series.group_id:
                _sync_group_participants(event, series.group, exclude_teacher=series.teacher)
            if copy_participants_from:
                _copy_participants(copy_participants_from, event)
            created.append(event)
            existing.add(starts_at)

    return created


def _participant_vk_user_id(user):
    if not user:
        return ""
    from .notifications import get_or_create_preferences

    prefs = get_or_create_preferences(user)
    return (prefs.vk_user_id or "").strip()


def _ensure_organizer(event, teacher):
    """Учитель урока всегда участник с ролью «Организатор»."""
    profile = getattr(teacher, "profile", None)
    name = ""
    if profile is not None:
        name = (profile.get_display_name() or "").strip()
    if not name:
        name = (teacher.get_full_name() or "").strip() or teacher.username

    participant, created = ScheduleEventParticipant.objects.get_or_create(
        event=event,
        teacher=teacher,
        role=ParticipantRole.ORGANIZER,
        defaults={
            "user": teacher,
            "display_name": name,
            "contact_email": teacher.email or "",
            "vk_user_id": _participant_vk_user_id(teacher),
            "status": ParticipantStatus.ACCEPTED,
        },
    )
    if created:
        return participant

    update_fields = []
    if participant.user_id != teacher.pk:
        participant.user = teacher
        update_fields.append("user")
    if (participant.display_name or "").strip() != name:
        participant.display_name = name
        update_fields.append("display_name")
    if participant.status != ParticipantStatus.ACCEPTED:
        participant.status = ParticipantStatus.ACCEPTED
        update_fields.append("status")
    if (participant.contact_email or "") != (teacher.email or ""):
        participant.contact_email = teacher.email or ""
        update_fields.append("contact_email")
    if update_fields:
        participant.save(update_fields=update_fields + ["updated_at"])
    return participant


def _sync_group_participants(event, group, exclude_teacher=None):
    from .choices import StudentStatus

    students = group.students.filter(status=StudentStatus.ACTIVE).select_related("user")
    for student in students:
        ScheduleEventParticipant.objects.get_or_create(
            event=event,
            student=student,
            role=ParticipantRole.STUDENT,
            defaults={
                "user": student.user,
                "display_name": student.full_name,
                "contact_email": student.email or "",
                "vk_user_id": _participant_vk_user_id(student.user),
                "status": ParticipantStatus.INVITED,
            },
        )


def _copy_participants(source_event, target_event):
    for p in source_event.participants.exclude(role=ParticipantRole.ORGANIZER):
        ScheduleEventParticipant.objects.get_or_create(
            event=target_event,
            student=p.student,
            user=p.user,
            teacher=p.teacher,
            role=p.role,
            defaults={
                "display_name": p.display_name,
                "contact_email": p.contact_email,
                "vk_user_id": p.vk_user_id,
                "status": p.status,
            },
        )


def sync_event_participants(event, *, student_ids=None, group=None, extra_student_ids=None, teacher=None):
    """Build participant list for a single event."""
    teacher = teacher or event.owner
    _ensure_organizer(event, teacher)

    if group:
        event.group = group
        _sync_group_participants(event, group, exclude_teacher=teacher)

    if student_ids:
        from .models import Student

        for student in Student.objects.filter(pk__in=student_ids, teacher=teacher):
            ScheduleEventParticipant.objects.get_or_create(
                event=event,
                student=student,
                role=ParticipantRole.STUDENT,
                defaults={
                    "user": student.user,
                    "display_name": student.full_name,
                    "contact_email": student.email or "",
                    "vk_user_id": _participant_vk_user_id(student.user),
                    "status": ParticipantStatus.INVITED,
                },
            )
            event.student = student

    if extra_student_ids:
        from .models import Student

        for student in Student.objects.filter(pk__in=extra_student_ids, teacher=teacher):
            ScheduleEventParticipant.objects.get_or_create(
                event=event,
                student=student,
                role=ParticipantRole.STUDENT,
                defaults={
                    "user": student.user,
                    "display_name": student.full_name,
                    "contact_email": student.email or "",
                    "vk_user_id": _participant_vk_user_id(student.user),
                    "status": ParticipantStatus.INVITED,
                },
            )

    event.save(update_fields=["group", "student", "updated_at"])
