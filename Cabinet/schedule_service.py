"""Schedule event business logic: create, move, cancel, conflicts, change log."""

from datetime import datetime

from django.db.models import Q
from django.utils import timezone

from .choices import ParticipantRole, ParticipantStatus, RecurrenceType, ScheduleChangeType, SeriesStatus
from .models import (
    ScheduleEvent,
    ScheduleEventChangeLog,
    ScheduleEventParticipant,
    ScheduleEventSeries,
    Student,
    StudentGroup,
)
from .notifications import NotificationService
from .schedule_series import DEFAULT_HORIZON_DAYS, generate_events_for_series, sync_event_participants


def log_change(event, *, changed_by, change_type, old_data=None, new_data=None, message="", series=None):
    return ScheduleEventChangeLog.objects.create(
        event=event,
        series=series or event.series,
        changed_by=changed_by,
        change_type=change_type,
        old_data=old_data or {},
        new_data=new_data or {},
        message=message,
    )


def event_snapshot(event):
    return {
        "title": event.title,
        "starts_at": event.starts_at.isoformat() if event.starts_at else None,
        "ends_at": event.ends_at.isoformat() if event.ends_at else None,
        "status": event.status,
        "telemost_url": event.telemost_url,
        "topic": event.topic,
    }


def normalize_series_scope(scope):
    text = (scope or "single").strip().lower()
    if text in ("series", "entire", "all"):
        return "series"
    if text == "following":
        return "following"
    return "single"


def coerce_schedule_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            if len(text) >= 16 and text[10] == "T":
                date_part, time_part = text.split("T", 1)
                time_bits = time_part.split(":")
                if len(time_bits) >= 2:
                    try:
                        hour = int(time_bits[0])
                        minute = int(time_bits[1])
                        second = int(time_bits[2]) if len(time_bits) >= 3 and time_bits[2].isdigit() else 0
                        y, m, d = [int(part) for part in date_part.split("-")]
                        parsed = datetime(y, m, d, hour, minute, second)
                    except ValueError:
                        return None
                else:
                    return None
            else:
                return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def normalize_event_update_data(data):
    """Приводит PATCH-поля события к типам модели."""
    normalized = dict(data)
    for key in ("starts_at", "ends_at"):
        if key in normalized:
            parsed = coerce_schedule_datetime(normalized[key])
            if parsed is not None:
                normalized[key] = parsed
    if "telemost_url" in normalized or "link" in normalized:
        normalized["telemost_url"] = (
            normalized.get("telemost_url") or normalized.get("link") or ""
        ).strip()
    return normalized


SERIES_SHARED_EVENT_FIELDS = (
    "title",
    "description",
    "topic",
    "telemost_url",
    "meeting_provider",
    "location",
    "materials",
    "teacher_comment",
    "reminder_minutes",
    "timezone",
)


def extract_shared_event_data(data):
    normalized = normalize_event_update_data(data)
    return {key: normalized[key] for key in SERIES_SHARED_EVENT_FIELDS if key in normalized}


def update_series_template(series, data, *, reference_event=None):
    normalized = normalize_event_update_data(data)
    fields_to_update = []
    for series_field, data_key in (
        ("title", "title"),
        ("topic", "topic"),
        ("teacher_comment", "teacher_comment"),
        ("timezone", "timezone"),
        ("reminder_minutes", "reminder_minutes"),
        ("meeting_provider", "meeting_provider"),
    ):
        if data_key in normalized:
            setattr(series, series_field, normalized[data_key])
            fields_to_update.append(series_field)
    if "telemost_url" in normalized:
        series.meeting_url = normalized["telemost_url"]
        fields_to_update.append("meeting_url")
    if reference_event and "starts_at" in normalized:
        series.start_time = normalized["starts_at"].time()
        fields_to_update.append("start_time")
    if reference_event and "ends_at" in normalized:
        series.end_time = normalized["ends_at"].time()
        fields_to_update.append("end_time")
    if fields_to_update:
        fields_to_update.append("updated_at")
        series.save(update_fields=fields_to_update)


def events_for_series_scope(series, event, scope):
    qs = ScheduleEvent.objects.filter(series=series).exclude(
        status__in=[ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.COMPLETED],
    )
    if scope == "following":
        qs = qs.filter(starts_at__gte=event.starts_at)
    return qs.order_by("starts_at")


