"""Автопривязка тем плана к будущим занятиям без темы (r42).

Правила:
* кандидаты — будущие занятия (planned/moved) ученика или группы с активным
  планом, без темы плана, с включённой синхронизацией с планом и без
  вручную введённой темы;
* темы выдаются в порядке плана по дате занятий через тот же код, что и при
  создании серии (PlanSyncService.get_next_plan_item + link_event_to_plan);
* такие связи помечаются plan_item_auto=True; ручной выбор темы не трогаем;
* уведомления ученикам не отправляются.
"""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager

from django.db import transaction
from django.utils import timezone

from .choices import EnrollmentStatus, LessonContentSource
from .models import LessonPlanEnrollment, ScheduleEvent

logger = logging.getLogger("cabinet.plan_autolink")

ACTIVE_EVENT_STATUSES = (ScheduleEvent.Status.PLANNED, ScheduleEvent.Status.MOVED)
LESSON_TYPES = (ScheduleEvent.EventType.INDIVIDUAL_LESSON, ScheduleEvent.EventType.GROUP_LESSON)
COPY_FIELDS = ("topic", "subtopic", "description", "goal", "homework_description")

_state = threading.local()


@contextmanager
def autolink_guard():
    prev = getattr(_state, "busy", False)
    _state.busy = True
    try:
        yield
    finally:
        _state.busy = prev


def autolink_running():
    return getattr(_state, "busy", False)


def candidate_events(*, teacher_id=None, enrollment=None, now=None):
    now = now or timezone.now()
    qs = ScheduleEvent.objects.filter(
        starts_at__gt=now,
        status__in=ACTIVE_EVENT_STATUSES,
        lesson_plan_item__isnull=True,
        plan_sync_enabled=True,
        event_type__in=LESSON_TYPES,
    ).filter(models_q(student__isnull=False) | models_q(group__isnull=False))
    if teacher_id:
        qs = qs.filter(owner_id=teacher_id)
    if enrollment is not None:
        qs = qs.filter(owner_id=enrollment.teacher_id)
        if enrollment.group_id:
            qs = qs.filter(group_id=enrollment.group_id)
        else:
            qs = qs.filter(student_id=enrollment.student_id)
    return qs.order_by("starts_at", "pk")


def models_q(**kw):
    from django.db.models import Q

    return Q(**kw)


def _has_manual_topic(event):
    return bool((event.topic or "").strip()) and event.content_source != LessonContentSource.PLAN


def link_event_auto(event, enrollment):
    """Привязать следующую свободную тему. Возвращает пункт плана или None."""
    from .lesson_plan_content_sync import LessonLearningPlanSyncService
    from .plan_sync import PlanSyncService

    item = PlanSyncService.get_next_plan_item(enrollment, exclude_event=event)
    if item is None:
        return None
    PlanSyncService.link_event_to_plan(event, item, overwrite_topic=True)
    event.refresh_from_db()
    if event.lesson_plan_item_id != item.pk:
        return None
    LessonLearningPlanSyncService._copy_item_fields_to_event(event, item, force_fields=COPY_FIELDS)
    LessonLearningPlanSyncService._sync_plan_materials_onto_event(event, item)
    event.content_source = LessonContentSource.PLAN
    event.plan_synced_at = timezone.now()
    event.plan_item_auto = True
    event.save(update_fields=[*COPY_FIELDS, "content_source", "plan_synced_at", "plan_item_auto", "updated_at"])
    return item


class _DryRun(Exception):
    pass


def fill_topicless(*, teacher_id=None, enrollment=None, event_ids=None, dry_run=False, now=None, log=None):
    """Идемпотентно заполнить будущие занятия без темы. dry_run — то же в откатываемой транзакции."""
    changes = [] if log is None else log
    if dry_run:
        try:
            with transaction.atomic():
                _fill(changes, teacher_id, enrollment, event_ids, now, True)
                raise _DryRun
        except _DryRun:
            pass
        return changes
    _fill(changes, teacher_id, enrollment, event_ids, now, False)
    return changes


