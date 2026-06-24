from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.models import EventReminderLog, ScheduleEvent
from Cabinet.notifications import NotificationService


class Command(BaseCommand):
    help = "Send lesson reminders for upcoming schedule events"

    def handle(self, *args, **options):
        now = timezone.now()
        sent = 0
        events = ScheduleEvent.objects.filter(
            status=ScheduleEvent.Status.PLANNED,
            starts_at__gt=now,
            reminder_minutes__isnull=False,
        ).prefetch_related("participants", "participants__user", "participants__student__user")

        for event in events:
            minutes = event.reminder_minutes
            if not minutes:
                continue
            window_start = event.starts_at - timedelta(minutes=minutes + 2)
            window_end = event.starts_at - timedelta(minutes=max(0, minutes - 2))
            if not (window_start <= now <= window_end):
                continue

            for participant in event.participants.filter(notification_enabled=True):
                user = participant.user or (
                    participant.student.user if participant.student else None
                ) or participant.teacher
                if not user:
                    continue
                if EventReminderLog.objects.filter(
                    event=event,
                    recipient=user,
                    reminder_minutes=minutes,
                ).exists():
                    continue
                NotificationService.notify_before_lesson(event, minutes)
                EventReminderLog.objects.create(
                    event=event,
                    recipient=user,
                    reminder_minutes=minutes,
                )
                sent += 1

        self.stdout.write(self.style.SUCCESS(f"Reminders processed, notifications sent: {sent}"))
