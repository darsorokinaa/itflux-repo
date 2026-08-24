"""
Персистить однозначные FK занятие↔пункт плана. Не связывает по тексту темы.
По умолчанию dry-run.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from Cabinet.choices import PlanItemStatus
from Cabinet.models import ScheduleEvent
from Cabinet.plan_dedupe import cancel_duplicate_active_enrollments
from Cabinet.plan_schedule import get_active_enrollment, plan_item_by_slot
from Cabinet.plan_sync import PlanSyncService


class Command(BaseCommand):
    help = (
        "Дедуп активных планов и персист однозначных слот-связей. "
        "python manage.py repair_lesson_plan_sync [--apply]"
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        apply = bool(options.get("apply"))
        dupes = cancel_duplicate_active_enrollments(apply=apply)
        self.stdout.write(
            f"Дубли активных назначений: {dupes['cancelled_count']}"
        )

        qs = ScheduleEvent.objects.filter(
            lesson_plan_item__isnull=True,
        ).exclude(
            status=ScheduleEvent.Status.CANCELLED,
        ).select_related("student", "group", "owner", "series")
        linked = 0
        skipped = 0
        ambiguous = 0
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
                ambiguous += 1
                continue
            taken = (
                ScheduleEvent.objects.filter(lesson_plan_item_id=item.pk)
                .exclude(pk=event.pk)
                .exclude(status=ScheduleEvent.Status.CANCELLED)
                .exists()
            )
            if taken:
                ambiguous += 1
                continue
            if item.status == PlanItemStatus.SKIPPED:
                skipped += 1
                continue
            linked += 1
            if apply:
                PlanSyncService.link_event_to_plan(event, item, copy_topic=False)
                if event.status in (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED):
                    PlanSyncService._complete_item_and_advance(item, event)

        self.stdout.write(
            f"Однозначных кандидатов на FK: {linked}, "
            f"пропущено: {skipped}, неоднозначных: {ambiguous}"
        )
        if not apply:
            self.stdout.write(self.style.WARNING("dry-run: ничего не изменено. Для записи: --apply"))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"Обновлено связей: {linked}, отменено дублей: {dupes['cancelled_count']}"
            ))