def _fill(changes, teacher_id, enrollment, event_ids, now, dry_run):
    from .plan_schedule import get_active_enrollment

    qs = candidate_events(teacher_id=teacher_id, enrollment=enrollment, now=now)
    if event_ids is not None:
        qs = qs.filter(pk__in=list(event_ids))
    with autolink_guard():
        for event in list(qs.select_related("owner", "student", "group")):
            if _has_manual_topic(event):
                continue
            enr = get_active_enrollment(event)
            if enr is None or enr.status != EnrollmentStatus.ACTIVE:
                continue
            if enrollment is not None and enr.pk != enrollment.pk:
                continue
            try:
                with transaction.atomic():
                    item = link_event_auto(event, enr)
            except Exception:
                logger.exception("autolink failed event=%s", event.pk)
                continue
            if item is None:
                continue
            changes.append({
                "event_id": event.pk,
                "teacher_id": event.owner_id,
                "starts_at": event.starts_at.isoformat(),
                "enrollment_id": enr.pk,
                "plan_id": enr.plan_id,
                "item_id": item.pk,
                "topic": (item.topic or item.title or "")[:80],
                "dry_run": dry_run,
            })


def shift_after_cancel(event, *, now=None):
    """r43: отмена → reflow (темы будущих автоуроков сдвигаются назад по порядку)."""
    return reflow_for_event(event)


def schedule_fill_on_commit(**kwargs):
    if autolink_running():
        return

    def _run():
        try:
            fill_topicless(**kwargs)
        except Exception:
            logger.exception("autolink on_commit failed %s", kwargs)

    transaction.on_commit(_run)


# --- r43: reflow — хронологический порядок тем для автоуроков ----------------

FREE_HOLDER_STATUSES = (ScheduleEvent.Status.CANCELLED, ScheduleEvent.Status.SKIPPED)


def _audience_q(enrollment):
    if enrollment.group_id:
        return models_q(group_id=enrollment.group_id)
    return models_q(student_id=enrollment.student_id)


def reflow_plan_state(enrollment, *, now=None):
    """Желаемое распределение: (events, pool, desired{event_pk: item|None})."""
    from .plan_schedule import get_active_enrollment, plan_start_order_for_enrollment
    from .plan_sync import PlanSyncService

    now = now or timezone.now()
    plan = enrollment.plan
    items = list(plan.items.order_by("order", "id"))
    base = ScheduleEvent.objects.filter(owner_id=enrollment.teacher_id).filter(_audience_q(enrollment))
    future_active = base.filter(
        starts_at__gt=now, status__in=ACTIVE_EVENT_STATUSES, event_type__in=LESSON_TYPES, plan_sync_enabled=True,
    )
    auto = list(future_active.filter(plan_item_auto=True, lesson_plan_item__plan_id=plan.pk))
    topicless = [
        ev for ev in future_active.filter(lesson_plan_item__isnull=True).select_related("owner")
        if not _has_manual_topic(ev) and (lambda e: e is not None and e.pk == enrollment.pk)(get_active_enrollment(ev))
    ]
    events = sorted({ev.pk: ev for ev in auto + topicless}.values(), key=lambda e: (e.starts_at, e.pk))
    flow_ids = {ev.pk for ev in events}

    held = set(
        ScheduleEvent.objects.filter(lesson_plan_item__plan_id=plan.pk)
        .exclude(pk__in=flow_ids).exclude(status__in=FREE_HOLDER_STATUSES)
        .values_list("lesson_plan_item_id", flat=True)
    )
    for item in items:
        sev = item.scheduled_event_id
        if sev and sev not in flow_ids:
            st = ScheduleEvent.objects.filter(pk=sev).values_list("status", flat=True).first()
            if st is not None and st not in FREE_HOLDER_STATUSES:
                held.add(item.pk)
    start_order = plan_start_order_for_enrollment(enrollment, items)
    min_order = items[0].order if items else 0
    pool = [
        it for it in items
        if it.status not in PlanSyncService.TERMINAL_ITEM
        and it.pk not in held
        and (start_order <= min_order or it.order >= start_order)
    ]
    desired = {}
    for idx, ev in enumerate(events):
        desired[ev.pk] = pool[idx] if idx < len(pool) else None
    return events, pool, desired


