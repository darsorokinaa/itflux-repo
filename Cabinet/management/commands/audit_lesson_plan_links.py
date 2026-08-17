"""Read-only: связи LessonPlanItem ↔ ScheduleEvent."""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count, Q
from django.utils import timezone

from Cabinet.choices import PlanItemStatus
from Cabinet.models import LessonPlanItem, ScheduleEvent


class Command(BaseCommand):
    help = (
        "Аудит связей пункт плана ↔ занятие. Только чтение. "
        "python manage.py audit_lesson_plan_links [--output=plan-links.json]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--output", type=str, default="", help="Путь к JSON-отчёту")

    def handle(self, *args, **options):
        report = self._build_report()
        self._print_summary(report)
        output = (options.get("output") or "").strip()
        if output:
            path = Path(output)
            path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
            self.stdout.write(self.style.SUCCESS(f"Отчёт сохранён: {path}"))

    def _build_report(self) -> dict:
        multi = list(
            ScheduleEvent.objects.filter(lesson_plan_item_id__isnull=False)
            .values("lesson_plan_item_id")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .order_by("-c")[:100]
        )
        multi_details = []
        for row in multi[:40]:
            item_id = row["lesson_plan_item_id"]
            events = list(
                ScheduleEvent.objects.filter(lesson_plan_item_id=item_id)
                .values("id", "status", "starts_at", "series_id")
            )
            multi_details.append({"plan_item_id": item_id, "count": row["c"], "events": events})

        expected_plan = ScheduleEvent.objects.filter(
            plan_sync_enabled=True,
            student_id__isnull=False,
        ).exclude(
            status=ScheduleEvent.Status.CANCELLED,
        )
        events_without_item = expected_plan.filter(lesson_plan_item_id__isnull=True).count()

        cancelled_or_moved_with_item = list(
            ScheduleEvent.objects.filter(
                lesson_plan_item_id__isnull=False,
                status__in=[ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.MOVED],
            ).values("id", "status", "lesson_plan_item_id", "plan_cancel_action")[:80]
        )
        completed_item_mismatch = list(
            LessonPlanItem.objects.filter(
                status=PlanItemStatus.COMPLETED,
            ).filter(
                Q(scheduled_event__isnull=True)
                | ~Q(
                    scheduled_event__status__in=[
                        ScheduleEvent.Status.DONE,
                        ScheduleEvent.Status.COMPLETED,
                    ]
                )
            ).values("id", "status", "scheduled_event_id", "scheduled_event__status")[:50]
        )
        reverse_mismatch = []
        for item in LessonPlanItem.objects.filter(scheduled_event_id__isnull=False).select_related(
            "scheduled_event"
        ).iterator(chunk_size=200):
            linked_ids = list(item.schedule_events_linked.values_list("id", flat=True))
            if item.scheduled_event_id not in linked_ids:
                reverse_mismatch.append({
                    "plan_item_id": item.pk,
                    "scheduled_event_id": item.scheduled_event_id,
                    "linked_event_ids": linked_ids,
                })
            if len(reverse_mismatch) >= 40:
                break

        return {
            "generated_at": timezone.now().isoformat(),
            "plan_items_total": LessonPlanItem.objects.count(),
            "events_with_plan_item": ScheduleEvent.objects.filter(
                lesson_plan_item_id__isnull=False
            ).count(),
            "plan_items_with_multiple_events": len(multi),
            "multi_event_items": multi_details,
            "events_expected_plan_without_item": events_without_item,
            "cancelled_or_moved_with_active_plan_item": cancelled_or_moved_with_item,
            "completed_items_with_conflicting_event_status": completed_item_mismatch,
            "scheduled_event_not_in_reverse_fk": reverse_mismatch,
            "note": (
                "Ожидаемая cardinality: один пункт плана — одно активное занятие "
                "(FK без UniqueConstraint). Только чтение, данные не чинятся."
            ),
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write("Аудит связей LessonPlanItem ↔ ScheduleEvent (данные не изменены)")
        self.stdout.write(f"  plan_items_total: {report['plan_items_total']}")
        self.stdout.write(f"  events_with_plan_item: {report['events_with_plan_item']}")
        self.stdout.write(f"  plan_items_with_multiple_events: {report['plan_items_with_multiple_events']}")
        self.stdout.write(
            f"  events expected plan without item: {report['events_expected_plan_without_item']}"
        )
        self.stdout.write(
            f"  cancelled/moved with plan item: {len(report['cancelled_or_moved_with_active_plan_item'])}"
        )
        self.stdout.write(
            f"  completed items conflicting event: {len(report['completed_items_with_conflicting_event_status'])}"
        )
