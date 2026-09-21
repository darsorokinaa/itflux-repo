"""Спокойная сводка для главного экрана учителя.

Считает только реальные действия: проведённые занятия, проверку работ,
решённые учениками задания и использованные материалы. Не использует
вход в кабинет как серию.

Сэкономленное время — нормированная оценка по фиксированным коэффициентам,
не замер секундомера. Сдача домашней — только административные 2 минуты:
если преподаватель потом проверяет решение сам, время проверки не прибавляется.
Автопроверка добавляет 30 секунд на каждый ответ, который пометила платформа.
Готовый материал, интерактив и полноценный урок считаются разными нормами.
Факт проведения урока сам по себе ничего не экономит.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta

from django.utils import timezone

from .choices import HomeworkStatus, MaterialType, ReviewSourceType, ReviewStatus, ScheduleMaterialSource
from .dashboard_notes import DAILY_NOTES, note_candidates
from .models import (
    Homework,
    HomeworkSubmission,
    InteractiveAttempt,
    ReviewItem,
    ScheduleEvent,
    ScheduleEventMaterial,
    AIRequestLog,
    EventReminderLog,
)

LESSON_TYPES = (
    ScheduleEvent.EventType.GROUP,
    ScheduleEvent.EventType.INDIVIDUAL,
    ScheduleEvent.EventType.INDIVIDUAL_LESSON,
    ScheduleEvent.EventType.GROUP_LESSON,
)
SKIPPED_STATUSES = (
    ScheduleEvent.Status.DRAFT,
    ScheduleEvent.Status.MOVED,
)
CANCELLED = ScheduleEvent.Status.CANCELLED

TIME_SAVED_SECONDS = {
    "homework_submitted": 120,
    "task_auto_checked": 30,
    "ready_material_used": 720,
    "interactive_used": 1320,
    "ready_lesson_used": 1800,
    "variant_generated": 780,
    "ai_worksheet_created": 1500,
    "automatic_lesson_reminder": 60,
    "student_booking": 210,
    "payment_recorded_automatically": 150,
}

TIME_SAVED_LABELS = {
    "homework_submitted": "ДЗ",
    "task_auto_checked": "Автопроверка",
    "ready_material_used": "Готовые материалы",
    "interactive_used": "Интерактив",
    "ready_lesson_used": "Готовый урок",
    "variant_generated": "Генератор",
    "ai_worksheet_created": "Рабочий лист ИИ",
    "automatic_lesson_reminder": "Напоминание",
    "student_booking": "Бронирование",
    "payment_recorded_automatically": "Оплата",
}

SAVED_TIME_NOTE = (
    "Оценка основана на среднем времени выполнения аналогичных преподавательских задач вручную. "
    "Фактическое время может отличаться."
)

AI_WORKSHEET_INTENTS = (
    "homework_generation",
    "lesson_generation",
    "test_generation",
)

LESSON_MILESTONES = (1, 10, 50, 100)
TASK_MILESTONES = (100, 500, 1000)
WEEKDAY_NAMES = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)
LOOKBACK_DAYS = 90
FRESH_DAYS = 7
RARE_FRESH_DAYS = 14
STREAK_GAP_DAYS = 3


def plural_ru(n, one, few, many) -> str:
    abs_n = abs(int(n)) % 100
    n1 = abs_n % 10
    if 10 < abs_n < 20:
        return many
    if n1 == 1:
        return one
    if 2 <= n1 <= 4:
        return few
    return many


def tasks_from_payload(payload) -> int:
    """Сколько заданий ученик реально закрыл в сохранённом результате."""
    if not isinstance(payload, dict):
        return 0
    checked = payload.get("checked")
    if isinstance(checked, dict) and checked:
        return len(checked)
    count = payload.get("checked_count")
    if isinstance(count, int) and count > 0:
        return count
    try:
        count = int(count) if count not in (None, "") else 0
    except (TypeError, ValueError):
        count = 0
    if count > 0:
        return count
    tasks = payload.get("tasks")
    if isinstance(tasks, list):
        return sum(1 for row in tasks if isinstance(row, dict) and row.get("ok") is not None)
    return 0


def auto_checked_task_count(payload) -> int:
    """Только задания, которые платформа сама пометила верными или неверными.

    Голый checked_count не считается: это может быть просто объём работы ученика.
    """
    if not isinstance(payload, dict):
        return 0
    checked = payload.get("checked")
    if isinstance(checked, dict) and checked:
        return sum(1 for value in checked.values() if isinstance(value, bool))
    tasks = payload.get("tasks")
    if isinstance(tasks, list):
        return sum(1 for row in tasks if isinstance(row, dict) and isinstance(row.get("ok"), bool))
    return 0


def saved_seconds(**counts) -> int:
    total = 0
    for key, rate in TIME_SAVED_SECONDS.items():
        total += int(counts.get(key) or 0) * rate
    return total


def bucket_saved_counts(bucket: dict) -> dict:
    return {
        "homework_submitted": bucket.get("submitted_homeworks") or 0,
        "task_auto_checked": bucket.get("auto_tasks") or 0,
        "ready_material_used": bucket.get("ready_materials") or 0,
        "interactive_used": bucket.get("interactives") or 0,
        "ready_lesson_used": bucket.get("ready_lessons") or 0,
        "variant_generated": bucket.get("variants") or 0,
        "ai_worksheet_created": bucket.get("ai_worksheets") or 0,
        "automatic_lesson_reminder": bucket.get("reminders") or 0,
        "student_booking": bucket.get("bookings") or 0,
        "payment_recorded_automatically": bucket.get("payments") or 0,
    }


def format_approx_saved(seconds: int) -> str:
    seconds = int(seconds or 0)
    if seconds <= 0:
        return ""
    return f"≈ {_duration_label(seconds)}"


def _duration_label(seconds: int) -> str:
    seconds = int(seconds or 0)
    if seconds <= 0:
        return "0 мин"
    minutes, secs = divmod(seconds, 60)
    if minutes >= 60 and secs == 0:
        hours, mins = divmod(minutes, 60)
        if mins == 0:
            return f"{hours} ч"
        return f"{hours} ч {mins} мин"
    if minutes == 0:
        return f"{secs} сек"
    if secs == 0:
        return f"{minutes} мин"
    return f"{minutes} мин {secs} сек"


def _rate_label(seconds: int) -> str:
    """Короткая норма для строки «2 × 12 мин»: часы не сворачиваем, половины пишем через запятую."""
    seconds = int(seconds or 0)
    if seconds <= 0:
        return "0 мин"
    if seconds < 60:
        return f"{seconds} сек"
    minutes, secs = divmod(seconds, 60)
    if secs == 0:
        return f"{minutes} мин"
    if secs == 30:
        return f"{minutes},5 мин"
    return _duration_label(seconds)


def _line_label(seconds: int) -> str:
    """Сумма строки разбивки остаётся в минутах, даже если их больше шестидесяти."""
    seconds = int(seconds or 0)
    if seconds <= 0:
        return "0 мин"
    if seconds < 60:
        return f"{seconds} сек"
    minutes, secs = divmod(seconds, 60)
    if secs == 0:
        return f"{minutes} мин"
    if secs == 30:
        return f"{minutes},5 мин"
    return _duration_label(seconds)


def summary_line(*, lessons: int, homeworks: int, tasks: int, materials: int) -> str:
    parts = [
        f"{lessons} {plural_ru(lessons, 'урок', 'урока', 'уроков')}",
        f"{homeworks} ДЗ",
        f"{tasks} {plural_ru(tasks, 'задание', 'задания', 'заданий')}",
    ]
    if materials > 0:
        parts.append(f"{materials} {plural_ru(materials, 'материал', 'материала', 'материалов')}")
    return " · ".join(parts)


def crossed_recently(total: int, recent: int, milestone: int) -> bool:
    """Порог пройден, и без недавних событий его ещё не было."""
    return total >= milestone and total - recent < milestone


def walk_streak(good: set, bad: set, today, *, max_gap: int = STREAK_GAP_DAYS) -> int:
    """Серия полезных дней. Пустые дни не рвут серию, пока пауза короткая.

    День из `bad` (например, отменённое занятие) серию обрывает.
    """
    if today in bad:
        return 0
    start = today if today in good else None
    if start is None:
        for gap in range(1, max_gap + 1):
            cand = today - timedelta(days=gap)
            if cand in bad:
                return 0
            if cand in good:
                start = cand
                break
        if start is None:
            return 0
    streak = 0
    empty_run = 0
    cursor = start
    for _ in range(LOOKBACK_DAYS):
        if cursor in bad:
            break
        if cursor in good:
            streak += 1
            empty_run = 0
        else:
            empty_run += 1
            if empty_run > max_gap:
                break
        cursor -= timedelta(days=1)
    return streak


def _aware(day, clock=None):
    value = datetime.combine(day, clock or datetime.min.time())
    if timezone.is_naive(value):
        return timezone.make_aware(value, timezone.get_current_timezone())
    return value


def _local_date(value):
    if value is None:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value, timezone.get_current_timezone())
    return timezone.localtime(value).date()


def _as_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _pending_reviews(teacher):
    from .homework_api import exclude_live_meeting_review_items, review_items_ready_to_check

    return review_items_ready_to_check(
        exclude_live_meeting_review_items(
            ReviewItem.objects.filter(teacher=teacher, status=ReviewStatus.PENDING)
        )
    )


def _counts_in_period(name, day, today, week_start, month_start, prev_week_start) -> bool:
    if not day:
        return False
    if name == "prev":
        return prev_week_start <= day < week_start
    if name == "today":
        return day == today
    if name == "week":
        return day >= week_start
    if name == "month":
        return day >= month_start
    return False


def _empty_bucket():
    return {
        "lessons": 0,
        "homeworks": 0,
        "submitted_homeworks": 0,
        "tasks": 0,
        "auto_tasks": 0,
        "materials": 0,
        "ready_materials": 0,
        "interactives": 0,
        "ready_lessons": 0,
        "variants": 0,
        "ai_worksheets": 0,
        "reminders": 0,
        "bookings": 0,
        "payments": 0,
        "saved_seconds": 0,
        "lesson_days": Counter(),
    }


def _is_bank_material(is_public, teacher_id) -> bool:
    """Материал банка платформы, а не файл, который преподаватель принёс сам."""
    return bool(is_public) or teacher_id is None


def _uses_in_lessons(event_ids):
    """Один материал и один интерактив считаются один раз на конкретное занятие.

    Время копится только с готового контента. Свой файл преподавателя не считается
    подготовкой, которую платформа взяла на себя. Если занятие уже идёт по готовому
    уроку каталога, материалы и интерактивы этого плана отдельно не прибавляются.
    """
    materials = set()
    interactives = set()
    ready_materials = set()
    ready_interactives = set()
    ready_lessons = set()
    if not event_ids:
        return materials, interactives, ready_materials, ready_interactives, ready_lessons

    ready_lessons.update(
        ScheduleEvent.objects.filter(
            id__in=event_ids,
            lesson_plan_item__plan__is_public=True,
        ).values_list("id", flat=True)
    )
    rows = ScheduleEventMaterial.objects.filter(event_id__in=event_ids).values_list(
        "event_id",
        "material_id",
        "interactive_id",
        "source",
        "material__is_public",
        "material__teacher_id",
        "material__material_type",
    )
    pending = []
    for event_id, material_id, interactive_id, source, is_public, teacher_id, material_type in rows:
        if material_id:
            materials.add((event_id, material_id))
        elif interactive_id:
            interactives.add((event_id, interactive_id))
        if (
            material_id
            and material_type == MaterialType.LESSON
            and _is_bank_material(is_public, teacher_id)
        ):
            ready_lessons.add(event_id)
        pending.append((event_id, material_id, interactive_id, source, is_public, teacher_id, material_type))

    for event_id, material_id, interactive_id, source, is_public, teacher_id, material_type in pending:
        bundled = event_id in ready_lessons and source == ScheduleMaterialSource.LEARNING_PLAN
        if bundled:
            continue
        if interactive_id:
            ready_interactives.add((event_id, interactive_id))
        elif (
            material_id
            and material_type != MaterialType.LESSON
            and _is_bank_material(is_public, teacher_id)
        ):
            ready_materials.add((event_id, material_id))
    return materials, interactives, ready_materials, ready_interactives, ready_lessons


def _add_dated(buckets, day, field, today, week_start, month_start, prev_week_start, amount=1):
    if not day or amount <= 0:
        return
    for name in buckets:
        if _counts_in_period(name, day, today, week_start, month_start, prev_week_start):
            buckets[name][field] += amount


def _count_extra_savings(teacher, buckets, *, today, week_start, month_start, prev_week_start, lookback):
    """События вне карточки занятия: генератор, длинная генерация ИИ, напоминания, запись ученика."""
    period = dict(
        today=today,
        week_start=week_start,
        month_start=month_start,
        prev_week_start=prev_week_start,
    )
    try:
        from Generator.Generator.models import Variant
    except ImportError:
        Variant = None
    if Variant is not None:
        for created_at in Variant.objects.filter(
            owner_teacher=teacher,
            created_at__gte=lookback,
        ).values_list("created_at", flat=True):
            _add_dated(buckets, _local_date(created_at), "variants", **period)

    for created_at in AIRequestLog.objects.filter(
        teacher=teacher,
        status=AIRequestLog.RequestStatus.SUCCESS,
        intent__in=AI_WORKSHEET_INTENTS,
        operation_type__in=(
            AIRequestLog.OperationType.TEXT_LONG_GENERATION,
            AIRequestLog.OperationType.TEXT_BULK_GENERATION,
        ),
        created_at__gte=lookback,
    ).values_list("created_at", flat=True):
        _add_dated(buckets, _local_date(created_at), "ai_worksheets", **period)

    reminded = {}
    for event_id, recipient_id, sent_at in EventReminderLog.objects.filter(
        event__owner=teacher,
        sent_at__gte=lookback,
    ).exclude(recipient_id=teacher.id).values_list("event_id", "recipient_id", "sent_at"):
        key = (event_id, recipient_id)
        previous = reminded.get(key)
        if previous is None or sent_at < previous:
            reminded[key] = sent_at
    for sent_at in reminded.values():
        _add_dated(buckets, _local_date(sent_at), "reminders", **period)

    from .availability_models import TeacherBooking

    for booked_at in TeacherBooking.objects.filter(
        teacher=teacher,
        source=TeacherBooking.Source.SELF_SERVICE,
        booked_at__gte=lookback,
    ).values_list("booked_at", flat=True):
        _add_dated(buckets, _local_date(booked_at), "bookings", **period)


def _difficult(record) -> bool:
    if record.get("requires_attention"):
        return True
    if (record.get("difficulties") or "").strip():
        return True
    payload = record.get("variant_result") if isinstance(record.get("variant_result"), dict) else {}
    checked = _as_int(payload.get("checked_count"))
    correct = _as_int(payload.get("correct_count"))
    if checked >= 3 and correct / checked < 0.6:
        return True
    tasks = payload.get("tasks")
    if isinstance(tasks, list):
        wrong = sum(1 for row in tasks if isinstance(row, dict) and row.get("ok") is False)
        if wrong >= 3:
            return True
    return False


def _wrong_count(record) -> int:
    payload = record.get("variant_result") if isinstance(record.get("variant_result"), dict) else {}
    checked = _as_int(payload.get("checked_count"))
    correct = _as_int(payload.get("correct_count"))
    if checked:
        return max(0, checked - correct)
    tasks = payload.get("tasks")
    if isinstance(tasks, list):
        return sum(1 for row in tasks if isinstance(row, dict) and row.get("ok") is False)
    if _difficult(record):
        return 1
    return 0


def _topic_of(record) -> str:
    return (record.get("journal__actual_topic") or record.get("journal__planned_topic") or "").strip()


def _struggle(records, *, today) -> dict | None:
    cutoff = today - timedelta(days=45)
    by_student = defaultdict(list)
    for record in records:
        lesson_day = record.get("journal__lesson_date")
        if lesson_day and lesson_day >= cutoff:
            by_student[record["student_id"]].append(record)
    best = None
    for rows in by_student.values():
        run = 0
        run_topic = ""
        for record in rows:
            topic = _topic_of(record)
            hard = _difficult(record)
            if hard and topic and topic.casefold() == run_topic.casefold():
                run += 1
            elif hard and topic:
                run = 1
                run_topic = topic
            else:
                run = 0
                run_topic = ""
            if run >= 3 and (best is None or run > best["count"] or (
                run == best["count"] and record["journal__lesson_date"] >= best["date"]
            )):
                best = {
                    "count": run,
                    "name": (record.get("student__first_name") or "").strip() or "Ученик",
                    "topic": run_topic,
                    "date": record["journal__lesson_date"],
                    "student_id": record["student_id"],
                }
    return best


def _week_lines(stats: dict) -> list[str]:
    lessons = stats["lessons"]
    homeworks = stats["homeworks"]
    tasks = stats["tasks"]
    materials = stats["materials"]
    lines = [
        f"{lessons} {plural_ru(lessons, 'урок', 'урока', 'уроков')}",
        f"{homeworks} {plural_ru(homeworks, 'домашняя работа', 'домашние работы', 'домашних работ')}",
        f"{tasks} {plural_ru(tasks, 'решённое задание', 'решённых задания', 'решённых заданий')}",
        f"{materials} {plural_ru(materials, 'использованный материал', 'использованных материала', 'использованных материалов')}",
    ]
    saved = format_approx_saved(stats.get("saved_seconds") or 0)
    if saved:
        lines.append(saved)
    return lines


def _busiest_fact(day_counts: Counter) -> str:
    if not day_counts:
        return ""
    top = max(day_counts.values())
    if top < 2 and len(day_counts) < 2:
        return ""
    # При равенстве берём более ранний день недели — так факт стабилен.
    winner = min(day for day, count in day_counts.items() if count == top)
    return f"Самый насыщенный день — {WEEKDAY_NAMES[winner]}"


def _card(**kwargs) -> dict:
    base = {
        "kind": "note",
        "id": "",
        "cooldown_days": 0,
        "kicker": "",
        "title": "",
        "body": "",
        "lines": [],
        "fact": "",
        "action": None,
        "celebrate": False,
        "candidates": [],
    }
    base.update(kwargs)
    return base


def build_engagement(teacher, *, now=None) -> dict:
    now = now or timezone.now()
    if timezone.is_naive(now):
        now = timezone.make_aware(now, timezone.get_current_timezone())
    today = timezone.localtime(now).date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    prev_week_start = week_start - timedelta(days=7)
    tomorrow = today + timedelta(days=1)
    fresh_after = now - timedelta(days=FRESH_DAYS)
    rare_after = now - timedelta(days=RARE_FRESH_DAYS)
    lookback = _aware(today - timedelta(days=LOOKBACK_DAYS))
    week_end = week_start + timedelta(days=7)
    horizon = max(week_end, tomorrow + timedelta(days=1))

    events = list(
        ScheduleEvent.objects.filter(
            owner=teacher,
            event_type__in=LESSON_TYPES,
            starts_at__gte=lookback,
            starts_at__lt=_aware(horizon),
        )
        .exclude(status__in=SKIPPED_STATUSES)
        .only("id", "starts_at", "ends_at", "status", "lesson_id")
    )

    conducted_all_qs = (
        ScheduleEvent.objects.filter(owner=teacher, event_type__in=LESSON_TYPES, ends_at__lte=now)
        .exclude(status__in=(*SKIPPED_STATUSES, CANCELLED))
    )
    lessons_total = conducted_all_qs.count()

    buckets = {
        "week": _empty_bucket(),
        "month": _empty_bucket(),
        "prev": _empty_bucket(),
        "today": _empty_bucket(),
    }
    material_ids = {key: [] for key in buckets}
    teaching_good = set()
    teaching_bad = set()
    planned_good = set()
    planned_bad = set()
    recent_lessons = 0
    tomorrow_count = 0
    remaining_today = 0
    active_days = set()

    by_day = defaultdict(list)
    for event in events:
        by_day[_local_date(event.starts_at)].append(event)
        if _local_date(event.starts_at) == tomorrow and event.status != CANCELLED:
            tomorrow_count += 1

    def _touch(bucket_name, event, when):
        if when < _period_start(bucket_name):
            return
        if bucket_name == "today" and when != today:
            return
        if bucket_name == "prev" and not (prev_week_start <= when < week_start):
            return
        if bucket_name == "week" and when < week_start:
            return
        if bucket_name == "month" and when < month_start:
            return
        bucket = buckets[bucket_name]
        bucket["lessons"] += 1
        bucket["lesson_days"][when.weekday()] += 1
        material_ids[bucket_name].append(event.id)

    def _period_start(name):
        return {
            "week": week_start,
            "month": month_start,
            "prev": prev_week_start,
            "today": today,
        }[name]

    for day, day_events in by_day.items():
        if day > today:
            continue
        past = [event for event in day_events if event.ends_at <= now]
        if not past:
            if day == today:
                remaining_today += sum(1 for event in day_events if event.status != CANCELLED and event.ends_at > now)
            continue
        conducted = [event for event in past if event.status != CANCELLED]
        cancelled = [event for event in past if event.status == CANCELLED]
        if conducted:
            teaching_good.add(day)
            active_days.add(day)
        elif cancelled:
            teaching_bad.add(day)
        if cancelled:
            planned_bad.add(day)
        elif conducted:
            planned_good.add(day)
        if day == today:
            remaining_today += sum(1 for event in day_events if event.status != CANCELLED and event.ends_at > now)
        for event in conducted:
            when = _local_date(event.ends_at) or day
            if event.ends_at >= fresh_after:
                recent_lessons += 1
            for name in buckets:
                _touch(name, event, when)

    for name in buckets:
        materials, _all_interactives, ready_materials, ready_interactives, ready_lessons = _uses_in_lessons(
            material_ids[name]
        )
        buckets[name]["materials"] = len(materials)
        buckets[name]["ready_materials"] = len(ready_materials)
        buckets[name]["interactives"] = len(ready_interactives)
        buckets[name]["ready_lessons"] = len(ready_lessons)

    # Задания учеников.
    task_daily = Counter()
    tasks_total = 0
    recent_tasks = 0
    counted_homework_ids = set()
    submissions = HomeworkSubmission.objects.filter(
        homework__teacher=teacher,
        submitted_at__isnull=False,
    ).values_list("homework_id", "submitted_at", "result_payload")
    for homework_id, submitted_at, payload in submissions.iterator(chunk_size=300):
        submitted_day = _local_date(submitted_at) if submitted_at else None
        if submitted_at and submitted_day:
            counted_homework_ids.add(homework_id)
            auto = auto_checked_task_count(payload)
            for name in buckets:
                if not _counts_in_period(name, submitted_day, today, week_start, month_start, prev_week_start):
                    continue
                buckets[name]["submitted_homeworks"] += 1
                buckets[name]["auto_tasks"] += auto
        count = tasks_from_payload(payload)
        if count <= 0:
            continue
        tasks_total += count
        if submitted_day:
            task_daily[submitted_day] += count
        if submitted_at and submitted_at >= fresh_after:
            recent_tasks += count
        for name in buckets:
            if not submitted_day or not _counts_in_period(name, submitted_day, today, week_start, month_start, prev_week_start):
                continue
            buckets[name]["tasks"] += count

    journal_rows = list(
        _journal_rows(teacher, today - timedelta(days=max(LOOKBACK_DAYS, 60)))
    )
    for record in journal_rows:
        homework_id = record.get("journal__homework_id")
        if homework_id and homework_id in counted_homework_ids:
            continue
        lesson_day = record.get("journal__lesson_date")
        auto = auto_checked_task_count(record.get("variant_result"))
        if auto and lesson_day:
            for name in buckets:
                if _counts_in_period(name, lesson_day, today, week_start, month_start, prev_week_start):
                    buckets[name]["auto_tasks"] += auto
        count = tasks_from_payload(record.get("variant_result"))
        if count <= 0:
            continue
        tasks_total += count
        if not lesson_day:
            continue
        task_daily[lesson_day] += count
        if lesson_day >= fresh_after.date():
            recent_tasks += count
        for name, start in (
            ("week", week_start),
            ("month", month_start),
            ("prev", prev_week_start),
            ("today", today),
        ):
            if name == "prev" and not (prev_week_start <= lesson_day < week_start):
                continue
            if name == "today" and lesson_day != today:
                continue
            if name in {"week", "month"} and lesson_day < start:
                continue
            buckets[name]["tasks"] += count

    # Проверенные домашние. Live-варианты урока сюда не входят.
    from .homework_api import exclude_live_meeting_review_items

    checked_rows = list(
        exclude_live_meeting_review_items(
            ReviewItem.objects.filter(
                teacher=teacher,
                status__in=(ReviewStatus.CHECKED, ReviewStatus.RETURNED),
                source_type=ReviewSourceType.HOMEWORK,
                checked_at__isnull=False,
                checked_at__gte=lookback,
            )
        ).values_list("source_id", "checked_at")
    )
    checked_today = 0
    for source_id, checked_at in checked_rows:
        checked_day = _local_date(checked_at)
        if not checked_day:
            continue
        active_days.add(checked_day)
        if checked_day == today:
            checked_today += 1
        for name, start in (
            ("week", week_start),
            ("month", month_start),
            ("prev", prev_week_start),
        ):
            if name == "prev" and not (prev_week_start <= checked_day < week_start):
                continue
            if name != "prev" and checked_day < start:
                continue
            buckets[name]["homeworks"] += 1

    interactive_rows = list(
        InteractiveAttempt.objects.filter(
            assignment__teacher=teacher,
            completed_at__isnull=False,
        ).values_list("completed_at", flat=True)
    )
    first_interactive_at = None
    for completed_at in interactive_rows:
        completed_day = _local_date(completed_at)
        if first_interactive_at is None or completed_at < first_interactive_at:
            first_interactive_at = completed_at
        if completed_day:
            active_days.add(completed_day)
    _count_extra_savings(
        teacher,
        buckets,
        today=today,
        week_start=week_start,
        month_start=month_start,
        prev_week_start=prev_week_start,
        lookback=lookback,
    )
    for name in buckets:
        buckets[name]["saved_seconds"] = saved_seconds(**bucket_saved_counts(buckets[name]))

    period = buckets["week"]
    period_key = "week"
    label = "На этой неделе"
    if period["lessons"] + period["homeworks"] + period["tasks"] + period["materials"] == 0:
        if buckets["month"]["lessons"] + buckets["month"]["homeworks"] + buckets["month"]["tasks"] + buckets["month"]["materials"] > 0:
            period = buckets["month"]
            period_key = "month"
            label = "В этом месяце"

    stats = {
        "period": period_key,
        "label": label,
        "lessons": period["lessons"],
        "homeworks_checked": period["homeworks"],
        "tasks_solved": period["tasks"],
        "materials_used": period["materials"],
        "saved_minutes": (period["saved_seconds"] or 0) // 60,
        "summary": summary_line(
            lessons=period["lessons"],
            homeworks=period["homeworks"],
            tasks=period["tasks"],
            materials=period["materials"],
        ) if (period["lessons"] or period["homeworks"] or period["tasks"] or period["materials"]) else "Пока без уроков и проверок",
        "saved_label": format_approx_saved(period["saved_seconds"]),
        "empty": not (period["lessons"] or period["homeworks"] or period["tasks"] or period["materials"]),
    }

    streaks = _streaks(
        teacher,
        today=today,
        now=now,
        teaching_good=teaching_good,
        teaching_bad=teaching_bad,
        planned_good=planned_good,
        planned_bad=planned_bad,
        checked_rows=checked_rows,
    )

    quiet = remaining_today == 0
    cards = _cards(
        teacher,
        now=now,
        today=today,
        quiet=quiet,
        lessons_total=lessons_total,
        recent_lessons=recent_lessons,
        tasks_total=tasks_total,
        recent_tasks=recent_tasks,
        task_daily=task_daily,
        buckets=buckets,
        tomorrow_count=tomorrow_count,
        checked_today=checked_today,
        conducted_today=buckets["today"]["lessons"],
        week_homeworks=buckets["week"]["homeworks"],
        first_interactive_at=first_interactive_at,
        active_days=active_days,
        fresh_after=fresh_after,
        rare_after=rare_after,
        journal_rows=journal_rows,
        conducted_all_qs=conducted_all_qs,
    )

    week_planned = sum(
        1
        for event in events
        if event.status != CANCELLED
        and (day := _local_date(event.starts_at))
        and week_start <= day < week_end
    )
    board = _build_board(
        teacher,
        today=today,
        streaks=streaks,
        week=buckets["week"],
        month_counts=bucket_saved_counts(buckets["month"]),
        week_planned=week_planned,
        lessons_total=lessons_total,
        tasks_total=tasks_total,
        homework_on_time=any(item["id"] == "homework_on_time" for item in streaks),
        has_interactive=first_interactive_at is not None,
        cards=cards,
    )

    return {
        "stats": stats,
        "streaks": streaks,
        "cards": cards,
        "board": board,
        "quiet": quiet,
        "note_pool_size": len(DAILY_NOTES),
    }


def _journal_rows(teacher, since):
    from .journal_models import StudentLessonRecord

    return (
        StudentLessonRecord.objects.filter(
            journal__teacher=teacher,
            journal__lesson_date__gte=since,
            journal__is_archived=False,
        )
        .order_by("student_id", "journal__lesson_date", "id")
        .values(
            "student_id",
            "student__first_name",
            "requires_attention",
            "difficulties",
            "variant_result",
            "journal__lesson_date",
            "journal__actual_topic",
            "journal__planned_topic",
            "journal__homework_id",
        )
    )


def _streaks(teacher, *, today, now, teaching_good, teaching_bad, planned_good, planned_bad, checked_rows):
    streaks = []
    planned = walk_streak(planned_good, planned_bad, today)
    teaching = walk_streak(teaching_good, teaching_bad, today)
    if planned >= 3:
        streaks.append({
            "id": "planned_days",
            "label": (
                f"{planned} {plural_ru(planned, 'день', 'дня', 'дней')} подряд "
                "проведены запланированные уроки"
            ),
        })
    elif teaching >= 3:
        streaks.append({
            "id": "teaching_days",
            "label": (
                f"{teaching} {plural_ru(teaching, 'учебный день', 'учебных дня', 'учебных дней')} подряд"
            ),
        })
    if _homework_on_time(teacher, now=now, checked_rows=checked_rows):
        streaks.append({"id": "homework_on_time", "label": "Все ДЗ проверены вовремя"})
    return streaks[:2]


def _homework_on_time(teacher, *, now, checked_rows) -> bool:
    window_start = now - timedelta(days=21)
    recent = [(source_id, checked_at) for source_id, checked_at in checked_rows if checked_at and checked_at >= window_start]
    if not recent:
        return False
    if Homework.objects.filter(
        teacher=teacher,
        status=HomeworkStatus.ASSIGNED,
        due_at__lt=now,
    ).exists():
        return False
    if _pending_reviews(teacher).exists():
        return False
    submission_ids = {source_id for source_id, _checked_at in recent}
    due_map = dict(
        HomeworkSubmission.objects.filter(id__in=submission_ids).values_list("id", "homework__due_at")
    )
    for source_id, checked_at in recent:
        due_at = due_map.get(source_id)
        if due_at and checked_at > due_at:
            return False
    return True


def _cards(
    teacher,
    *,
    now,
    today,
    quiet,
    lessons_total,
    recent_lessons,
    tasks_total,
    recent_tasks,
    task_daily,
    buckets,
    tomorrow_count,
    checked_today,
    conducted_today,
    week_homeworks,
    first_interactive_at,
    active_days,
    fresh_after,
    rare_after,
    journal_rows,
    conducted_all_qs,
):
    cards = []
    cards.extend(_easter_cards(
        today=today,
        quiet=quiet,
        lessons_total=lessons_total,
        recent_lessons=recent_lessons,
        tasks_total=tasks_total,
        recent_tasks=recent_tasks,
        task_daily=task_daily,
        conducted_today=conducted_today,
        rare_after=rare_after,
        conducted_all_qs=conducted_all_qs,
    ))
    achievement = _achievement_card(
        teacher,
        today=today,
        lessons_total=lessons_total,
        recent_lessons=recent_lessons,
        tasks_total=tasks_total,
        recent_tasks=recent_tasks,
        first_interactive_at=first_interactive_at,
        active_days=active_days,
        fresh_after=fresh_after,
        conducted_all_qs=conducted_all_qs,
        skip_lesson_100=any(card["id"] == "easter-lesson-100" for card in cards),
        skip_tasks_1000=any(card["id"] == "easter-tasks-1000" for card in cards),
    )
    if achievement:
        cards.append(achievement)

    prev = buckets["prev"]
    if prev["lessons"] or prev["homeworks"] or prev["tasks"] or prev["materials"]:
        iso = prev_week_iso(today)
        fact = _topic_fact(journal_rows, today) or _busiest_fact(prev["lesson_days"])
        cards.append(_card(
            kind="week",
            id=f"week-{iso.year}-{iso.week:02d}",
            kicker="Итоги",
            title="Ваша неделя",
            lines=_week_lines(prev),
            fact=fact,
        ))

    recommendation = _recommendation(
        teacher,
        now=now,
        today=today,
        quiet=quiet,
        tomorrow_count=tomorrow_count,
        journal_rows=journal_rows,
    )
    if recommendation:
        cards.append(recommendation)

    if quiet and checked_today >= 1 and week_homeworks >= 2 and not _pending_reviews(teacher).exists():
        cards.append(_card(
            kind="easter",
            id="easter-hw-clear",
            cooldown_days=14,
            kicker="Заметили",
            title="Все домашние проверены",
            body="Такое надо зафиксировать.",
        ))

    if quiet:
        kicker = "На сегодня всё" if conducted_today else "Свободный день"
        cards.append(_card(
            kind="note",
            id="note",
            kicker=kicker,
            candidates=note_candidates(teacher.id, today),
        ))
    return cards


def prev_week_iso(today):
    week_start = today - timedelta(days=today.weekday())
    return (week_start - timedelta(days=7)).isocalendar()


def _easter_cards(
    *,
    today,
    quiet,
    lessons_total,
    recent_lessons,
    tasks_total,
    recent_tasks,
    task_daily,
    conducted_today,
    rare_after,
    conducted_all_qs,
):
    cards = []
    if crossed_recently(lessons_total, recent_lessons, 100):
        nth = conducted_all_qs.order_by("ends_at").values_list("ends_at", flat=True)[99:100]
        nth_at = nth[0] if nth else None
        if nth_at and nth_at >= rare_after:
            cards.append(_card(
                kind="easter",
                id="easter-lesson-100",
                cooldown_days=3650,
                title="Это был ваш 100-й урок 🎉",
                celebrate=True,
            ))
    if crossed_recently(tasks_total, recent_tasks, 1000):
        cards.append(_card(
            kind="easter",
            id="easter-tasks-1000",
            cooldown_days=3650,
            title="Ученики решили уже 1000 заданий",
            celebrate=True,
        ))
    today_tasks = task_daily.get(today, 0)
    if today_tasks >= 100:
        prior_hit = any(
            count >= 100
            for day, count in task_daily.items()
            if day < today and (today - day).days <= 21
        )
        if not prior_hit:
            cards.append(_card(
                kind="easter",
                id=f"easter-tasks-day-{today.isoformat()}",
                cooldown_days=3650,
                title="Сегодня ученики решили уже 100 заданий.",
            ))
    if quiet and today.weekday() == 4 and conducted_today >= 1:
        cards.append(_card(
            kind="easter",
            id="easter-friday",
            cooldown_days=21,
            title="Последний урок пятницы закончен. На сегодня официально всё.",
        ))
    return cards


def _achievement_card(
    teacher,
    *,
    today,
    lessons_total,
    recent_lessons,
    tasks_total,
    recent_tasks,
    first_interactive_at,
    active_days,
    fresh_after,
    conducted_all_qs,
    skip_lesson_100,
    skip_tasks_1000,
):
    options = []
    lesson_copy = {
        1: ("Первый проведённый урок", "Он уже в вашей истории на платформе."),
        10: ("10 проведённых уроков", "Короткая серия, которую стоит заметить."),
        50: ("50 проведённых уроков", "Полсотни занятий — это уже ритм."),
        100: ("100 проведённых уроков", "Сотня уроков. Платформа просто это видит."),
    }
    for milestone in reversed(LESSON_MILESTONES):
        if milestone == 100 and skip_lesson_100:
            continue
        if not crossed_recently(lessons_total, recent_lessons, milestone):
            continue
        nth = list(conducted_all_qs.order_by("ends_at").values_list("ends_at", flat=True)[milestone - 1:milestone])
        if not nth or nth[0] < fresh_after:
            continue
        title, body = lesson_copy[milestone]
        options.append(_card(
            kind="achievement",
            id=f"ach-lessons-{milestone}",
            cooldown_days=3650,
            kicker="Заметили",
            title=title,
            body=body,
            celebrate=milestone >= 100,
        ))
        break

    task_copy = {
        100: ("100 заданий, решённых учениками", "Первая сотня уже позади."),
        500: ("500 заданий, решённых учениками", "Пять сотен решений — это уже объём курса."),
        1000: ("1000 заданий, решённых учениками", "Тысяча решённых заданий."),
    }
    for milestone in reversed(TASK_MILESTONES):
        if milestone == 1000 and skip_tasks_1000:
            continue
        if not crossed_recently(tasks_total, recent_tasks, milestone):
            continue
        title, body = task_copy[milestone]
        options.append(_card(
            kind="achievement",
            id=f"ach-tasks-{milestone}",
            cooldown_days=3650,
            kicker="Заметили",
            title=title,
            body=body,
            celebrate=milestone >= 1000,
        ))
        break

    first_homework = (
        Homework.objects.filter(teacher=teacher)
        .exclude(status=HomeworkStatus.DRAFT)
        .order_by("created_at")
        .values_list("created_at", flat=True)
        .first()
    )
    issued = Homework.objects.filter(teacher=teacher).exclude(status=HomeworkStatus.DRAFT).count()
    if first_homework and first_homework >= fresh_after and issued <= 2:
        options.append(_card(
            kind="achievement",
            id="ach-homework-first",
            cooldown_days=3650,
            kicker="Заметили",
            title="Первое выданное домашнее задание",
            body="С этого места домашняя работа живёт в платформе, а не в переписке.",
        ))

    if first_interactive_at and first_interactive_at >= fresh_after:
        options.append(_card(
            kind="achievement",
            id="ach-interactive-first",
            cooldown_days=3650,
            kicker="Заметили",
            title="Первый использованный интерактив",
            body="Ученики уже прошли его. Это тоже часть урока.",
        ))

    first_day = None
    earliest_lesson = conducted_all_qs.order_by("ends_at").values_list("ends_at", flat=True).first()
    if earliest_lesson:
        first_day = _local_date(earliest_lesson)
    if first_homework:
        homework_day = _local_date(first_homework)
        if homework_day and (first_day is None or homework_day < first_day):
            first_day = homework_day
    if first_day and (today - first_day).days >= 30:
        recent_active = len({day for day in active_days if (today - day).days <= 35})
        days_since = (today - first_day).days
        if recent_active >= 8 and 30 <= days_since <= 37:
            options.append(_card(
                kind="achievement",
                id="ach-active-month",
                cooldown_days=3650,
                kicker="Заметили",
                title="Месяц работы на платформе",
                body="За это время занятия, проверки и задания уже стали ритмом, а не разовым визитом.",
            ))

    if not options:
        return None
    # Самый редкий свежий порог важнее «первого раза», если оба случились вместе.
    rank = {"ach-lessons-100": 0, "ach-tasks-1000": 1, "ach-lessons-50": 2, "ach-tasks-500": 3}
    options.sort(key=lambda card: rank.get(card["id"], 10))
    return options[0]


def _recommendation(teacher, *, now, today, quiet, tomorrow_count, journal_rows):
    struggle = _struggle(journal_rows, today=today)
    if struggle:
        count = struggle["count"]
        noun = plural_ru(count, "занятие", "занятия", "занятий")
        return _card(
            kind="recommendation",
            id=f"rec-topic-{struggle['student_id']}",
            kicker="Стоит заметить",
            title=f"{struggle['name']} — {count} {noun} подряд с ошибками в теме «{struggle['topic'][:80]}»",
            action={"label": "Подобрать задания", "href": "/subject"},
        )

    pending = _pending_reviews(teacher).filter(source_type=ReviewSourceType.HOMEWORK).count()
    if pending >= 1 and (quiet or pending >= 2):
        noun = plural_ru(pending, "домашняя работа", "домашние работы", "домашних работ")
        return _card(
            kind="recommendation",
            id="rec-reviews",
            kicker="Сейчас",
            title=f"Осталось проверить {pending} {noun}",
            action={"label": "Перейти к проверке", "href": "/cabinet/review"},
        )

    hour = timezone.localtime(now).hour
    if tomorrow_count >= 3 and (quiet or hour >= 17):
        noun = plural_ru(tomorrow_count, "занятие", "занятия", "занятий")
        return _card(
            kind="recommendation",
            id=f"rec-tomorrow-{today.isoformat()}",
            kicker="На завтра",
            title=f"Завтра {tomorrow_count} {noun} — можно подготовить материалы заранее",
            action={"label": "Подготовить уроки", "href": "/lessons"},
        )
    return None


def _topic_fact(journal_rows, today) -> str:
    week_start = today - timedelta(days=today.weekday())
    prev_start = week_start - timedelta(days=7)
    counts = Counter()
    for record in journal_rows:
        lesson_day = record.get("journal__lesson_date")
        if not lesson_day or not (prev_start <= lesson_day < week_start):
            continue
        topic = _topic_of(record)
        wrong = _wrong_count(record)
        if topic and wrong:
            counts[topic] += wrong
    if not counts:
        return ""
    topic = counts.most_common(1)[0][0]
    return f"Ученики чаще всего ошибались в теме «{topic[:80]}»"


_MONTHS_GENITIVE = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)
_MONTHS_PREP = (
    "январе", "феврале", "марте", "апреле", "мае", "июне",
    "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
)
_TIME_MARKS = (60, 180, 300, 600, 1200)
_LESSON_MARKS = (10, 50, 100, 250, 500)


def _build_board(
    teacher,
    *,
    today,
    streaks,
    week,
    month_counts,
    week_planned,
    lessons_total,
    tasks_total,
    homework_on_time,
    has_interactive,
    cards,
):
    done = week["lessons"]
    percent = round(100 * done / week_planned) if week_planned else 0
    if percent >= 50:
        week_title = "Вы уже сделали больше половины"
    elif done:
        week_title = "Неделя уже началась"
    else:
        week_title = "Неделя ещё впереди"

    exact_saved = saved_seconds(**month_counts)
    parts = _saved_parts(month_counts)
    time_target = next((mark for mark in _TIME_MARKS if exact_saved < mark * 60), _TIME_MARKS[-1])
    lesson_target = next((mark for mark in _LESSON_MARKS if lessons_total < mark), _LESSON_MARKS[-1])

    badges, opened = _board_badges(
        lessons_total=lessons_total,
        tasks_total=tasks_total,
        homework_on_time=homework_on_time,
        has_interactive=has_interactive,
    )
    easter = next((card for card in cards if card.get("kind") == "easter"), None)
    streak = streaks[0] if streaks else None
    notes = note_candidates(teacher.id, today)

    return {
        "streak": {
            "label": streak["label"],
            "hint": "учебные дни, не входы в кабинет",
        } if streak else None,
        "week": {
            "title": week_title,
            "percent": percent,
            "goal_label": "Занятия в расписании на этой неделе",
            "goal_value": f"{done} / {week_planned}" if week_planned else "0",
            "metrics": [
                {"label": "Уроки", "value": done, "hint": "проведено"},
                {"label": "Домашние", "value": week["homeworks"], "hint": "проверено"},
                {"label": "Задания", "value": week["tasks"], "hint": "решили ученики"},
                {"label": "Материалы", "value": week["materials"], "hint": "использовано"},
            ],
        },
        "time": {
            "scope": f"сэкономлено в {_MONTHS_PREP[today.month - 1]}",
            "value": format_approx_saved(exact_saved) or "≈ 0 мин",
            "note": SAVED_TIME_NOTE,
            "hint": SAVED_TIME_NOTE,
            "parts": parts,
            "total": {
                "label": "Итого",
                "value": _duration_label(exact_saved),
            } if parts else None,
            "mark_label": "До следующего рубежа",
            "mark_value": f"{_duration_label(exact_saved)} / {_clock(time_target)}",
            "percent": min(100, round(100 * exact_saved / (time_target * 60))) if time_target else 0,
        },
        "daily": {
            "date_label": f"{today.day} {_MONTHS_GENITIVE[today.month - 1]}",
            "candidates": notes,
            "caption": "Новая фраза появится завтра",
        },
        "achievements": {
            "opened": opened,
            "items": badges,
            "milestone": {
                "title": f"До {lesson_target}-го урока" if lesson_target != 1 else "До первого урока",
                "current": lessons_total,
                "target": lesson_target,
                "percent": min(100, round(100 * lessons_total / lesson_target)) if lesson_target else 0,
            },
        },
        "easter": {
            "id": easter["id"],
            "title": easter.get("title") or "",
            "body": easter.get("body") or "",
            "celebrate": bool(easter.get("celebrate")),
            "cooldown_days": easter.get("cooldown_days") or 0,
        } if easter else None,
    }


def _saved_parts(counts: dict) -> list[dict]:
    rows = []
    for key, rate in TIME_SAVED_SECONDS.items():
        count = int(counts.get(key) or 0)
        if count <= 0:
            continue
        rows.append({
            "key": key,
            "label": TIME_SAVED_LABELS[key],
            "count": count,
            "rate": _rate_label(rate),
            "formula": f"{count} × {_rate_label(rate)}",
            "value": _line_label(count * rate),
        })
    return rows


def _clock(minutes: int) -> str:
    minutes = int(minutes or 0)
    if minutes < 60:
        return f"{minutes} мин"
    hours, mins = divmod(minutes, 60)
    if mins == 0:
        return f"{hours} ч"
    return f"{hours} ч {mins} мин"


def _board_badges(*, lessons_total, tasks_total, homework_on_time, has_interactive):
    catalog = [
        ("ach-lessons-1", "Первый урок", "первое занятие", lessons_total >= 1),
        ("ach-lessons-10", "10 уроков", "первые 10 занятий", lessons_total >= 10),
        ("ach-lessons-50", "50 уроков", "полсотни занятий", lessons_total >= 50),
        ("ach-lessons-100", "100 уроков", "сотня занятий", lessons_total >= 100),
        ("ach-tasks-100", "100 заданий", "решили ученики", tasks_total >= 100),
        ("ach-tasks-500", "500 заданий", "решили ученики", tasks_total >= 500),
        ("ach-tasks-1000", "1000 заданий", "тысяча решений", tasks_total >= 1000),
        ("ach-homework-clear", "Без хвостов", "все ДЗ проверены вовремя", homework_on_time),
        ("ach-interactive", "Интерактив", "уже использован на занятии", has_interactive),
    ]
    items = [
        {"id": key, "title": title, "detail": detail, "locked": not ok}
        for key, title, detail, ok in catalog
    ]
    return items, sum(1 for item in items if not item["locked"])