def find_orphan_series_events(event, scope):
    """Занятия с тем же названием/учеником, у которых потеряна связь с серией (series_id=NULL)."""
    scope = normalize_series_scope(scope)
    qs = ScheduleEvent.objects.filter(
        owner=event.owner,
        title=event.title,
        series_id__isnull=True,
    ).exclude(
        status__in=[ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.COMPLETED],
    )
    if event.student_id:
        qs = qs.filter(student_id=event.student_id)
    elif event.group_id:
        qs = qs.filter(group_id=event.group_id)
    if scope == "following":
        qs = qs.filter(starts_at__gte=event.starts_at)
    return qs.order_by("starts_at", "pk")


def events_for_edit_scope(event, scope):
    scope = normalize_series_scope(scope)
    if scope == "single":
        return ScheduleEvent.objects.filter(pk=event.pk)
    if event.series_id:
        return events_for_series_scope(event.series, event, scope)
    return find_orphan_series_events(event, scope)


def check_conflicts(
    *,
    teacher,
    starts_at,
    ends_at,
    student_id=None,
    group_id=None,
    exclude_event_id=None,
    exclude_event_ids=None,
):
    conflicts = []
    base = ScheduleEvent.objects.filter(owner=teacher).exclude(
        status=ScheduleEvent.Status.CANCELLED,
    )
    excluded_ids = []
    if exclude_event_ids:
        excluded_ids.extend(exclude_event_ids)
    if exclude_event_id:
        excluded_ids.append(exclude_event_id)
    if excluded_ids:
        base = base.exclude(pk__in=excluded_ids)

    teacher_overlap = base.filter(starts_at__lt=ends_at, ends_at__gt=starts_at)
    if teacher_overlap.exists():
        conflicts.append({"type": "teacher", "events": list(teacher_overlap.values("id", "title", "starts_at"))})

    if student_id:
        student_events = base.filter(
            Q(student_id=student_id)
            | Q(participants__student_id=student_id, participants__status__in=[
                ParticipantStatus.INVITED, ParticipantStatus.ACCEPTED,
            ])
        ).filter(starts_at__lt=ends_at, ends_at__gt=starts_at).distinct()
        if student_events.exists():
            conflicts.append({"type": "student", "events": list(student_events.values("id", "title", "starts_at"))})

    if group_id:
        group_events = base.filter(group_id=group_id).filter(
            starts_at__lt=ends_at, ends_at__gt=starts_at,
        )
        if group_events.exists():
            conflicts.append({"type": "group", "events": list(group_events.values("id", "title", "starts_at"))})

    return conflicts


def create_single_event(
    *,
    teacher,
    data,
    student_ids=None,
    group_id=None,
    extra_student_ids=None,
    notify=True,
):
    from datetime import timedelta

    from .student_subjects import resolve_student_subject_for_write

    group = None
    if group_id:
        group = StudentGroup.objects.filter(pk=group_id, teacher=teacher).first()

    student_subject = None
    student_subject_id = data.get("student_subject") or data.get("student_subject_id")
    primary_student = None
    if student_ids and len(student_ids) == 1 and not group_id:
        primary_student = Student.objects.filter(pk=student_ids[0], teacher=teacher).first()
        if primary_student is not None:
            student_subject = resolve_student_subject_for_write(
                teacher=teacher,
                student=primary_student,
                student_subject_id=student_subject_id,
                allow_empty=True,
            )
            # Individual lesson with subjects: require subject when student has any active ones
            active_count = primary_student.subjects.filter(status="active").count()
            if active_count and student_subject is None:
                student_subject = resolve_student_subject_for_write(
                    teacher=teacher,
                    student=primary_student,
                    student_subject_id=student_subject_id,
                    allow_empty=False,
                )

    event = ScheduleEvent.objects.create(
        owner=teacher,
        title=data["title"],
        description=data.get("description", ""),
        topic=data.get("topic", ""),
        starts_at=data["starts_at"],
        ends_at=data["ends_at"],
        event_type=data.get("event_type", ScheduleEvent.EventType.GROUP_LESSON),
        format=data.get("format", ScheduleEvent.Format.ONLINE),
        lesson_id=data.get("lesson"),
        lesson_plan_item_id=data.get("lesson_plan_item"),
        homework_id=data.get("homework"),
        group=group,
        student_subject=student_subject,
        timezone=data.get("timezone", "Europe/Moscow"),
        telemost_url=data.get("telemost_url", data.get("meeting_url", "")),
        meeting_provider=data.get("meeting_provider", "none"),
        location=data.get("location", ""),
        materials=data.get("materials", ""),
        teacher_comment=data.get("teacher_comment", ""),
        reminder_minutes=data.get("reminder_minutes"),
        status=ScheduleEvent.Status.PLANNED,
    )

    sync_event_participants(
        event,
        student_ids=student_ids,
        group=group,
        extra_student_ids=extra_student_ids,
        teacher=teacher,
    )
    if student_ids and len(student_ids) == 1:
        event.student_id = student_ids[0]
        event.save(update_fields=["student"])

    log_change(event, changed_by=teacher, change_type=ScheduleChangeType.CREATED, new_data=event_snapshot(event))
    if notify and data.get("notify_participants", True):
        NotificationService.notify_event_created(event)
    return event


