"""Минимальный кабинет в Telegram: расписание, напоминание, ДЗ, сводка журнала."""

from __future__ import annotations

import logging
from datetime import date, timedelta

from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone

from .choices import CommentVisibility, HomeworkStatus, StudentStatus
from .models import Homework, NotificationPreference, ScheduleEvent, Student
from .notification_catalog import ROLE_STUDENT
from .notification_dispatch import user_role
from .notification_time import user_local_now, user_zoneinfo
from .telegram_connect import (
    bind_telegram_account,
    platform_path_url,
    telegram_open_html,
)
from Generator.telegram_utils import escape_telegram_html

logger = logging.getLogger(__name__)

BTN_SCHEDULE = "Расписание"
BTN_TODAY = "Сегодня"
BTN_TOMORROW = "Завтра"
BTN_WEEK = "Неделя"
BTN_MONTH = "Месяц"
BTN_REMIND = "Напомнить"
BTN_HOMEWORK = "ДЗ"
BTN_JOURNAL = "Журнал"
BTN_ASSIGNMENTS = "Задания"
BTN_CABINET = "Кабинет"
STUDENTS_PAGE_SIZE = 8

_MONTHS = (
    "",
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)
_WEEKDAYS = ("пн", "вт", "ср", "чт", "пт", "сб", "вс")

PERIODS = {
    "today": (0, 1, "сегодня", 20),
    "tom": (1, 2, "завтра", 20),
    "week": (0, 7, "неделю", 40),
    "month": (0, 31, "месяц", 50),
}


def _is_teacher(user: User) -> bool:
    return user_role(user) != ROLE_STUDENT


def _cabinet_path(user: User) -> str:
    return "/cabinet/schedule" if _is_teacher(user) else "/cabinet/student"


def _first_name(student: Student) -> str:
    return (student.first_name or student.full_name or "друг").split()[0]


def _teacher_name(teacher: User) -> str:
    profile = getattr(teacher, "profile", None)
    if profile:
        return profile.get_display_name()
    return (teacher.get_full_name() or "").strip()


def _human_date(value: date) -> str:
    return f"{_WEEKDAYS[value.weekday()]}, {value.day} {_MONTHS[value.month]}"


def _student_cabinet_url() -> str:
    return platform_path_url("/cabinet/student")


def menu_keyboard(user: User) -> dict:
    cabinet_url = platform_path_url(_cabinet_path(user))
    if _is_teacher(user):
        return {
            "inline_keyboard": [
                [
                    {"text": BTN_SCHEDULE, "callback_data": "c:today"},
                    {"text": BTN_HOMEWORK, "callback_data": "c:hw"},
                ],
                [
                    {"text": BTN_REMIND, "callback_data": "c:remind"},
                    {"text": BTN_JOURNAL, "callback_data": "c:journal"},
                ],
                [{"text": BTN_CABINET, "url": cabinet_url}],
            ]
        }
    return {
        "inline_keyboard": [
            [
                {"text": BTN_TODAY, "callback_data": "c:today"},
                {"text": BTN_TOMORROW, "callback_data": "c:tom"},
            ],
            [
                {"text": BTN_WEEK, "callback_data": "c:week"},
                {"text": BTN_MONTH, "callback_data": "c:month"},
            ],
            [
                {"text": BTN_ASSIGNMENTS, "callback_data": "c:hw"},
                {"text": BTN_CABINET, "url": cabinet_url},
            ],
        ]
    }


def schedule_keyboard() -> dict:
    return {
        "inline_keyboard": [
            [
                {"text": BTN_TODAY, "callback_data": "c:today"},
                {"text": BTN_TOMORROW, "callback_data": "c:tom"},
            ],
            [
                {"text": BTN_WEEK, "callback_data": "c:week"},
                {"text": BTN_MONTH, "callback_data": "c:month"},
            ],
            [{"text": "Меню", "callback_data": "c:menu"}],
        ]
    }


def user_by_chat_id(chat_id) -> User | None:
    chat_id = str(chat_id or "").strip()
    if not chat_id:
        return None
    prefs = (
        NotificationPreference.objects.filter(telegram_chat_id=chat_id, telegram_enabled=True)
        .select_related("user", "user__profile")
        .first()
    )
    if prefs is None or not prefs.telegram_connected:
        return None
    return prefs.user


