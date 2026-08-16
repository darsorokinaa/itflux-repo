"""
Персистить однозначные FK занятие↔пункт плана. Не связывает по тексту темы.
По умолчанию dry-run.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from Cabinet.choices import PlanItemStatus
from Cabinet.models import ScheduleEvent
from Cabinet.plan_schedule import get_active_enrollment, plan_item_by_slot
from Cabinet.plan_sync import PlanSyncService


class Command(BaseCommand):
    help = (
        "Для завершённых уроков без FK, если слот однозначен — записать связь и "
        "пометить пункт выполненным. python manage.py repair_lesson_plan_sync [--apply]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        apply = bool(options.get("apply"))
        qs = ScheduleEvent.objects.filter(
            status__in=[ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED],
            lesson_plan_item__isnull=True,
        ).select_related("student", "group", "owner", "series")
        linked = 0
        skipped = 0
        for event in qs.iterator():
            enrollment = get_active_enrollment(event)
            if enrollment is None:
                skipped += 1
                continue
            item, _ = plan_item_by_slot(event, enrollment)
            if item is None:
                skipped += 1
                continue
            other = item.scheduled_event_id
            if other and other != event.pk:
                skipped += 1
                continue
            if item.status == PlanItemStatus.SKIPPED:
                skipped += 1
                continue
            linked += 1
            if apply:
                PlanSyncService.link_event_to_plan(event, item, copy_topic=False)
                PlanSyncService._complete_item_and_advance(item, event)
        self.stdout.write(f"Однозначных кандидатов: {linked}, пропущено неоднозначных: {skipped}")
        if not apply:
            self.stdout.write(self.style.WARNING("dry-run: ничего не изменено. Для записи: --apply"))
        else:
            self.stdout.write(self.style.SUCCESS(f"Обновлено: {linked}"))