def create_series(
    *,
    teacher,
    series_data,
    student_ids=None,
    group_id=None,
    extra_student_ids=None,
    notify=True,
):
    from datetime import timedelta

    group = None
    if group_id:
        group = StudentGroup.objects.filter(pk=group_id, teacher=teacher).first()

    from .student_subjects import resolve_student_subject_for_write

    student_subject = None
    student_subject_id = series_data.get("student_subject") or series_data.get("student_subject_id")
    if student_ids and len(student_ids) == 1 and not group_id:
        primary_student = Student.objects.filter(pk=student_ids[0], teacher=teacher).first()
        if primary_student is not None:
            active_count = primary_student.subjects.filter(status="active").count()
            student_subject = resolve_student_subject_for_write(
                teacher=teacher,
                student=primary_student,
                student_subject_id=student_subject_id,
                # Без id: автоподстановка при одном предмете; при нескольких — ошибка.
                allow_empty=not active_count,
            )
            if active_count and student_subject is None:
                student_subject = resolve_student_subject_for_write(
                    teacher=teacher,
                    student=primary_student,
                    student_subject_id=student_subject_id,
                    allow_empty=False,
                )

    series = ScheduleEventSeries.objects.create(
        teacher=teacher,
        created_by=teacher,
        title=series_data["title"],
        description=series_data.get("description", ""),
        event_type=series_data.get("event_type", "group_lesson"),
        lesson_id=series_data.get("lesson"),
        lesson_plan_item_id=series_data.get("lesson_plan_item"),
        homework_id=series_data.get("homework"),
        group=group,
        student_subject=student_subject,
        timezone=series_data.get("timezone", "Europe/Moscow"),
        start_date=series_data["start_date"],
        start_time=series_data["start_time"],
        end_time=series_data["end_time"],
        recurrence_type=series_data.get("recurrence_type", RecurrenceType.NONE),
        recurrence_interval=series_data.get("recurrence_interval", 1),
        recurrence_weekdays=series_data.get("recurrence_weekdays", []),
        recurrence_until=series_data.get("recurrence_until"),
        recurrence_count=series_data.get("recurrence_count"),
        meeting_url=series_data.get("meeting_url", ""),
        meeting_provider=series_data.get("meeting_provider", "none"),
        format=series_data.get("format", "online"),
        topic=series_data.get("topic", ""),
        teacher_comment=series_data.get("teacher_comment", ""),
        reminder_minutes=series_data.get("reminder_minutes"),
        notify_on_create=series_data.get("notify_participants", True),
    )

    date_to = timezone.localdate() + timedelta(days=DEFAULT_HORIZON_DAYS)
    if series.recurrence_until:
        date_to = min(date_to, series.recurrence_until)

    events = generate_events_for_series(series, series.start_date, date_to)

    if student_ids or extra_student_ids:
        for event in events:
            sync_event_participants(
                event,
                student_ids=student_ids,
                extra_student_ids=extra_student_ids,
                teacher=teacher,
            )
            if student_ids and len(student_ids) == 1:
                update_fields = []
                if event.student_id != student_ids[0]:
                    event.student_id = student_ids[0]
                    update_fields.append("student_id")
                if student_subject and event.student_subject_id != student_subject.id:
                    event.student_subject = student_subject
                    update_fields.append("student_subject")
                if update_fields:
                    event.save(update_fields=update_fields)

    if notify and series.notify_on_create:
        for event in events[:1]:
            NotificationService.notify_event_created(event)

    return series, events


def move_event(event, *, starts_at, ends_at, changed_by, notify=True):
    old = event_snapshot(event)
    event.original_start_at = event.original_start_at or event.starts_at
    event.starts_at = starts_at
    event.ends_at = ends_at
    event.status = ScheduleEvent.Status.MOVED
    event.save()
    log_change(
        event,
        changed_by=changed_by,
        change_type=ScheduleChangeType.MOVED,
        old_data=old,
        new_data=event_snapshot(event),
    )
    if notify:
        NotificationService.notify_event_moved(
            event, old_start_at=old.get("starts_at"), old_end_at=old.get("ends_at"),
        )
    return event