def _reply(chat_id, text: str, reply_markup: dict | None = None) -> None:
    from Generator.telegram_utils import send_telegram_message

    send_telegram_message(text, chat_id=str(chat_id), reply_markup=reply_markup)


def _event_audience(event: ScheduleEvent) -> str:
    if event.student_id and getattr(event, "student", None):
        return event.student.full_name
    try:
        for participant in event.participants.select_related("student").all()[:4]:
            if participant.student_id and participant.student:
                return participant.student.full_name
            if participant.display_name:
                return participant.display_name
    except Exception:
        pass
    if event.group_id and getattr(event, "group", None):
        return event.group.title
    return event.title or "занятие"


def _events_for_period(user: User, period: str) -> tuple[list[ScheduleEvent], object, str]:
    offset, span, label, limit = PERIODS.get(period) or PERIODS["today"]
    tz = user_zoneinfo(user)
    now = user_local_now(user)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=offset)
    day_end = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=span)
    statuses = [ScheduleEvent.Status.PLANNED, ScheduleEvent.Status.MOVED]
    qs = ScheduleEvent.objects.filter(
        status__in=statuses,
        starts_at__gte=day_start,
        starts_at__lt=day_end,
    ).select_related("student", "group")
    if _is_teacher(user):
        qs = qs.filter(owner=user)
    else:
        student_ids = list(Student.objects.filter(user=user).values_list("id", flat=True))
        qs = qs.filter(
            Q(student_id__in=student_ids) | Q(participants__student_id__in=student_ids)
        ).distinct()
    return list(qs.order_by("starts_at")[:limit]), tz, label


def format_schedule(user: User, period: str = "today") -> str:
    events, tz, label = _events_for_period(user, period)
    lines = [f"Расписание на {label}", ""]
    if not events:
        empty = {
            "сегодня": "Сегодня уроков нет.",
            "завтра": "Завтра уроков нет.",
            "неделю": "На эту неделю уроков нет.",
            "месяц": "На ближайший месяц уроков нет.",
        }
        lines.append(empty.get(label, "Уроков нет."))
    else:
        last_day = None
        show_dates = period in ("week", "month")
        for event in events:
            local = event.starts_at.astimezone(tz)
            if show_dates and local.date() != last_day:
                if last_day is not None:
                    lines.append("")
                lines.append(_human_date(local.date()))
                last_day = local.date()
            title = event.title or "Занятие"
            extra = _event_audience(event)
            when = local.strftime("%H:%M")
            if extra and extra != title:
                lines.append(f"{when} — {escape_telegram_html(title)} · {escape_telegram_html(extra)}")
            else:
                lines.append(f"{when} — {escape_telegram_html(title)}")
    path = "/cabinet/schedule" if _is_teacher(user) else "/cabinet/student/lessons"
    label_link = "Открыть расписание" if _is_teacher(user) else "Открыть занятия"
    lines.extend(["", telegram_open_html(path, label_link)])
    return "\n".join(lines)


def _format_today(user: User) -> str:
    return format_schedule(user, "today")


def _teacher_students(teacher: User):
    return list(
        Student.objects.filter(teacher=teacher)
        .exclude(status=StudentStatus.ARCHIVED)
        .order_by("last_name", "first_name")
    )


def _students_keyboard(students: list[Student], *, page: int = 0, action: str = "r") -> dict:
    start = page * STUDENTS_PAGE_SIZE
    chunk = students[start : start + STUDENTS_PAGE_SIZE]
    rows = []
    for student in chunk:
        rows.append(
            [{"text": (student.full_name or "Ученик")[:32], "callback_data": f"c:{action}:{student.pk}"}]
        )
    nav = []
    if page > 0:
        nav.append({"text": "←", "callback_data": f"c:l:{action}:{page - 1}"})
    if start + STUDENTS_PAGE_SIZE < len(students):
        nav.append({"text": "Ещё →", "callback_data": f"c:l:{action}:{page + 1}"})
    if nav:
        rows.append(nav)
    rows.append([{"text": "Меню", "callback_data": "c:menu"}])
    return {"inline_keyboard": rows}


def _student_has_telegram(student: Student) -> bool:
    if not student.user_id:
        return False
    return NotificationPreference.objects.filter(
        user_id=student.user_id,
        telegram_enabled=True,
    ).exclude(telegram_chat_id="").exists()


