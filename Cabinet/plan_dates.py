"""Даты занятий в плане: первая дата + интервал или дни недели → остальные автоматически.

День недели не хранится отдельно: он всегда вычисляется из календарной даты.
Уже заполненные даты не переписываются, пока преподаватель явно не просит пересчёт.
"""

from datetime import date, time, timedelta
import logging
import re

from django.utils.dateparse import parse_date

from .choices import PlanItemStatus
from .models import LessonPlanItem

logger = logging.getLogger("cabinet.plan_sync")

INTERVAL_WEEKLY = "weekly"
INTERVAL_TWICE_WEEKLY = "twice_weekly"
INTERVAL_THRICE_WEEKLY = "thrice_weekly"
INTERVAL_FOUR_WEEKLY = "four_weekly"
INTERVAL_DAILY = "daily"
INTERVAL_BIWEEKLY = "biweekly"

VALID_INTERVALS = frozenset({
    INTERVAL_DAILY,
    INTERVAL_FOUR_WEEKLY,
    INTERVAL_THRICE_WEEKLY,
    INTERVAL_TWICE_WEEKLY,
    INTERVAL_WEEKLY,
    INTERVAL_BIWEEKLY,
})

INTERVAL_WEEKDAYS = "weekdays"

INTERVAL_LABELS = {
    INTERVAL_DAILY: "Каждый день",
    INTERVAL_FOUR_WEEKLY: "4 раза в неделю",
    INTERVAL_THRICE_WEEKLY: "3 раза в неделю",
    INTERVAL_TWICE_WEEKLY: "2 раза в неделю",
    INTERVAL_WEEKLY: "Раз в неделю",
    INTERVAL_BIWEEKLY: "Раз в две недели",
    INTERVAL_WEEKDAYS: "По выбранным дням",
}

WEEKDAY_LABELS_RU = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)


def normalize_interval(value):
    raw = str(value or "").strip().lower().replace(" ", "_")
    if raw in {"manual", "none", "off", "без_автоматического_расписания"}:
        return "manual"
    if raw in VALID_INTERVALS:
        return raw
    aliases = {
        "7": INTERVAL_WEEKLY,
        "week": INTERVAL_WEEKLY,
        "weekly": INTERVAL_WEEKLY,
        "раз_в_неделю": INTERVAL_WEEKLY,
        "14": INTERVAL_BIWEEKLY,
        "biweekly": INTERVAL_BIWEEKLY,
        "2weeks": INTERVAL_BIWEEKLY,
        "раз_в_две_недели": INTERVAL_BIWEEKLY,
        "twice": INTERVAL_TWICE_WEEKLY,
        "twice_weekly": INTERVAL_TWICE_WEEKLY,
        "2x": INTERVAL_TWICE_WEEKLY,
        "2_раза_в_неделю": INTERVAL_TWICE_WEEKLY,
        "thrice": INTERVAL_THRICE_WEEKLY,
        "thrice_weekly": INTERVAL_THRICE_WEEKLY,
        "3x": INTERVAL_THRICE_WEEKLY,
        "3_раза_в_неделю": INTERVAL_THRICE_WEEKLY,
        "four": INTERVAL_FOUR_WEEKLY,
        "four_weekly": INTERVAL_FOUR_WEEKLY,
        "4x": INTERVAL_FOUR_WEEKLY,
        "4_раза_в_неделю": INTERVAL_FOUR_WEEKLY,
        "daily": INTERVAL_DAILY,
        "day": INTERVAL_DAILY,
        "каждый_день": INTERVAL_DAILY,
    }
    if raw in ("weekdays", "custom_weekdays", "по_дням", "дни_недели"):
        return INTERVAL_WEEKDAYS
    if aliases.get(raw):
        return aliases[raw]
    every = _every_n_step(raw)
    if every:
        return raw
    return INTERVAL_WEEKLY


def _every_n_step(interval):
    """Постоянный шаг для «каждые N дней/недель». None, если это другой режим."""
    match = re.fullmatch(r"every_(\d+)_(days|weeks)", str(interval or ""))
    if not match:
        return None
    count = int(match.group(1))
    if count < 1:
        return None
    if match.group(2) == "weeks":
        return min(count, 52) * 7
    return min(count, 366)


def weekday_index(value):
    parsed = parse_plan_date(value)
    if parsed is None:
        return None
    return parsed.weekday()


def weekday_label(value):
    index = weekday_index(value)
    if index is None:
        return ""
    return WEEKDAY_LABELS_RU[index]


