"""Утреннее «Расписание на сегодня» для учителей."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from Cabinet.models import Notification, Profile, ScheduleEvent
from Cabinet.notification_time import user_local_now, user_zoneinfo
from Cabinet.notifications import get_or_create_preferences
from Cabinet.webpush import notify_user_channels


class Command(BaseCommand):
    help = "Send teacher daily schedule push/in-app summary"

    def handle(self, *args, **options):
        sent = 0

        teachers = User.objects.filter(
            profile__role=Profile.Role.TEACHER,
            is_active=True,
        ).select_related("profile")

        for teacher in teachers:
            prefs = get_or_create_preferences(teacher)
            if not prefs.notify_daily_schedule:
                continue
            if prefs.daily_schedule_hour is None:
                continue

            local_now = user_local_now(teacher)
            if int(prefs.daily_schedule_hour) != local_now.hour:
                continue

            tz = user_zoneinfo(teacher)
            today_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            today_end = today_start + timedelta(days=1)
            # Convert local day bounds to aware UTC-comparable datetimes
            day_start_utc = today_start
            day_end_utc = today_end

            # Уже отправляли сегодня (по локальной дате пользователя)
            already = Notification.objects.filter(
                recipient_user=teacher,
                payload__type="daily_schedule",
                created_at__gte=day_start_utc,
            ).exists()
            if already:
                continue

            events = list(
                ScheduleEvent.objects.filter(
                    owner=teacher,
                    status__in=[ScheduleEvent.Status.PLANNED, ScheduleEvent.Status.MOVED],
                    starts_at__gte=day_start_utc,
                    starts_at__lt=day_end_utc,
                ).order_by("starts_at")[:20]
            )

            if not events:
                if not prefs.notify_daily_schedule_empty:
                    continue
                title = "Расписание на сегодня"
                message = "Сегодня уроков нет."
            else:
                first = events[0]
                first_time = first.starts_at.astimezone(tz).strftime("%H:%M")
                audience = first.title or "занятие"
                for p in first.participants.select_related("student").all()[:1]:
                    if p.student_id and p.student:
                        audience = p.student.full_name
                        break
                title = "Расписание на сегодня"
                message = (
                    f"Сегодня {len(events)} "
                    f"{_plural(len(events), 'урок', 'урока', 'уроков')}. "
                    f"Первый урок в {first_time} с {audience}."
                )

            notify_user_channels(
                teacher,
                title=title,
                message=message,
                payload={
                    "type": "daily_schedule",
                    "event_type": "daily_schedule",
                    "url": "/cabinet/schedule",
                    "lessons_count": len(events),
                },
                push_priority="important",
                tag=f"daily-schedule-{today_start.date().isoformat()}",
                dedup_key=f"daily_schedule:{teacher.pk}:{today_start.date().isoformat()}",
            )
            sent += 1

        journal_sent = 0
        try:
            from Cabinet.journal_notifications import notify_teacher_journal_digest

            for teacher in teachers:
                prefs = get_or_create_preferences(teacher)
                if not prefs.notify_journal_daily_digest:
                    continue
                if prefs.daily_schedule_hour is None:
                    continue
                local_now = user_local_now(teacher)
                if int(prefs.daily_schedule_hour) != local_now.hour:
                    continue
                if notify_teacher_journal_digest(teacher):
                    journal_sent += 1
        except Exception as exc:
            self.stderr.write(f"Journal digest error: {exc}")

        self.stdout.write(
            self.style.SUCCESS(
                f"Daily schedule notifications sent: {sent}; journal digests: {journal_sent}"
            )
        )


def _plural(n, one, few, many):
    abs_n = abs(n) % 100
    last = abs_n % 10
    if 10 < abs_n < 20:
        return many
    if last == 1:
        return one
    if 2 <= last <= 4:
        return few
    return many
