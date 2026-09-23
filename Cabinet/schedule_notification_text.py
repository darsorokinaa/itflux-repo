"""Подробный текст уведомлений о событиях расписания."""

from datetime import datetime
from zoneinfo import ZoneInfo

from django.utils import timezone

_KIND_LABELS = {
    "personal": "Личное дело",
    "blocked": "Блокировка",
    "individual": "Индивидуальный урок",
    "individual_lesson": "Индивидуальный урок",
    "group": "Групповой урок",
    "group_lesson": "Групповой урок",
    "homework": "Домашнее задание",
    "homework_deadline": "Дедлайн домашнего задания",
    "review": "Проверка работ",
}

_PRIVATE_KINDS = {"personal", "blocked"}

_CHANGE_LABELS = {
    "title": "название",
    "topic": "тема",
    "subtopic": "подтема",
    "description": "описание",
    "goal": "цель",
    "homework_description": "домашнее задание",
    "location": "место",
    "format": "формат",
    "starts_at": "время",
    "ends_at": "время",
    "event_type": "тип",
    "all_day": "длительность",
    "travel_before_minutes": "дорога",
    "travel_after_minutes": "дорога",
}


def event_kind(event) -> str:
    return str(getattr(event, "event_type", "") or "")


def event_kind_label(event) -> str:
    return _KIND_LABELS.get(event_kind(event), "Занятие")


def _event_tz(event):
    name = (getattr(event, "timezone", None) or "").strip() or "Europe/Moscow"
    try:
        return ZoneInfo(name)
    except Exception:
        return timezone.get_current_timezone()