def _move_event_shifted(event, *, start_delta, duration, changed_by, notify=True):
    new_start = event.starts_at + start_delta
    new_end = new_start + duration
    return move_event(event, starts_at=new_start, ends_at=new_end, changed_by=changed_by, notify=notify)


def _only_time_of_day_changed(event, *, starts_at):
    edited_local = timezone.localtime(event.starts_at)
    new_local = timezone.localtime(starts_at)
    return edited_local.date() == new_local.date()


def _event_timezone(event):
    from .schedule_series import _series_tz

    if event.series_id:
        return _series_tz(event.series)
    try:
        import zoneinfo

        return zoneinfo.ZoneInfo(event.timezone or "Europe/Moscow")
    except Exception:
        import zoneinfo

        return zoneinfo.ZoneInfo("Europe/Moscow")


def _move_events_to_time_of_day(events, *, new_start, new_end, changed_by):
    """Выставляет одинаковое время суток, сохраняя дату каждого занятия."""
    new_start_local = timezone.localtime(new_start)
    new_end_local = timezone.localtime(new_end)
    duration = new_end - new_start
    moved = []
    for ev in events:
        tz = _event_timezone(ev)
        local_date = ev.starts_at.astimezone(tz).date()
        ev_new_start = datetime.combine(local_date, new_start_local.time(), tzinfo=tz)
        ev_new_end = datetime.combine(local_date, new_end_local.time(), tzinfo=tz)
        if ev_new_end <= ev_new_start:
            ev_new_end = ev_new_start + duration
        moved.append(move_event(
            ev,
            starts_at=ev_new_start,
            ends_at=ev_new_end,
            changed_by=changed_by,
            notify=False,
        ))
    return moved


def move_event_with_scope(event, *, starts_at, ends_at, changed_by, scope=None, notify=True):
    """scope: single | following | series (None = single)."""
    scope = normalize_series_scope(scope)
    start_delta = starts_at - event.starts_at
    duration = ends_at - starts_at

    if scope == "single":
        return move_event(event, starts_at=starts_at, ends_at=ends_at, changed_by=changed_by, notify=notify)

    scope_events = list(events_for_edit_scope(event, scope))
    if len(scope_events) <= 1:
        return move_event(event, starts_at=starts_at, ends_at=ends_at, changed_by=changed_by, notify=notify)

    old_snapshots = {ev.pk: event_snapshot(ev) for ev in scope_events}

    if _only_time_of_day_changed(event, starts_at=starts_at):
        moved = _move_events_to_time_of_day(
            scope_events,
            new_start=starts_at,
            new_end=ends_at,
            changed_by=changed_by,
        )
    else:
        moved = [
            _move_event_shifted(
                ev,
                start_delta=start_delta,
                duration=duration,
                changed_by=changed_by,
                notify=False,
            )
            for ev in scope_events
        ]

    if event.series_id:
        series = event.series
        series.start_time = timezone.localtime(starts_at).time()
        series.end_time = timezone.localtime(ends_at).time()
        series.save(update_fields=["start_time", "end_time", "updated_at"])

    if notify and moved:
        for ev in moved:
            old = old_snapshots.get(ev.pk, {})
            NotificationService.notify_event_moved(
                ev,
                old_start_at=old.get("starts_at"),
                old_end_at=old.get("ends_at"),
            )
    return moved[0] if moved else event


def cancel_event(event, *, changed_by, notify=True, plan_cancel_action=None):
    from .plan_schedule import apply_plan_cancel_action
    from .video_meeting_service import cancel_meeting_for_event

    old = event_snapshot(event)
    if plan_cancel_action:
        apply_plan_cancel_action(event, plan_cancel_action)

    # Если урок уже был оформлен финансово как проведённый — вернуть списание.
    try:
        from .billing_models import DeliveryStatus, EventBillingRecord
        from .billing_service import unfinalize_event_billing

        has_finalized = EventBillingRecord.objects.filter(
            event=event,
            finalized_at__isnull=False,
            delivery_status=DeliveryStatus.CONDUCTED,
        ).exists()
        if has_finalized and changed_by:
            unfinalize_event_billing(
                event=event,
                teacher=changed_by,
                comment="Отмена урока — возврат списания",
                reset_event_status=False,
            )
    except Exception:
        pass

    event.status = ScheduleEvent.Status.CANCELLED
    event.save(update_fields=["status", "updated_at"])
    cancel_meeting_for_event(event)
    log_change(
        event,
        changed_by=changed_by,
        change_type=ScheduleChangeType.CANCELLED,
        old_data=old,
        new_data=event_snapshot(event),
    )
    if notify:
        skip_user_id = changed_by.pk if changed_by else None
        NotificationService.notify_event_cancelled(event, skip_user_id=skip_user_id)
    return event


