"""Минимальный кабинет в Telegram: расписание, ученики, напоминание для пересылки."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone

from .choices import HomeworkStatus, StudentStatus
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

BTN_TODAY = "Сегодня"
BTN_STUDENTS = "Ученики"
BTN_REMIND = "Напомнить"
BTN_ASSIGNMENTS = "Задания"
BTN_CABINET = "Кабинет"
STUDENTS_PAGE_SIZE = 8


def _is_teacher(user: User) -> bool:
    return user_role(user) != ROLE_STUDENT


def _cabinet_path(user: User) -> str:
    return "/cabinet/schedule" if _is_teacher(user) else "/cabinet/student"


def teacher_reply_keyboard() -> dict:
    return {
        "keyboard": [
            [{"text": BTN_TODAY}, {"text": BTN_STUDENTS}],
            [{"text": BTN_REMIND}, {"text": BTN_CABINET}],
        ],
        "resize_keyboard": True,
    }


def student_reply_keyboard() -> dict:
    return {
        "keyboard": [
            [{"text": BTN_TODAY}, {"text": BTN_ASSIGNMENTS}],
            [{"text": BTN_CABINET}],
        ],
        "resize_keyboard": True,
    }


def menu_keyboard(user: User) -> dict:
    return teacher_reply_keyboard() if _is_teacher(user) else student_reply_keyboard()


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


def _today_events(user: User) -> tuple[list[ScheduleEvent], object]:
    tz = user_zoneinfo(user)
    now = user_local_now(user)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
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
    return list(qs.order_by("starts_at")[:15]), tz


def _format_today(user: User) -> str:
    events, tz = _today_events(user)
    lines = ["Расписание на сегодня", ""]
    if not events:
        lines.append("Сегодня уроков нет.")
    else:
        for event in events:
            when = event.starts_at.astimezone(tz).strftime("%H:%M")
            title = event.title or "Занятие"
            extra = _event_audience(event)
            if extra and extra != title:
                lines.append(f"{when} — {escape_telegram_html(title)} · {escape_telegram_html(extra)}")
            else:
                lines.append(f"{when} — {escape_telegram_html(title)}")
    path = "/cabinet/schedule" if _is_teacher(user) else "/cabinet/student/lessons"
    label = "Открыть расписание" if _is_teacher(user) else "Открыть занятия"
    lines.extend(["", telegram_open_html(path, label)])
    return "\n".join(lines)


def _teacher_students(teacher: User):
    return list(
        Student.objects.filter(teacher=teacher)
        .exclude(status=StudentStatus.ARCHIVED)
        .order_by("last_name", "first_name")
    )


def _students_keyboard(students: list[Student], *, page: int = 0, action: str = "s") -> dict:
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


def _pending_homework(teacher: User, student: Student) -> list[Homework]:
    return list(
        Homework.objects.filter(
            teacher=teacher,
            status__in=[HomeworkStatus.ASSIGNED, HomeworkStatus.OVERDUE],
        )
        .filter(Q(student=student) | Q(group__students=student))
        .distinct()
        .order_by("due_at", "id")[:3]
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
    """Текст, который учитель может переслать ученику как есть."""
    first = (student.first_name or student.full_name or "друг").split()[0]
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
        lines.append(f"Напоминаю про занятие {when_label} — «{title}».")
    homework = _pending_homework(teacher, student)
    if homework:
        if event:
            lines.append("")
        if len(homework) == 1:
            hw = homework[0]
            due = hw.due_at.astimezone(tz).strftime("%d.%m") if hw.due_at else ""
            due_bit = f" (до {due})" if due else ""
            lines.append(f"Не забудь сдать «{hw.title}»{due_bit}.")
        else:
            lines.append("Не забудь сдать задания:")
            for hw in homework:
                due = hw.due_at.astimezone(tz).strftime("%d.%m") if hw.due_at else ""
                due_bit = f" — до {due}" if due else ""
                lines.append(f"• {hw.title}{due_bit}")
    if not event and not homework:
        lines.append("Напоминаю заглянуть в кабинет — там расписание и задания.")
    lines.extend(["", f"Кабинет: {platform_path_url('/cabinet/student')}"])
    return "\n".join(lines)


def _format_assignments(user: User) -> str:
    rows = _student_homework(user)
    lines = ["Задания", ""]
    if not rows:
        lines.append("Сейчас нет невыполненных заданий.")
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
            "Личный кабинет в Telegram\n\n"
            "Сегодня — уроки на день.\n"
            "Ученики — список.\n"
            "Напомнить — текст, который можно переслать ученику или отправить сюда.\n"
            "Кабинет — полная версия на сайте."
        )
    return (
        "Личный кабинет в Telegram\n\n"
        "Сегодня — занятия на день.\n"
        "Задания — что нужно сдать.\n"
        "Кабинет — полная версия на сайте."
    )


def show_menu(chat_id, user: User) -> None:
    _reply(chat_id, _welcome_text(user), menu_keyboard(user))


def _show_students(chat_id, teacher: User, *, page: int = 0, action: str = "s") -> None:
    students = _teacher_students(teacher)
    if not students:
        _reply(chat_id, "Пока нет учеников.", menu_keyboard(teacher))
        return
    title = "Кому напомнить?" if action == "r" else "Ученики"
    _reply(chat_id, title, _students_keyboard(students, page=page, action=action))


def _show_student_card(chat_id, teacher: User, student: Student) -> None:
    connected = _student_has_telegram(student)
    tg_line = "Telegram подключён" if connected else "Telegram не подключён — можно переслать сообщение"
    text = (
        f"{escape_telegram_html(student.full_name)}\n\n"
        f"{tg_line}\n\n"
        f"{telegram_open_html(f'/cabinet/students?student={student.pk}', 'Открыть в кабинете')}"
    )
    buttons = [[{"text": "Напомнить", "callback_data": f"c:r:{student.pk}"}]]
    _reply(chat_id, text, {"inline_keyboard": buttons})


def _show_reminder(chat_id, teacher: User, student: Student) -> None:
    text = escape_telegram_html(build_student_reminder_text(teacher, student))
    hint = (
        "\n\nМожно переслать ученику как есть."
        if not _student_has_telegram(student)
        else "\n\nМожно переслать или отправить ученику в бот."
    )
    buttons = []
    if _student_has_telegram(student):
        buttons.append([{"text": "Отправить ученику", "callback_data": f"c:x:{student.pk}"}])
    buttons.append([{"text": "К ученикам", "callback_data": "c:l:r:0"}])
    _reply(chat_id, text + hint, {"inline_keyboard": buttons} if buttons else None)


def _send_reminder_to_student(teacher: User, student: Student) -> str:
    user = student.user
    if user is None or not _student_has_telegram(student):
        return "Ученик ещё не подключил Telegram. Перешлите сообщение вручную."
    from .telegram_connect import send_telegram_to_user

    ok = send_telegram_to_user(user, escape_telegram_html(build_student_reminder_text(teacher, student)))
    if ok:
        return "Напоминание отправлено ученику."
    return "Не получилось отправить. Перешлите сообщение вручную."


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

    if command in (BTN_TODAY, "/today"):
        _reply(chat_id, _format_today(user), menu_keyboard(user))
        return
    if command in (BTN_CABINET, "/cabinet"):
        path = _cabinet_path(user)
        label = "Открыть кабинет учителя" if _is_teacher(user) else "Открыть кабинет"
        _reply(chat_id, telegram_open_html(path, label), menu_keyboard(user))
        return
    if _is_teacher(user) and command in (BTN_STUDENTS, "/students"):
        _show_students(chat_id, user, action="s")
        return
    if _is_teacher(user) and command in (BTN_REMIND, "/remind"):
        _show_students(chat_id, user, action="r")
        return
    if not _is_teacher(user) and command in (BTN_ASSIGNMENTS, "/homework", "/dz"):
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
    if action == "s":
        _show_student_card(chat_id, user, student)
        return
    if action == "r":
        _show_reminder(chat_id, user, student)
        return
    if action == "x":
        _reply(chat_id, _send_reminder_to_student(user, student), menu_keyboard(user))
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
                "Telegram подключён.\n\nЗдесь будут приходить напоминания об уроках и заданиях.",
            )
            show_menu(chat_id, user)
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
