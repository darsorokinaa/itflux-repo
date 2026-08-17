"""
PlanSyncService — единый lifecycle занятия:

план → запланированное занятие → карточка в расписании → проведено → журнал.

Вызывается при завершении ScheduleEvent (сигнал / API) и при создании/отмене.
Связь только через FK (ScheduleEvent.lesson_plan_item / LessonPlanItem.scheduled_event),
не по совпадению текста темы.
"""

from __future__ import annotations

import logging
from typing import Optional

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .choices import EnrollmentStatus, LessonContentSource, PlanItemStatus

logger = logging.getLogger("cabinet.plan_sync")


class PlanSyncService:

    COMPLETED_STATUSES = {"done", "completed"}
    TERMINAL_ITEM = (PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED)

    # ── Публичный интерфейс ────────────────────────────────────────────────

    @classmethod
    def on_event_completed(cls, event) -> list:
        """
        Вызывается после того как ScheduleEvent отмечен done/completed.
        Идемпотентно: повторный вызов не создаёт второй completed item / журнал.
        """
        if event.status not in cls.COMPLETED_STATUSES:
            return []
        return cls._complete_linked_plan(event, ensure_journal=True)

    @classmethod
    @transaction.atomic
    def mark_event_completed(cls, event, *, teacher=None, ensure_journal=True) -> list:
        from .models import ScheduleEvent

        locked = (
            ScheduleEvent.objects.select_for_update(of=("self",))
            .filter(pk=event.pk)
            .first()
        )
        if locked is None:
            return []
        if locked.status not in cls.COMPLETED_STATUSES:
            locked.status = ScheduleEvent.Status.COMPLETED
            locked.save(update_fields=["status", "updated_at"])
            logger.info("lesson completed event=%s", locked.pk)
        return cls._complete_linked_plan(locked, ensure_journal=ensure_journal)

    @classmethod
    def sync_enrollment(cls, enrollment) -> Optional[object]:
        """Вручную продвигает текущий пункт плана как выполненный."""
        current = cls.get_current_item(enrollment)
        if not current:
            return None
        return cls._advance(enrollment, current)

    @classmethod
    def get_current_item(cls, enrollment):
        """Текущий активный пункт плана (первый не выполненный и не пропущенный)."""
        return enrollment.plan.items.exclude(
            status__in=cls.TERMINAL_ITEM
        ).order_by("order", "id").first()

    @classmethod
    def get_next_item(cls, enrollment, after_order: int):
        """Следующий пункт после указанного порядкового номера."""
        return enrollment.plan.items.filter(
            order__gt=after_order
        ).exclude(
            status__in=cls.TERMINAL_ITEM
        ).order_by("order", "id").first()

    @classmethod
    def get_next_plan_item(cls, enrollment, *, exclude_event=None):
        """
        Следующая тема для нового занятия: первый пункт, который ещё не
        завершён/пропущен и не занят другим активным событием.
        """
        from .models import ScheduleEvent

        busy_ids = set(
            enrollment.plan.items.filter(
                scheduled_event__isnull=False,
            ).exclude(
                scheduled_event__status__in=[
                    ScheduleEvent.Status.CANCELLED,
                    ScheduleEvent.Status.COMPLETED,
                    ScheduleEvent.Status.DONE,
                ]
            ).values_list("id", flat=True)
        )
        linked_busy = ScheduleEvent.objects.filter(
            lesson_plan_item__plan_id=enrollment.plan_id,
        ).exclude(
            status__in=[
                ScheduleEvent.Status.CANCELLED,
                ScheduleEvent.Status.COMPLETED,
                ScheduleEvent.Status.DONE,
            ]
        )
        if exclude_event is not None:
            linked_busy = linked_busy.exclude(pk=exclude_event.pk)
        busy_ids.update(linked_busy.values_list("lesson_plan_item_id", flat=True))
        busy_ids.discard(None)
        if exclude_event is not None:
            busy_ids.discard(
                getattr(exclude_event, "lesson_plan_item_id", None)
            )
        qs = enrollment.plan.items.exclude(status__in=cls.TERMINAL_ITEM).order_by("order", "id")
        start_order = getattr(enrollment, "plan_start_order", None) or 1
        if start_order > 1:
            qs = qs.filter(order__gte=start_order)
        for item in qs:
            if item.id in busy_ids:
                continue
            other = item.scheduled_event_id
            if other and (exclude_event is None or other != exclude_event.pk):
                continue
            return item
        return None

    @classmethod
    def get_enrollment_progress(cls, enrollment) -> dict:
        items = enrollment.plan.items.all()
        total = items.count()
        completed = items.filter(status=PlanItemStatus.COMPLETED).count()
        current = cls.get_current_item(enrollment)
        return {
            "total": total,
            "completed": completed,
            "remaining": total - completed,
            "percent": round(completed * 100 / total) if total else 0,
            "current_item": {
                "id": current.pk,
                "title": current.title,
                "order": current.order,
                "topic": current.topic,
            } if current else None,
            "is_finished": completed >= total and total > 0,
        }

    @classmethod
    @transaction.atomic
    def link_event_to_plan(cls, event, item, *, copy_topic=True):
        """Явная связь событие ↔ пункт плана по ID."""
        from .models import LessonPlanItem, ScheduleEvent

        if item is None:
            return event
        item = LessonPlanItem.objects.select_for_update().filter(pk=item.pk).first()
        if item is None:
            return event
        terminal = {
            ScheduleEvent.Status.CANCELLED,
            ScheduleEvent.Status.COMPLETED,
            ScheduleEvent.Status.DONE,
        }
        taken_by_other = (
            ScheduleEvent.objects.select_for_update()
            .filter(lesson_plan_item_id=item.pk)
            .exclude(pk=event.pk)
            .exclude(status__in=terminal)
            .exists()
        )
        other_scheduled = item.scheduled_event
        if (
            other_scheduled is not None
            and other_scheduled.pk != event.pk
            and other_scheduled.status not in terminal
        ):
            taken_by_other = True
        if taken_by_other:
            logger.info(
                "skip double plan link event=%s item=%s already assigned",
                event.pk,
                item.pk,
            )
            return event
        event.lesson_plan_item = item
        update_event_fields = ["lesson_plan_item", "updated_at"]
        if item.scheduled_event_id not in (None, event.pk):
            other = item.scheduled_event
            if other is not None and other.status == ScheduleEvent.Status.CANCELLED:
                item.scheduled_event = event
                item.save(update_fields=["scheduled_event", "updated_at"])
        elif item.scheduled_event_id != event.pk:
            item.scheduled_event = event
            item_fields = ["scheduled_event", "updated_at"]
            if item.status == PlanItemStatus.NOT_STARTED:
                item.status = PlanItemStatus.PLANNED
                item_fields.append("status")
            item.save(update_fields=item_fields)
        elif item.status == PlanItemStatus.NOT_STARTED:
            item.status = PlanItemStatus.PLANNED
            item.save(update_fields=["status", "updated_at"])

        if copy_topic and not (event.topic or "").strip():
            topic = (item.topic or item.title or "").strip()
            if topic:
                event.topic = topic[:500]
                update_event_fields.append("topic")
                event.content_source = LessonContentSource.PLAN
                update_event_fields.append("content_source")
        event.save(update_fields=list(dict.fromkeys(update_event_fields)))
        logger.info(
            "schedule event linked to plan event=%s item=%s",
            event.pk,
            item.pk,
        )
        return event

    @classmethod
    def suggest_next_for_event(cls, event):
        from .plan_schedule import get_active_enrollment

        enrollment = get_active_enrollment(event)
        if enrollment is None:
            return None, None
        item = None
        if event.lesson_plan_item_id:
            item = event.lesson_plan_item
        if item is None:
            item = cls.get_next_plan_item(enrollment, exclude_event=event)
        return enrollment, item

    @classmethod
    def link_next_plan_item(cls, event, *, force=False):
        """Привязать следующее свободное занятие плана, если явной связи ещё нет."""
        if event.lesson_plan_item_id and not force:
            return event.lesson_plan_item
        for _ in range(8):
            enrollment, item = cls.suggest_next_for_event(event)
            if item is None:
                return None
            cls.link_event_to_plan(event, item)
            event.refresh_from_db()
            if event.lesson_plan_item_id == item.id:
                return item
            if event.lesson_plan_item_id:
                return event.lesson_plan_item
        return None

    @classmethod
    def assign_plan_items_to_events(cls, events, *, first_item=None):
        """Последовательно привязать свободные пункты плана к новым событиям серии."""
        if not events:
            return
        from .plan_schedule import get_active_enrollment

        first = events[0]
        enrollment = get_active_enrollment(first)
        if enrollment is None:
            if first_item is not None:
                cls.link_event_to_plan(first, first_item)
            return
        remaining = []
        start_item = first_item
        for event in events:
            if event.lesson_plan_item_id:
                continue
            item = None
            if start_item is not None:
                item = start_item
                start_item = None
            if item is None:
                item = cls.get_next_plan_item(enrollment, exclude_event=event)
            if item is None:
                remaining.append(event)
                continue
            cls.link_event_to_plan(event, item)
            event.refresh_from_db()
            if not event.lesson_plan_item_id:
                fallback = cls.get_next_plan_item(enrollment, exclude_event=event)
                if fallback is not None and fallback.id != item.id:
                    cls.link_event_to_plan(event, fallback)
                    event.refresh_from_db()
        if remaining:
            logger.info(
                "unplanned series events after plan exhausted count=%s enrollment=%s",
                len(remaining),
                enrollment.pk,
            )

    @classmethod
    def on_event_cancelled(cls, event, *, plan_cancel_action=None):
        from .plan_schedule import PLAN_CANCEL_SHIFT, PLAN_CANCEL_SKIP, apply_plan_cancel_action

        action = apply_plan_cancel_action(event, plan_cancel_action)
        item = event.lesson_plan_item
        if item is None and event.plan_items.exists():
            item = event.plan_items.order_by("order", "id").first()
        if item is None:
            logger.info("lesson cancelled event=%s action=%s", event.pk, action)
            return action
        if action == PLAN_CANCEL_SKIP:
            logger.info("lesson cancelled event=%s item=%s skipped", event.pk, item.pk)
            return action
        # shift: вернуть пункт в очередь, не завершать и не дублировать
        update_fields = ["updated_at"]
        if item.scheduled_event_id == event.pk:
            item.scheduled_event = None
            update_fields.append("scheduled_event")
        if item.status == PlanItemStatus.COMPLETED:
            pass
        elif item.status != PlanItemStatus.SKIPPED:
            item.status = PlanItemStatus.PLANNED
            update_fields.append("status")
        item.save(update_fields=update_fields)
        if event.lesson_plan_item_id == item.id:
            event.lesson_plan_item = None
            event.save(update_fields=["lesson_plan_item", "updated_at"])
        logger.info("lesson cancelled event=%s item=%s returned to planned", event.pk, item.pk)
        return action

    @classmethod
    def on_event_rescheduled(cls, event):
        logger.info("lesson rescheduled event=%s item=%s", event.pk, event.lesson_plan_item_id)
        return event.lesson_plan_item

    # ── Внутренняя логика ──────────────────────────────────────────────────

    @classmethod
    def _resolve_item_for_completion(cls, event):
        from .plan_schedule import resolve_plan_item_for_event

        if event.lesson_plan_item_id:
            return event.lesson_plan_item
        linked = list(event.plan_items.order_by("order", "id")[:2])
        if len(linked) == 1:
            return linked[0]
        if not event.plan_sync_enabled:
            return None
        item, _ = resolve_plan_item_for_event(event)
        return item

    @classmethod
    def _complete_linked_plan(cls, event, *, ensure_journal=True) -> list:
        item = cls._resolve_item_for_completion(event)
        advanced = []
        if item is not None:
            result = cls._complete_item_and_advance(item, event)
            if result:
                advanced.extend(result)
        else:
            logger.info("lesson completed without plan item event=%s", event.pk)

        if ensure_journal:
            cls._ensure_journal_for_event(event, item)
        return advanced

    @classmethod
    def _ensure_journal_for_event(cls, event, item=None):
        try:
            from .journal_service import get_or_create_journal, planned_topic_for_event
            from .journal_models import JournalStatus, LessonJournal

            teacher = event.owner
            journal = LessonJournal.objects.filter(schedule_event_id=event.pk).first()
            if journal is None:
                journal = get_or_create_journal(event, teacher)
                logger.info("journal entry created event=%s journal=%s", event.pk, journal.pk)
            planned = ""
            if item is not None:
                planned = (item.topic or item.title or "").strip()
            if not planned:
                planned = planned_topic_for_event(event)
            actual = (event.topic or "").strip() or planned
            update_fields = []
            if planned and not journal.planned_topic:
                journal.planned_topic = planned[:500]
                update_fields.append("planned_topic")
            if actual and not journal.actual_topic:
                journal.actual_topic = actual[:500]
                update_fields.append("actual_topic")
            if update_fields:
                journal.save(update_fields=update_fields + ["updated_at"])
        except Exception:
            logger.exception("Не удалось создать/обновить журнал для события #%s", event.pk)

    @classmethod
    @transaction.atomic
    def _complete_item_and_advance(cls, item, event=None) -> list:
        """Помечает пункт плана выполненным и продвигает план."""
        if item.status == PlanItemStatus.COMPLETED:
            if event and item.scheduled_event_id in (None, event.pk):
                if item.scheduled_event_id != event.pk:
                    item.scheduled_event = event
                    item.save(update_fields=["scheduled_event", "updated_at"])
                if event.lesson_plan_item_id != item.id:
                    event.lesson_plan_item = item
                    event.save(update_fields=["lesson_plan_item", "updated_at"])
            return []

        item.status = PlanItemStatus.COMPLETED
        item.completed_at = timezone.now()
        update_fields = ["status", "completed_at"]
        if event:
            if item.scheduled_event_id in (None, event.pk):
                item.scheduled_event = event
                update_fields.append("scheduled_event")
            if event.lesson_plan_item_id != item.id:
                event.lesson_plan_item = item
                event.save(update_fields=["lesson_plan_item", "updated_at"])
        item.save(update_fields=update_fields)
        logger.info("plan item completed item=%s event=%s", item.pk, event.pk if event else None)

        advanced = [item]
        from .models import LessonPlanEnrollment
        enrollments = LessonPlanEnrollment.objects.filter(
            plan=item.plan
        ).exclude(status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED])

        if event is not None:
            scoped = enrollments.filter(
                Q(student_id=event.student_id, student_id__isnull=False)
                | Q(group_id=event.group_id, group_id__isnull=False)
            )
            if scoped.exists():
                enrollments = scoped

        for enrollment in enrollments:
            next_item = cls._advance(enrollment, item)
            if next_item:
                advanced.append(next_item)

        return advanced

    @classmethod
    @transaction.atomic
    def _advance(cls, enrollment, completed_item) -> Optional[object]:
        next_item = cls.get_next_item(enrollment, completed_item.order)

        if next_item:
            if next_item.status == PlanItemStatus.NOT_STARTED:
                next_item.status = PlanItemStatus.PLANNED
                next_item.save(update_fields=["status"])
                logger.info("plan item planned item=%s enrollment=%s", next_item.pk, enrollment.pk)
            return next_item

        enrollment.status = EnrollmentStatus.COMPLETED
        enrollment.save(update_fields=["status", "updated_at"])
        logger.info("enrollment completed enrollment=%s", enrollment.pk)
        return None