def cancel_event_with_scope(event, *, changed_by, scope=None, notify=True, plan_cancel_action=None):
    """scope: single | following | series (None = single)."""
    scope = scope or "single"
    if scope == "series" and event.series_id:
        cancel_series(event.series, changed_by=changed_by, notify=notify, plan_cancel_action=plan_cancel_action)
        return event
    if scope == "following" and event.series_id:
        cancel_series(
            event.series,
            changed_by=changed_by,
            from_date=event.starts_at.date(),
            notify=notify,
            plan_cancel_action=plan_cancel_action,
        )
        return event
    return cancel_event(event, changed_by=changed_by, notify=notify, plan_cancel_action=plan_cancel_action)


def cancel_series(series, *, changed_by, from_date=None, notify=True, plan_cancel_action=None):
    qs = ScheduleEvent.objects.filter(series=series).exclude(
        status=ScheduleEvent.Status.CANCELLED,
    )
    if from_date:
        qs = qs.filter(starts_at__date__gte=from_date)
    events = list(qs.order_by("starts_at", "pk"))
    for event in events:
        cancel_event(
            event,
            changed_by=changed_by,
            notify=False,
            plan_cancel_action=plan_cancel_action,
        )
    series.status = SeriesStatus.CANCELLED
    series.save(update_fields=["status", "updated_at"])
    if notify and events:
        skip_user_id = changed_by.pk if changed_by else None
        NotificationService.notify_event_cancelled(
            events[0],
            events_count=len(events),
            skip_user_id=skip_user_id,
        )
    return events


def update_event(event, *, changed_by, data, notify=True):
    data = normalize_event_update_data(data)
    old = event_snapshot(event)
    fields = [
        "title", "description", "topic", "telemost_url", "meeting_provider",
        "location", "materials", "teacher_comment", "reminder_minutes", "timezone",
    ]
    for f in fields:
        if f in data:
            setattr(event, f, data[f])
    if "starts_at" in data:
        event.starts_at = data["starts_at"]
    if "ends_at" in data:
        event.ends_at = data["ends_at"]
    if "student_subject" in data:
        ss_val = data["student_subject"]
        if ss_val in (None, "", 0, "0"):
            event.student_subject = None
        elif hasattr(ss_val, "pk"):
            event.student_subject = ss_val
        else:
            event.student_subject_id = int(ss_val)
    event.save()
    log_change(
        event,
        changed_by=changed_by,
        change_type=ScheduleChangeType.UPDATED,
        old_data=old,
        new_data=event_snapshot(event),
    )
    if notify and data.get("notify_participants", True):
        NotificationService.notify_event_updated(event, changes=data)
    return event


def add_participant(event, *, student, changed_by, notify=True):
    participant, created = ScheduleEventParticipant.objects.get_or_create(
        event=event,
        student=student,
        role=ParticipantRole.STUDENT,
        defaults={
            "user": student.user,
            "display_name": student.full_name,
            "contact_email": student.email or "",
            "status": ParticipantStatus.INVITED,
        },
    )
    if created and notify:
        NotificationService.notify_participants_changed(event, added=[participant], removed=[])
    if created:
        log_change(
            event,
            changed_by=changed_by,
            change_type=ScheduleChangeType.PARTICIPANTS_CHANGED,
            message=f"Добавлен: {student.full_name}",
        )
    return participant


def remove_participant(participant, *, changed_by, notify=True):
    event = participant.event
    participant.status = ParticipantStatus.REMOVED
    participant.save(update_fields=["status", "updated_at"])
    if notify:
        NotificationService.notify_participants_changed(event, added=[], removed=[participant])
    log_change(
        event,
        changed_by=changed_by,
        change_type=ScheduleChangeType.PARTICIPANTS_CHANGED,
        message=f"Удалён: {participant.display_name}",
    )
    return participant


def apply_series_edit(event, *, scope, changed_by, data, notify=True):
    """scope: single | following | series — общие поля без перезаписи дат всех занятий одной."""
    data = normalize_event_update_data(data)
    scope = normalize_series_scope(scope)

    scope_events = list(events_for_edit_scope(event, scope))
    if scope == "single" or len(scope_events) <= 1:
        return update_event(event, changed_by=changed_by, data=data, notify=notify)

    shared = extract_shared_event_data(data)
    if not shared:
        return event

    if event.series_id:
        update_series_template(event.series, data, reference_event=event if scope == "series" else None)

    for ev in scope_events:
        update_event(ev, changed_by=changed_by, data=shared, notify=False)

    if notify:
        NotificationService.notify_event_updated(event, changes=shared)
    return event