def _next_lesson_for_student(teacher: User, student: Student) -> ScheduleEvent | None:
    now = timezone.now()
    return (
        ScheduleEvent.objects.filter(
            owner=teacher,
            status__in=[ScheduleEvent.Status.PLANNED, ScheduleEvent.Status.MOVED],
            starts_at__gte=now,
        )
        .filter(Q(student=student) | Q(participants__student=student))
        .select_related("student", "group")
        .distinct()
        .order_by("starts_at")
        .first()
    )


def _student_homeworks(teacher: User, student: Student, statuses: list[str], limit: int = 5):
    return list(
        Homework.objects.filter(teacher=teacher, status__in=statuses)
        .filter(Q(student=student) | Q(group__students=student))
        .distinct()
        .order_by("due_at", "id")[:limit]
    )


def _overdue_homework(teacher: User, student: Student) -> list[Homework]:
    now = timezone.now()
    return list(
        Homework.objects.filter(teacher=teacher)
        .filter(Q(student=student) | Q(group__students=student))
        .filter(
            Q(status=HomeworkStatus.OVERDUE)
            | Q(status=HomeworkStatus.ASSIGNED, due_at__lt=now)
        )
        .distinct()
        .order_by("due_at", "id")[:5]
    )


def _pending_homework(teacher: User, student: Student) -> list[Homework]:
    return _student_homeworks(
        teacher,
        student,
        [HomeworkStatus.ASSIGNED, HomeworkStatus.OVERDUE],
        limit=3,
    )


def _student_homework(user: User) -> list[Homework]:
    student_ids = list(Student.objects.filter(user=user).values_list("id", flat=True))
    if not student_ids:
        return []
    return list(
        Homework.objects.filter(
            status__in=[HomeworkStatus.ASSIGNED, HomeworkStatus.OVERDUE],
        )
        .filter(Q(student_id__in=student_ids) | Q(group__students__id__in=student_ids))
        .distinct()
        .order_by("due_at", "id")[:8]
    )


def build_student_reminder_text(teacher: User, student: Student) -> str:
    """Тёплый текст, который учитель может переслать ученику."""
    first = _first_name(student)
    tz = user_zoneinfo(teacher)
    lines = [f"Привет, {first}!", ""]
    event = _next_lesson_for_student(teacher, student)
    if event:
        when = event.starts_at.astimezone(tz)
        today = user_local_now(teacher).date()
        if when.date() == today:
            when_label = f"сегодня в {when.strftime('%H:%M')}"
        elif when.date() == today + timedelta(days=1):
            when_label = f"завтра в {when.strftime('%H:%M')}"
        else:
            when_label = when.strftime("%d.%m в %H:%M")
        title = event.title or "занятие"
        lines.append(f"Напоминаю совсем коротко: занятие {when_label} — «{title}».")
        lines.append("Буду ждать.")
    homework = _pending_homework(teacher, student)
    if homework:
        if event:
            lines.append("")
        if len(homework) == 1:
            hw = homework[0]
            due = hw.due_at.astimezone(tz).strftime("%d.%m") if hw.due_at else ""
            if due:
                lines.append(
                    f"По заданию «{hw.title}» срок — до {due}. "
                    "Если что-то не получается, напиши, разберёмся."
                )
            else:
                lines.append(
                    f"По заданию «{hw.title}» пока без срока. "
                    "Если что-то не получается, напиши, разберёмся."
                )
        else:
            lines.append("Ещё лежат задания. Давай потихоньку закроем:")
            for hw in homework:
                due = hw.due_at.astimezone(tz).strftime("%d.%m") if hw.due_at else ""
                due_bit = f" — до {due}" if due else ""
                lines.append(f"• {hw.title}{due_bit}")
            lines.append("Если где-то застрял(а) — напиши, помогу.")
    if not event and not homework:
        lines.append("Просто написала напомнить о себе: в кабинете есть расписание и задания.")
        lines.append("Если нужно что-то уточнить — напиши.")
    lines.extend(["", f"Кабинет: {_student_cabinet_url()}"])
    return "\n".join(lines)


