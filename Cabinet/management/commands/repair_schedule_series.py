"""Восстанавливает связь серий занятий, потерянную после удаления ScheduleEventSeries."""

from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from Cabinet.choices import RecurrenceType, SeriesStatus
from Cabinet.models import ScheduleEvent, ScheduleEventSeries


def orphan_group_key(event):
    parts = [str(event.owner_id), (event.title or "").strip().lower()]
    if event.student_id:
        parts.append(f"student-{event.student_id}")
    elif event.group_id:
        parts.append(f"group-{event.group_id}")
    else:
        return None
    return tuple(parts)


class Command(BaseCommand):
    help = "Связывает «осиротевшие» повторяющиеся занятия (series_id=NULL) с новой серией."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Только показать, без записи в БД")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        orphans = ScheduleEvent.objects.filter(
            series_id__isnull=True,
            is_recurring_instance=True,
        ).exclude(
            status__in=[ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.COMPLETED],
        ).order_by("owner_id", "title", "starts_at")

        groups = defaultdict(list)
        for event in orphans:
            key = orphan_group_key(event)
            if key:
                groups[key].append(event)

        repaired = 0
        for key, events in groups.items():
            if len(events) < 2:
                continue
            first = events[0]
            local_start = timezone.localtime(first.starts_at)
            local_end = timezone.localtime(first.ends_at)
            self.stdout.write(
                f"{'[dry-run] ' if dry_run else ''}Серия «{first.title}»: {len(events)} занятий, "
                f"учитель={first.owner_id}, с {local_start.date()} {local_start.time()}"
            )
            if dry_run:
                repaired += 1
                continue

            with transaction.atomic():
                series = ScheduleEventSeries.objects.create(
                    teacher=first.owner,
                    created_by=first.owner,
                    title=first.title,
                    description=first.description,
                    event_type=first.event_type,
                    lesson=first.lesson,
                    lesson_plan_item=first.lesson_plan_item,
                    homework=first.homework,
                    group=first.group,
                    timezone=first.timezone or "Europe/Moscow",
                    start_date=local_start.date(),
                    start_time=local_start.time(),
                    end_time=local_end.time(),
                    recurrence_type=RecurrenceType.WEEKLY,
                    recurrence_interval=1,
                    recurrence_weekdays=[local_start.weekday()],
                    recurrence_count=len(events),
                    meeting_url=first.telemost_url or "",
                    meeting_provider=first.meeting_provider,
                    format=first.format,
                    topic=first.topic,
                    teacher_comment=first.teacher_comment,
                    reminder_minutes=first.reminder_minutes,
                    status=SeriesStatus.ACTIVE,
                    notify_on_create=False,
                )
                ScheduleEvent.objects.filter(
                    pk__in=[event.pk for event in events],
                ).update(series=series, is_recurring_instance=True)
            repaired += 1

        self.stdout.write(self.style.SUCCESS(f"Готово: групп серий — {repaired}"))
