"""Read-only: журналы уроков и расхождения с расписанием."""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from Cabinet.journal_models import JournalStatus, LessonJournal
from Cabinet.models import ScheduleEvent


class Command(BaseCommand):
    help = (
        "Аудит журналов уроков. Только чтение. "
        "python manage.py audit_lesson_journals [--output=journals.json]"
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
        status_dist = dict(
            LessonJournal.objects.values_list("status").annotate(c=Count("id")).values_list("status", "c")
        )
        without_event = LessonJournal.objects.filter(schedule_event__isnull=True).count()
        multi = list(
            LessonJournal.objects.values("schedule_event_id")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .order_by("-c")[:100]
        )
        completed_event_draft = list(
            LessonJournal.objects.filter(
                status=JournalStatus.DRAFT,
                schedule_event__status__in=[
                    ScheduleEvent.Status.COMPLETED,
                    ScheduleEvent.Status.DONE,
                ],
            ).values("id", "schedule_event_id", "status", "schedule_event__status")[:80]
        )
        cancelled_event_completed = list(
            LessonJournal.objects.filter(
                status=JournalStatus.COMPLETED,
                schedule_event__status=ScheduleEvent.Status.CANCELLED,
            ).values("id", "schedule_event_id", "status", "schedule_event__status")[:80]
        )
        mismatch = []
        for row in (
            LessonJournal.objects.filter(actual_topic__gt="")
            .select_related("schedule_event")
            .only(
                "id",
                "actual_topic",
                "planned_topic",
                "status",
                "schedule_event_id",
                "schedule_event__topic",
            )[:400]
        ):
            event_topic = (row.schedule_event.topic or "").strip() if row.schedule_event_id else ""
            actual = (row.actual_topic or "").strip()
            if actual and event_topic and actual != event_topic:
                mismatch.append(
                    {
                        "journal_id": row.id,
                        "event_id": row.schedule_event_id,
                        "status": row.status,
                        "actual_topic": actual,
                        "event_topic": event_topic,
                        "planned_topic": row.planned_topic,
                    }
                )
        suspected = [
            {
                "schedule_event_id": row["schedule_event_id"],
                "count": row["c"],
            }
            for row in multi
        ]
        return {
            "generated_at": timezone.now().isoformat(),
            "total": LessonJournal.objects.count(),
            "status_distribution": status_dist,
            "journal_without_event": without_event,
            "event_with_multiple_journals": suspected,
            "completed_event_draft_journal": completed_event_draft,
            "cancelled_event_completed_journal": cancelled_event_completed,
            "factual_topic_mismatch": mismatch[:80],
            "factual_topic_mismatch_count": len(mismatch),
            "offline_journals": LessonJournal.objects.filter(
                schedule_event__format=ScheduleEvent.Format.OFFLINE
            ).count(),
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write(f"journals={report['total']}")
        self.stdout.write(f"status={report['status_distribution']}")
        self.stdout.write(f"without_event={report['journal_without_event']}")
        self.stdout.write(f"multi_journals={len(report['event_with_multiple_journals'])}")
        self.stdout.write(f"completed_event_draft={len(report['completed_event_draft_journal'])}")
        self.stdout.write(f"cancelled_event_completed={len(report['cancelled_event_completed_journal'])}")
        self.stdout.write(f"topic_mismatch={report['factual_topic_mismatch_count']}")
        self.stdout.write(f"offline={report['offline_journals']}")
        if report["event_with_multiple_journals"]:
            self.stdout.write(self.style.WARNING("Есть события с несколькими журналами — не вводить unique без разбора."))
        else:
            self.stdout.write(self.style.SUCCESS("Дублей журнал↔событие не найдено."))