def _parse_dt(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _local_dt(value, event):
    parsed = value if isinstance(value, datetime) else _parse_dt(value)
    if not isinstance(parsed, datetime):
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return timezone.localtime(parsed, _event_tz(event))


def format_when(event, start=None, end=None) -> str:
    start_dt = event.starts_at if start is None else start
    end_dt = event.ends_at if end is None else end
    start_local = _local_dt(start_dt, event)
    if start_local is None:
        return ""
    if getattr(event, "all_day", False):
        return f"{start_local.strftime('%d.%m.%Y')}, весь день"
    end_local = _local_dt(end_dt, event)
    if end_local is None:
        return start_local.strftime("%d.%m.%Y, %H:%M")
    if start_local.date() == end_local.date():
        return f"{start_local.strftime('%d.%m.%Y, %H:%M')}–{end_local.strftime('%H:%M')}"
    return f"{start_local.strftime('%d.%m.%Y, %H:%M')}–{end_local.strftime('%d.%m.%Y, %H:%M')}"


def format_clock_span(event, tz) -> str:
    if getattr(event, "all_day", False):
        return "весь день"
    start = event.starts_at.astimezone(tz) if event.starts_at else None
    if start is None:
        return ""
    end = event.ends_at.astimezone(tz) if event.ends_at else None
    if end is None:
        return start.strftime("%H:%M")
    return f"{start.strftime('%H:%M')}–{end.strftime('%H:%M')}"


def event_headline(event) -> str:
    kind = event_kind_label(event)
    title = str(getattr(event, "title", "") or "").strip()
    if title and title.casefold() != kind.casefold():
        return f"{kind} «{title}»"
    return kind


def _audience(event) -> tuple[str, list[str]]:
    """('student'|'group'|'', names)."""
    if not getattr(event, "pk", None):
        return "", []
    student_names = []
    group_names = []
    try:
        participants = event.participants.select_related("student", "group").all()[:6]
    except Exception:
        participants = []
    for participant in participants:
        student = getattr(participant, "student", None)
        if getattr(participant, "student_id", None) and student is not None:
            name = str(getattr(student, "full_name", "") or "").strip()
            if name:
                student_names.append(name)
            continue
        group = getattr(participant, "group", None)
        if getattr(participant, "group_id", None) and group is not None:
            name = str(getattr(group, "title", "") or "").strip()
            if name:
                group_names.append(name)
    if student_names:
        return "student", student_names
    if group_names:
        return "group", group_names
    student = None
    group = None
    try:
        if getattr(event, "student_id", None):
            student = event.student
        if getattr(event, "group_id", None):
            group = event.group
    except Exception:
        student = None
        group = None
    if student is not None:
        name = str(getattr(student, "full_name", "") or "").strip()
        if name:
            return "student", [name]
    if group is not None:
        name = str(getattr(group, "title", "") or "").strip()
        if name:
            return "group", [name]
    audience = str(getattr(event, "audience", "") or "").strip()
    if audience:
        return "student", [audience]
    return "", []


def _subject_label(event) -> str:
    if not getattr(event, "student_subject_id", None):
        return ""
    try:
        subject = event.student_subject
    except Exception:
        return ""
    if subject is None:
        return ""
    return str(getattr(subject, "display_label", "") or "").strip()


def _clip(text: str, limit: int = 280) -> str:
    cleaned = " ".join(str(text or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def event_detail_lines(
    event,
    *,
    old_start_at=None,
    old_end_at=None,
    changes=None,
    extra_lines=None,
) -> list[str]:
    lines = [event_headline(event)]
    if old_start_at:
        old_when = format_when(event, old_start_at, old_end_at)
        new_when = format_when(event)
        if old_when:
            lines.append(f"Было: {old_when}")
        if new_when:
            lines.append(f"Стало: {new_when}")
    else:
        when = format_when(event)
        if when:
            lines.append(when)

    title = str(getattr(event, "title", "") or "").strip()
    if event_kind(event) not in _PRIVATE_KINDS:
        who_kind, names = _audience(event)
        if names and not (len(names) == 1 and names[0].casefold() == title.casefold()):
            if len(names) == 1:
                who = "Группа" if who_kind == "group" else "Ученик"
                lines.append(f"{who}: {names[0]}")
            else:
                lines.append(f"Участники: {names[0]} и ещё {len(names) - 1}")
        subject = _subject_label(event)
        if subject:
            lines.append(f"Предмет: {subject}")
        topic = str(getattr(event, "topic", "") or "").strip()
        if topic and topic.casefold() != title.casefold():
            lines.append(f"Тема: {topic}")
        event_format = str(getattr(event, "format", "") or "")
        if event_format == "online":
            lines.append("Онлайн")
        elif event_format == "offline":
            lines.append("Офлайн")

    location = str(getattr(event, "location", "") or "").strip()
    if location:
        lines.append(f"Место: {location}")

    travel = []
    before = int(getattr(event, "travel_before_minutes", 0) or 0)
    after = int(getattr(event, "travel_after_minutes", 0) or 0)
    if before:
        travel.append(f"{before} мин до")
    if after:
        travel.append(f"{after} мин после")
    if travel:
        lines.append("Дорога: " + ", ".join(travel))

    description = _clip(getattr(event, "description", "") or "")
    if description and description.casefold() != title.casefold():
        lines.append(description)

    changed = []
    for key in changes or {}:
        label = _CHANGE_LABELS.get(key)
        if label and label not in changed:
            changed.append(label)
    if changed:
        lines.append("Изменилось: " + ", ".join(changed))

    for line in extra_lines or []:
        text = str(line or "").strip()
        if text and text not in lines:
            lines.append(text)
    return [line for line in lines if line]


def schedule_notification_copy(
    event,
    action: str,
    *,
    old_start_at=None,
    old_end_at=None,
    events_count: int = 1,
    changes=None,
    extra_lines=None,
) -> tuple[str, str]:
    kind = event_kind(event)
    personal = kind == "personal"
    blocked = kind == "blocked"
    lines = event_detail_lines(
        event,
        old_start_at=old_start_at,
        old_end_at=old_end_at,
        changes=changes,
        extra_lines=extra_lines,
    )
    headline = lines[0] if lines else event_kind_label(event)

    if action == "created":
        if personal:
            title = "Новое личное дело"
        elif blocked:
            title = "Новая блокировка"
        else:
            title = "Новое занятие"
        return title, "\n".join(lines)

    named = str(getattr(event, "title", "") or "").strip() or event_kind_label(event)
    if action == "moved":
        if personal:
            title = "Личное дело перенесено"
            lead = f"Личное дело «{named}» перенесено."
        elif blocked:
            title = "Блокировка перенесена"
            lead = f"Блокировка «{named}» перенесена."
        else:
            title = "Занятие перенесено"
            lead = f"Занятие «{named}» перенесено."
        return title, "\n".join([lead, *lines[1:]])

    if action == "cancelled":
        if events_count > 1:
            title = "Занятия отменены"
            lead = f"Занятия «{named}» отменены ({events_count} шт.)."
        elif personal:
            title = "Личное дело отменено"
            lead = f"Личное дело «{named}» отменено."
        elif blocked:
            title = "Блокировка снята"
            lead = f"Блокировка «{named}» снята."
        else:
            title = "Занятие отменено"
            lead = f"Занятие «{named}» отменено."
        return title, "\n".join([lead, *lines[1:]])

    if action == "updated":
        if personal:
            title = "Личное дело изменено"
            lead = f"Личное дело «{named}» изменено."
        elif blocked:
            title = "Блокировка изменена"
            lead = f"Блокировка «{named}» изменена."
        else:
            title = "Занятие изменено"
            lead = f"Занятие «{named}» изменено."
        return title, "\n".join([lead, *lines[1:]])

    if action == "added":
        return "Вас добавили на занятие", "\n".join(lines)

    if action == "removed":
        return "Вас сняли с занятия", "\n".join([f"{headline}: вы больше не участвуете.", *lines[1:]])

    if action == "broadcast":
        return "Изменён состав участников", "\n".join([f"Состав обновлён: {headline}.", *lines[1:]])

    return event_kind_label(event), "\n".join(lines)


def daily_schedule_line(event, tz) -> str:
    clock = format_clock_span(event, tz)
    headline = event_headline(event)
    bits = [bit for bit in (clock, headline) if bit]
    if event_kind(event) not in _PRIVATE_KINDS:
        _who, names = _audience(event)
        title = str(getattr(event, "title", "") or "").strip()
        if names and names[0].casefold() != title.casefold():
            bits.append(names[0])
        subject = _subject_label(event)
        if subject:
            bits.append(subject)
    return " · ".join(bits)


def plural_ru(count: int, one: str, few: str, many: str) -> str:
    abs_n = abs(count) % 100
    last = abs_n % 10
    if 10 < abs_n < 20:
        return many
    if last == 1:
        return one
    if 2 <= last <= 4:
        return few
    return many
