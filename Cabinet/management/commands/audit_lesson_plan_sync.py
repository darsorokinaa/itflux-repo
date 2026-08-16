"""Только чтение: рассинхрон расписание ↔ план ↔ журнал."""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count, Q
from django.utils import timezone

from Cabinet.choices import PlanItemStatus
from Cabinet.journal_models import LessonJournal
from Cabinet.models import LessonPlanItem, ScheduleEvent


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
            .values("lesson_plan_item_id")
            .annotate(cnt=Count("id"))
            .filter(cnt__gt=1)[:200]
        )
        cancelled_but_item_completed = events.filter(
            status=ScheduleEvent.Status.CANCELLED,
            lesson_plan_item__status=PlanItemStatus.COMPLETED,
        ).count()
        moved_but_item_completed = events.filter(
            status=ScheduleEvent.Status.MOVED,
            lesson_plan_item__status=PlanItemStatus.COMPLETED,
        ).count()
        journals_without_topic = LessonJournal.objects.filter(
            Q(planned_topic="") | Q(planned_topic__isnull=True)
        ).count()
        completed_without_journal = completed.exclude(
            id__in=LessonJournal.objects.values("schedule_event_id")
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
            "moved_events_with_completed_plan_item": moved_but_item_completed,
            "journals_without_planned_topic": journals_without_topic,
            "completed_events_without_journal": completed_without_journal,
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write("Аудит план/расписание/журнал (данные не изменены)")
        for key, value in report.items():
            if key in ("generated_at", "plan_items_linked_to_many_events"):
                continue
            self.stdout.write(f"  {key}: {value}")
        self.stdout.write(
            f"  plan items with many events: {len(report.get('plan_items_linked_to_many_events') or [])}"
        )
