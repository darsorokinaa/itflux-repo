"""Даты занятий в плане: первая дата + интервал → остальные автоматически."""

from datetime import date, timedelta
import logging

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

INTERVAL_LABELS = {
    INTERVAL_DAILY: "Каждый день",
    INTERVAL_FOUR_WEEKLY: "4 раза в неделю",
    INTERVAL_THRICE_WEEKLY: "3 раза в неделю",
    INTERVAL_TWICE_WEEKLY: "2 раза в неделю",
    INTERVAL_WEEKLY: "Раз в неделю",
    INTERVAL_BIWEEKLY: "Раз в две недели",
}


def normalize_interval(value):
    raw = str(value or "").strip().lower().replace(" ", "_")
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
    return aliases.get(raw, INTERVAL_WEEKLY)


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


def generate_plan_dates(start, count, interval=INTERVAL_WEEKLY):
    start_date = parse_plan_date(start)
    if not start_date or count <= 0:
        return []
    interval = normalize_interval(interval)
    dates = []
    current = start_date
    for index in range(count):
        dates.append(current)
        current = next_plan_date(current, index, interval)
    return dates


def apply_plan_item_dates(plan, start_date, interval=INTERVAL_WEEKLY, *, from_index=0):
    """Проставляет scheduled_date пунктам плана от первой даты.

    Учитель потом может поправить любую дату отдельно через PATCH пункта.
    """
    if plan is None:
        return []
    items = list(plan.items.order_by("order", "id"))
    if from_index:
        items = items[from_index:]
    start = parse_plan_date(start_date)
    if start is None and items:
        start = items[0].scheduled_date
    dates = generate_plan_dates(start, len(items), interval)
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
    return dates


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
