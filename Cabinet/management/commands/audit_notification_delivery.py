"""Read-only: дубли доставки уведомлений и устаревшие reminders."""

from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from Cabinet.choices import NotificationChannel, NotificationStatus
from Cabinet.models import EventReminderLog, Notification, ScheduleEvent
from Cabinet.notification_catalog import NotificationEventType


class Command(BaseCommand):
    help = (
        "Аудит доставки уведомлений. Только чтение. "
        "python manage.py audit_notification_delivery [--output=notify-delivery.json]"
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
        key_dups = list(
            Notification.objects.exclude(event_key="")
            .values("recipient_user_id", "channel", "event_key")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .order_by("-c")[:80]
        )
        tg_repeats = list(
            Notification.objects.filter(channel=NotificationChannel.TELEGRAM)
            .exclude(event_key="")
            .values("recipient_user_id", "event_type", "event_key")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .order_by("-c")[:80]
        )
        empty_key_tg = list(
            Notification.objects.filter(
                channel=NotificationChannel.TELEGRAM,
                event_type=NotificationEventType.LESSON_UPDATED,
                event_key="",
            )
            .values("recipient_user_id", "payload__event_id")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .order_by("-c")[:40]
        )
        cancelled_ids = list(
            ScheduleEvent.objects.filter(status=ScheduleEvent.Status.CANCELLED).values_list("id", flat=True)
        )
        reminders_cancelled = EventReminderLog.objects.filter(event_id__in=cancelled_ids).count()
        moved_events = ScheduleEvent.objects.filter(status=ScheduleEvent.Status.MOVED)
        stale_moved = []
        for event in moved_events.select_related()[:200]:
            original = getattr(event, "original_start_at", None)
            if not original or not event.starts_at:
                continue
            logs = EventReminderLog.objects.filter(event=event)
            if logs.exists() and original != event.starts_at:
                stale_moved.append(
                    {
                        "event_id": event.pk,
                        "starts_at": event.starts_at,
                        "original_start_at": original,
                        "reminder_logs": logs.count(),
                    }
                )
        failed = Notification.objects.filter(status=NotificationStatus.FAILED).count()
        return {
            "generated_at": timezone.now().isoformat(),
            "duplicate_event_channel_keys": key_dups,
            "repeated_telegram": tg_repeats,
            "lesson_updated_empty_key_telegram": empty_key_tg,
            "reminder_logs_for_cancelled_events": reminders_cancelled,
            "stale_moved_reminder_logs": stale_moved[:40],
            "failed_deliveries": failed,
        }

    def _print_summary(self, report: dict) -> None:
        self.stdout.write(f"key_dups={len(report['duplicate_event_channel_keys'])}")
        self.stdout.write(f"repeated_telegram={len(report['repeated_telegram'])}")
        self.stdout.write(f"empty_key_lesson_updated_tg={len(report['lesson_updated_empty_key_telegram'])}")
        self.stdout.write(f"cancelled_reminder_logs={report['reminder_logs_for_cancelled_events']}")
        self.stdout.write(f"stale_moved_logs={len(report['stale_moved_reminder_logs'])}")
        self.stdout.write(f"failed={report['failed_deliveries']}")
