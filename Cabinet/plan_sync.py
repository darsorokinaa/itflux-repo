"""
PlanSyncService — единый lifecycle занятия:

план → запланированное занятие → карточка в расписании → проведено → журнал.

Вызывается при завершении ScheduleEvent (сигнал / API) и при создании/отмене.
Связь только через FK (ScheduleEvent.lesson_plan_item / LessonPlanItem.scheduled_event),
не по совпадению текста темы.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .choices import EnrollmentStatus, LessonContentSource, PlanItemStatus

logger = logging.getLogger("cabinet.plan_sync")
_realign_guard = threading.local()


def _lessons_word(n: int) -> str:
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return "занятие"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return "занятия"
    return "занятий"


def _unlinked_topics_phrase(n: int) -> str:
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return f"Для {n} занятия тема ещё не определена"
    return f"Для {n} занятий темы ещё не определены"


class PlanSyncService:

    COMPLETED_STATUSES = {"done", "completed"}
    TERMINAL_ITEM = (PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED)

    # ── Публичный интерфейс ────────────────────────────────────────────────

    @classmethod
    def on_event_completed(cls, event) -> list:
        """
        Вызывается после того как ScheduleEvent отмечен done/completed.
        Идемпотентно: повторный вызов не создаёт второй completed item / журнал.
        Неявка не съедает тему — оставшиеся пункты сдвигаются на будущие занятия.
        """
        if event.status not in cls.COMPLETED_STATUSES:
            return []
        from .plan_schedule import event_consumed_plan_topic

        if event_consumed_plan_topic(event, student_id=event.student_id):
            advanced = cls._complete_linked_plan(event, ensure_journal=True)
        else:
            cls._release_plan_item_shift(event)
            cls._ensure_journal_for_event(event, None)
            advanced = []
        cls.realign_for_event(event)
        return advanced

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
        from .plan_schedule import plan_slots_exhausted

        if plan_slots_exhausted(
            enrollment, enrollment.teacher, exclude_event=exclude_event,
        ):
            return None

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
        from .plan_schedule import plan_start_order_for_enrollment

        qs = enrollment.plan.items.exclude(status__in=cls.TERMINAL_ITEM).order_by("order", "id")
        start_order = plan_start_order_for_enrollment(enrollment)
        min_order = enrollment.plan.items.order_by("order", "id").values_list("order", flat=True).first()
        if min_order is None:
            min_order = 0
        if start_order > min_order:
            qs = qs.filter(order__gte=start_order)
        for item in qs:
            if item.id in busy_ids:
                continue
            other = item.scheduled_event_id
            if other and (exclude_event is None or other != exclude_event.pk):
                continue
            return item
        return None

    NEAR_END_INFO = 5
    NEAR_END_WARN = 2

    @classmethod
    def get_enrollment_progress(cls, enrollment, *, event=None, plan_item=None) -> dict:
        from .models import ScheduleEvent
        from .plan_schedule import events_for_enrollment, plan_items_for_enrollment

        items = plan_items_for_enrollment(enrollment)
        total = len(items)
        completed = sum(1 for item in items if item.status == PlanItemStatus.COMPLETED)
        skipped = sum(1 for item in items if item.status == PlanItemStatus.SKIPPED)
        remaining = max(0, total - completed - skipped)
        current = cls.get_current_item(enrollment)
        next_item = cls.get_next_plan_item(enrollment, exclude_event=event)
        now = timezone.now()
        ignored_statuses = {
            ScheduleEvent.Status.CANCELLED,
            ScheduleEvent.Status.COMPLETED,
            ScheduleEvent.Status.DONE,
        }
        future_events = [
            ev
            for ev in events_for_enrollment(enrollment, enrollment.teacher)
            if ev.starts_at >= now
            and ev.status not in ignored_statuses
        ]
        linked_item_ids = {
            ev.lesson_plan_item_id
            for ev in future_events
            if ev.lesson_plan_item_id
        }
        remaining_unassigned = sum(
            1
            for item in items
            if item.status not in cls.TERMINAL_ITEM
            and item.id not in linked_item_ids
        )
        unlinked_future = [ev for ev in future_events if not ev.lesson_plan_item_id]
        item_for_event = plan_item
        if item_for_event is None and event is not None:
            item_for_event = event.lesson_plan_item
        active_items = [item for item in items if item.status != PlanItemStatus.SKIPPED]
        is_last_topic = bool(
            item_for_event is not None
            and active_items
            and active_items[-1].id == item_for_event.id
        )
        warning_level, warning_message = cls._progress_warning(
            total=total,
            remaining=remaining,
            remaining_unassigned=remaining_unassigned,
            future_count=len(future_events),
            unlinked_future=len(unlinked_future),
            is_last_topic=is_last_topic,
            event_bound=item_for_event is not None,
            next_item_missing=next_item is None,
        )
        return {
            "total": total,
            "completed": completed,
            "skipped": skipped,
            "remaining": remaining,
            "remaining_unassigned": remaining_unassigned,
            "percent": round(completed * 100 / total) if total else 0,
            "current_item": {
                "id": current.pk,
                "title": current.title,
                "order": current.order,
                "topic": current.topic,
            } if current else None,
            "next_item": {
                "id": next_item.pk,
                "title": next_item.title,
                "order": next_item.order,
                "topic": next_item.topic,
            } if next_item else None,
            "is_finished": remaining == 0 and total > 0,
            "is_schedule_exhausted": remaining_unassigned == 0 and total > 0,
            "needs_manual_topic": bool(next_item is None and total > 0),
            "is_last_topic": is_last_topic,
            "future_events": len(future_events),
            "unlinked_future_events": len(unlinked_future),
            "warning_level": warning_level,
            "warning_message": warning_message,
        }

    @classmethod
    def _last_topic_message(cls, *, unlinked_future):
        extra = (
            f" {_unlinked_topics_phrase(unlinked_future)} — добавьте темы в план."
            if unlinked_future
            else (
                " Добавьте продолжение, чтобы следующие занятия не остались без темы."
            )
        )
        return "last", f"Это последняя тема текущего плана.{extra}"

    @classmethod
    def _progress_warning(
        cls,
        *,
        total,
        remaining,
        remaining_unassigned,
        future_count,
        unlinked_future,
        is_last_topic=False,
        event_bound=False,
        next_item_missing=False,
    ):
        if total == 0:
            return "empty", "План обучения пока не заполнен. Добавьте темы."
        if next_item_missing and remaining > 0 and remaining_unassigned > 0 and not event_bound:
            return (
                "need_topic",
                "Все темы плана уже использованы. Новая тема добавится в конец плана.",
            )
        if is_last_topic:
            return cls._last_topic_message(unlinked_future=unlinked_future)
        if remaining == 0:
            extra = unlinked_future or max(0, future_count)
            if extra:
                return (
                    "exhausted",
                    (
                        f"План завершён. Все {total} тем использованы. "
                        f"{_unlinked_topics_phrase(extra)} — добавьте темы в план."
                    ),
                )
            return "exhausted", f"План завершён. Все {total} тем пройдены."
        overflow = unlinked_future - remaining_unassigned
        if overflow > 0:
            if remaining_unassigned == 0:
                return (
                    "overbooked",
                    (
                        "Все темы плана уже назначены на занятия. "
                        f"{_unlinked_topics_phrase(unlinked_future)} — добавьте темы в план."
                    ),
                )
            return (
                "overbooked",
                (
                    f"В плане свободно {remaining_unassigned} {_lessons_word(remaining_unassigned)}, "
                    f"а в расписании без темы — {unlinked_future} {_lessons_word(unlinked_future)}. "
                    f"{_unlinked_topics_phrase(overflow)}."
                ),
            )
        if remaining == 1 and not event_bound:
            return cls._last_topic_message(unlinked_future=unlinked_future)
        if remaining <= cls.NEAR_END_WARN:
            return (
                "warn",
                f"План подходит к концу — осталось {remaining} {_lessons_word(remaining)}.",
            )
        if remaining <= cls.NEAR_END_INFO:
            return (
                "info",
                f"В плане осталось {remaining} {_lessons_word(remaining)}. "
                "Можно заранее добавить следующие темы.",
            )
        return "ok", ""

    @classmethod
    @transaction.atomic
    def link_event_to_plan(cls, event, item, *, copy_topic=True, overwrite_topic=False, force=False):
        """Явная связь событие ↔ пункт плана по ID. Один урок — одна тема."""
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
        if not force:
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
        if item.scheduled_event_id != event.pk:
            item.scheduled_event = event
            item_fields = ["scheduled_event", "updated_at"]
            if item.status == PlanItemStatus.NOT_STARTED:
                item.status = PlanItemStatus.PLANNED
                item_fields.append("status")
            item.save(update_fields=item_fields)
        elif item.status == PlanItemStatus.NOT_STARTED:
            item.status = PlanItemStatus.PLANNED
            item.save(update_fields=["status", "updated_at"])

        LessonPlanItem.objects.filter(
            scheduled_event_id=event.pk,
        ).exclude(pk=item.pk).update(scheduled_event=None)
        ScheduleEvent.objects.filter(
            lesson_plan_item_id=item.pk,
        ).exclude(pk=event.pk).exclude(
            status__in=terminal,
        ).update(lesson_plan_item=None)

        if copy_topic:
            overrides = set(event.manual_override_fields or [])
            topic = (item.topic or item.title or "").strip()
            if topic and "topic" not in overrides:
                if overwrite_topic or not (event.topic or "").strip():
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
            cls.link_event_to_plan(event, item, overwrite_topic=True)
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
                cls.link_event_to_plan(first, first_item, overwrite_topic=True)
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
            cls.link_event_to_plan(event, item, overwrite_topic=True)
            event.refresh_from_db()
            if not event.lesson_plan_item_id:
                fallback = cls.get_next_plan_item(enrollment, exclude_event=event)
                if fallback is not None and fallback.id != item.id:
                    cls.link_event_to_plan(event, fallback, overwrite_topic=True)
                    event.refresh_from_db()
        if remaining:
            logger.info(
                "unplanned series events after plan exhausted count=%s enrollment=%s",
                len(remaining),
                enrollment.pk,
            )
        cls.realign_enrollment_topics(enrollment)

    @classmethod
    def on_event_cancelled(cls, event, *, plan_cancel_action=None):
        from .plan_schedule import PLAN_CANCEL_SKIP, apply_plan_cancel_action

        action = apply_plan_cancel_action(event, plan_cancel_action)
        item = event.lesson_plan_item
        if item is None and event.plan_items.exists():
            item = event.plan_items.order_by("order", "id").first()
        if item is None:
            logger.info("lesson cancelled event=%s action=%s", event.pk, action)
            cls.realign_for_event(event)
            return action
        if action == PLAN_CANCEL_SKIP:
            logger.info("lesson cancelled event=%s item=%s skipped", event.pk, item.pk)
            cls.realign_for_event(event)
            return action
        cls._release_plan_item_shift(event, item=item)
        logger.info("lesson cancelled event=%s item=%s returned to planned", event.pk, item.pk)
        cls.realign_for_event(event)
        return action

    @classmethod
    def on_event_rescheduled(cls, event):
        logger.info("lesson rescheduled event=%s item=%s", event.pk, event.lesson_plan_item_id)
        cls.realign_for_event(event)
        event.refresh_from_db()
        return event.lesson_plan_item

    @classmethod
    def on_event_deleted(cls, event, *, plan_cancel_action=None):
        """Удаление будущего занятия освобождает непройденный пункт плана."""
        from .plan_schedule import PLAN_CANCEL_SHIFT

        return cls.on_event_cancelled(
            event,
            plan_cancel_action=plan_cancel_action or PLAN_CANCEL_SHIFT,
        )

    @classmethod
    def realign_for_event(cls, event):
        from .plan_schedule import get_active_enrollment

        enrollment = get_active_enrollment(event)
        if enrollment is None:
            return {"ok": True, "skipped": True, "updated_event_ids": []}
        return cls.realign_enrollment_topics(enrollment)

    @classmethod
    def realign_enrollments_for_events(cls, events) -> None:
        """Пересчитать темы для всех планов, которые видны в выборке расписания."""
        from .plan_schedule import get_active_enrollment

        seen = set()
        for event in events:
            enrollment = get_active_enrollment(event) if event else None
            if enrollment is None or enrollment.pk in seen:
                continue
            seen.add(enrollment.pk)
            try:
                cls.realign_enrollment_topics(enrollment)
            except Exception:
                logger.exception(
                    "plan realign failed enrollment=%s event=%s",
                    enrollment.pk,
                    event.pk,
                )

    @classmethod
    @transaction.atomic
    def realign_enrollment_topics(cls, enrollment) -> dict:
        """
        Раскладывает темы плана по занятиям:

        1. Сколько уроков фактически прошло (проведён / опоздал / ушёл раньше /
           тех. причина) — столько первых пунктов плана считаются пройденными.
        2. Оставшиеся пункты по порядку вешаются на будущие занятия.
        """
        if getattr(_realign_guard, "active", False):
            return {"ok": True, "skipped": True, "updated_event_ids": []}
        _realign_guard.active = True
        try:
            return cls._realign_enrollment_topics_inner(enrollment)
        finally:
            _realign_guard.active = False

    @classmethod
    def _realign_enrollment_topics_inner(cls, enrollment) -> dict:
        from .lesson_plan_content_sync import CONTENT_FIELDS, LessonLearningPlanSyncService
        from .plan_schedule import (
            attendance_statuses_by_event,
            event_consumed_plan_topic,
            event_is_upcoming_for_plan,
            events_for_enrollment,
            plan_items_for_enrollment,
            unique_plan_slot_events,
        )

        now = timezone.now()
        items = [
            item for item in plan_items_for_enrollment(enrollment)
            if item.status != PlanItemStatus.SKIPPED
        ]
        sequence_events = [
            ev for ev in events_for_enrollment(enrollment, enrollment.teacher)
            if getattr(ev, "plan_sync_enabled", True)
        ]
        attendance_map = attendance_statuses_by_event(
            [ev.pk for ev in sequence_events],
            student_id=enrollment.student_id,
        )

        from .models import ScheduleEvent
        from .journal_models import LessonJournal

        journals = {
            journal.schedule_event_id: journal
            for journal in LessonJournal.objects.filter(
                schedule_event_id__in=[ev.pk for ev in sequence_events],
            )
        }

        conducted = []
        upcoming = []
        for ev in sequence_events:
            if ev.status in (ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.DRAFT):
                continue
            consumed = event_consumed_plan_topic(
                ev,
                student_id=enrollment.student_id,
                attendance_statuses=attendance_map.get(ev.pk) or [],
                journal=journals.get(ev.pk),
            )
            # Будущее занятие не считаем проведённым, даже если статус сбился.
            future_open = event_is_upcoming_for_plan(ev, now=now) or (
                ev.starts_at >= now
                and ev.status not in cls.COMPLETED_STATUSES
            )
            if consumed and not future_open:
                conducted.append(ev)
            elif future_open:
                upcoming.append(ev)

        conducted = unique_plan_slot_events(conducted)
        upcoming = unique_plan_slot_events(upcoming)
        parked = unique_plan_slot_events([
            ev for ev in sequence_events
            if ev.status not in (ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.DRAFT)
            and ev.pk not in {row.pk for row in conducted}
            and ev.pk not in {row.pk for row in upcoming}
            and getattr(ev, "plan_sync_enabled", True)
        ])
        history_slots = unique_plan_slot_events([*conducted, *parked])
        restart_plan = len(history_slots) >= len(items)

        desired = {}
        used_item_ids = set()

        def take_next_item():
            for item in items:
                if item.id not in used_item_ids:
                    used_item_ids.add(item.id)
                    return item
            return None

        def take_item_for_event(ev):
            from .plan_schedule import event_local_date
            event_date = event_local_date(ev)
            if event_date:
                for item in items:
                    if item.id in used_item_ids:
                        continue
                    if item.scheduled_date == event_date:
                        used_item_ids.add(item.id)
                        return item
            return take_next_item()

        # Журнал по дате → пункты плана по порядку. Старые FK не сохраняем:
        # иначе «дыра» (тема 04 пройдена, а 03 ещё в будущем).
        for ev in conducted:
            nxt = take_next_item()
            if nxt is not None:
                desired[ev.pk] = nxt
        def keep_existing_item(ev):
            """Тема, которую учитель только что добавил в календарь (последний пункт на эту дату), не сдвигаем."""
            current_item = next(
                (item for item in items if item.id == ev.lesson_plan_item_id),
                None,
            )
            if current_item is None or current_item.id in used_item_ids:
                return None
            max_order = max((item.order or 0) for item in items)
            if (current_item.order or 0) < max_order:
                return None
            from .plan_schedule import event_local_date
            event_date = event_local_date(ev)
            if current_item.scheduled_date and event_date and current_item.scheduled_date == event_date:
                return current_item
            return None

        for ev in upcoming:
            kept = keep_existing_item(ev)
            if kept is not None:
                used_item_ids.add(kept.id)
                desired[ev.pk] = kept
                continue
            if restart_plan:
                continue
            nxt = take_item_for_event(ev)
            if nxt is not None:
                desired[ev.pk] = nxt

        updated_ids = []
        conducted_ids = {ev.pk for ev in conducted}

        for ev in sequence_events:
            want = desired.get(ev.pk)
            if ev.lesson_plan_item_id and (want is None or ev.lesson_plan_item_id != want.id):
                cls._clear_event_plan_link(ev)
                ev.lesson_plan_item = None
                ev.lesson_plan_item_id = None
                if ev.pk not in updated_ids:
                    updated_ids.append(ev.pk)

        assigned_item_ids = {item.id for item in desired.values()}
        for item in items:
            want_event_id = next(
                (event_id for event_id, bound in desired.items() if bound.id == item.id),
                None,
            )
            if item.scheduled_event_id and item.scheduled_event_id != want_event_id:
                item.scheduled_event = None
                item.save(update_fields=["scheduled_event", "updated_at"])

        for ev in [*conducted, *upcoming]:
            item = desired.get(ev.pk)
            if item is None:
                continue
            ev.refresh_from_db()
            item.refresh_from_db()
            consumed = ev.pk in conducted_ids
            changed = ev.lesson_plan_item_id != item.id
            cls.link_event_to_plan(
                ev,
                item,
                copy_topic=not consumed,
                overwrite_topic=not consumed,
                force=True,
            )
            ev.refresh_from_db()
            item.refresh_from_db()
            if changed and ev.pk not in updated_ids:
                updated_ids.append(ev.pk)
            if consumed:
                cls._complete_item_and_advance(item, ev)
                cls._sync_journal_planned_from_item(ev, item)
                continue
            overrides = set(ev.manual_override_fields or [])
            fields = [field for field in CONTENT_FIELDS if field not in overrides]
            if fields and ev.plan_sync_enabled:
                LessonLearningPlanSyncService._copy_item_fields_to_event(
                    ev, item, force_fields=fields,
                )
                LessonLearningPlanSyncService._sync_plan_materials_onto_event(ev, item)
                ev.content_source = LessonContentSource.PLAN
                ev.plan_synced_at = timezone.now()
                ev.save()
                LessonLearningPlanSyncService._sync_journal_topic(ev)
                if ev.pk not in updated_ids:
                    updated_ids.append(ev.pk)

        for item in items:
            item.refresh_from_db()
            if item.id in assigned_item_ids:
                continue
            update_fields = ["updated_at"]
            if item.scheduled_event_id:
                item.scheduled_event = None
                update_fields.append("scheduled_event")
            if item.status == PlanItemStatus.COMPLETED:
                item.status = PlanItemStatus.PLANNED
                item.completed_at = None
                update_fields.extend(["status", "completed_at"])
            if len(update_fields) > 1:
                item.save(update_fields=update_fields)

        for item in items:
            item.refresh_from_db()
            want_event_id = next(
                (event_id for event_id, bound in desired.items() if bound.id == item.id),
                None,
            )
            if want_event_id in conducted_ids:
                continue
            if item.status == PlanItemStatus.COMPLETED:
                item.status = PlanItemStatus.PLANNED
                item.completed_at = None
                item.save(update_fields=["status", "completed_at", "updated_at"])

        remaining_open = [
            item for item in items
            if item.status not in (PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED)
        ]
        if enrollment.status == EnrollmentStatus.COMPLETED and remaining_open:
            enrollment.status = EnrollmentStatus.ACTIVE
            enrollment.save(update_fields=["status", "updated_at"])

        logger.info(
            "plan realigned enrollment=%s conducted=%s upcoming=%s updated=%s",
            enrollment.pk,
            len(conducted),
            len(upcoming),
            len(updated_ids),
        )
        return {
            "ok": True,
            "updated_event_ids": updated_ids,
            "conducted": len(conducted),
            "future_events": len(upcoming),
            "plan_items": len(items),
        }

    @classmethod
    def _clear_event_plan_link(cls, event):
        item = event.lesson_plan_item
        if event.lesson_plan_item_id:
            event.lesson_plan_item = None
            event.save(update_fields=["lesson_plan_item", "updated_at"])
        if item is not None and item.scheduled_event_id == event.pk:
            item.scheduled_event = None
            item.save(update_fields=["scheduled_event", "updated_at"])

    @classmethod
    def _sync_journal_planned_from_item(cls, event, item):
        """В журнале планируемая тема = пункт плана. Фактическую не трогаем."""
        from .journal_models import LessonJournal

        if event is None or item is None:
            return
        planned = (item.topic or item.title or "").strip()[:500]
        if not planned:
            return
        journal = LessonJournal.objects.filter(schedule_event_id=event.pk).first()
        if journal is None or journal.planned_topic == planned:
            return
        journal.planned_topic = planned
        journal.save(update_fields=["planned_topic", "updated_at"])

    @classmethod
    def _release_plan_item_shift(cls, event, item=None):
        item = item or event.lesson_plan_item
        if item is None and event.plan_items.exists():
            item = event.plan_items.order_by("order", "id").first()
        if item is None:
            return
        update_fields = ["updated_at"]
        if item.scheduled_event_id == event.pk:
            item.scheduled_event = None
            update_fields.append("scheduled_event")
        if item.status == PlanItemStatus.COMPLETED:
            item.status = PlanItemStatus.PLANNED
            item.completed_at = None
            update_fields.extend(["status", "completed_at"])
        elif item.status != PlanItemStatus.SKIPPED:
            item.status = PlanItemStatus.PLANNED
            update_fields.append("status")
        item.save(update_fields=update_fields)
        if event.lesson_plan_item_id == item.id:
            event.lesson_plan_item = None
            event.save(update_fields=["lesson_plan_item", "updated_at"])

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
            if event and item.scheduled_event_id != event.pk:
                item.scheduled_event = event
                item.save(update_fields=["scheduled_event", "updated_at"])
            if event and event.lesson_plan_item_id != item.id:
                event.lesson_plan_item = item
                event.save(update_fields=["lesson_plan_item", "updated_at"])
            return []

        item.status = PlanItemStatus.COMPLETED
        item.completed_at = timezone.now()
        update_fields = ["status", "completed_at"]
        if event:
            if item.scheduled_event_id != event.pk:
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