def build_homework_overdue_text(teacher: User, student: Student) -> str:
    first = _first_name(student)
    tz = user_zoneinfo(teacher)
    rows = _overdue_homework(teacher, student)
    lines = [f"{first}, привет!", ""]
    if not rows:
        lines.append("Просроченных заданий сейчас нет. Всё хорошо.")
    else:
        lines.append("По домашнему заданию пока висит то, что лучше закрыть:")
        for hw in rows:
            due = hw.due_at.astimezone(tz).strftime("%d.%m") if hw.due_at else ""
            due_bit = f" — срок был {due}" if due else ""
            lines.append(f"• {hw.title}{due_bit}")
        lines.append("")
        lines.append("Давай разберём это на ближайших днях. Если застрял(а) — напиши, помогу.")
    lines.extend(["", f"Кабинет: {platform_path_url('/cabinet/student/assignments')}"])
    return "\n".join(lines)


def build_journal_parent_text(teacher: User, student: Student) -> str:
    """Аккуратная сводка для пересылки родителю. Без внутренних заметок."""
    from .journal_models import AttendanceStatus, RecordPublishStatus, StudentLessonRecord

    first = _first_name(student)
    name = student.full_name or first
    records = list(
        StudentLessonRecord.objects.filter(
            journal__teacher=teacher,
            student=student,
            publish_status__in=[
                RecordPublishStatus.PUBLISHED,
                RecordPublishStatus.EDITED_AFTER_PUBLISH,
            ],
        )
        .select_related("journal")
        .order_by("-journal__lesson_date", "-id")[:3]
    )
    lines = ["Здравствуйте!", "", f"Короткая сводка по занятиям ({name})."]
    if not records:
        lines.append("")
        lines.append("Пока нет опубликованных итогов. Как только заполню журнал — пришлю сводку.")
    else:
        att_map = {
            AttendanceStatus.PRESENT: "был(а) на занятии",
            AttendanceStatus.LATE: "немного опоздал(а)",
            AttendanceStatus.LEFT_EARLY: "ушёл(а) чуть раньше",
            AttendanceStatus.PARTIAL: "был(а) часть занятия",
            AttendanceStatus.ABSENT_EXCUSED: "не было на занятии, причина уважительная",
            AttendanceStatus.ABSENT_UNEXCUSED: "не было на занятии",
            AttendanceStatus.CANCELLED_BY_STUDENT: "занятие не состоялось",
            AttendanceStatus.CANCELLED_BY_TEACHER: "занятие перенесено / не состоялось",
            AttendanceStatus.TECHNICAL_ISSUE: "занятие не состоялось по технической причине",
        }
        for record in records:
            journal = record.journal
            topic = journal.actual_topic or journal.planned_topic or "занятие"
            lines.extend(["", f"{journal.lesson_date.strftime('%d.%m')} — «{topic}»"])
            att = att_map.get(record.attendance_status)
            if att:
                lines.append(att.capitalize() + ".")
            if record.overall_score is not None:
                score = str(record.overall_score).rstrip("0").rstrip(".")
                lines.append(f"Оценка: {score}.")
            if (record.recommendation or "").strip():
                lines.append(f"Рекомендация: {record.recommendation.strip()}")
            comment = (record.teacher_comment or "").strip()
            if comment and record.comment_visibility == CommentVisibility.STUDENT_AND_PARENT:
                lines.append(comment)
    teacher_name = _teacher_name(teacher)
    if teacher_name:
        lines.extend(["", f"— {teacher_name}"])
    lines.extend(["", f"Кабинет: {platform_path_url('/cabinet/student/results')}"])
    return "\n".join(lines)


def _format_assignments(user: User) -> str:
    rows = _student_homework(user)
    lines = ["Задания", ""]
    if not rows:
        lines.append("Сейчас нет невыполненных заданий. Можно выдохнуть.")
    else:
        tz = user_zoneinfo(user)
        for hw in rows:
            due = hw.due_at.astimezone(tz).strftime("%d.%m") if hw.due_at else "без срока"
            lines.append(f"• {escape_telegram_html(hw.title)} — {due}")
    lines.extend(["", telegram_open_html("/cabinet/student/assignments", "Открыть задания")])
    return "\n".join(lines)


def _welcome_text(user: User) -> str:
    if _is_teacher(user):
        return (
            "Короткое меню\n\n"
            "Расписание — сегодня, завтра, неделя или месяц.\n"
            "ДЗ — просроченные, текст можно переслать.\n"
            "Напомнить — тёплое сообщение ученику.\n"
            "Журнал — аккуратная сводка для родителя."
        )
    return (
        "Короткое меню\n\n"
        "Расписание — сегодня, завтра, неделя или месяц.\n"
        "Задания — что нужно сдать."
    )


def show_menu(chat_id, user: User) -> None:
    _reply(chat_id, _welcome_text(user), menu_keyboard(user))


