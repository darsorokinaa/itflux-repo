"""Telegram и in-app уведомления журнала — через существующий бот и prefs."""

from __future__ import annotations

import html
import logging

from .journal_models import StudentLessonRecord
from .journal_service import dashboard_attention
from .models import Student
from .notifications import get_or_create_preferences
from .telegram_connect import platform_path_url
from Generator.telegram_utils import escape_telegram_html

logger = logging.getLogger(__name__)


def _student_user(student: Student):
    return student.user if student and student.user_id else None


def notify_lesson_results_published(record: StudentLessonRecord) -> bool:
    """Одно объединённое уведомление ученику. Не вызывать при автосохранении."""
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher

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
    title = "Итоги урока опубликованы"
    payload = {
        "record_id": record.id,
        "journal_id": journal.id,
        "url": results_path,
        "type": "journal_results",
        "event_type": "journal_results",
    }

    tg_text = (
        f"{escape_telegram_html(message)}\n\n"
        f'<a href="{html.escape(results_url, quote=True)}">Посмотреть результаты</a>'
    )
    result = NotificationDispatcher.notify(
        user,
        NotificationEventType.JOURNAL_RESULTS,
        title=title,
        message=message,
        payload=payload,
        url=results_path,
        dedup_key=(
            f"journal_results:{record.id}:{user.pk}:"
            f"{record.published_at.isoformat() if record.published_at else 'x'}"
        ),
        recipient_student=student,
        skip_actor=False,
        create_telegram=True,
        telegram_text=tg_text,
        push_tag=f"journal-{record.id}",
        private_title="Итоги урока",
        private_message="Опубликованы итоги занятия",
    )
    return not result.skipped


def notify_journal_comment_added(record: StudentLessonRecord) -> bool:
    """Отдельное уведомление при добавлении комментария в уже опубликованные итоги."""
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher

    student = record.student
    user = _student_user(student)
    if user is None:
        return False
    comment = (record.teacher_comment or "").strip()
    if not comment:
        return False

    prefs = get_or_create_preferences(user)
    if not getattr(prefs, "notify_journal_comment", True):
        return False

    results_path = f"/cabinet/student/results/{record.id}"
    title = "Комментарий в итогах урока"
    message = comment[:400]
    result = NotificationDispatcher.notify(
        user,
        NotificationEventType.JOURNAL_COMMENT,
        title=title,
        message=message,
        payload={
            "record_id": record.id,
            "url": results_path,
            "type": NotificationEventType.JOURNAL_COMMENT,
            "event_type": NotificationEventType.JOURNAL_COMMENT,
        },
        url=results_path,
        dedup_key=f"journal_comment:{record.id}:{hash(comment) & 0xFFFFFFFF}:{user.pk}",
        recipient_student=student,
        skip_actor=False,
        create_telegram=True,
        push_tag=f"journal-comment-{record.id}",
        private_title="Комментарий в итогах",
        private_message="Учитель оставил комментарий к итогам урока",
    )
    return not result.skipped


def notify_journal_recommendation_added(record: StudentLessonRecord) -> bool:
    """Отдельное уведомление при новой рекомендации в опубликованных итогах."""
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher

    student = record.student
    user = _student_user(student)
    if user is None:
        return False
    recommendation = (record.recommendation or "").strip()
    if not recommendation:
        return False

    prefs = get_or_create_preferences(user)
    if not getattr(prefs, "notify_journal_recommendation", True):
        return False

    results_path = f"/cabinet/student/results/{record.id}"
    title = "Новая рекомендация"
    message = recommendation[:400]
    result = NotificationDispatcher.notify(
        user,
        NotificationEventType.JOURNAL_RECOMMENDATION,
        title=title,
        message=message,
        payload={
            "record_id": record.id,
            "url": results_path,
            "type": NotificationEventType.JOURNAL_RECOMMENDATION,
            "event_type": NotificationEventType.JOURNAL_RECOMMENDATION,
        },
        url=results_path,
        dedup_key=f"journal_recommendation:{record.id}:{hash(recommendation) & 0xFFFFFFFF}:{user.pk}",
        recipient_student=student,
        skip_actor=False,
        create_telegram=True,
        push_tag=f"journal-rec-{record.id}",
        private_title="Новая рекомендация",
        private_message="Учитель добавил рекомендацию к итогам урока",
    )
    return not result.skipped


def notify_teacher_journal_digest(teacher) -> bool:
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher
    from .notification_time import user_local_now

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
    title = "Журнал — требует внимания"
    message = (
        f"Не заполнены итоги: {data['unfilled_journals']} урока\n"
        f"Не отмечена посещаемость: {data['unmarked_attendance_lessons']} урок\n"
        f"Ученики с маркером внимания: {data['attention_students']}"
    )

    today = user_local_now(teacher).date().isoformat()
    result = NotificationDispatcher.notify(
        teacher,
        NotificationEventType.JOURNAL_DAILY_DIGEST,
        title=title,
        message=message,
        payload={
            "type": NotificationEventType.JOURNAL_DAILY_DIGEST,
            "event_type": NotificationEventType.JOURNAL_DAILY_DIGEST,
            "url": "/cabinet/journal",
        },
        url="/cabinet/journal",
        dedup_key=f"journal_daily_digest:{teacher.pk}:{today}",
        recipient_teacher=teacher,
        skip_actor=False,
        create_telegram=True,
        telegram_text=f"{title}\n\n{message}",
        push_tag=f"journal-digest-{teacher.pk}-{today}",
    )
    return not result.skipped
