"""Map schedule events to lesson plan items (one lesson → one plan item)."""

from django.db.models import Q
from django.utils import timezone

from .choices import EnrollmentStatus, PlanItemStatus
from .journal_models import AttendanceStatus
from .models import LessonPlanEnrollment, ScheduleEvent

PLAN_CANCEL_SHIFT = "shift"
PLAN_CANCEL_SKIP = "skip"

# Посещаемость, которая для плана считается проведённым занятием:
# присутствовал, опоздал, ушёл раньше, часть урока, техническая причина.
CONDUCTED_FOR_PLAN_ATTENDANCE = frozenset({
    AttendanceStatus.PRESENT,
    AttendanceStatus.LATE,
    AttendanceStatus.LEFT_EARLY,
    AttendanceStatus.PARTIAL,
    AttendanceStatus.TECHNICAL_ISSUE,
})


def enrollment_start_date(enrollment):
    if enrollment.start_date:
        return enrollment.start_date
    return timezone.localtime(enrollment.created_at).date()


def event_local_date(event):
    starts = getattr(event, "starts_at", None)
    if starts is None:
        return None
    if timezone.is_aware(starts):
        starts = timezone.localtime(starts)
    return starts.date()


def linked_schedule_event_for_item(item):
    """Событие расписания, по которому у темы есть дата занятия."""
    event = getattr(item, "scheduled_event", None) if getattr(item, "scheduled_event_id", None) else None
    if event is not None and getattr(event, "lesson_plan_item_id", None) == item.id:
        return event
    linked = getattr(item, "schedule_events_linked", None)
    if linked is None:
        return None
    rows = linked.all() if hasattr(linked, "all") else linked
    for ev in rows:
        if getattr(ev, "lesson_plan_item_id", None) == item.id:
            return ev
    return None


def plan_item_is_passed(item, *, now=None):
    """
    Тема пройдена по дате занятия: прошедшая дата считается,
    будущая — нет, даже если статус в плане сбился на completed.
    Без даты остаётся статус completed.
    """
    if item.status == PlanItemStatus.SKIPPED:
        return False
    now = now or timezone.now()
    today = timezone.localtime(now).date() if timezone.is_aware(now) else now.date()

    event = linked_schedule_event_for_item(item)
    starts_at = getattr(event, "starts_at", None) if event is not None else None
    if starts_at is not None:
        return starts_at <= now

    scheduled = getattr(item, "scheduled_date", None)
    if scheduled:
        if scheduled < today:
            return True
        if scheduled > today:
            return False
        return item.status == PlanItemStatus.COMPLETED

    return item.status == PlanItemStatus.COMPLETED


def plan_passed_items_count(plan, *, now=None):
    return sum(1 for item in plan.items.all() if plan_item_is_passed(item, now=now))


def get_active_enrollment(event):
    qs = LessonPlanEnrollment.objects.filter(
        teacher=event.owner,
    ).exclude(
        status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED],
    )
    if event.student_id:
        qs = qs.filter(student_id=event.student_id)
        if event.student_subject_id:
            # Предмет занятия → enrollment этого предмета, иначе старый без предмета.
            subject_qs = qs.filter(student_subject_id=event.student_subject_id)
            if subject_qs.exists():
                qs = subject_qs
            else:
                qs = qs.filter(student_subject__isnull=True)
        else:
            # Старые уроки без предмета не должны «прилипать» к новому
            # subject-specific плану — иначе ломается тема/материалы в календаре.
            unbound = qs.filter(student_subject__isnull=True)
            if unbound.exists():
                qs = unbound
            else:
                event_date = event_local_date(event)
                if event_date:
                    dated = qs.filter(plan__items__scheduled_date=event_date).distinct()
                    if dated.exists():
                        qs = dated
    elif event.group_id:
        qs = qs.filter(group_id=event.group_id)
    else:
        return None
    qs = qs.select_related("plan", "student_subject").prefetch_related(
        "plan__items__materials",
        "plan__items__attached_interactives",
        "plan__items__homework_materials",
        "plan__items__homework_interactives",
        "plan__items__linked_lesson",
        "plan__items__plan",
    ).order_by("-created_at")
    matches = list(qs[:3])
    if len(matches) > 1:
        import logging
        logging.getLogger("cabinet.plan_sync").warning(
            "Multiple active plans detected teacher=%s student=%s subject=%s ids=%s",
            event.owner_id,
            event.student_id,
            event.student_subject_id,
            [m.pk for m in matches],
        )
    return matches[0] if matches else None