def _picker_title(action: str) -> str:
    return {
        "r": "Кому напомнить?",
        "h": "ДЗ — выберите ученика",
        "j": "Журнал — сводка для родителя",
    }.get(action, "Ученики")


def _show_students(chat_id, teacher: User, *, page: int = 0, action: str = "r") -> None:
    students = _teacher_students(teacher)
    if not students:
        _reply(chat_id, "Пока нет учеников.", menu_keyboard(teacher))
        return
    _reply(chat_id, _picker_title(action), _students_keyboard(students, page=page, action=action))


def _show_homework_overdue(chat_id, teacher: User, student: Student) -> None:
    send_cb = f"c:xo:{student.pk}" if _student_has_telegram(student) else ""
    _show_forwardable(
        chat_id,
        build_homework_overdue_text(teacher, student),
        send_cb=send_cb,
        back_cb="c:l:h:0",
    )


def _show_forwardable(chat_id, text: str, *, send_cb: str = "", back_cb: str = "c:menu") -> None:
    body = escape_telegram_html(text)
    hint = "\n\nМожно переслать как есть."
    buttons = []
    if send_cb:
        buttons.append([{"text": "Отправить ученику", "callback_data": send_cb}])
    buttons.append([{"text": "Назад", "callback_data": back_cb}])
    _reply(chat_id, body + hint, {"inline_keyboard": buttons})


def _show_reminder(chat_id, teacher: User, student: Student) -> None:
    send_cb = f"c:x:{student.pk}" if _student_has_telegram(student) else ""
    _show_forwardable(
        chat_id,
        build_student_reminder_text(teacher, student),
        send_cb=send_cb,
        back_cb="c:l:r:0",
    )


def _send_text_to_student(student: Student, text: str) -> str:
    user = student.user
    if user is None or not _student_has_telegram(student):
        return "Ученик ещё не подключил Telegram. Перешлите сообщение вручную."
    from .telegram_connect import send_telegram_to_user

    ok = send_telegram_to_user(user, escape_telegram_html(text))
    if ok:
        return "Сообщение отправлено ученику."
    return "Не получилось отправить. Перешлите сообщение вручную."


def _send_reminder_to_student(teacher: User, student: Student) -> str:
    return _send_text_to_student(student, build_student_reminder_text(teacher, student))


def _get_teacher_student(teacher: User, student_id: str) -> Student | None:
    try:
        pk = int(student_id)
    except (TypeError, ValueError):
        return None
    return (
        Student.objects.filter(teacher=teacher, pk=pk)
        .exclude(status=StudentStatus.ARCHIVED)
        .first()
    )


def handle_connected_text(chat_id, user: User, text: str) -> None:
    command = (text or "").strip()
    if command.startswith("/"):
        command = command.split("@", 1)[0]

    if command in (BTN_TODAY, "/today", BTN_SCHEDULE, "/schedule"):
        _reply(chat_id, format_schedule(user, "today"), schedule_keyboard())
        return
    if command in (BTN_TOMORROW, "/tomorrow"):
        _reply(chat_id, format_schedule(user, "tom"), schedule_keyboard())
        return
    if command in (BTN_WEEK, "/week"):
        _reply(chat_id, format_schedule(user, "week"), schedule_keyboard())
        return
    if command in (BTN_MONTH, "/month"):
        _reply(chat_id, format_schedule(user, "month"), schedule_keyboard())
        return
    if command in (BTN_CABINET, "/cabinet"):
        path = _cabinet_path(user)
        label = "Открыть кабинет учителя" if _is_teacher(user) else "Открыть кабинет"
        _reply(chat_id, telegram_open_html(path, label), menu_keyboard(user))
        return
    if _is_teacher(user) and command in (BTN_REMIND, "/remind"):
        _show_students(chat_id, user, action="r")
        return
    if _is_teacher(user) and command in (BTN_HOMEWORK, "/homework", "/dz"):
        _show_students(chat_id, user, action="h")
        return
    if _is_teacher(user) and command in (BTN_JOURNAL, "/journal"):
        _show_students(chat_id, user, action="j")
        return
    if not _is_teacher(user) and command in (BTN_ASSIGNMENTS, BTN_HOMEWORK, "/homework", "/dz"):
        _reply(chat_id, _format_assignments(user), menu_keyboard(user))
        return
    show_menu(chat_id, user)