def normalize_weekdays(raw):
    """0 = понедельник … 6 = воскресенье. Порядок сохраняется, дубли убираются."""
    if raw is None:
        return []
    if isinstance(raw, (str, int)):
        raw = [raw]
    result = []
    for value in raw:
        try:
            day = int(value)
        except (TypeError, ValueError):
            continue
        if 0 <= day <= 6 and day not in result:
            result.append(day)
    return result


def parse_clock(value, default="16:00"):
    text = str(value or default).strip()
    parts = text.split(":")
    try:
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
    except (TypeError, ValueError):
        hour, minute = 16, 0
    hour = min(23, max(0, hour))
    minute = min(59, max(0, minute))
    return time(hour, minute)


def normalize_weekday_slots(raw, weekdays=None):
    """Слоты вида {weekday, start_time, duration_minutes}. Несколько слотов на один день допустимы."""
    slots = []
    if isinstance(raw, list):
        for row in raw:
            if not isinstance(row, dict):
                continue
            try:
                day = int(row.get("weekday"))
            except (TypeError, ValueError):
                continue
            if not 0 <= day <= 6:
                continue
            try:
                duration = int(row.get("duration_minutes") or row.get("duration") or 60)
            except (TypeError, ValueError):
                duration = 60
            duration = min(24 * 60, max(15, duration))
            slots.append({
                "weekday": day,
                "start_time": parse_clock(row.get("start_time") or row.get("start")).strftime("%H:%M"),
                "duration_minutes": duration,
            })
    if slots:
        return slots
    days = normalize_weekdays(weekdays)
    return [
        {"weekday": day, "start_time": "16:00", "duration_minutes": 60}
        for day in days
    ]


def parse_plan_date(value):
    if isinstance(value, date):
        return value
    if not value:
        return None
    if hasattr(value, "date"):
        try:
            return value.date()
        except Exception:
            return None
    return parse_date(str(value)[:10])


def interval_step_days(interval, index):
    fixed = _every_n_step(interval)
    if fixed:
        return fixed
    if interval == "manual":
        return 0
    if interval == INTERVAL_DAILY:
        return 1
    if interval == INTERVAL_THRICE_WEEKLY:
        return (2, 2, 3)[index % 3]
    if interval == INTERVAL_FOUR_WEEKLY:
        return (1, 2, 1, 3)[index % 4]
    if interval == INTERVAL_TWICE_WEEKLY:
        return 3 if index % 2 == 0 else 4
    if interval == INTERVAL_BIWEEKLY:
        return 14
    return 7


def next_plan_date(current, index, interval):
    """Дата следующего занятия после урока с индексом `index`."""
    return current + timedelta(days=interval_step_days(interval, index))


def generate_plan_dates(start, count, interval=INTERVAL_WEEKLY, weekdays=None, until=None):
    start_date = parse_plan_date(start)
    if not start_date or count <= 0:
        return []
    days = normalize_weekdays(weekdays)
    until_date = parse_plan_date(until)
    if days or normalize_interval(interval) == INTERVAL_WEEKDAYS:
        return _dates_for_weekdays(start_date, count, days or [start_date.weekday()], until_date)
    interval = normalize_interval(interval)
    if interval == "manual":
        return [start_date]
    dates = []
    current = start_date
    for index in range(count):
        if until_date and current > until_date:
            break
        dates.append(current)
        current = next_plan_date(current, index, interval)
    return dates


def _dates_for_weekdays(start_date, count, weekdays, until_date):
    dates = []
    cursor = start_date
    guard = 0
    limit = max(count * 14, 400)
    while len(dates) < count and guard < limit:
        if until_date and cursor > until_date:
            break
        if cursor.weekday() in weekdays:
            dates.append(cursor)
        cursor += timedelta(days=1)
        guard += 1
    return dates


def generate_weekday_occurrences(start, count, slots, until=None):
    """Даты и время по слотам дней недели. Один день может дать несколько занятий."""
    start_date = parse_plan_date(start)
    normalized = normalize_weekday_slots(slots)
    if not start_date or count <= 0 or not normalized:
        return []
    until_date = parse_plan_date(until)
    by_day = {}
    for slot in normalized:
        by_day.setdefault(slot["weekday"], []).append(slot)
    occurrences = []
    cursor = start_date
    guard = 0
    while len(occurrences) < count and guard < max(count * 21, 800):
        if until_date and cursor > until_date:
            break
        for slot in by_day.get(cursor.weekday(), []):
            occurrences.append({
                "date": cursor,
                "start_time": slot["start_time"],
                "duration_minutes": slot["duration_minutes"],
                "weekday": cursor.weekday(),
            })
            if len(occurrences) >= count:
                break
        cursor += timedelta(days=1)
        guard += 1
    return occurrences


def iso_plan_date(value):
    parsed = parse_plan_date(value)
    return parsed.isoformat() if parsed else ""


