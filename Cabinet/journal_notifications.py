"""Telegram и in-app уведомления журнала — через существующий бот и prefs."""

from __future__ import annotations

import html
import logging

from django.utils import timezone

from .choices import NotificationChannel, NotificationStatus
from .journal_models import StudentLessonRecord
from .journal_service import dashboard_attention
from .models import Notification, Student
from .notifications import get_or_create_preferences
from .telegram_connect import platform_path_url, send_telegram_to_user
from Generator.telegram_utils import escape_telegram_html

logger = logging.getLogger(__name__)


def _student_user(student: Student):
    return student.user if student and student.user_id else None


def notify_lesson_results_published(record: StudentLessonRecord) -> bool:
    """Одно объединённое уведомление ученику. Не вызывать при автосохранении."""
    student = record.student
    user = _student_user(student)
    if user is None:
        return False

    prefs = get_or_create_preferences(user)
    if not getattr(prefs, "notify_journal_results", True):
        return False

    journal = record.journal
    date_label = journal.lesson_date.strftime("%d.%m.%Y")
    topic = journal.actual_topic or journal.planned_topic or "Урок"
    comment = (record.teacher_comment or "").strip()
    recommendation = (record.recommendation or "").strip()

    lines = [
        "Итоги урока опубликованы",
        "",
        f"Дата: {date_label}",
        f"Тема: {topic}",
    ]
    if comment and getattr(prefs, "notify_journal_comment", True):
        lines.extend(["", "Комментарий учителя:", comment])
    if recommendation and getattr(prefs, "notify_journal_recommendation", True):
        lines.extend(["", "Рекомендация:", recommendation])

    results_path = f"/cabinet/student/results/{record.id}"
    results_url = platform_path_url(results_path)
    message = "\n".join(lines)

    Notification.objects.create(
        recipient_user=user,
        recipient_student=student,
        title="Итоги урока опубликованы",
        message=message,
        payload={
            "record_id": record.id,
            "journal_id": journal.id,
            "url": results_path,
            "type": "journal_results",
        },
        channel=NotificationChannel.IN_APP,
        status=NotificationStatus.SENT,
        sent_at=timezone.now(),
    )

    if prefs.telegram_connected:
        tg_text = (
            f"{escape_telegram_html(message)}\n\n"
            f'<a href="{html.escape(results_url, quote=True)}">Посмотреть результаты</a>'
        )
        try:
            ok = send_telegram_to_user(user, tg_text)
            if ok:
                Notification.objects.create(
                    recipient_user=user,
                    recipient_student=student,
                    title="Итоги урока опубликованы",
                    message=message,
                    payload={"record_id": record.id, "url": results_path, "type": "journal_results"},
                    channel=NotificationChannel.TELEGRAM,
                    status=NotificationStatus.SENT,
                    sent_at=timezone.now(),
                )
            return ok
        except Exception:
            logger.exception("Failed to send journal Telegram to user %s", user.id)
            return False
    return True


def notify_teacher_journal_digest(teacher) -> bool:
    prefs = get_or_create_preferences(teacher)
    if not getattr(prefs, "notify_journal_daily_digest", False):
        return False
    data = dashboard_attention(teacher)
    if not any(
        [
            data["unfilled_journals"],
            data["unmarked_attendance_lessons"],
            data["attention_students"],
        ]
    ):
        return False
    message = (
        "Журнал — требует внимания\n\n"
        f"Не заполнены итоги: {data['unfilled_journals']} урока\n"
        f"Не отмечена посещаемость: {data['unmarked_attendance_lessons']} урок\n"
        f"Ученики с маркером внимания: {data['attention_students']}"
    )
    if prefs.telegram_connected:
        try:
            return bool(send_telegram_to_user(teacher, message))
        except Exception:
            logger.exception("Failed journal digest for teacher %s", teacher.id)
    return False