def events_for_enrollment(enrollment, owner):
    qs = ScheduleEvent.objects.filter(owner=owner)
    if enrollment.student_id:
        by_student = Q(student_id=enrollment.student_id)
        if enrollment.student_subject_id:
            # Уроки этого предмета + уже связанные с планом.
            by_audience = by_student & Q(student_subject_id=enrollment.student_subject_id)
            # Старый урок без предмета: подхватываем, если это единственный
            # активный план ученика или дата совпадает с датой в плане.
            other_subject_plans = LessonPlanEnrollment.objects.filter(
                teacher_id=enrollment.teacher_id,
                student_id=enrollment.student_id,
                student_subject__isnull=False,
            ).exclude(pk=enrollment.pk).exclude(
                status__in=[EnrollmentStatus.COMPLETED, EnrollmentStatus.CANCELLED],
            ).exists()
            unbound = by_student & Q(student_subject__isnull=True)
            if not other_subject_plans:
                by_audience = by_audience | unbound
            else:
                dated = list(
                    enrollment.plan.items.exclude(scheduled_date=None)
                    .values_list("scheduled_date", flat=True)
                )
                if dated:
                    by_audience = by_audience | (unbound & Q(starts_at__date__in=dated))
        else:
            by_audience = by_student & Q(student_subject__isnull=True)
        already_linked = by_student & Q(lesson_plan_item__plan_id=enrollment.plan_id)
        qs = qs.filter(by_audience | already_linked).distinct()
    elif enrollment.group_id:
        qs = qs.filter(
            Q(group_id=enrollment.group_id)
            | Q(lesson_plan_item__plan_id=enrollment.plan_id, group_id=enrollment.group_id)
        ).distinct()
    else:
        return ScheduleEvent.objects.none()

    start = enrollment_start_date(enrollment)
    if start:
        qs = qs.filter(starts_at__date__gte=start)
    return qs.order_by("starts_at", "pk")


def plan_start_order_for_enrollment(enrollment, items=None):
    """
    С какого пункта плана идём. Нумерация может быть с 0 или с 1.
    Дефолт enrollment.plan_start_order=1 при пунктах 0,1,2… значит «с начала»,
    а не «пропустить нулевой».
    """
    if items is None:
        items = list(enrollment.plan.items.order_by("order", "id"))
    raw = getattr(enrollment, "plan_start_order", None)
    min_order = items[0].order if items else 0
    if raw is None:
        return min_order
    start_order = int(raw)
    if start_order == 1 and min_order == 0:
        return 0
    return start_order


def plan_items_for_enrollment(enrollment):
    items = list(enrollment.plan.items.order_by("order", "id"))
    start_order = plan_start_order_for_enrollment(enrollment, items)
    min_order = items[0].order if items else 0
    if start_order > min_order:
        filtered = [item for item in items if item.order >= start_order]
        if filtered:
            items = filtered
        elif start_order <= len(items):
            # 1-based fallback: «начать с урока N»
            items = items[max(0, start_order - 1):]
    return items


def active_plan_slot_events(enrollment, owner, *, exclude_event=None):
    """Все незакрытые занятия плана: прошедшие и будущие, без отменённых."""
    events = [
        ev for ev in events_for_enrollment(enrollment, owner)
        if getattr(ev, "plan_sync_enabled", True)
        and ev.status not in (
            ScheduleEvent.Status.CANCELLED,
            ScheduleEvent.Status.DRAFT,
        )
    ]
    if exclude_event is not None and getattr(exclude_event, "pk", None):
        events = [ev for ev in events if ev.pk != exclude_event.pk]
    return unique_plan_slot_events(events)


