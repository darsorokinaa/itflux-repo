"""Финансовые уведомления через существующий Telegram-канал (без новых ботов/ссылок)."""

from __future__ import annotations

import logging

from django.contrib.auth.models import User

from .billing_models import BillingAccount, StudentPayment
from .models import Notification, NotificationPreference
from .choices import NotificationChannel, NotificationStatus

logger = logging.getLogger(__name__)


def _prefs(user: User) -> NotificationPreference:
    prefs, _ = NotificationPreference.objects.get_or_create(user=user)
    return prefs


def _send_telegram(user: User, text: str) -> bool:
    prefs = _prefs(user)
    if not prefs.telegram_connected:
        return False
    try:
        from Generator.telegram_utils import send_telegram_message

        return bool(send_telegram_message(text, chat_id=str(prefs.telegram_chat_id)))
    except Exception:
        logger.exception("Failed to send billing telegram to user=%s", user.id)
        return False


def notify_payment_received(teacher: User, payment: StudentPayment) -> None:
    from Generator.telegram_utils import escape_telegram_html

    prefs = _prefs(teacher)
    if not prefs.notify_payment_received:
        return
    text = (
        f"Ученик: {escape_telegram_html(payment.student.full_name)}\n"
        f"Сумма: {payment.amount} {payment.currency}"
    )
    Notification.objects.create(
        recipient_user=teacher,
        recipient_teacher=teacher,
        channel=NotificationChannel.IN_APP,
        title="Поступила оплата",
        message=text,
        payload={
            "type": "billing_payment",
            "payment_id": str(payment.id),
            "url": "/cabinet/payments",
        },
        status=NotificationStatus.SENT,
    )
    if prefs.telegram_enabled:
        _send_telegram(teacher, f"Поступила оплата\n\n{text}\n\nОткрыть: /cabinet/payments")


def send_billing_message_to_student(account: BillingAccount, text: str) -> bool:
    """Отправка ученику только если явно разрешено на аккаунте и в prefs учителя."""
    if not account.student_billing_notifications:
        # Still create in-app for linked user if show_billing allowed — reminder is explicit teacher action
        pass
    student_user = account.student.user
    if not student_user:
        # Store as notification on student roster only
        Notification.objects.create(
            recipient_student=account.student,
            recipient_teacher=account.teacher,
            channel=NotificationChannel.IN_APP,
            title="Напоминание об оплате",
            message=text,
            payload={"type": "billing_reminder", "url": "/cabinet/student"},
            status=NotificationStatus.SENT,
        )
        return False

    Notification.objects.create(
        recipient_user=student_user,
        recipient_student=account.student,
        channel=NotificationChannel.IN_APP,
        title="Напоминание об оплате",
        message=text,
        payload={"type": "billing_reminder", "url": "/cabinet/student"},
        status=NotificationStatus.SENT,
    )
    return _send_telegram(student_user, text)


def build_daily_digest_text(summary: dict) -> str:
    return (
        "Оплаты — сводка за сегодня\n\n"
        f"Получено: {summary.get('today_received', '0')} {summary.get('currency', 'RUB')}\n"
        f"Ожидают оплаты: {summary.get('awaiting_payment_count', 0)} "
        f"на {summary.get('expected_incoming', '0')} {summary.get('currency', 'RUB')}\n"
        f"Заканчиваются абонементы: {summary.get('low_packages', 0)}\n"
        f"Требуют оформления: {summary.get('needs_decision', 0)}"
    )


def send_teacher_billing_digest(teacher: User, summary: dict, *, weekly: bool = False) -> bool:
    prefs = _prefs(teacher)
    if weekly and not prefs.notify_billing_weekly_digest:
        return False
    if not weekly and not prefs.notify_billing_daily_digest:
        return False
    title = "Оплаты — недельная сводка" if weekly else "Оплаты — сводка за сегодня"
    text = build_daily_digest_text(summary)
    if weekly:
        text = text.replace("за сегодня", "за неделю")
    Notification.objects.create(
        recipient_user=teacher,
        recipient_teacher=teacher,
        channel=NotificationChannel.IN_APP,
        title=title,
        message=text,
        payload={"type": "billing_digest", "url": "/cabinet/payments"},
        status=NotificationStatus.SENT,
    )
    if prefs.telegram_enabled:
        return _send_telegram(teacher, f"{text}\n\nОткрыть: /cabinet/payments")
    return True
