"""Read-only: распределение статусов ScheduleEvent и подозрительные комбинации."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from django.utils import timezone

from Cabinet.models import ScheduleEvent, VideoMeeting


class Command(BaseCommand):
    help = (
        "Аудит статусов занятий. Только чтение. "
        "python manage.py audit_schedule_event_statuses [--output=statuses.json]"
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
        qs = ScheduleEvent.objects.all()
        by_status = dict(
            qs.values("status").annotate(c=Count("id")).values_list("status", "c")
        )
        unknown_status = list(
            qs.exclude(status__in=[choice[0] for choice in ScheduleEvent.Status.choices])
            .values("id", "status")[:50]
        )
        monthly = defaultdict(lambda: Counter())
        for row in (
            qs.annotate(month=TruncMonth("starts_at"))
            .values("month", "status")
            .annotate(c=Count("id"))
        ):
            key = row["month"].strftime("%Y-%m") if row["month"] else "unknown"
            monthly[key][row["status"]] = row["c"]

        journal_by_event_status = list(
            qs.filter(journal__isnull=False)
            .values("status", "journal__status")
            .annotate(c=Count("id"))
            .order_by("status", "journal__status")
        )
        billing_by_event_status = list(
            qs.filter(billing_records__isnull=False)
            .values("status", "billing_records__delivery_status", "billing_records__financial_status")
            .annotate(c=Count("id", distinct=True))
            .order_by("status")[:80]
        )
        meeting_by_event_status = list(
            VideoMeeting.objects.values("schedule_event__status", "status")
            .annotate(c=Count("id"))
            .order_by("schedule_event__status", "status")
        )

        moved = qs.filter(status=ScheduleEvent.Status.MOVED)
        moved_without_original = moved.filter(original_start_at__isnull=True).count()
        now = timezone.now()
        conducted_future = qs.filter(
            status__in=[ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED],
            starts_at__gt=now,
        ).count()
        cancelled_with_reminders = qs.filter(
            status=ScheduleEvent.Status.CANCELLED,
            reminder_logs__isnull=False,
        ).distinct().count()

        tz_counts = dict(
            qs.values("timezone").annotate(c=Count("id")).values_list("timezone", "c")
        )
        empty_tz = qs.filter(Q(timezone="") | Q(timezone__isnull=True)).count()

        conducted_in_series = qs.filter(
            series_id__isnull=False,
            status__in=[ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED],
        )
        series_would_mutate = []
        for event in conducted_in_series.select_related("series")[:200]:
            siblings = ScheduleEvent.objects.filter(series_id=event.series_id)
            mutable_if_old_scope = siblings.exclude(
                status__in=[ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.COMPLETED]
            ).filter(status=ScheduleEvent.Status.DONE).count()
            if mutable_if_old_scope:
                series_would_mutate.append({
                    "event_id": event.pk,
                    "series_id": event.series_id,
                    "status": event.status,
                    "done_siblings_old_scope": mutable_if_old_scope,
                })

        odd = {
            "unknown_status": unknown_status,
            "done_and_completed_both_present": bool(
                by_status.get(ScheduleEvent.Status.DONE) and by_status.get(ScheduleEvent.Status.COMPLETED)
            ),
            "moved_without_original_start_at": moved_without_original,
            "conducted_with_future_starts_at": conducted_future,
            "cancelled_with_reminder_logs": cancelled_with_reminders,
            "empty_timezone": empty_tz,
            "done_in_series_old_scope_would_mutate": series_would_mutate[:30],
        }
        return {
            "generated_at": timezone.now().isoformat(),
            "total": qs.count(),
            "by_status": by_status,
            "by_month": {month: dict(counts) for month, counts in sorted(monthly.items())},
            "journal_by_event_status": journal_by_event_status,
            "billing_by_event_status": billing_by_event_status,
            "video_meeting_by_event_status": meeting_by_event_status,
            "moved_count": moved.count(),
            "moved_without_original_start_at": moved_without_original,
            "timezone_distribution": tz_counts,
            "odd": odd,
            "note": (
                "Только чтение. done и completed — синонимы «проведено». "
                "moved — то же занятие после переноса (не tombstone). "
                "Данные не исправляются."
            ),
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write("Аудит статусов ScheduleEvent (данные не изменены)")
        self.stdout.write(f"  total: {report['total']}")
        for status, count in sorted(report["by_status"].items(), key=lambda row: (-row[1], row[0])):
            self.stdout.write(f"  status {status}: {count}")
        self.stdout.write(f"  moved: {report['moved_count']}")
        self.stdout.write(f"  moved without original_start_at: {report['moved_without_original_start_at']}")
        odd = report["odd"]
        self.stdout.write(f"  unknown_status: {len(odd['unknown_status'])}")
        self.stdout.write(f"  conducted with future starts_at: {odd['conducted_with_future_starts_at']}")
        self.stdout.write(f"  empty timezone: {odd['empty_timezone']}")
        self.stdout.write(
            f"  done siblings previously in series edit scope: "
            f"{len(odd['done_in_series_old_scope_would_mutate'])}"
        )
