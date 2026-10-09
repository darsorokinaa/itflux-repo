"""Расчёт дат плана для Excel и импорта.

Формулы на листе и этот модуль следуют одному правилу:
итоговая дата строки — «Дата вручную», если она заполнена, иначе «Дата по расписанию».
Автоматическая дата следующей строки продолжается после итоговой даты предыдущей.
Пропущенная строка не сдвигает последовательность.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from .plan_dates import normalize_weekdays, parse_plan_date

MODE_WEEKDAYS = "По дням недели"
MODE_WEEKLY = "Раз в неделю"
MODE_BIWEEKLY = "Раз в две недели"
MODE_EVERY_N_WEEKS = "Каждые N недель"
MODE_EVERY_N_DAYS = "Каждые N дней"
MODE_DAILY = "Каждый день"
MODE_MANUAL = "Без автоматического расписания"

SCHEDULE_MODES = (
    MODE_WEEKDAYS,
    MODE_WEEKLY,
    MODE_BIWEEKLY,
    MODE_EVERY_N_WEEKS,
    MODE_EVERY_N_DAYS,
    MODE_DAILY,
    MODE_MANUAL,
)

WEEKDAY_SETTING_LABELS = (
    "Понедельник",
    "Вторник",
    "Среда",
    "Четверг",
    "Пятница",
    "Суббота",
    "Воскресенье",
)

WEEKDAY_NAMES = ("PlanMon", "PlanTue", "PlanWed", "PlanThu", "PlanFri", "PlanSat", "PlanSun")

MODE_IDS = {
    "weekdays": MODE_WEEKDAYS,
    "weekly": MODE_WEEKLY,
    "biweekly": MODE_BIWEEKLY,
    "every_n_weeks": MODE_EVERY_N_WEEKS,
    "every_n_days": MODE_EVERY_N_DAYS,
    "daily": MODE_DAILY,
    "manual": MODE_MANUAL,
    "none": MODE_MANUAL,
    "off": MODE_MANUAL,
}


def clamp_step(value, default=1):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return min(366, max(1, number))


def canonical_mode(value, interval="", weekdays=None) -> str:
    text = str(value or "").strip()
    if text in SCHEDULE_MODES:
        return text
    folded = text.casefold()
    for label in SCHEDULE_MODES:
        if label.casefold() == folded:
            return label
    mapped = MODE_IDS.get(folded.replace(" ", "_"))
    if mapped:
        return mapped
    token = str(interval or "").strip().lower()
    if token in {"manual", "none", "off"}:
        return MODE_MANUAL
    if weekdays or token == "weekdays":
        return MODE_WEEKDAYS
    if token == "biweekly":
        return MODE_BIWEEKLY
    if token == "daily":
        return MODE_DAILY
    if token == "weekly":
        return MODE_WEEKLY
    if re.fullmatch(r"every_\d+_weeks", token):
        return MODE_EVERY_N_WEEKS
    if re.fullmatch(r"every_\d+_days", token):
        return MODE_EVERY_N_DAYS
    if token in {"twice_weekly", "thrice_weekly", "four_weekly"}:
        return MODE_WEEKDAYS
    return MODE_WEEKLY


def weekdays_for_legacy_interval(interval, start) -> list[int]:
    """2/3/4 раза в неделю совпадают с набором дней, выведенным из первой даты."""
    start_date = parse_plan_date(start)
    if start_date is None:
        return []
    base = start_date.weekday()
    token = str(interval or "").strip().lower()
    if token in {"weekly", "biweekly"}:
        return [base]
    if token == "daily":
        return list(range(7))
    if token == "twice_weekly":
        return _unique([base, (base + 3) % 7])
    if token == "thrice_weekly":
        second = (base + 2) % 7
        return _unique([base, second, (second + 2) % 7])
    if token == "four_weekly":
        second = (base + 1) % 7
        third = (second + 2) % 7
        return _unique([base, second, third, (third + 1) % 7])
    return []


def _unique(days):
    result = []
    for day in days:
        if day not in result:
            result.append(day)
    return result


def interval_token(mode: str, step_n: int, weekdays: list[int]) -> str:
    if mode == MODE_MANUAL:
        return "manual"
    if mode == MODE_WEEKDAYS:
        return "weekdays"
    if mode == MODE_WEEKLY:
        return "weekly"
    if mode == MODE_BIWEEKLY:
        return "biweekly"
    if mode == MODE_DAILY:
        return "daily"
    if mode == MODE_EVERY_N_WEEKS:
        step = clamp_step(step_n, 2)
        if step == 1:
            return "weekly"
        if step == 2:
            return "biweekly"
        return f"every_{step}_weeks"
    if mode == MODE_EVERY_N_DAYS:
        step = clamp_step(step_n, 1)
        if step == 1:
            return "daily"
        return f"every_{step}_days"
    if weekdays:
        return "weekdays"
    return "weekly"


def step_default(mode: str, interval: str = "") -> int:
    match = re.fullmatch(r"every_(\d+)_(days|weeks)", str(interval or ""))
    if match:
        return clamp_step(match.group(1), 1)
    if mode == MODE_EVERY_N_WEEKS:
        return 2
    if mode == MODE_BIWEEKLY:
        return 2
    return 1


def resolve_schedule(settings: dict | None) -> dict:
    settings = settings or {}
    weekdays = normalize_weekdays(settings.get("weekdays"))
    interval = str(settings.get("interval") or "").strip().lower()
    mode = canonical_mode(settings.get("schedule_mode"), interval, weekdays)
    start = parse_plan_date(settings.get("start_date"))
    step_n = clamp_step(settings.get("step_n"), step_default(mode, interval))
    if mode == MODE_WEEKDAYS and not weekdays:
        weekdays = weekdays_for_legacy_interval(interval, start)
    if mode in {MODE_WEEKLY, MODE_BIWEEKLY} and start and not weekdays:
        weekdays = [start.weekday()]
    if mode == MODE_DAILY:
        weekdays = list(range(7))
    warning = ""
    nearest = None
    if mode == MODE_WEEKDAYS and start and weekdays and start.weekday() not in weekdays:
        nearest = nearest_school_day(start, weekdays)
        if nearest:
            warning = (
                f"Первая дата {start.strftime('%d.%m.%Y')} не совпадает с учебным днём. "
                f"Ближайшая подходящая: {nearest.strftime('%d.%m.%Y')}. "
                "Выбранная дата сохранена."
            )
    elif mode == MODE_WEEKDAYS and not weekdays:
        warning = "Учебные дни не выбраны, поэтому автоматические даты не рассчитаны."
    return {
        "mode": mode,
        "weekdays": weekdays,
        "step_n": step_n,
        "start": start,
        "interval": interval_token(mode, step_n, weekdays),
        "warning": warning,
        "nearest": nearest,
        "start_time": str(settings.get("start_time") or "").strip(),
        "duration_minutes": clamp_step(settings.get("duration_minutes") or 60, 60),
    }


def nearest_school_day(start, weekdays) -> date | None:
    start_date = parse_plan_date(start)
    days = set(normalize_weekdays(weekdays))
    if not start_date or not days or start_date.weekday() in days:
        return None
    for offset in range(1, 8):
        candidate = start_date + timedelta(days=offset)
        if candidate.weekday() in days:
            return candidate
    return None


def next_schedule_date(anchor, mode: str, weekdays, step_n: int):
    if anchor is None or mode == MODE_MANUAL:
        return None
    if mode == MODE_WEEKDAYS:
        days = set(normalize_weekdays(weekdays))
        if not days:
            return None
        cursor = anchor + timedelta(days=1)
        for _ in range(366):
            if cursor.weekday() in days:
                return cursor
            cursor += timedelta(days=1)
        return None
    if mode == MODE_WEEKLY:
        return anchor + timedelta(days=7)
    if mode == MODE_BIWEEKLY:
        return anchor + timedelta(days=14)
    if mode == MODE_EVERY_N_WEEKS:
        return anchor + timedelta(days=7 * clamp_step(step_n, 2))
    if mode == MODE_DAILY:
        return anchor + timedelta(days=1)
    if mode == MODE_EVERY_N_DAYS:
        return anchor + timedelta(days=clamp_step(step_n, 1))
    return anchor + timedelta(days=7)


def sequence_plan(count, start, mode, weekdays, step_n, manuals, skips, pinned) -> list[dict]:
    """Последовательность, совпадающая с формулами листа."""
    start_date = parse_plan_date(start)
    anchor = None
    rows = []
    for index in range(count):
        manual = manuals[index] if index < len(manuals) else None
        skip = bool(skips[index]) if index < len(skips) else False
        pin = pinned[index] if index < len(pinned) else None
        manual = parse_plan_date(manual)
        pin = parse_plan_date(pin)
        if mode == MODE_MANUAL or skip:
            schedule = None
        elif pin:
            schedule = pin
        elif index == 0:
            schedule = start_date
        elif anchor is None:
            schedule = None
        else:
            schedule = next_schedule_date(anchor, mode, weekdays, step_n)
        effective = manual or schedule
        if not skip and effective:
            anchor = effective
        if manual:
            source = "manual"
        elif effective:
            source = "automatic"
        else:
            source = ""
        rows.append({
            "schedule": schedule,
            "effective": effective,
            "source": source,
            "skip": skip,
        })
    return rows


def _weekday_hit(date_expr: str) -> str:
    checks = [
        f'AND(WEEKDAY({date_expr},2)={index},{name}="Да")'
        for index, name in enumerate(WEEKDAY_NAMES, start=1)
    ]
    return "OR(" + ",".join(checks) + ")"


def _next_weekdays(anchor: str) -> str:
    inner = '""'
    for offset in range(7, 0, -1):
        expr = f"{anchor}+{offset}"
        inner = f"IF({_weekday_hit(expr)},{expr},{inner})"
    return inner


def _next_expr(anchor: str) -> str:
    return (
        f'IF(PlanMode="{MODE_WEEKDAYS}",{_next_weekdays(anchor)},'
        f'IF(PlanMode="{MODE_WEEKLY}",{anchor}+7,'
        f'IF(PlanMode="{MODE_BIWEEKLY}",{anchor}+14,'
        f'IF(PlanMode="{MODE_EVERY_N_WEEKS}",{anchor}+7*MAX(1,IF(PlanStepN="",1,PlanStepN)),'
        f'IF(PlanMode="{MODE_DAILY}",{anchor}+1,'
        f'IF(PlanMode="{MODE_EVERY_N_DAYS}",{anchor}+MAX(1,IF(PlanStepN="",1,PlanStepN)),'
        f'""))))))'
    )


def _blank_row(row: int, title_col: str, topic_col: str, manual_col: str) -> str:
    return f'AND({title_col}{row}="",{topic_col}{row}="",{manual_col}{row}="")'


# Сколько пустых вставленных строк можно перешагнуть, не показав 01.01.1900.
# Обычные пустые строки шаблона формулы уже содержат, этот запас нужен только
# для строки, которую редактор вставил без формулы.
ANCHOR_LOOKBACK = 15


def _real_date(expr: str) -> str:
    """Настоящая дата занятия. Пустая ячейка и серийный ноль (01.01.1900) не подходят."""
    return f'IFERROR(AND({expr}<>"",{expr}>=DATE(2000,1,1)),FALSE)'


def _index_above(col: str, offset: int) -> str:
    return f'IFERROR(INDEX({col}:{col},ROW()-{offset}),"")'


def _this_row(col: str) -> str:
    return f"INDEX({col}:{col},ROW())"


def formula_prev_anchor(anchor_col: str) -> str:
    """Последняя настоящая опора выше этой строки.

    Ссылка через INDEX(ROW()-n), а не на конкретную ячейку: удаление строки
    не превращает формулу в #ССЫЛКА!. Пустая вставленная строка пропускается.
    """
    expr = '""'
    for offset in range(ANCHOR_LOOKBACK, 0, -1):
        cell = _index_above(anchor_col, offset)
        expr = f'IF({_real_date(cell)},{cell},{expr})'
    return f'={expr}'


def formula_schedule(row: int, prev_col: str, skip_col: str, title_col: str, topic_col: str, manual_col: str) -> str:
    prev = _this_row(prev_col)
    inactive = f'OR({skip_col}{row}="Да",{_blank_row(row, title_col, topic_col, manual_col)})'
    return (
        f'=IF(OR(PlanMode="{MODE_MANUAL}",{inactive}),"",'
        f'IF(ROW()<=2,IF(PlanStartDate="","",PlanStartDate),'
        f'IF({_real_date(prev)},{_next_expr(prev)},"")))'
    )


def formula_effective(row: int, manual_col: str, schedule_col: str) -> str:
    manual = f"{manual_col}{row}"
    schedule = f"{schedule_col}{row}"
    return f'=IF({_real_date(manual)},{manual},IF({_real_date(schedule)},{schedule},""))'


def formula_anchor(row: int, prev_col: str, skip_col: str, effective_col: str, title_col: str, topic_col: str, manual_col: str) -> str:
    prev = _this_row(prev_col)
    effective = f"{effective_col}{row}"
    inactive = f'OR({skip_col}{row}="Да",{_blank_row(row, title_col, topic_col, manual_col)})'
    return (
        f'=IF({inactive},IF({_real_date(prev)},{prev},""),'
        f'IF({_real_date(effective)},{effective},""))'
    )


def formula_nearest_start() -> str:
    hit = _weekday_hit("PlanStartDate")
    nearest = _next_weekdays("PlanStartDate-1")
    return (
        f'=IF(OR(PlanMode<>"{MODE_WEEKDAYS}",PlanStartDate="",{hit}),"",{nearest})'
    )