def handle_callback(callback: dict) -> None:
    callback_id = str(callback.get("id") or "")
    data = str(callback.get("data") or "")
    message = callback.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    from_user = callback.get("from") or {}
    user = user_by_chat_id(chat_id) or user_by_chat_id(from_user.get("id"))
    from Generator.telegram_utils import answer_telegram_callback_query

    if user is None or chat_id is None:
        answer_telegram_callback_query(callback_id, "Сначала подключите Telegram из кабинета")
        return
    answer_telegram_callback_query(callback_id)
    parts = data.split(":")
    if len(parts) < 2 or parts[0] != "c":
        show_menu(chat_id, user)
        return
    action = parts[1]
    if action in PERIODS:
        _reply(chat_id, format_schedule(user, action), schedule_keyboard())
        return
    if action == "cabinet":
        path = _cabinet_path(user)
        label = "Открыть кабинет учителя" if _is_teacher(user) else "Открыть кабинет"
        _reply(chat_id, telegram_open_html(path, label), menu_keyboard(user))
        return
    if action == "hw":
        if _is_teacher(user):
            _show_students(chat_id, user, action="h")
        else:
            _reply(chat_id, _format_assignments(user), menu_keyboard(user))
        return
    if action == "remind":
        if _is_teacher(user):
            _show_students(chat_id, user, action="r")
        else:
            show_menu(chat_id, user)
        return
    if action == "journal":
        if _is_teacher(user):
            _show_students(chat_id, user, action="j")
        else:
            show_menu(chat_id, user)
        return
    if action == "menu":
        show_menu(chat_id, user)
        return
    if not _is_teacher(user):
        show_menu(chat_id, user)
        return
    if action == "l" and len(parts) >= 4:
        list_action = parts[2]
        try:
            page = int(parts[3])
        except ValueError:
            page = 0
        _show_students(chat_id, user, page=max(page, 0), action=list_action)
        return
    student_id = parts[2] if len(parts) >= 3 else ""
    student = _get_teacher_student(user, student_id)
    if student is None:
        _reply(chat_id, "Ученик не найден.", menu_keyboard(user))
        return
    if action == "r":
        _show_reminder(chat_id, user, student)
        return
    if action == "x":
        _reply(chat_id, _send_reminder_to_student(user, student), menu_keyboard(user))
        return
    if action in ("h", "ho"):
        _show_homework_overdue(chat_id, user, student)
        return
    if action == "xo":
        _reply(
            chat_id,
            _send_text_to_student(student, build_homework_overdue_text(user, student)),
            menu_keyboard(user),
        )
        return
    if action == "j":
        _show_forwardable(
            chat_id,
            build_journal_parent_text(user, student),
            back_cb="c:l:j:0",
        )
        return
    show_menu(chat_id, user)


def _extract_start_token(text: str) -> str:
    text = (text or "").strip()
    if not text.startswith("/start"):
        return ""
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return ""
    return parts[1].strip()


def handle_telegram_update(update: dict) -> None:
    callback = update.get("callback_query")
    if callback:
        try:
            handle_callback(callback)
        except Exception:
            logger.exception("Telegram cabinet callback failed")
        return

    message = update.get("message") or update.get("edited_message") or {}
    text = message.get("text") or ""
    chat = message.get("chat") or {}
    from_user = message.get("from") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        return

    start_token = _extract_start_token(text)
    if start_token:
        try:
            user = bind_telegram_account(
                token=start_token,
                chat_id=str(chat_id),
                username=from_user.get("username") or "",
            )
            _reply(
                chat_id,
                "Telegram подключён.\n\n" + _welcome_text(user),
                menu_keyboard(user),
            )
            logger.info("Telegram linked for user_id=%s chat_id=%s", user.id, chat_id)
        except ValueError as exc:
            _reply(chat_id, str(exc))
        except Exception:
            logger.exception("Telegram webhook bind failed")
        return

    user = user_by_chat_id(chat_id)
    if user is None:
        _reply(
            chat_id,
            "Чтобы пользоваться кабинетом в Telegram, откройте настройки уведомлений "
            "в личном кабинете и нажмите «Подключить Telegram».\n\n"
            f"{telegram_open_html('/cabinet', 'Открыть кабинет')}",
        )
        return

    try:
        handle_connected_text(chat_id, user, text)
    except Exception:
        logger.exception("Telegram cabinet command failed")
