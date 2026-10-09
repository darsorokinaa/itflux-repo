"""Единые операции занятия для плана, календаря и журнала.

Источник фактических даты и времени — ScheduleEvent.
Пункт плана хранит порядок и методические данные.
Журнал хранит историю проведения и не переписывается, когда перестраивают будущую серию.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta

from django.db import transaction
from django.utils import timezone

from .choices import PlanItemStatus, ScheduleChangeType
from .models import LessonPlanEnrollment, LessonPlanItem, ScheduleEvent, ScheduleEventChangeLog
from .plan_dates import normalize_weekday_slots, parse_clock
from .plan_schedule import event_local_date, event_zone
from .schedule_service import event_snapshot, log_change

_sync_guard = threading.local()


class LessonLifecycleError(Exception):
    def __init__(self, message, *, code="invalid", status=400, extra=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.extra = extra or {}


def _conducted(status):
    return status in (ScheduleEvent.Status.DONE, ScheduleEvent.Status.COMPLETED)


def sync_event_datetime_to_linked_records(event, *, changed_by=None):
    """Подтягивает дату плана и открытого журнала к фактическому времени события.

    Проведённый журнал обновляется только если перенесли именно это занятие.
    Оценки, посещаемость, ДЗ и тема не сбрасываются.
    """
    if getattr(_sync_guard, "active", False):
        return event
    _sync_guard.active = True
    try:
        return _sync_event_datetime_to_linked_records(event, changed_by=changed_by)
    finally:
        _sync_guard.active = False


def _sync_event_datetime_to_linked_records(event, *, changed_by=None):
    local_date = event_local_date(event)
    item = event.lesson_plan_item
    if item is None:
        item = event.plan_items.order_by("order", "id").first()
    if item is not None and local_date is not None:
        fields = []
        if item.scheduled_date != local_date:
            item.scheduled_date = local_date
            fields.append("scheduled_date")
        if item.scheduled_event_id != event.pk:
            item.scheduled_event = event
            fields.append("scheduled_event")
        if (
            item.status == PlanItemStatus.SKIPPED
            and event.status not in (ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.SKIPPED)
        ):
            item.status = PlanItemStatus.PLANNED
            fields.append("status")
        elif item.status == PlanItemStatus.NOT_STARTED:
            item.status = PlanItemStatus.PLANNED
            fields.append("status")
        if fields:
            item.save(update_fields=fields + ["updated_at"])

    from .journal_models import JournalStatus, LessonJournal
    from .journal_service import write_audit

    journal = LessonJournal.objects.filter(schedule_event_id=event.pk).first()
    if journal is None or local_date is None:
        return event
    same_date = journal.lesson_date == local_date
    same_start = journal.started_at == event.starts_at
    if same_date and same_start:
        return event
    old_date = journal.lesson_date.isoformat() if journal.lesson_date else ""
    journal.lesson_date = local_date
    journal.started_at = event.starts_at
    journal.finished_at = event.ends_at
    duration = event_duration_minutes(event)
    if duration:
        journal.planned_duration_minutes = duration
    journal.save(update_fields=[
        "lesson_date",
        "started_at",
        "finished_at",
        "planned_duration_minutes",
        "updated_at",
    ])
    if journal.status in (JournalStatus.COMPLETED, JournalStatus.REOPENED):
        write_audit(
            actor=changed_by,
            action="update",
            journal=journal,
            field_name="lesson_date",
            old_value=old_date,
            new_value=local_date.isoformat(),
            meta={"source": "schedule_move"},
        )
    return event


def event_duration_minutes(event):
    if not event.starts_at or not event.ends_at:
        return None
    minutes = int((event.ends_at - event.starts_at).total_seconds() // 60)
    return minutes if minutes > 0 else None


def sync_plan_item_date_to_event(item, *, changed_by):
    """Дата в плане двигает связанное будущее занятие, не трогая проведённую историю."""
    event = item.scheduled_event
    if event is None:
        event = item.schedule_events_linked.order_by("starts_at").first()
    if event is None or item.scheduled_date is None:
        return {"moved": False, "reason": ""}
    if _conducted(event.status):
        return {
            "moved": False,
            "code": "conducted_kept",
            "reason": (
                "Проведённый урок остаётся в журнале на своей дате. "
                "Чтобы исправить именно его, перенесите это занятие в календаре."
            ),
        }
    if event.status in (ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.SKIPPED):
        return {
            "moved": False,
            "code": "inactive",
            "reason": "Сначала восстановите занятие, затем меняйте дату.",
        }
    if event_local_date(event) == item.scheduled_date:
        return {"moved": False, "unchanged": True, "reason": ""}
    zone = event_zone(event)
    local_start = event.starts_at.astimezone(zone)
    new_start = datetime.combine(item.scheduled_date, local_start.timetz())
    if timezone.is_naive(new_start):
        new_start = timezone.make_aware(new_start, zone)
    duration = event.ends_at - event.starts_at
    if duration <= timedelta(0):
        duration = timedelta(minutes=60)
    from .schedule_service import move_event

    move_event(
        event,
        starts_at=new_start,
        ends_at=new_start + duration,
        changed_by=changed_by,
        notify=False,
    )
    return {"moved": True, "event_id": event.pk, "reason": ""}


def _lock_event(event):
    return (
        ScheduleEvent.objects.select_for_update(of=("self",))
        .filter(pk=event.pk)
        .first()
    )


def _item_from_cancel_log(event):
    log = (
        ScheduleEventChangeLog.objects.filter(
            event=event,
            change_type=ScheduleChangeType.CANCELLED,
        )
        .order_by("-created_at")
        .first()
    )
    if log is None:
        return None
    item_id = (log.old_data or {}).get("lesson_plan_item_id")
    if not item_id:
        return None
    return LessonPlanItem.objects.filter(pk=item_id).first()


@transaction.atomic
def restore_event(event, *, changed_by, reason="", starts_at=None, ends_at=None):
    """Возвращает отменённое или пропущенное занятие.

    Новые дата и время, если они переданы, меняются в той же транзакции, что и статус.
    При конфликте не сохраняется ничего: другие занятия не двигаются.
    """
    locked = _lock_event(event)
    if locked is None:
        raise LessonLifecycleError("Занятие не найдено", code="not_found", status=404)
    reason = (reason or "").strip()[:500]
    if locked.status not in (ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.SKIPPED):
        if reason and locked.status_reason != reason:
            locked.status_reason = reason
            locked.save(update_fields=["status_reason", "updated_at"])
        return locked
    from .schedule_service import check_conflicts, coerce_schedule_datetime

    target_start = locked.starts_at
    target_end = locked.ends_at
    if starts_at is not None or ends_at is not None:
        target_start = coerce_schedule_datetime(
            starts_at if starts_at is not None else locked.starts_at,
            event=locked,
            teacher=changed_by,
        )
        target_end = coerce_schedule_datetime(
            ends_at if ends_at is not None else locked.ends_at,
            event=locked,
            teacher=changed_by,
        )
        if target_start is None or target_end is None or target_end <= target_start:
            raise LessonLifecycleError("Укажите дату и время начала и окончания.")
    conflicts = check_conflicts(
        teacher=locked.owner,
        starts_at=target_start,
        ends_at=target_end,
        student_id=locked.student_id,
        group_id=locked.group_id,
        exclude_event_id=locked.pk,
        travel_before_minutes=locked.travel_before_minutes or 0,
        travel_after_minutes=locked.travel_after_minutes or 0,
        all_day=bool(locked.all_day),
    )
    if conflicts:
        raise LessonLifecycleError(
            "Это время уже занято другим занятием. Выберите другое время для восстановления. Остальные занятия не переносятся.",
            code="schedule_conflict",
            status=409,
            extra={"conflicts": conflicts},
        )
    old = event_snapshot(locked)
    time_changed = target_start != locked.starts_at or target_end != locked.ends_at
    if time_changed:
        locked.original_start_at = locked.original_start_at or locked.starts_at
        locked.starts_at = target_start
        locked.ends_at = target_end
    item = locked.lesson_plan_item or _item_from_cancel_log(locked)
    locked.status = ScheduleEvent.Status.PLANNED
    locked.status_reason = reason
    locked.plan_cancel_action = ""
    locked.save()
    if item is not None:
        busy = ScheduleEvent.objects.filter(lesson_plan_item_id=item.pk).exclude(pk=locked.pk).exclude(
            status__in=[
                ScheduleEvent.Status.CANCELLED,
                ScheduleEvent.Status.SKIPPED,
                ScheduleEvent.Status.DONE,
                ScheduleEvent.Status.COMPLETED,
            ],
        ).exists()
        slot_free = item.scheduled_event_id in (None, locked.pk)
        if not busy and slot_free:
            if item.status in (PlanItemStatus.SKIPPED, PlanItemStatus.NOT_STARTED):
                item.status = PlanItemStatus.PLANNED
            item.scheduled_event = locked
            item.save(update_fields=["status", "scheduled_event", "updated_at"])
            locked.lesson_plan_item = item
            locked.save(update_fields=["lesson_plan_item", "updated_at"])
    _reopen_cancelled_journal(locked)
    if time_changed:
        sync_event_datetime_to_linked_records(locked, changed_by=changed_by)
    log_change(
        locked,
        changed_by=changed_by,
        change_type=ScheduleChangeType.RESTORED,
        old_data=old,
        new_data=event_snapshot(locked),
        message=reason,
    )
    return locked


def _reopen_cancelled_journal(event):
    from .journal_models import JournalStatus, LessonJournal

    journal = LessonJournal.objects.filter(schedule_event_id=event.pk).first()
    if journal is None or journal.status != JournalStatus.CANCELLED:
        return
    journal.status = JournalStatus.REOPENED if journal.completed_at else JournalStatus.DRAFT
    journal.save(update_fields=["status", "updated_at"])


@transaction.atomic
def skip_event(event, *, changed_by, reason=""):
    locked = _lock_event(event)
    if locked is None:
        raise LessonLifecycleError("Занятие не найдено", code="not_found", status=404)
    if _conducted(locked.status):
        raise LessonLifecycleError(
            "Проведённый урок нельзя отметить пропущенным. Сначала исправьте отметку о проведении — оценки и работы сохранятся.",
            code="conducted",
        )
    reason = (reason or "").strip()[:500]
    if locked.status == ScheduleEvent.Status.SKIPPED:
        if reason and locked.status_reason != reason:
            locked.status_reason = reason
            locked.save(update_fields=["status_reason", "updated_at"])
        return locked
    old = event_snapshot(locked)
    try:
        from .billing_service import sync_cancelled_event_billing

        sync_cancelled_event_billing(locked, teacher=changed_by or locked.owner, comment=reason or "Пропуск урока")
    except Exception:
        pass
    locked.status = ScheduleEvent.Status.SKIPPED
    locked.status_reason = reason
    locked.save(update_fields=["status", "status_reason", "updated_at"])
    item = locked.lesson_plan_item
    if item is not None and item.status != PlanItemStatus.COMPLETED:
        item.status = PlanItemStatus.SKIPPED
        if item.scheduled_event_id != locked.pk:
            item.scheduled_event = locked
        item.save(update_fields=["status", "scheduled_event", "updated_at"])
    log_change(
        locked,
        changed_by=changed_by,
        change_type=ScheduleChangeType.UPDATED,
        old_data=old,
        new_data=event_snapshot(locked),
        message=reason or "Занятие пропущено",
    )
    return locked


@transaction.atomic
def reopen_conducted_lesson(event, *, changed_by, reason=""):
    """Снимает ошибочную отметку «проведено», не удаляя журнал, оценки и ДЗ."""
    from .journal_models import JournalStatus, LessonJournal
    from .journal_service import write_audit

    locked = _lock_event(event)
    if locked is None:
        raise LessonLifecycleError("Занятие не найдено", code="not_found", status=404)
    journal = LessonJournal.objects.filter(schedule_event_id=locked.pk).first()
    conducted_journal = bool(journal and journal.status == JournalStatus.COMPLETED)
    if not _conducted(locked.status) and not conducted_journal:
        raise LessonLifecycleError(
            "Занятие не отмечено проведённым.",
            code="not_conducted",
        )
    reason = (reason or "").strip()[:500]
    old = event_snapshot(locked)
    locked.status = ScheduleEvent.Status.PLANNED
    locked.status_reason = reason
    locked.save(update_fields=["status", "status_reason", "updated_at"])
    if journal is not None and journal.status == JournalStatus.COMPLETED:
        journal.status = JournalStatus.REOPENED
        journal.updated_by = changed_by
        journal.version += 1
        journal.save(update_fields=["status", "updated_by", "version", "updated_at"])
        write_audit(
            actor=changed_by,
            action="reopened",
            journal=journal,
            field_name="status",
            old_value=JournalStatus.COMPLETED,
            new_value=JournalStatus.REOPENED,
            meta={"reason": reason},
        )
    log_change(
        locked,
        changed_by=changed_by,
        change_type=ScheduleChangeType.UPDATED,
        old_data=old,
        new_data=event_snapshot(locked),
        message=reason or "Отметка о проведении исправлена",
    )
    return locked


def update_status_reason(event, *, changed_by, reason):
    reason = (reason or "").strip()[:500]
    if event.status_reason == reason:
        return event
    old = event_snapshot(event)
    event.status_reason = reason
    event.save(update_fields=["status_reason", "updated_at"])
    log_change(
        event,
        changed_by=changed_by,
        change_type=ScheduleChangeType.UPDATED,
        old_data=old,
        new_data=event_snapshot(event),
        message=reason,
    )
    return event


def _active_enrollment(plan, teacher):
    from .choices import EnrollmentStatus

    return (
        LessonPlanEnrollment.objects.filter(plan=plan, teacher=teacher)
        .exclude(status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED])
        .select_related("student", "group", "student_subject")
        .order_by("-updated_at")
        .first()
    )


def _slot_for_date(scheduled_date, slots, counters):
    day_slots = [slot for slot in slots if slot["weekday"] == scheduled_date.weekday()]
    if not day_slots:
        return {"start_time": "16:00", "duration_minutes": 60}
    index = counters.get(scheduled_date, 0)
    counters[scheduled_date] = index + 1
    return day_slots[index % len(day_slots)]


def _bounds_for_item(item, slots, counters, zone):
    slot = _slot_for_date(item.scheduled_date, slots, counters)
    start_clock = parse_clock(slot["start_time"])
    start = timezone.make_aware(datetime.combine(item.scheduled_date, start_clock), zone)
    duration = int(slot.get("duration_minutes") or 60)
    end = start + timedelta(minutes=duration)
    if end <= start:
        end = start + timedelta(hours=1)
    return start, end, slot


@transaction.atomic
def materialize_plan_calendar(plan, *, teacher, enrollment=None, slots=None, notify=False):
    """Создаёт недостающие занятия календаря по датам плана. Повторный вызов не плодит дубли."""
    from .plan_sync import PlanSyncService
    from .schedule_service import check_conflicts

    enrollment = enrollment or _active_enrollment(plan, teacher)
    if enrollment is None:
        return {
            "ok": False,
            "code": "enrollment_required",
            "detail": "Назначьте план ученику или группе, чтобы поставить занятия в календарь.",
            "created": [],
            "updated": [],
            "kept": [],
            "conflicts": [],
        }
    normalized = normalize_weekday_slots(slots or enrollment.weekday_slots)
    if normalized and enrollment.weekday_slots != normalized:
        enrollment.weekday_slots = normalized
        enrollment.save(update_fields=["weekday_slots", "updated_at"])
    from .schedule_service import resolve_schedule_timezone

    zone = resolve_schedule_timezone(teacher=teacher)
    counters = {}
    created = []
    updated = []
    kept = []
    conflicts = []
    protected = {
        ScheduleEvent.Status.DONE,
        ScheduleEvent.Status.COMPLETED,
        ScheduleEvent.Status.CANCELLED,
        ScheduleEvent.Status.SKIPPED,
        ScheduleEvent.Status.MOVED,
    }
    for item in plan.items.order_by("order", "id"):
        if not item.scheduled_date:
            continue
        event = item.scheduled_event
        if event is None:
            event = item.schedule_events_linked.order_by("starts_at").first()
        starts_at, ends_at, slot_for_bounds = _bounds_for_item(item, normalized, counters, zone)
        if event is not None and (event.status in protected or event.original_start_at):
            kept.append(event.pk)
            continue
        hits = check_conflicts(
            teacher=teacher,
            starts_at=starts_at,
            ends_at=ends_at,
            student_id=enrollment.student_id,
            group_id=enrollment.group_id,
            exclude_event_id=event.pk if event else None,
        )
        if hits:
            conflicts.append({
                "item_id": item.pk,
                "date": item.scheduled_date.isoformat(),
                "conflicts": hits,
            })
            continue
        if event is None:
            event = ScheduleEvent.objects.create(
                owner=teacher,
                title=(item.title or plan.title or "Урок")[:200],
                topic=(item.topic or "")[:500],
                description=item.description or "",
                goal=item.goal or "",
                homework_description=item.homework_description or "",
                starts_at=starts_at,
                ends_at=ends_at,
                event_type=(
                    ScheduleEvent.EventType.GROUP_LESSON
                    if enrollment.group_id
                    else ScheduleEvent.EventType.INDIVIDUAL_LESSON
                ),
                student_id=enrollment.student_id,
                group_id=enrollment.group_id,
                student_subject_id=enrollment.student_subject_id,
                timezone=getattr(zone, "key", None) or "Europe/Moscow",
                status=ScheduleEvent.Status.PLANNED,
            )
            PlanSyncService.link_event_to_plan(event, item, overwrite_topic=False)
            if item.status == PlanItemStatus.NOT_STARTED:
                item.status = PlanItemStatus.PLANNED
                item.save(update_fields=["status", "updated_at"])
            log_change(
                event,
                changed_by=teacher,
                change_type=ScheduleChangeType.CREATED,
                new_data=event_snapshot(event),
                message="Создано из плана уроков",
            )
            _bind_weekday_series(event, enrollment, slot_for_bounds, teacher, zone)
            created.append(event.pk)
            continue
        if event.starts_at != starts_at or event.ends_at != ends_at:
            event.starts_at = starts_at
            event.ends_at = ends_at
            event.save(update_fields=["starts_at", "ends_at", "updated_at"])
            sync_event_datetime_to_linked_records(event, changed_by=teacher)
            _bind_weekday_series(event, enrollment, slot_for_bounds, teacher, zone)
            updated.append(event.pk)
        else:
            _bind_weekday_series(event, enrollment, slot_for_bounds, teacher, zone)
            kept.append(event.pk)
    if notify and created:
        from .notifications import NotificationService

        first = ScheduleEvent.objects.filter(pk=created[0]).first()
        if first is not None:
            NotificationService.notify_event_created(first)
    return {
        "ok": True,
        "created": created,
        "updated": updated,
        "kept": kept,
        "conflicts": conflicts,
        "enrollment_id": enrollment.pk,
    }


def _bind_weekday_series(event, enrollment, slot, teacher, zone):
    """Новое занятие плана получает серию своего дня недели. Уже входящие в серию не переносятся."""
    if event is None or event.series_id or not slot:
        return None
    from .choices import RecurrenceType
    from .models import ScheduleEventSeries

    weekday = int(slot["weekday"]) if slot.get("weekday") is not None else event_local_date(event).weekday()
    start_clock = parse_clock(slot.get("start_time") or "16:00")
    duration = int(slot.get("duration_minutes") or 60)
    end_clock = (datetime.combine(event_local_date(event), start_clock) + timedelta(minutes=duration)).time()
    series = (
        ScheduleEventSeries.objects.filter(
            teacher=teacher,
            recurrence_weekdays=[weekday],
            events__lesson_plan_item__plan_id=enrollment.plan_id,
        )
        .distinct()
        .first()
    )
    fields = []
    if series is None:
        series = ScheduleEventSeries.objects.create(
            teacher=teacher,
            created_by=teacher,
            title=(getattr(enrollment.plan, "title", None) or "Занятия")[:200],
            event_type=event.event_type,
            group_id=enrollment.group_id,
            student_subject_id=enrollment.student_subject_id,
            timezone=getattr(zone, "key", None) or event.timezone or "Europe/Moscow",
            start_date=event_local_date(event),
            start_time=start_clock,
            end_time=end_clock,
            recurrence_type=RecurrenceType.NONE,
            recurrence_count=1,
            recurrence_weekdays=[weekday],
        )
    else:
        if series.start_time != start_clock:
            series.start_time = start_clock
            fields.append("start_time")
        if series.end_time != end_clock:
            series.end_time = end_clock
            fields.append("end_time")
        if list(series.recurrence_weekdays or []) != [weekday]:
            series.recurrence_weekdays = [weekday]
            fields.append("recurrence_weekdays")
        if fields:
            series.save(update_fields=fields + ["updated_at"])
    event.series = series
    event.save(update_fields=["series", "updated_at"])
    return series


def assert_fresh_write(instance, expected_raw):
    """Отказывает, если запись изменилась после того, как её открыли в другой вкладке."""
    if expected_raw in (None, ""):
        return
    from django.utils.dateparse import parse_datetime

    expected = parse_datetime(str(expected_raw).replace("Z", "+00:00"))
    if expected is None:
        return
    if timezone.is_naive(expected):
        expected = timezone.make_aware(expected, timezone.get_current_timezone())
    current = getattr(instance, "updated_at", None)
    if current is None:
        return
    if abs((current - expected).total_seconds()) > 1 and current > expected:
        raise LessonLifecycleError(
            "Это занятие уже изменили в другой вкладке. Сравните сохранённую версию со своей правкой и повторите действие, если она всё ещё нужна.",
            code="stale_write",
            status=409,
        )


def diagnose_plan_calendar_links(*, plan_id=None):
    """Только отчёт. Неоднозначные связи не исправляются."""
    from .journal_models import LessonJournal

    events = ScheduleEvent.objects.exclude(lesson_plan_item_id=None)
    items = LessonPlanItem.objects.exclude(scheduled_event_id=None)
    if plan_id:
        events = events.filter(lesson_plan_item__plan_id=plan_id)
        items = items.filter(plan_id=plan_id)
    issues = []
    for event in events.select_related("lesson_plan_item").iterator():
        item = event.lesson_plan_item
        if item is None:
            continue
        if item.scheduled_event_id and item.scheduled_event_id != event.pk:
            issues.append({
                "code": "split_link",
                "event_id": event.pk,
                "item_id": item.pk,
                "item_event_id": item.scheduled_event_id,
            })
    seen_items = {}
    for event in events.iterator():
        seen_items.setdefault(event.lesson_plan_item_id, []).append(event.pk)
    for item_id, event_ids in seen_items.items():
        if len(event_ids) > 1:
            issues.append({"code": "item_shared", "item_id": item_id, "event_ids": event_ids})
    for item in items.iterator():
        holder = ScheduleEvent.objects.filter(pk=item.scheduled_event_id).first()
        if holder is None:
            issues.append({"code": "dangling_item_event", "item_id": item.pk, "event_id": item.scheduled_event_id})
            continue
        if holder.lesson_plan_item_id and holder.lesson_plan_item_id != item.pk:
            issues.append({
                "code": "item_points_elsewhere",
                "item_id": item.pk,
                "event_id": holder.pk,
                "event_item_id": holder.lesson_plan_item_id,
            })
    journals = LessonJournal.objects.filter(schedule_event_id=None)
    if journals.exists():
        issues.append({"code": "journal_without_event", "count": journals.count()})
    return {"ok": True, "issues": issues, "issue_count": len(issues)}