def plan_slots_exhausted(enrollment, owner, *, exclude_event=None):
    """В расписании уже не меньше занятий, чем тем в плане — новую тему не берём с начала."""
    items = plan_items_for_enrollment(enrollment)
    if not items:
        return True
    return len(active_plan_slot_events(enrollment, owner, exclude_event=exclude_event)) >= len(items)


def attendance_statuses_by_event(event_ids, student_id=None):
    """event_id → список отмеченных статусов посещаемости (без not_marked)."""
    if not event_ids:
        return {}
    from .journal_models import StudentLessonRecord

    qs = StudentLessonRecord.objects.filter(
        journal__schedule_event_id__in=list(event_ids),
    ).exclude(attendance_status=AttendanceStatus.NOT_MARKED)
    if student_id:
        qs = qs.filter(student_id=student_id)
    mapping = {}
    for event_id, status in qs.values_list("journal__schedule_event_id", "attendance_status"):
        mapping.setdefault(event_id, []).append(status)
    return mapping


def event_consumed_plan_topic(event, *, student_id=None, attendance_statuses=None, journal=None):
    """
    Занятие съело слот плана: проведено по журналу или явно завершено.
    Прошедшее без отметки занятие слот не съедает.
    """
    if not getattr(event, "plan_sync_enabled", True):
        return False
    if event.status == ScheduleEvent.Status.CANCELLED:
        return False

    marked = attendance_statuses
    if marked is None:
        mapping = attendance_statuses_by_event([event.pk], student_id=student_id)
        marked = mapping.get(event.pk) or []
    if marked:
        return any(status in CONDUCTED_FOR_PLAN_ATTENDANCE for status in marked)

    if journal is not None:
        from .journal_models import JournalStatus

        if journal.status == JournalStatus.CANCELLED:
            return False
        if journal.status == JournalStatus.COMPLETED and (journal.actual_topic or "").strip():
            if event.starts_at >= timezone.now() and event.status not in (
                ScheduleEvent.Status.DONE,
                ScheduleEvent.Status.COMPLETED,
            ):
                return False
            return True

    return event.status in (
        ScheduleEvent.Status.DONE,
        ScheduleEvent.Status.COMPLETED,
    )


def event_is_upcoming_for_plan(event, *, now=None):
    """Будущее активное занятие, на которое можно повесить следующую тему."""
    if not getattr(event, "plan_sync_enabled", True):
        return False
    if event.status in (
        ScheduleEvent.Status.CANCELLED,
        ScheduleEvent.Status.DONE,
        ScheduleEvent.Status.COMPLETED,
        ScheduleEvent.Status.DRAFT,
    ):
        return False
    now = now or timezone.now()
    event_date = event_local_date(event)
    if event_date is None:
        return event.starts_at >= now
    today = timezone.localtime(now).date() if timezone.is_aware(now) else now.date()
    # Занятие на сегодня остаётся слотом плана, даже если время уже прошло —
    # иначе тема «пропадает», хотя урок стоит в расписании на эту дату.
    return event_date >= today


def plan_slot_key(event):
    """Ключ слота: одно время у одного ученика/группы = один урок."""
    starts = event.starts_at
    if starts is None:
        return ("pk", event.pk)
    if timezone.is_aware(starts):
        starts = timezone.localtime(starts)
    stamped = starts.replace(second=0, microsecond=0)
    return (stamped, event.student_id, event.group_id)


def unique_plan_slot_events(events):
    """
    Схлопывает дубли карточек на одно и то же время.
    В карточке уже выбранный пункт плана важнее «пустого» дубля.
    """
    chosen = {}
    order = []
    for ev in events:
        key = plan_slot_key(ev)
        prev = chosen.get(key)
        if prev is None:
            chosen[key] = ev
            order.append(key)
            continue
        if prev.lesson_plan_item_id is None and ev.lesson_plan_item_id:
            chosen[key] = ev
    return [chosen[key] for key in order]


