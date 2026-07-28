from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.models import EventReminderLog, ScheduleEvent
from Cabinet.notifications import NotificationService, get_or_create_preferences


class Command(BaseCommand):
    help = "Send lesson reminders for upcoming schedule events (24h / 1h / 10m by user prefs)"

    def handle(self, *args, **options):
        now = timezone.now()
        sent = 0
        # Смотрим события в ближайшие 25 часов — покрывает 24ч-напоминание
        events = ScheduleEvent.objects.filter(
            status=ScheduleEvent.Status.PLANNED,
            starts_at__gt=now,
            starts_at__lte=now + timedelta(hours=25),
        ).prefetch_related(
            "participants",
            "participants__user",
            "participants__student__user",
            "participants__student",
        )

        for event in events:
            for participant in event.participants.filter(notification_enabled=True):
                user = participant.user or (
                    participant.student.user if participant.student else None
                ) or participant.teacher
                if not user:
                    continue
                prefs = get_or_create_preferences(user)
                minutes_list = prefs.effective_lesson_reminder_minutes()
                # Legacy single-field fallback if JSON empty already handled in effective_*
                if prefs.notify_before_lesson_minutes and prefs.notify_before_lesson_minutes not in minutes_list:
                    # Не дублируем, если пользователь явно задал только старое поле
                    pass

                for minutes in minutes_list:
                    window_start = event.starts_at - timedelta(minutes=minutes + 2)
                    window_end = event.starts_at - timedelta(minutes=max(0, minutes - 2))
                    if not (window_start <= now <= window_end):
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