def apply_sequence_dates(items, start, interval=INTERVAL_WEEKLY, *, from_index=0, preserve_manual=True):
    """Проставляет даты списку уроков через generate_plan_dates.

    Ручные даты не пересчитываются. Это тот же scheduler, что и у плана,
    без отдельного Excel-алгоритма «дата + N дней».
    """
    if not items or from_index >= len(items):
        return items
    start_date = parse_plan_date(start) or parse_plan_date(items[from_index].get("scheduled_date"))
    dates = generate_plan_dates(start_date, len(items) - from_index, interval)
    for offset, item in enumerate(items[from_index:]):
        current = parse_plan_date(item.get("scheduled_date"))
        if preserve_manual and str(item.get("date_source") or "").lower() == "manual" and current:
            item["scheduled_date"] = current.isoformat()
            continue
        generated = dates[offset] if offset < len(dates) else None
        if generated is None:
            continue
        item["scheduled_date"] = generated.isoformat()
        item["date_source"] = "automatic"
    return items


def apply_plan_item_dates(
    plan,
    start_date,
    interval=INTERVAL_WEEKLY,
    *,
    from_index=0,
    weekdays=None,
    until=None,
    slots=None,
    preserve_existing=False,
):
    """Проставляет scheduled_date пунктам плана от первой даты.

    Учитель потом может поправить любую дату отдельно через PATCH пункта.
    preserve_existing=True не трогает уже стоящие даты — только пустые слоты.
    Темы, ДЗ и порядок не изменяются.
    """
    if plan is None:
        return []
    items = list(plan.items.order_by("order", "id"))
    if from_index:
        items = items[from_index:]
    start = parse_plan_date(start_date)
    if start is None and items:
        start = items[0].scheduled_date
    normalized_slots = normalize_weekday_slots(slots, weekdays) if (slots or weekdays) else []
    if normalized_slots:
        occurrences = generate_weekday_occurrences(start, len(items), normalized_slots, until=until)
        dates = [row["date"] for row in occurrences]
    else:
        dates = generate_plan_dates(start, len(items), interval, weekdays=weekdays, until=until)
    if preserve_existing:
        used = {}
        for item in items:
            if item.scheduled_date:
                used[item.scheduled_date] = used.get(item.scheduled_date, 0) + 1
        filtered = []
        seen = {}
        for scheduled in dates:
            seen[scheduled] = seen.get(scheduled, 0) + 1
            if seen[scheduled] <= used.get(scheduled, 0):
                continue
            filtered.append(scheduled)
        dates = filtered
        items = [item for item in items if not item.scheduled_date]
    changed = []
    for item, scheduled in zip(items, dates):
        dirty = False
        if item.scheduled_date != scheduled:
            item.scheduled_date = scheduled
            dirty = True
        if scheduled and item.status == PlanItemStatus.NOT_STARTED:
            item.status = PlanItemStatus.PLANNED
            dirty = True
        if dirty:
            changed.append(item)
    if changed:
        LessonPlanItem.objects.bulk_update(changed, ["scheduled_date", "status"])
    _realign_plan_enrollments(plan)
    return [item.scheduled_date for item in plan.items.order_by("order", "id")]


def _realign_plan_enrollments(plan):
    if plan is None or not getattr(plan, "pk", None):
        return
    from .choices import EnrollmentStatus
    from .models import LessonPlanEnrollment
    from .plan_sync import PlanSyncService

    enrollments = LessonPlanEnrollment.objects.filter(plan=plan).exclude(
        status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED],
    )
    for enrollment in enrollments:
        try:
            PlanSyncService.realign_enrollment_topics(enrollment)
        except Exception:
            logger.exception("plan realign after dates failed enrollment=%s", enrollment.pk)


def apply_enrollment_start_dates(enrollment, *, start_date=None, interval=None):
    """Сохраняет дату начала назначения и расставляет даты в плане."""
    if enrollment is None or not enrollment.plan_id:
        return []
    if start_date is not None:
        enrollment.start_date = parse_plan_date(start_date)
    chosen_interval = None
    if interval:
        chosen_interval = normalize_interval(interval)
        enrollment.frequency = chosen_interval
    elif enrollment.frequency:
        chosen_interval = normalize_interval(enrollment.frequency)
    else:
        chosen_interval = INTERVAL_WEEKLY
    update_fields = []
    if start_date is not None:
        update_fields.append("start_date")
    if interval:
        update_fields.append("frequency")
    if update_fields and enrollment.pk:
        update_fields.append("updated_at")
        enrollment.save(update_fields=update_fields)
    if not enrollment.start_date:
        return []
    return apply_plan_item_dates(enrollment.plan, enrollment.start_date, chosen_interval)
