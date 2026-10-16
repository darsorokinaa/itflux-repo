"""Недельное расписание плана (r40): дни недели + время → ScheduleEvent по темам плана.

Правила синхронизации:
* трогаем только «свои» события: созданные этим расписанием, ещё не прошедшие,
  в статусе planned и не изменённые никем после генерации (updated_at совпадает
  с сохранённым в плане отпечатком);
* прошедшие, проведённые, отменённые, перенесённые и созданные вручную
  события не меняются и не удаляются — их темы считаются уже занятыми;
* новые события создаются через schedule_service.create_single_event, как
  при ручном создании урока (участники, связь с темой, уведомления, видеосвязь).
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.utils import timezone

from .choices import EnrollmentStatus, PlanItemStatus, ScheduleChangeType
from .models import LessonPlan, LessonPlanEnrollment, ScheduleEvent

WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
INACTIVE = {ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.SKIPPED}
MAX_HORIZON_DAYS = 400
_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})")


class WeeklyScheduleError(ValueError):
    pass


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise WeeklyScheduleError(f"Некорректная дата: {value}")


def _parse_time(value):
    match = _TIME_RE.match(str(value or "").strip())
    if not match:
        raise WeeklyScheduleError("Укажите время занятия в формате ЧЧ:ММ.")
    hh, mm = int(match.group(1)), int(match.group(2))
    if hh > 23 or mm > 59:
        raise WeeklyScheduleError("Некорректное время занятия.")
    return time(hh, mm)


def normalize_pattern(raw: dict | None) -> dict:
    raw = dict(raw or {})
    slots = []
    seen = set()
    for slot in raw.get("slots") or []:
        try:
            weekday = int(slot.get("weekday"))
        except (TypeError, ValueError, AttributeError):
            raise WeeklyScheduleError("Некорректный день недели.")
        if weekday < 0 or weekday > 6:
            raise WeeklyScheduleError("Некорректный день недели.")
        at = _parse_time(slot.get("time"))
        key = (weekday, at)
        if key in seen:
            continue
        seen.add(key)
        slots.append({"weekday": weekday, "time": at.strftime("%H:%M")})
    if not slots:
        raise WeeklyScheduleError("Выберите хотя бы один день недели и время.")
    slots.sort(key=lambda s: (s["weekday"], s["time"]))
    try:
        duration = int(raw.get("duration_minutes") or 60)
    except (TypeError, ValueError):
        raise WeeklyScheduleError("Некорректная длительность.")
    if duration < 10 or duration > 480:
        raise WeeklyScheduleError("Длительность — от 10 до 480 минут.")
    start = _parse_date(raw.get("start_date"))
    if not start:
        raise WeeklyScheduleError("Укажите дату начала.")
    end = _parse_date(raw.get("end_date"))
    if end and end < start:
        raise WeeklyScheduleError("Дата окончания раньше даты начала.")
    skips = sorted({_parse_date(d).isoformat() for d in (raw.get("skip_dates") or []) if d})
    fmt = "offline" if str(raw.get("format") or "").lower() == "offline" else "online"
    video = "jitsi" if (raw.get("video") == "jitsi" and fmt == "online") else "none"
    conflict_mode = "ignore" if raw.get("conflict_mode") == "ignore" else "skip"
    enrollment_id = raw.get("enrollment_id")
    try:
        enrollment_id = int(enrollment_id) if enrollment_id not in (None, "") else None
    except (TypeError, ValueError):
        enrollment_id = None
    return {
        "slots": slots,
        "duration_minutes": duration,
        "start_date": start.isoformat(),
        "end_date": end.isoformat() if end else None,
        "skip_dates": skips,
        "format": fmt,
        "video": video,
        "notify": bool(raw.get("notify")),
        "conflict_mode": conflict_mode,
        "enrollment_id": enrollment_id,
        "timezone": (raw.get("timezone") or "").strip() or None,
    }


def plan_enrollments(plan, teacher):
    return list(
        LessonPlanEnrollment.objects.filter(plan=plan, teacher=teacher)
        .exclude(status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED])
        .select_related("student", "student__user__profile", "group")
        .order_by("-status", "id")
    )


def enrollment_label(enrollment):
    if enrollment.group_id:
        return f"Группа: {enrollment.group.title}"
    if enrollment.student_id:
        return enrollment.student.full_name or f"Ученик #{enrollment.student_id}"
    return f"Назначение #{enrollment.pk}"


def _resolve_enrollment(plan, teacher, enrollment_id):
    rows = plan_enrollments(plan, teacher)
    if enrollment_id:
        for row in rows:
            if row.pk == enrollment_id:
                return row
        raise WeeklyScheduleError("Ученик или группа для этого плана не найдены.")
    active = [r for r in rows if r.status == EnrollmentStatus.ACTIVE] or rows
    if not active:
        raise WeeklyScheduleError("План не назначен ученику или группе. Сначала назначьте план.")
    if len(active) > 1:
        raise WeeklyScheduleError("План назначен нескольким ученикам — выберите, для кого расписание.")
    return active[0]


def _stamp(event):
    """Отпечаток: время + число записей в журнале изменений.

    Любой перенос/отмена/правка из календаря пишет журнал → событие
    считается изменённым вручную и больше не трогается генератором.
    """
    from .models import ScheduleEventChangeLog

    logs = ScheduleEventChangeLog.objects.filter(event_id=event.pk).count()
    return f"{event.starts_at.isoformat()}|{event.ends_at.isoformat()}|{logs}"


def _local(dt, tz):
    return dt.astimezone(tz)


def _conflict_summary(conflicts, tz):
    out = []
    for block in conflicts or []:
        for ev in block.get("events") or []:
            title = ev.get("title") or ev.get("label") or "Занятие"
            start = ev.get("starts_at") or ev.get("start") or ev.get("startsAt")
            when = ""
            if isinstance(start, datetime):
                when = _local(start, tz).strftime("%d.%m %H:%M")
            elif isinstance(start, str):
                try:
                    when = _local(datetime.fromisoformat(start), tz).strftime("%d.%m %H:%M")
                except ValueError:
                    when = start[:16]
            out.append(f"{title} {when}".strip())
    return list(dict.fromkeys(out))[:5]


def build_schedule(plan, teacher, pattern, *, now=None):
    """Считает план действий. Ничего не пишет в БД."""
    from .schedule_service import check_conflicts, resolve_schedule_timezone

    now = now or timezone.now()
    enrollment = _resolve_enrollment(plan, teacher, pattern.get("enrollment_id"))
    tz = resolve_schedule_timezone(pattern.get("timezone"), teacher=teacher)
    generated = dict((plan.weekly_schedule or {}).get("generated") or {})

    items = list(plan.items.order_by("order", "id"))
    item_ids = [it.pk for it in items]
    events_by_item: dict[int, list] = {pk: [] for pk in item_ids}
    fk_ids = {it.scheduled_event_id for it in items if it.scheduled_event_id}
    for ev in ScheduleEvent.objects.filter(owner=teacher).filter(
        models_q(lesson_plan_item_id__in=item_ids) | models_q(pk__in=fk_ids)
    ).order_by("starts_at", "pk"):
        targets = {ev.lesson_plan_item_id} if ev.lesson_plan_item_id in events_by_item else set()
        targets |= {it.pk for it in items if it.scheduled_event_id == ev.pk}
        for pk in targets:
            if ev not in events_by_item[pk]:
                events_by_item[pk].append(ev)

    def is_own(ev):
        return (
            generated.get(str(ev.pk)) == _stamp(ev)
            and ev.status == ScheduleEvent.Status.PLANNED
            and ev.starts_at > now
            and ev.lesson_plan_item_id is not None
        )

    rows = []
    pending = []  # (item, own_event|None)
    surplus = []
    own_ids = set()
    for ev_list in events_by_item.values():
        own_ids |= {ev.pk for ev in ev_list if is_own(ev)}

    for idx, item in enumerate(items, start=1):
        evs = events_by_item[item.pk]
        own = [ev for ev in evs if is_own(ev)]
        kept = [ev for ev in evs if ev.status not in INACTIVE and ev.pk not in own_ids]
        base = {"item_id": item.pk, "number": idx, "topic": item.topic or item.title}
        if item.status == PlanItemStatus.SKIPPED:
            rows.append({**base, "action": "skipped_topic", "label": "Тема пропущена"})
            surplus.extend(own)
            continue
        if kept:
            ev = kept[0]
            rows.append({
                **base, "action": "keep", "event_id": ev.pk,
                "starts_at": _local(ev.starts_at, tz).isoformat(),
                "label": "Уже в календаре — не меняется",
            })
            surplus.extend(own)
            continue
        if item.status == PlanItemStatus.COMPLETED:
            rows.append({**base, "action": "done", "label": "Тема пройдена"})
            surplus.extend(own)
            continue
        pending.append((item, own[0] if own else None, base))
        surplus.extend(own[1:])

    start = max(date.fromisoformat(pattern["start_date"]), now.astimezone(tz).date())
    end = date.fromisoformat(pattern["end_date"]) if pattern.get("end_date") else None
    skips = set(pattern.get("skip_dates") or [])
    by_weekday: dict[int, list] = {}
    for slot in pattern["slots"]:
        by_weekday.setdefault(slot["weekday"], []).append(_parse_time(slot["time"]))
    duration = timedelta(minutes=pattern["duration_minutes"])

    skipped_slots = []
    assignments = []
    day = start
    limit = start + timedelta(days=MAX_HORIZON_DAYS)
    queue = list(pending)
    while queue and day <= limit and (end is None or day <= end):
        if day.isoformat() not in skips:
            for at in sorted(by_weekday.get(day.weekday(), [])):
                if not queue:
                    break
                starts = timezone.make_aware(datetime.combine(day, at), tz)
                if starts <= now:
                    continue
                ends = starts + duration
                conflicts = check_conflicts(
                    teacher=teacher,
                    starts_at=starts,
                    ends_at=ends,
                    student_id=enrollment.student_id if not enrollment.group_id else None,
                    group_id=enrollment.group_id,
                    exclude_event_ids=list(own_ids),
                )
                summary = _conflict_summary(conflicts, tz) if conflicts else []
                if conflicts and pattern["conflict_mode"] == "skip":
                    skipped_slots.append({
                        "starts_at": starts.isoformat(), "conflicts": summary or ["Занято"],
                    })
                    continue
                item, own, base = queue.pop(0)
                assignments.append((item, own, base, starts, ends, summary))
        day += timedelta(days=1)

    for item, own, base, starts, ends, summary in assignments:
        if own is not None and own.starts_at == starts and own.ends_at == ends:
            action, label = "unchanged", "Без изменений"
        elif own is not None:
            action, label = "move", "Время будет изменено"
        else:
            action, label = "create", "Будет создано"
        rows.append({
            **base, "action": action, "label": label,
            "event_id": own.pk if own else None,
            "starts_at": starts.isoformat(), "ends_at": ends.isoformat(),
            "weekday": WEEKDAY_LABELS[starts.weekday()],
            "conflicts": summary,
        })
    for item, own, base in queue:
        rows.append({**base, "action": "no_slot", "label": "Не хватило дат до окончания"})
        if own is not None:
            surplus.append(own)
    surplus_rows = [{
        "event_id": ev.pk, "starts_at": _local(ev.starts_at, tz).isoformat(), "topic": ev.topic,
        "item_id": ev.lesson_plan_item_id,
    } for ev in {e.pk: e for e in surplus}.values()]

    order = {it.pk: n for n, it in enumerate(items)}
    rows.sort(key=lambda r: order.get(r["item_id"], 0))
    summary = {
        "create": sum(r["action"] == "create" for r in rows),
        "move": sum(r["action"] == "move" for r in rows),
        "unchanged": sum(r["action"] == "unchanged" for r in rows),
        "keep": sum(r["action"] == "keep" for r in rows),
        "no_slot": sum(r["action"] == "no_slot" for r in rows),
        "remove": len(surplus_rows),
        "conflicts": sum(bool(r.get("conflicts")) for r in rows),
        "skipped_slots": len(skipped_slots),
    }
    return {
        "enrollment": {"id": enrollment.pk, "label": enrollment_label(enrollment)},
        "timezone": tz.key,
        "pattern": pattern,
        "rows": rows,
        "skipped_slots": skipped_slots,
        "remove": surplus_rows,
        "summary": summary,
        "_enrollment": enrollment,
        "_assignments": assignments,
        "_surplus": list({e.pk: e for e in surplus}.values()),
        "_tz": tz,
    }


def models_q(**kwargs):
    from django.db.models import Q

    return Q(**kwargs)


def public_result(result):
    return {k: v for k, v in result.items() if not k.startswith("_")}


def apply_schedule(plan, teacher, pattern, *, now=None):
    from .models import EventReminderLog, LessonPlanItem
    from .notifications import NotificationService
    from .schedule_service import create_single_event, event_snapshot, log_change

    log = []
    with transaction.atomic():
        plan = LessonPlan.objects.select_for_update().get(pk=plan.pk)
        result = build_schedule(plan, teacher, pattern, now=now)
        enrollment = result["_enrollment"]
        tz = result["_tz"]
        state = dict(plan.weekly_schedule or {})
        generated = dict(state.get("generated") or {})
        notify = bool(pattern.get("notify"))

        for ev in result["_surplus"]:
            generated.pop(str(ev.pk), None)
            log.append({"op": "delete", "event_id": ev.pk, "starts_at": ev.starts_at.isoformat()})
            ev.delete()

        for item, own, base, starts, ends, _summary in result["_assignments"]:
            local_day = starts.astimezone(tz).date()
            if own is not None:
                if own.starts_at == starts and own.ends_at == ends:
                    continue
                old = event_snapshot(own)
                own.starts_at, own.ends_at = starts, ends
                own.save(update_fields=["starts_at", "ends_at", "updated_at"])
                EventReminderLog.objects.filter(event=own).delete()
                log_change(own, changed_by=teacher, change_type=ScheduleChangeType.UPDATED,
                           old_data=old, new_data=event_snapshot(own),
                           message="Недельное расписание плана")
                if notify:
                    NotificationService.notify_event_moved(
                        own, old_start_at=old.get("starts_at"), old_end_at=old.get("ends_at"))
                own.refresh_from_db()
                generated[str(own.pk)] = _stamp(own)
                LessonPlanItem.objects.filter(pk=item.pk).update(scheduled_date=local_day)
                log.append({"op": "move", "event_id": own.pk, "item_id": item.pk, "starts_at": starts.isoformat()})
                continue
            data = {
                "title": enrollment_label(enrollment).replace("Группа: ", ""),
                "topic": (item.topic or item.title or "")[:500],
                "starts_at": starts,
                "ends_at": ends,
                "event_type": (ScheduleEvent.EventType.GROUP_LESSON if enrollment.group_id
                               else ScheduleEvent.EventType.INDIVIDUAL_LESSON),
                "format": pattern["format"],
                "timezone": tz.key,
                "lesson_plan_item": item.pk,
                "meeting_provider": "jitsi" if pattern["video"] == "jitsi" else "none",
                "student_subject": enrollment.student_subject_id,
                "notify_participants": notify,
            }
            event = create_single_event(
                teacher=teacher,
                data=data,
                student_ids=[enrollment.student_id] if enrollment.student_id and not enrollment.group_id else None,
                group_id=enrollment.group_id,
                notify=notify,
            )
            if pattern["video"] == "jitsi":
                from .video_meeting_service import get_or_create_meeting_for_event

                get_or_create_meeting_for_event(event=event, created_by=teacher)
            LessonPlanItem.objects.filter(pk=item.pk).update(scheduled_date=local_day)
            event.refresh_from_db()
            generated[str(event.pk)] = _stamp(event)
            log.append({"op": "create", "event_id": event.pk, "item_id": item.pk, "starts_at": starts.isoformat()})

        # Отпечатки событий, которые уже не «наши» (прошли/изменены), больше не нужны.
        alive = set(ScheduleEvent.objects.filter(pk__in=[int(k) for k in generated]).values_list("pk", flat=True))
        generated = {k: v for k, v in generated.items() if int(k) in alive}
        stored = {k: v for k, v in pattern.items()}
        stored["enrollment_id"] = enrollment.pk
        state.update({
            "pattern": stored,
            "generated": generated,
            "applied_at": timezone.now().isoformat(),
            "last_log": log[-200:],
        })
        plan.weekly_schedule = state
        plan.save(update_fields=["weekly_schedule", "updated_at"])
    out = public_result(build_schedule(plan, teacher, pattern, now=now))
    out["applied"] = log
    return out
