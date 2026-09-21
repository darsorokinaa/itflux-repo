"""Единый расчёт занятости преподавателя: уроки, личные события, дорога, блокировки."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from django.utils import timezone

from .choices import RecurrenceType, ScheduleEventVisibility, SeriesStatus
from .models import ScheduleEvent, ScheduleEventSeries

NON_LESSON_EVENT_TYPES = frozenset({"personal", "blocked"})
PRIVATE_EVENT_TYPES = frozenset({"personal", "blocked"})

# Не хранить дорогу отдельными событиями: минуты на событии → интервал занятости.
MAX_TRAVEL_MINUTES = 12 * 60


@dataclass(frozen=True)
class BusyInterval:
    start: datetime
    end: datetime
    source: str
    event_id: int | None = None
    series_id: int | None = None
    title: str = ""
    event_type: str = ""
    visibility: str = ScheduleEventVisibility.PUBLIC
    student_name: str = ""
    is_travel: bool = False
    travel_kind: str = ""  # before | after | ""

    def overlaps(self, other_start: datetime, other_end: datetime) -> bool:
        return self.start < other_end and self.end > other_start

    def public_label(self) -> str:
        if self.visibility == ScheduleEventVisibility.PRIVATE or self.event_type in PRIVATE_EVENT_TYPES:
            if self.is_travel:
                return "Недоступно"
            return "Недоступно"
        if self.student_name:
            return f"Урок с {self.student_name}"
        return self.title or "Занятие"

    def teacher_label(self) -> str:
        if self.is_travel:
            base = self.title or "Событие"
            return f"Дорога · {base}"
        if self.event_type == "blocked":
            return self.title or "Заблокированное время"
        if self.event_type == "personal":
            return self.title or "Личное событие"
        if self.student_name:
            return f"Урок с {self.student_name}"
        return self.title or "Занятие"


def is_non_lesson_event_type(event_type: str | None) -> bool:
    return (event_type or "") in NON_LESSON_EVENT_TYPES


def default_visibility_for_type(event_type: str | None) -> str:
    if (event_type or "") in PRIVATE_EVENT_TYPES:
        return ScheduleEventVisibility.PRIVATE
    return ScheduleEventVisibility.PUBLIC


def clamp_travel_minutes(value) -> int:
    try:
        minutes = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(minutes, MAX_TRAVEL_MINUTES))


def parse_latlng(value):
    if value in (None, ""):
        return None
    try:
        return round(float(value), 6)
    except (TypeError, ValueError):
        return None


def _as_aware(value: datetime) -> datetime:
    if timezone.is_naive(value):
        return timezone.make_aware(value, timezone.get_current_timezone())
    return value


def occupancy_window(starts_at, ends_at, *, travel_before_minutes=0, travel_after_minutes=0, all_day=False, tz=None):
    start = _as_aware(starts_at)
    end = _as_aware(ends_at)
    if all_day:
        zone = tz or start.tzinfo
        local = start.astimezone(zone)
        day = local.date()
        start = datetime.combine(day, time.min, tzinfo=zone)
        end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=zone)
    before = clamp_travel_minutes(travel_before_minutes)
    after = clamp_travel_minutes(travel_after_minutes)
    return start - timedelta(minutes=before), end + timedelta(minutes=after)


def travel_segments(starts_at, ends_at, *, travel_before_minutes=0, travel_after_minutes=0, all_day=False, tz=None):
    """Визуальные отрезки дороги. Не независимые события."""
    if all_day:
        return []
    start = _as_aware(starts_at)
    end = _as_aware(ends_at)
    before = clamp_travel_minutes(travel_before_minutes)
    after = clamp_travel_minutes(travel_after_minutes)
    segments = []
    if before:
        segments.append(("before", start - timedelta(minutes=before), start))
    if after:
        segments.append(("after", end, end + timedelta(minutes=after)))
    return segments


def _event_student_name(event) -> str:
    student = getattr(event, "student", None)
    if student is not None:
        return student.full_name or ""
    return ""


def _interval_from_event(event, *, include_travel=True) -> BusyInterval:
    start, end = occupancy_window(
        event.starts_at,
        event.ends_at,
        travel_before_minutes=getattr(event, "travel_before_minutes", 0) if include_travel else 0,
        travel_after_minutes=getattr(event, "travel_after_minutes", 0) if include_travel else 0,
        all_day=bool(getattr(event, "all_day", False)),
    )
    return BusyInterval(
        start=start,
        end=end,
        source=event.event_type or "lesson",
        event_id=event.pk,
        series_id=event.series_id,
        title=event.title or "",
        event_type=event.event_type or "",
        visibility=getattr(event, "visibility", None) or default_visibility_for_type(event.event_type),
        student_name=_event_student_name(event),
    )


def _interval_from_series(series, starts_at, ends_at) -> BusyInterval:
    start, end = occupancy_window(
        starts_at,
        ends_at,
        travel_before_minutes=getattr(series, "travel_before_minutes", 0),
        travel_after_minutes=getattr(series, "travel_after_minutes", 0),
        all_day=bool(getattr(series, "all_day", False)),
    )
    return BusyInterval(
        start=start,
        end=end,
        source=series.event_type or "lesson",
        event_id=None,
        series_id=series.pk,
        title=series.title or "",
        event_type=series.event_type or "",
        visibility=getattr(series, "visibility", None) or default_visibility_for_type(series.event_type),
    )


def _range_bounds(range_start, range_end, tz):
    if isinstance(range_start, datetime):
        start = _as_aware(range_start)
    else:
        start = datetime.combine(range_start, time.min, tzinfo=tz)
    if isinstance(range_end, datetime):
        end = _as_aware(range_end)
    else:
        end = datetime.combine(range_end + timedelta(days=1), time.min, tzinfo=tz)
    return start, end


def get_busy_intervals(
    teacher,
    range_start,
    range_end,
    *,
    tz=None,
    exclude_event_ids=None,
    exclude_series_ids=None,
):
    """Занятость преподавателя в диапазоне.

    Учитывает конкретные события (уроки, личные, блокировки) вместе с дорогой
    и ещё не материализованные даты активных серий.
    """
    from .schedule_service import resolve_schedule_timezone
    from .schedule_series import _combine, _iter_dates

    tz = tz or resolve_schedule_timezone(teacher=teacher)
    start_dt, end_dt = _range_bounds(range_start, range_end, tz)
    # Дорога может выйти за границы дня — чуть расширяем выборку.
    query_start = start_dt - timedelta(hours=12)
    query_end = end_dt + timedelta(hours=12)
    exclude_event_ids = {int(pk) for pk in (exclude_event_ids or []) if pk}
    exclude_series_ids = {int(pk) for pk in (exclude_series_ids or []) if pk}

    events = (
        ScheduleEvent.objects.filter(
            owner=teacher,
            starts_at__lt=query_end,
            ends_at__gt=query_start,
        )
        .exclude(status=ScheduleEvent.Status.CANCELLED)
        .select_related("student", "series")
    )
    if exclude_event_ids:
        events = events.exclude(pk__in=exclude_event_ids)

    intervals: list[BusyInterval] = []
    materialized = set()  # (series_id, local date iso)
    for event in events:
        if event.series_id and event.series_id in exclude_series_ids:
            continue
        intervals.append(_interval_from_event(event))
        if event.series_id:
            local = event.starts_at.astimezone(tz).date()
            materialized.add((event.series_id, local.isoformat()))

    cancelled_dates = set()
    if exclude_event_ids or True:
        cancelled_rows = ScheduleEvent.objects.filter(
            owner=teacher,
            status=ScheduleEvent.Status.CANCELLED,
            starts_at__lt=query_end,
            ends_at__gt=query_start,
            series_id__isnull=False,
        ).values_list("series_id", "starts_at")
        for series_id, starts_at in cancelled_rows:
            local = starts_at.astimezone(tz).date()
            cancelled_dates.add((series_id, local.isoformat()))
            materialized.add((series_id, local.isoformat()))

    date_from = start_dt.astimezone(tz).date()
    date_to = (end_dt.astimezone(tz) - timedelta(microseconds=1)).date()
    series_qs = ScheduleEventSeries.objects.filter(
        teacher=teacher,
        status=SeriesStatus.ACTIVE,
        start_date__lte=date_to,
    )
    if exclude_series_ids:
        series_qs = series_qs.exclude(pk__in=exclude_series_ids)
    for series in series_qs:
        if series.recurrence_type == RecurrenceType.NONE:
            continue
        for day in _iter_dates(series, date_from, date_to):
            key = (series.pk, day.isoformat())
            if key in materialized or key in cancelled_dates:
                continue
            starts_at, ends_at = _combine(series, day)
            if ends_at <= query_start or starts_at >= query_end:
                continue
            intervals.append(_interval_from_series(series, starts_at, ends_at))

    intervals.sort(key=lambda item: (item.start, item.end, item.event_id or 0))
    return [item for item in intervals if item.start < end_dt and item.end > start_dt]


def find_overlapping_intervals(intervals: list[BusyInterval], start: datetime, end: datetime) -> list[BusyInterval]:
    start = _as_aware(start)
    end = _as_aware(end)
    return [item for item in intervals if item.overlaps(start, end)]


def serialize_busy_interval(item: BusyInterval, *, public=False) -> dict:
    title = item.public_label() if public else item.teacher_label()
    return {
        "id": item.event_id,
        "series_id": item.series_id,
        "title": title,
        "starts_at": item.start.isoformat(),
        "ends_at": item.end.isoformat(),
        "event_type": item.event_type if not public else "",
        "source": item.source if not public else "busy",
        "visibility": item.visibility,
        "is_travel": item.is_travel,
        "student_name": "" if public else item.student_name,
    }
