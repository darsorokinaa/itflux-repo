"""Map schedule events to lesson plan items (one lesson → one plan item)."""

from django.utils import timezone

from .choices import EnrollmentStatus, PlanItemStatus
from .models import LessonPlanEnrollment, ScheduleEvent

PLAN_CANCEL_SHIFT = "shift"
PLAN_CANCEL_SKIP = "skip"


def enrollment_start_date(enrollment):
    if enrollment.start_date:
        return enrollment.start_date
    return timezone.localtime(enrollment.created_at).date()


def get_active_enrollment(event):
    qs = LessonPlanEnrollment.objects.filter(
        teacher=event.owner,
    ).exclude(
        status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED],
    )
    if event.student_id:
        qs = qs.filter(student_id=event.student_id)
    elif event.group_id:
        qs = qs.filter(group_id=event.group_id)
    else:
        return None
    return qs.select_related("plan").prefetch_related(
        "plan__items__materials",
        "plan__items__attached_interactives",
        "plan__items__homework_materials",
        "plan__items__homework_interactives",
        "plan__items__linked_lesson",
        "plan__items__plan",
    ).order_by("-created_at").first()


def events_for_enrollment(enrollment, owner):
    qs = ScheduleEvent.objects.filter(owner=owner)
    if enrollment.student_id:
        qs = qs.filter(student_id=enrollment.student_id)
    elif enrollment.group_id:
        qs = qs.filter(group_id=enrollment.group_id)
    else:
        return ScheduleEvent.objects.none()

    start = enrollment_start_date(enrollment)
    if start:
        qs = qs.filter(starts_at__date__gte=start)
    return qs.order_by("starts_at", "pk")


def plan_items_for_enrollment(enrollment):
    items = list(enrollment.plan.items.order_by("order", "id"))
    start_order = getattr(enrollment, "plan_start_order", None) or 1
    if start_order > 1:
        filtered = [item for item in items if item.order >= start_order]
        if filtered:
            items = filtered
        elif start_order <= len(items):
            items = items[start_order - 1:]
    return items


def plan_slot_index(event, enrollment):
    """
    0-based plan slot for this event.
    Cancelled with shift → slot not consumed; cancelled with skip → slot consumed.
    """
    slots = 0
    for ev in events_for_enrollment(enrollment, event.owner):
        if ev.pk == event.pk:
            return slots
        if ev.status == ScheduleEvent.Status.CANCELLED:
            if (getattr(ev, "plan_cancel_action", "") or "") == PLAN_CANCEL_SKIP:
                slots += 1
        else:
            slots += 1
    return None


def plan_item_by_slot(event, enrollment):
    plan_items = plan_items_for_enrollment(enrollment)
    if not plan_items:
        return None, None

    index = plan_slot_index(event, enrollment)
    if index is None or index >= len(plan_items):
        return None, None

    item = plan_items[index]
    lesson_number = item.order or (index + 1)
    return item, lesson_number


def resolve_plan_item_for_event(event):
    """
    One schedule lesson → one plan item.
    Priority: explicit scheduled_event link → slot in enrollment plan → direct FK.
    """
    linked = list(event.plan_items.order_by("order", "id")[:2])
    if len(linked) == 1:
        item = linked[0]
        return item, item.order or None

    enrollment = get_active_enrollment(event)
    if enrollment:
        item, lesson_number = plan_item_by_slot(event, enrollment)
        if item:
            return item, lesson_number

    if event.lesson_plan_item_id:
        item = event.lesson_plan_item
        return item, item.order or None

    if event.series_id and event.series.lesson_plan_item_id:
        item = event.series.lesson_plan_item
        return item, item.order or None

    return None, None


def mark_plan_item_skipped(plan_item, event=None):
    plan_item.status = PlanItemStatus.SKIPPED
    update_fields = ["status", "updated_at"]
    if event and plan_item.scheduled_event_id == event.pk:
        plan_item.scheduled_event = None
        update_fields.append("scheduled_event")
    plan_item.save(update_fields=update_fields)


def apply_plan_cancel_action(event, plan_cancel_action):
    """Apply plan topic shift/skip when a lesson is cancelled."""
    action = (plan_cancel_action or PLAN_CANCEL_SHIFT).strip().lower()
    if action not in (PLAN_CANCEL_SHIFT, PLAN_CANCEL_SKIP):
        action = PLAN_CANCEL_SHIFT

    event.plan_cancel_action = action if action == PLAN_CANCEL_SKIP else ""
    event.save(update_fields=["plan_cancel_action", "updated_at"])

    if action == PLAN_CANCEL_SKIP:
        plan_item, _ = resolve_plan_item_for_event(event)
        if plan_item:
            mark_plan_item_skipped(plan_item, event)

    return action
