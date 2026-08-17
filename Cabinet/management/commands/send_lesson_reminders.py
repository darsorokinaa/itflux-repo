from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.models import EventReminderLog, ScheduleEvent
from Cabinet.notifications import NotificationService, get_or_create_preferences


ACTIVE_REMINDER_STATUSES = (
    ScheduleEvent.Status.PLANNED,
    ScheduleEvent.Status.MOVED,
)


class Command(BaseCommand):
    help = "Send lesson reminders for upcoming schedule events (24h / 1h / 10m by user prefs)"

    def handle(self, *args, **options):
        now = timezone.now()
        sent = 0
        # Смотрим события в ближайшие 25 часов — покрывает 24ч-напоминание.
        # PLANNED и MOVED: после переноса урок остаётся актуальным.
        events = ScheduleEvent.objects.filter(
            status__in=ACTIVE_REMINDER_STATUSES,
            starts_at__gt=now,
            starts_at__lte=now + timedelta(hours=25),
        ).prefetch_related(
            "participants",
            "participants__user",
            "participants__student__user",
            "participants__student",
        )

        for event in events:
            # Финальная проверка актуального состояния (отмена / перенос после выборки).
            event.refresh_from_db(fields=["status", "starts_at", "timezone"])
            if event.status not in ACTIVE_REMINDER_STATUSES:
                continue
            if event.starts_at <= now:
                continue

            for participant in event.participants.filter(notification_enabled=True):
                user = participant.user or (
                    participant.student.user if participant.student else None
                ) or participant.teacher
                if not user:
                    continue
                prefs = get_or_create_preferences(user)
                minutes_list = prefs.effective_lesson_reminder_minutes()
                if not minutes_list:
                    continue

                for minutes in minutes_list:
                    window_start = event.starts_at - timedelta(minutes=minutes + 2)
                    window_end = event.starts_at - timedelta(minutes=max(0, minutes - 2))
                    if not (window_start <= now <= window_end):
                        continue
                    if event.starts_at <= now:
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
