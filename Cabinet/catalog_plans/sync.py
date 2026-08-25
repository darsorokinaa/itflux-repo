from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction

from Cabinet.choices import PlanItemStatus, PlanStatus
from Cabinet.models import LessonPlan, LessonPlanItem


def _publisher_teacher():
    emails = getattr(settings, "LESSON_PLAN_CATALOG_PUBLISHER_EMAILS", ()) or ()
    for email in emails:
        email = (email or "").strip()
        if not email:
            continue
        user = User.objects.filter(email__iexact=email).first()
        if user is not None:
            return user
    return None


def _item_payload(spec_item):
    topic = (spec_item.get("topic") or "").strip()
    subtopic = (spec_item.get("subtopic") or "").strip()
    block = (spec_item.get("block") or "").strip()
    description = (spec_item.get("description") or "").strip()
    if block:
        description = f"{block}\n\n{description}".strip() if description else block
    title = subtopic or topic or f"Занятие {spec_item['order']}"
    return {
        "order": spec_item["order"],
        "title": title[:255],
        "topic": topic[:500],
        "subtopic": subtopic[:255],
        "task_number": (spec_item.get("task_number") or "")[:32],
        "description": description,
        "goal": (spec_item.get("goal") or "").strip(),
        "planned_results": (spec_item.get("planned_results") or "").strip(),
        "status": PlanItemStatus.NOT_STARTED,
    }


def _find_existing(spec):
    return (
        LessonPlan.objects.filter(
            is_public=True,
            title=spec["title"],
            subject=spec["subject"],
            direction=spec["direction"],
        )
        .order_by("id")
        .first()
    )


@transaction.atomic
def sync_catalog_plan(spec) -> tuple[LessonPlan, bool]:
    """Создаёт или обновляет публичный шаблон. Повторный запуск не плодит дубли."""
    items_spec = list(spec.get("items") or [])
    defaults = {
        "description": spec.get("description") or "",
        "goal": spec.get("goal") or "",
        "exam_type": spec.get("exam_type") or "",
        "grade": spec.get("grade") or "",
        "is_public": True,
        "status": PlanStatus.PUBLISHED,
        "lessons_count": len(items_spec),
    }
    plan = _find_existing(spec)
    created = plan is None
    if created:
        plan = LessonPlan.objects.create(
            teacher=_publisher_teacher(),
            title=spec["title"],
            subject=spec["subject"],
            direction=spec["direction"],
            **defaults,
        )
    else:
        for field, value in defaults.items():
            setattr(plan, field, value)
        plan.save(update_fields=[*defaults.keys(), "updated_at"])

    keep_orders = []
    for spec_item in items_spec:
        payload = _item_payload(spec_item)
        order = payload.pop("order")
        keep_orders.append(order)
        item = plan.items.filter(order=order).order_by("id").first()
        if item is None:
            LessonPlanItem.objects.create(plan=plan, order=order, **payload)
        else:
            for field, value in payload.items():
                setattr(item, field, value)
            item.save(update_fields=[*payload.keys(), "updated_at"])

    extras = plan.items.exclude(order__in=keep_orders)
    for extra in extras:
        if extra.schedule_events_linked.exists() or extra.scheduled_event_id:
            continue
        extra.delete()

    plan.lessons_count = plan.items.count()
    plan.save(update_fields=["lessons_count", "updated_at"])
    return plan, created


def sync_all_catalog_plans(*, keys=None) -> list[tuple[LessonPlan, bool]]:
    from . import ALL_PLANS

    wanted = {key.strip() for key in (keys or []) if str(key).strip()}
    results = []
    for spec in ALL_PLANS:
        if wanted and spec.get("key") not in wanted:
            continue
        results.append(sync_catalog_plan(spec))
    return results