def plan_slot_index(event, enrollment):
    """
    0-based plan slot for this event.

    Слот занимают фактически проведённые занятия и будущие активные.
    Отмена со сдвигом и неявка слот не занимают; skip — через SKIPPED-пункты.
    """
    now = timezone.now()
    events = unique_plan_slot_events([
        ev for ev in events_for_enrollment(enrollment, event.owner)
        if getattr(ev, "plan_sync_enabled", True)
    ])
    attendance_map = attendance_statuses_by_event(
        [ev.pk for ev in events],
        student_id=enrollment.student_id,
    )
    slots = 0
    for ev in events:
        if ev.pk == event.pk:
            return slots
        if event_consumed_plan_topic(
            ev,
            student_id=enrollment.student_id,
            attendance_statuses=attendance_map.get(ev.pk) or [],
        ):
            slots += 1
        elif event_is_upcoming_for_plan(ev, now=now):
            slots += 1
    return None


def plan_item_by_slot(event, enrollment):
    plan_items = plan_items_for_enrollment(enrollment)
    if not plan_items:
        return None, None

    index = plan_slot_index(event, enrollment)
    if index is None:
        return None, None

    completed_event = event.status in (
        ScheduleEvent.Status.DONE,
        ScheduleEvent.Status.COMPLETED,
    )
    i = index
    while 0 <= i < len(plan_items):
        item = plan_items[i]
        lesson_number = item.order if item.order is not None else (i + 1)
        linked_to_self = (
            item.scheduled_event_id == event.pk
            or event.lesson_plan_item_id == item.id
        )
        if item.status in (PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED):
            if linked_to_self or completed_event:
                return item, lesson_number
            i += 1
            continue
        return item, lesson_number
    return None, None


def plan_item_display_number(item):
    """Номер темы в карточке: 1, 2, 3… по порядку плана, даже если order с нуля."""
    if item is None:
        return None
    items = list(item.plan.items.order_by("order", "id"))
    for index, row in enumerate(items, start=1):
        if row.id == item.id:
            return index
    return item.order if item.order else 1


def plan_item_matching_event_date(event):
    """Пункт плана, который в плане стоит на эту дату и время."""
    if not getattr(event, "plan_sync_enabled", True):
        return None
    enrollment = get_active_enrollment(event)
    if enrollment is None:
        return None
    slot = plan_slot_key(event)
    event_date = event_local_date(event)
    date_match = None
    for item in plan_items_for_enrollment(enrollment):
        if item.status in (PlanItemStatus.COMPLETED, PlanItemStatus.SKIPPED):
            continue
        scheduled = item.scheduled_event
        if scheduled is not None and plan_slot_key(scheduled) == slot:
            return item
        if (
            date_match is None
            and event_date
            and item.scheduled_date == event_date
        ):
            date_match = item
    return date_match


def resolve_plan_item_for_event(event):
    """
    Тема карточки урока = пункт плана на эту дату.

    Сначала явный выбор в карточке, если он не противоречит дате в плане.
    Иначе пункт, у которого в плане стоит это же время.
    """
    def _result(item):
        if item is None:
            return None, None
        return item, plan_item_display_number(item)

    if event.lesson_plan_item_id:
        item = event.lesson_plan_item
        if item is not None:
            scheduled = item.scheduled_event
            if (
                scheduled is None
                or scheduled.pk == event.pk
                or plan_slot_key(scheduled) == plan_slot_key(event)
            ):
                return _result(item)

    dated = plan_item_matching_event_date(event)
    if dated is not None:
        return _result(dated)

    linked = list(event.plan_items.order_by("order", "id")[:2])
    if len(linked) == 1:
        return _result(linked[0])
    if len(linked) > 1 and event.lesson_plan_item_id:
        for item in linked:
            if item.id == event.lesson_plan_item_id:
                return _result(item)

    if event.series_id and event.series.lesson_plan_item_id:
        item = event.series.lesson_plan_item
        if item is not None and item.status not in (
            PlanItemStatus.COMPLETED,
            PlanItemStatus.SKIPPED,
        ):
            if item.scheduled_event_id in (None, event.pk):
                occupied = (
                    ScheduleEvent.objects.filter(lesson_plan_item_id=item.id)
                    .exclude(pk=event.pk)
                    .exclude(
                        status__in=[
                            ScheduleEvent.Status.CANCELLED,
                            ScheduleEvent.Status.COMPLETED,
                            ScheduleEvent.Status.DONE,
                        ]
                    )
                    .exists()
                )
                if not occupied:
                    return _result(item)

    return None, None


