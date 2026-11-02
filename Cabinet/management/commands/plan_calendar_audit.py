"""r137: аудит расхождений плана уроков и календаря.

Категории:
  date_mismatch      — у темы есть активное занятие, но дата темы != локальной дате занятия (исправляется);
  linked_to_inactive — тема привязана к отменённому/пропущенному занятию (снимается только с --unlink-cancelled);
  without_lesson     — у темы есть дата, но активного занятия нет (только отчёт, уроки НЕ создаются);
  event_only_link    — занятие ссылается на тему, а тема на него нет (только отчёт).

Исправления — queryset.update() в одной транзакции: без сигналов, reflow и уведомлений.
"""
import json

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from Cabinet.choices import PlanItemStatus
from Cabinet.models import LessonPlanItem, ScheduleEvent
from Cabinet.plan_schedule import event_local_date

INACTIVE = (ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.SKIPPED)
TERMINAL_ITEM = (PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED)


def collect(teacher_id=None):
    qs = LessonPlanItem.objects.select_related("plan", "scheduled_event")
    if teacher_id:
        qs = qs.filter(plan__teacher_id=teacher_id)
    active_by_item = {}
    ev_qs = ScheduleEvent.objects.filter(lesson_plan_item__isnull=False).exclude(status__in=INACTIVE)
    if teacher_id:
        ev_qs = ev_qs.filter(owner_id=teacher_id)
    for ev in ev_qs.order_by("starts_at"):
        active_by_item.setdefault(ev.lesson_plan_item_id, ev)
    out = {"date_mismatch": [], "linked_to_inactive": [], "without_lesson": [], "event_only_link": []}
    for it in qs.order_by("plan_id", "order", "id"):
        ev = it.scheduled_event
        base = {
            "item_id": it.pk, "plan_id": it.plan_id, "teacher_id": it.plan.teacher_id,
            "order": it.order, "topic": (it.topic or it.title or "")[:80],
            "status": it.status,
            "scheduled_date": it.scheduled_date.isoformat() if it.scheduled_date else None,
            "scheduled_event_id": it.scheduled_event_id,
        }
        if ev is not None and ev.status not in INACTIVE:
            local = event_local_date(ev)
            if local and it.scheduled_date != local:
                out["date_mismatch"].append({**base, "event_local_date": local.isoformat(), "event_status": ev.status})
            continue
        if ev is not None:
            out["linked_to_inactive"].append({**base, "event_status": ev.status})
        other = active_by_item.get(it.pk)
        if other is not None:
            out["event_only_link"].append({**base, "event_id": other.pk,
                                           "event_local_date": event_local_date(other).isoformat()})
            continue
        if it.scheduled_date and it.status not in TERMINAL_ITEM:
            out["without_lesson"].append(base)
    return out


class Command(BaseCommand):
    help = "Аудит и исправление расхождений план ↔ календарь (r137)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")
        parser.add_argument("--teacher", type=int)
        parser.add_argument("--json-out")
        parser.add_argument(
            "--include-conducted", action="store_true",
            help="Править дату и у тем проведённых занятий (по умолчанию только запланированные/перенесённые).",
        )
        parser.add_argument(
            "--unlink-cancelled", action="store_true",
            help="Снять связь темы с отменённым уроком (по умолчанию нет: тема зарезервирована для переноса).",
        )

    def handle(self, *args, **opts):
        data = collect(opts.get("teacher"))
        summary = {k: len(v) for k, v in data.items()}
        active_rows = [r for r in data["date_mismatch"] if r["event_status"] in ("planned", "moved")]
        summary["date_mismatch_active_lessons"] = len(active_rows)
        if opts.get("json_out"):
            with open(opts["json_out"], "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=1)
        self.stdout.write(json.dumps({"summary": summary, "dry_run": bool(opts["dry_run"])}, ensure_ascii=False))
        if opts["dry_run"]:
            return
        now = timezone.now()
        fixed_dates = unlinked = 0
        with transaction.atomic():
            for row in (data["date_mismatch"] if opts.get("include_conducted") else active_rows):
                fixed_dates += LessonPlanItem.objects.filter(
                    pk=row["item_id"], scheduled_event_id=row["scheduled_event_id"],
                ).update(scheduled_date=row["event_local_date"], updated_at=now)
            for row in (data["linked_to_inactive"] if opts.get("unlink_cancelled") else []):
                unlinked += LessonPlanItem.objects.filter(
                    pk=row["item_id"], scheduled_event_id=row["scheduled_event_id"],
                ).update(scheduled_event=None, updated_at=now)
        self.stdout.write(json.dumps({"applied": {"date_fixed": fixed_dates, "unlinked": unlinked}}))
