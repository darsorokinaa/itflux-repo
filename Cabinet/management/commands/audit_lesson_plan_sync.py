"""Только чтение: рассинхрон расписание ↔ план ↔ журнал."""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count, Q
from django.utils import timezone

from Cabinet.choices import PlanItemStatus
from Cabinet.journal_models import LessonJournal
from Cabinet.models import LessonPlan, LessonPlanItem, ScheduleEvent
from Cabinet.plan_dedupe import cancel_duplicate_active_enrollments
from Cabinet.plan_schedule import AUTO_MATERIALS_PLAN_DESCRIPTION


class Command(BaseCommand):
    help = (
        "Аудит связей план/расписание/журнал (только чтение). "
        "python manage.py audit_lesson_plan_sync [--output=plan_sync_audit.json]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="", help="Путь к JSON-отчёту")

    def handle(self, *args, **options):
        report = self._build_report()
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _build_report(self) -> dict:
        completed_statuses = (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED)
        events = ScheduleEvent.objects.all()
        completed = events.filter(status__in=completed_statuses)
        completed_without_item = completed.filter(lesson_plan_item__isnull=True).count()
        completed_item_not_done = completed.filter(
            lesson_plan_item__isnull=False,
        ).exclude(
            lesson_plan_item__status=PlanItemStatus.COMPLETED,
        ).count()
        completed_items_without_event = LessonPlanItem.objects.filter(
            status=PlanItemStatus.COMPLETED,
            scheduled_event__isnull=True,
        ).count()
        items_with_many_events = list(
            ScheduleEvent.objects.filter(lesson_plan_item__isnull=False)
            .exclude(status=ScheduleEvent.Status.CANCELLED)
            .values("lesson_plan_item_id")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)[:200]
        )
        cancelled_but_item_completed = events.filter(
            status=ScheduleEvent.Status.CANCELLED,
            lesson_plan_item__status=PlanItemStatus.COMPLETED,
        ).count()
        journals_without_topic = LessonJournal.objects.filter(
            Q(planned_topic="") | Q(planned_topic__isnull=True)
        ).count()
        completed_without_journal = completed.exclude(
            id__in=LessonJournal.objects.values("schedule_event_id")
        ).count()

        reverse_mismatch = 0
        topic_mismatch = []
        alien_links = 0
        for event in (
            ScheduleEvent.objects.filter(lesson_plan_item__isnull=False)
            .select_related("lesson_plan_item", "lesson_plan_item__plan", "student", "group")
            .iterator(chunk_size=200)
        ):
            item = event.lesson_plan_item
            if item is None:
                continue
            if item.scheduled_event_id not in (None, event.pk):
                reverse_mismatch += 1
            plan_topic = (item.topic or item.title or "").strip()
            event_topic = (event.topic or "").strip()
            if (
                plan_topic
                and event_topic
                and plan_topic != event_topic
                and event.plan_sync_enabled
                and "topic" not in (event.manual_override_fields or [])
                and event.status not in completed_statuses
                and event.status != ScheduleEvent.Status.CANCELLED
            ):
                if len(topic_mismatch) < 100:
                    topic_mismatch.append({
                        "event_id": event.pk,
                        "item_id": item.pk,
                        "event_topic": event_topic,
                        "plan_topic": plan_topic,
                    })
            enrollments = item.plan.enrollments.all()
            if event.student_id and enrollments.exists():
                if not any(enr.student_id == event.student_id for enr in enrollments):
                    alien_links += 1

        empty_plans = LessonPlan.objects.exclude(
            description=AUTO_MATERIALS_PLAN_DESCRIPTION,
        ).annotate(n=Count("items")).filter(n=0).count()
        auto_material_plans = LessonPlan.objects.filter(
            description=AUTO_MATERIALS_PLAN_DESCRIPTION,
        ).count()

        duplicate_report = cancel_duplicate_active_enrollments(apply=False)

        order_gaps = 0
        for plan_id in LessonPlan.objects.exclude(
            description=AUTO_MATERIALS_PLAN_DESCRIPTION,
        ).values_list("id", flat=True):
            orders = list(
                LessonPlanItem.objects.filter(plan_id=plan_id)
                .order_by("order", "id")
                .values_list("order", flat=True)
            )
            if orders and orders != list(range(orders[0], orders[0] + len(orders))):
                order_gaps += 1

        future_unlinked = ScheduleEvent.objects.filter(
            lesson_plan_item__isnull=True,
            starts_at__gte=timezone.now(),
        ).exclude(
            status__in=[
                ScheduleEvent.Status.CANCELLED,
                ScheduleEvent.Status.COMPLETED,
                ScheduleEvent.Status.DONE,
            ],
        ).count()

        return {
            "generated_at": timezone.now().isoformat(),
            "events_total": events.count(),
            "completed_events": completed.count(),
            "completed_events_without_plan_item_fk": completed_without_item,
            "completed_events_with_unfinished_plan_item": completed_item_not_done,
            "completed_plan_items_without_scheduled_event": completed_items_without_event,
            "plan_items_linked_to_many_events": items_with_many_events,
            "cancelled_events_with_completed_plan_item": cancelled_but_item_completed,
            "journals_without_planned_topic": journals_without_topic,
            "completed_events_without_journal": completed_without_journal,
            "reverse_fk_mismatch": reverse_mismatch,
            "topic_sync_conflicts": topic_mismatch,
            "topic_sync_conflicts_count": len(topic_mismatch),
            "alien_plan_item_links": alien_links,
            "empty_plans": empty_plans,
            "auto_material_draft_plans": auto_material_plans,
            "duplicate_active_enrollments": duplicate_report["cancelled_count"],
            "duplicate_active_details": duplicate_report["cancelled"][:50],
            "plan_order_gaps": order_gaps,
            "future_events_without_plan_item": future_unlinked,
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write("Аудит план/расписание/журнал (данные не изменены)")
        keys = [
            "events_total",
            "duplicate_active_enrollments",
            "completed_events_without_plan_item_fk",
            "future_events_without_plan_item",
            "topic_sync_conflicts_count",
            "alien_plan_item_links",
            "reverse_fk_mismatch",
            "empty_plans",
            "auto_material_draft_plans",
            "plan_order_gaps",
            "completed_events_with_unfinished_plan_item",
            "completed_plan_items_without_scheduled_event",
            "cancelled_events_with_completed_plan_item",
            "journals_without_planned_topic",
            "completed_events_without_journal",
        ]
        for key in keys:
            self.stdout.write(f"  {key}: {report.get(key)}")
        self.stdout.write(
            f"  plan items with many events: {len(report.get('plan_items_linked_to_many_events') or [])}"
        )
