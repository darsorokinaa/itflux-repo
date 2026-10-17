"""r70: единый расчёт «сэкономленного времени» для кабинета и страницы тарифов.

Методика согласована с владельцем (и с маркетингом):

* считаем только то, что платформа сделала за преподавателя автоматически;
  всё, что преподаватель делает руками, — 0;
* у каждого действия одна фиксированная норма (минуты, которые оно заняло бы вручную);
* повторы одного и того же объекта не считаются (вариант — один раз,
  по дате первой выдачи ученику);
* интерактивы не считаем (решение владельца: их собирает сам преподаватель);
* категорию, которая надёжно не логируется в БД, не показываем и не оцениваем.

Используется:
* главной кабинета (`dashboard_engagement`) — «в этом месяце» + «за всё время»;
* карточкой «Итоги — Ваша неделя» — за прошлую неделю;
* `/pricing` (`r50_api.PricingMeView`) — «за всё время» для залогиненного учителя.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone


@dataclass(frozen=True)
class Category:
    key: str
    seconds: int
    label: str
    rate_text: str  # «вариант — 10 мин» в сноске
    summary_noun: str = ""  # «собранные варианты» в первой фразе сноски (пусто — не упоминаем)


# Порядок = порядок в разбивке и в сноске.
CATEGORIES: tuple[Category, ...] = (
    Category("variant", 600, "Варианты", "вариант — 10 мин", "собранные варианты"),
    Category("auto_checked_answer", 30, "Автопроверка ответов", "проверка одного ответа — 30 сек", "автопроверку ответов"),
    Category("reminder", 30, "Напоминания", "напоминание — 30 сек", "напоминания"),
    Category("booking", 120, "Бронирования", "бронирование — 2 мин", "бронирования"),
)
CATEGORY_BY_KEY = {category.key: category for category in CATEGORIES}

# Есть в методике, но в БД нет надёжного следа — не показываем и не оцениваем.
HIDDEN_CATEGORIES = {
    "interactive": (
        "Интерактив — не считаем по решению владельца (r70): интерактивы преподаватель "
        "собирает сам, а ручная работа = 0."
    ),
    "worksheet": (
        "Рабочий лист (в т.ч. ИИ) — 10 мин: выдача листа ученику не хранится, "
        "«Скачать PDF» — это window.print() в браузере без записи на сервере."
    ),
    "ready_lesson": (
        "Готовый урок из каталога — 15 мин: ни занятие, ни ДЗ не ссылаются на урок каталога "
        "(Generator.Lesson); банковых материалов-уроков на занятиях нет, публичные планы при "
        "записи копируются без ссылки на источник."
    ),
    "journal_auto": (
        "Запись журнала, созданная синхронизацией плана — 1 мин: LessonJournal.created_by всегда "
        "преподаватель, автосоздание (plan_sync) и открытие журнала вручную в БД не различаются."
    ),
}

HIDE_BELOW_SECONDS = 10 * 60

_FOOTNOTE_HEAD = "Это оценка, а не замер."
_FOOTNOTE_TAIL = "Вашу собственную работу в кабинете не считаем. Реальная экономия у каждого своя."


def _join_ru(items: list[str]) -> str:
    items = [item for item in items if item]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " и " + items[-1]


def build_footnote(categories=CATEGORIES) -> str:
    nouns = _join_ru([category.summary_noun for category in categories])
    rates = ", ".join(category.rate_text for category in categories)
    return (
        f"{_FOOTNOTE_HEAD} Мы учитываем только то, что платформа сделала за Вас автоматически: {nouns}. "
        f"Для каждого действия берём примерное время, которое оно заняло бы вручную: {rates}. "
        f"{_FOOTNOTE_TAIL}"
    )


FOOTNOTE = build_footnote()

_MONTHS_PREP = (
    "январе", "феврале", "марте", "апреле", "мае", "июне",
    "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
)


# ── Форматирование ───────────────────────────────────────────────────────────

def format_saved(seconds) -> str:
    """Всегда вниз: до часа — до 10 мин («≈ 40 мин»), от часа — до целых часов («≈ 16 ч»).

    Меньше 10 минут — пустая строка: блок не показываем.
    """
    seconds = int(seconds or 0)
    if seconds < HIDE_BELOW_SECONDS:
        return ""
    minutes = seconds // 60
    if minutes < 60:
        return f"≈ {minutes // 10 * 10} мин"
    return f"≈ {minutes // 60} ч"


def _rate_text(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} сек"
    minutes, rest = divmod(seconds, 60)
    return f"{minutes} мин" if not rest else f"{minutes} мин {rest} сек"


def _line_text(seconds: int) -> str:
    minutes = int(seconds) // 60
    if minutes <= 0:
        return "меньше минуты"
    return f"{minutes} мин"


# ── Сбор фактов ──────────────────────────────────────────────────────────────

def _local_date(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        if timezone.is_naive(value):
            value = timezone.make_aware(value, timezone.get_current_timezone())
        return timezone.localtime(value).date()
    if isinstance(value, date):
        return value
    return None


def is_excluded_teacher(teacher) -> bool:
    """Тестовые/демо-аккаунты. В БД нет флага — список задаётся в настройках."""
    ids = getattr(settings, "TIME_SAVINGS_EXCLUDED_TEACHER_IDS", ()) or ()
    try:
        return int(teacher.pk) in {int(value) for value in ids}
    except (TypeError, ValueError):
        return False


def _first_dates(pairs) -> dict:
    first = {}
    for key, value in pairs:
        day = _local_date(value)
        if key is None or day is None:
            continue
        if key not in first or day < first[key]:
            first[key] = day
    return first


def _assigned_homework_tasks(teacher):
    from .choices import HomeworkStatus
    from .models import HomeworkTask

    return (
        HomeworkTask.objects.filter(homework__teacher=teacher, is_active=True)
        .exclude(homework__status=HomeworkStatus.DRAFT)
        .filter(Q(homework__student__isnull=False) | Q(homework__group__isnull=False))
        .exclude(homework__student__user_id=teacher.pk)
    )


def _variant_days(teacher) -> list:
    """Вариант генератора, выданный ученику (ДЗ или показ на уроке). Один раз на вариант."""
    from Generator.models import Variant

    from .homework_api import VARIANT_URL_RE

    pairs = []
    rows = _assigned_homework_tasks(teacher).filter(description__icontains="/variant/").values_list(
        "description", "homework__created_at"
    )
    for description, created_at in rows.iterator(chunk_size=500):
        match = VARIANT_URL_RE.search(description or "")
        if not match:
            continue
        pairs.append((int(match.group(1)), created_at))
    first = _first_dates(pairs)
    if not first:
        return []
    existing = set(Variant.objects.filter(id__in=list(first)).values_list("id", flat=True))
    return [(day, 1) for variant_id, day in first.items() if variant_id in existing]


def _auto_checked_days(teacher) -> list:
    """Ответы, которые платформа сама пометила верными/неверными (0,5 мин за ответ).

    Только итоговая сдача (HomeworkSubmission.result_payload), без бонуса за саму сдачу.
    Live-варианты урока тоже сюда входят (они оформлены как ДЗ); variant_result журнала
    не берём — это копия той же сдачи.
    """
    from .dashboard_engagement import auto_checked_task_count
    from .models import HomeworkSubmission

    out = []
    rows = (
        HomeworkSubmission.objects.filter(homework__teacher=teacher, submitted_at__isnull=False)
        .exclude(student__user_id=teacher.pk)
        .values_list("submitted_at", "result_payload")
    )
    for submitted_at, payload in rows.iterator(chunk_size=300):
        count = auto_checked_task_count(payload)
        day = _local_date(submitted_at)
        if count > 0 and day:
            out.append((day, count))
    return out


def _reminder_days(teacher) -> list:
    """Автоматическое напоминание ученику/родителю о занятии. Одно на пару (занятие, получатель)."""
    from .models import EventReminderLog

    rows = (
        EventReminderLog.objects.filter(event__owner=teacher)
        .exclude(recipient_id=teacher.pk)
        .values_list("event_id", "recipient_id", "sent_at")
    )
    first = _first_dates(((event_id, recipient_id), sent_at) for event_id, recipient_id, sent_at in rows)
    return [(day, 1) for day in first.values()]


def _booking_days(teacher) -> list:
    """Занятие, на которое ученик сам записался через ссылку бронирования."""
    from .availability_models import TeacherBooking

    rows = TeacherBooking.objects.filter(
        teacher=teacher,
        source=TeacherBooking.Source.SELF_SERVICE,
        status=TeacherBooking.Status.ACTIVE,
    ).values_list("booked_at", flat=True)
    return [(day, 1) for day in (_local_date(value) for value in rows) if day]


_COLLECTORS = {
    "variant": _variant_days,
    "auto_checked_answer": _auto_checked_days,
    "reminder": _reminder_days,
    "booking": _booking_days,
}


def collect_units(teacher) -> dict:
    """{ключ категории: [(локальная дата, количество), ...]} — все факты за всё время."""
    if teacher is None or not getattr(teacher, "pk", None) or is_excluded_teacher(teacher):
        return {category.key: [] for category in CATEGORIES}
    return {category.key: list(_COLLECTORS[category.key](teacher)) for category in CATEGORIES}


def count_units(units: dict, *, start: date | None = None, end: date | None = None) -> dict:
    """Счётчики за период [start, end). None — без границы."""
    counts = {}
    for category in CATEGORIES:
        total = 0
        for day, amount in units.get(category.key) or ():
            if start is not None and day < start:
                continue
            if end is not None and day >= end:
                continue
            total += amount
        counts[category.key] = total
    return counts


def summarize(counts: dict) -> dict:
    seconds = 0
    parts = []
    for category in CATEGORIES:
        count = int(counts.get(category.key) or 0)
        if count <= 0:
            continue
        line = count * category.seconds
        seconds += line
        parts.append({
            "key": category.key,
            "label": category.label,
            "count": count,
            "rate": _rate_text(category.seconds),
            "formula": f"{count} × {_rate_text(category.seconds)}",
            "value": _line_text(line),
            "minutes": line // 60,
        })
    label = format_saved(seconds)
    return {
        "seconds": seconds,
        "minutes": seconds // 60,
        "label": label,
        "visible": bool(label),
        "parts": parts if label else [],
    }


def period_summary(units: dict, *, start=None, end=None) -> dict:
    return summarize(count_units(units, start=start, end=end))


def teacher_time_savings(teacher, *, now=None, units=None) -> dict:
    """Месяц (с 1-го числа) + за всё время + сноска. Один источник для кабинета и /pricing."""
    now = now or timezone.now()
    if timezone.is_naive(now):
        now = timezone.make_aware(now, timezone.get_current_timezone())
    today = timezone.localtime(now).date()
    month_start = today.replace(day=1)
    if units is None:
        units = collect_units(teacher)
    month = period_summary(units, start=month_start, end=today + timedelta(days=1))
    all_time = period_summary(units, end=today + timedelta(days=1))
    return {
        "month": {**month, "scope": f"в {_MONTHS_PREP[today.month - 1]}"},
        "all_time": {**all_time, "scope": "за всё время"},
        "footnote": FOOTNOTE,
        "rates": [
            {"key": c.key, "label": c.label, "seconds": c.seconds, "rate": _rate_text(c.seconds)}
            for c in CATEGORIES
        ],
    }