def explicit_plan_item_for_event(event):
    """
    Пункт плана, явно привязанный к занятию (не слот enrollment).
    Нужен для записи материалов: слот нельзя мутировать для уроков «вне плана».
    """
    linked = list(event.plan_items.order_by("order", "id")[:2])
    if len(linked) == 1:
        item = linked[0]
        return item, item.order or None
    if len(linked) > 1:
        # Неоднозначная явная связь — берём ту, что указана на событии, иначе первую.
        if event.lesson_plan_item_id:
            for item in linked:
                if item.id == event.lesson_plan_item_id:
                    return item, item.order or None
        item = linked[0]
        return item, item.order or None

    if event.lesson_plan_item_id:
        item = event.lesson_plan_item
        return item, item.order or None

    if event.series_id and event.series.lesson_plan_item_id:
        item = event.series.lesson_plan_item
        return item, item.order or None

    return None, None


AUTO_MATERIALS_PLAN_DESCRIPTION = "Автосоздано для материалов занятия"


def ensure_event_plan_item(event, *, teacher=None):
    """
    Гарантирует пункт плана для прикрепления материалов/ДЗ к занятию.

    Только явная связь событие↔пункт (или создание черновика «Материалы: …»).
    Слот enrollment НЕ используется — иначе материалы урока «вне плана»
    попадают в настоящий план ученика.
    """
    from .choices import Direction, ExamType, PlanStatus, PlanSubject
    from .models import LessonPlan, LessonPlanItem

    teacher = teacher or event.owner
    item, lesson_number = explicit_plan_item_for_event(event)
    if item is not None:
        update_fields = []
        if event.lesson_plan_item_id != item.id:
            event.lesson_plan_item = item
            update_fields.append("lesson_plan_item")
        if item.scheduled_event_id != event.pk:
            item.scheduled_event = event
            item.save(update_fields=["scheduled_event", "updated_at"])
        if update_fields:
            event.save(update_fields=update_fields)
        return item, lesson_number if lesson_number is not None else item.order

    plan = LessonPlan.objects.create(
        teacher=teacher,
        title=f"Материалы: {(event.title or 'Урок').strip()}"[:255],
        description=AUTO_MATERIALS_PLAN_DESCRIPTION,
        direction=Direction.OTHER,
        subject=PlanSubject.INFORMATICS,
        exam_type=ExamType.NONE,
        status=PlanStatus.DRAFT,
        lessons_count=1,
    )
    item = LessonPlanItem.objects.create(
        plan=plan,
        order=1,
        title=(event.title or "Урок").strip()[:255] or "Урок",
        topic=(event.topic or "").strip()[:255],
        scheduled_event=event,
    )
    event.lesson_plan_item = item
    event.save(update_fields=["lesson_plan_item"])
    return item, 1


def mark_plan_item_skipped(plan_item, event=None):
    plan_item.status = PlanItemStatus.SKIPPED
    update_fields = ["status", "updated_at"]
    if event and plan_item.scheduled_event_id == event.pk:
        plan_item.scheduled_event = None
        update_fields.append("scheduled_event")
    plan_item.save(update_fields=update_fields)


def apply_plan_cancel_action(event, plan_cancel_action):
    """Apply plan topic shift/skip when a lesson is cancelled."""
    action = (plan_cancel_action or PLAN_CANCEL_SHIFT).strip().lower()
    if action not in (PLAN_CANCEL_SHIFT, PLAN_CANCEL_SKIP):
        action = PLAN_CANCEL_SHIFT

    event.plan_cancel_action = action if action == PLAN_CANCEL_SKIP else ""
    event.save(update_fields=["plan_cancel_action", "updated_at"])

    if action == PLAN_CANCEL_SKIP:
        plan_item, _ = resolve_plan_item_for_event(event)
        if plan_item:
            mark_plan_item_skipped(plan_item, event)

    return action