def reflow_enrollment(enrollment, *, now=None, dry_run=False, log=None):
    """Идемпотентно расставить темы будущим автоурокам по порядку. Без уведомлений."""
    from .lesson_plan_content_sync import LessonLearningPlanSyncService
    from .models import LessonPlanItem
    from .plan_sync import PlanSyncService

    changes = [] if log is None else log
    events, _pool, desired = reflow_plan_state(enrollment, now=now)
    todo = [ev for ev in events if (desired[ev.pk].pk if desired[ev.pk] else None) != ev.lesson_plan_item_id]
    # Тема без нового занятия: оставляем автоуроку текущую, только если её нет в пуле (не трогаем лишнее).
    todo = [ev for ev in todo if not (desired[ev.pk] is None and ev.lesson_plan_item_id is None)]
    for ev in todo:
        new = desired[ev.pk]
        changes.append({
            "event_id": ev.pk, "teacher_id": ev.owner_id, "enrollment_id": enrollment.pk,
            "plan_id": enrollment.plan_id, "starts_at": ev.starts_at.isoformat(),
            "auto": bool(ev.plan_item_auto), "from_item": ev.lesson_plan_item_id,
            "to_item": new.pk if new else None,
            "to_topic": ((new.topic or new.title) if new else "")[:80], "dry_run": dry_run,
        })
    if dry_run or not todo:
        return changes
    with autolink_guard(), transaction.atomic():
        ids = [ev.pk for ev in todo]
        list(ScheduleEvent.objects.select_for_update(of=("self",)).filter(pk__in=ids).order_by("pk"))
        # 1) снять старые связи у меняющихся автоуроков (update — без сигналов и уведомлений)
        LessonPlanItem.objects.filter(scheduled_event_id__in=ids).update(scheduled_event=None, updated_at=timezone.now())
        ScheduleEvent.objects.filter(pk__in=ids).update(lesson_plan_item=None)
        # 2) привязать заново по порядку
        for ev in todo:
            ev.refresh_from_db()
            new = desired[ev.pk]
            if new is None:
                ScheduleEvent.objects.filter(pk=ev.pk).update(plan_item_auto=False, topic="", updated_at=timezone.now())
                continue
            PlanSyncService.link_event_to_plan(ev, new, overwrite_topic=True, force=True)
            ev.refresh_from_db()
            LessonLearningPlanSyncService._copy_item_fields_to_event(ev, new, force_fields=COPY_FIELDS)
            LessonLearningPlanSyncService._sync_plan_materials_onto_event(ev, new)
            ev.content_source = LessonContentSource.PLAN
            ev.plan_synced_at = timezone.now()
            ev.plan_item_auto = True
            ev.save(update_fields=[*COPY_FIELDS, "content_source", "plan_synced_at", "plan_item_auto", "updated_at"])
    return changes


def reflow_all(*, teacher_id=None, dry_run=False, now=None):
    changes = []
    qs = LessonPlanEnrollment.objects.filter(status=EnrollmentStatus.ACTIVE).select_related("plan")
    if teacher_id:
        qs = qs.filter(teacher_id=teacher_id)
    for enr in qs.order_by("pk"):
        try:
            reflow_enrollment(enr, now=now, dry_run=dry_run, log=changes)
        except Exception:
            logger.exception("reflow failed enrollment=%s", enr.pk)
    return changes


def reflow_for_event(event):
    from .plan_schedule import get_active_enrollment

    enr = get_active_enrollment(event)
    if enr is None and event.lesson_plan_item_id:
        enr = LessonPlanEnrollment.objects.filter(
            plan_id=event.lesson_plan_item.plan_id, status=EnrollmentStatus.ACTIVE,
        ).filter(_audience_q_event(event)).first()
    if enr is not None and enr.status == EnrollmentStatus.ACTIVE:
        return reflow_enrollment(enr)
    return []


def _audience_q_event(event):
    if event.group_id:
        return models_q(group_id=event.group_id)
    return models_q(student_id=event.student_id)


def schedule_reflow_on_commit(*, enrollment_ids=None, event_id=None, plan_id=None):
    if autolink_running():
        return
    key = (tuple(sorted(enrollment_ids or [])), event_id, plan_id)

    def _run():
        try:
            if event_id is not None:
                ev = ScheduleEvent.objects.filter(pk=event_id).select_related("lesson_plan_item").first()
                if ev is not None:
                    reflow_for_event(ev)
            ids = list(enrollment_ids or [])
            if plan_id is not None:
                ids += list(LessonPlanEnrollment.objects.filter(
                    plan_id=plan_id, status=EnrollmentStatus.ACTIVE).values_list("pk", flat=True))
            for enr in LessonPlanEnrollment.objects.filter(pk__in=ids, status=EnrollmentStatus.ACTIVE):
                reflow_enrollment(enr)
        except Exception:
            logger.exception("reflow on_commit failed key=%s", key)

    transaction.on_commit(_run)
