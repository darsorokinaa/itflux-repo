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
    from .teacher_notifications import _override_allows

    prefs = _prefs(teacher)
    if not prefs.notify_payment_received:
        return
    if not _override_allows(payment.student, "billing", True):
        return

    from .telegram_connect import telegram_message_with_open
    from Generator.telegram_utils import escape_telegram_html

    privacy = prefs.push_privacy_mode
    student_name = payment.student.full_name
    payments_path = f"/cabinet/payments?student={payment.student_id}"
    if privacy:
        title = "Поступила оплата"
        message = f"Ученик: {student_name}"
        tg_text = telegram_message_with_open(
            f"Поступила оплата\n\nУченик: {escape_telegram_html(student_name)}",
            payments_path,
            "Открыть оплаты",
        )
    else:
        title = "Поступила оплата"
        message = f"Ученик: {student_name}\nСумма: {payment.amount} {payment.currency}"
        tg_text = telegram_message_with_open(
            f"Поступила оплата\n\n"
            f"Ученик: {escape_telegram_html(student_name)}\n"
            f"Сумма: {payment.amount} {payment.currency}",
            payments_path,
            "Открыть оплаты",
        )

    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher

    NotificationDispatcher.notify(
        teacher,
        NotificationEventType.BILLING_PAYMENT,
        title=title,
        message=message,
        payload={
            "type": "billing_payment",
            "event_type": "billing_payment",
            "payment_id": str(payment.id),
            "student_id": payment.student_id,
            "url": f"/cabinet/payments?student={payment.student_id}",
        },
        url=f"/cabinet/payments?student={payment.student_id}",
        dedup_key=f"billing_payment:{payment.id}:{teacher.pk}",
        recipient_teacher=teacher,
        skip_actor=False,
        create_telegram=True,
        telegram_text=tg_text,
        push_tag=f"payment-{payment.id}",
        private_title="Поступила оплата",
        private_message="Зафиксирована новая оплата",
    )

    try:
        from .student_notifications import notify_student_payment_recorded

        notify_student_payment_recorded(
            teacher=teacher,
            student=payment.student,
            amount=payment.amount,
            currency=payment.currency,
        )
    except Exception:
        logger.exception("Failed student payment notification for payment=%s", payment.id)

def send_billing_message_to_student(account: BillingAccount, text: str) -> bool:
    """Отправка ученику: аккаунт + prefs учителя notify_student_payment_due."""
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher

    teacher_prefs = _prefs(account.teacher)
    if not account.student_billing_notifications:
        return False
    if not getattr(teacher_prefs, "notify_student_payment_due", False):
        return False

    student_user = account.student.user
    if not student_user:
        Notification.objects.create(
            recipient_student=account.student,
            recipient_teacher=account.teacher,
            channel=NotificationChannel.IN_APP,
            event_type=NotificationEventType.BILLING_REMINDER,
            title="Напоминание об оплате",
            message=text,
            payload={"type": "billing_reminder", "event_type": "billing_reminder", "url": "/cabinet/student"},
            status=NotificationStatus.SENT,
            sent_at=__import__("django.utils.timezone", fromlist=["now"]).now(),
        )
        return False

    result = NotificationDispatcher.notify(
        student_user,
        NotificationEventType.BILLING_REMINDER,
        title="Напоминание об оплате",
        message=text,
        actor=account.teacher,
        payload={
            "type": "billing_reminder",
            "event_type": "billing_reminder",
            "url": "/cabinet/student",
        },
        url="/cabinet/student",
        dedup_key=f"billing_reminder:{account.student_id}:{hash(text) & 0xFFFFFFFF}",
        recipient_student=account.student,
        skip_actor=True,
        create_telegram=True,
        telegram_text=text,
        push_tag=f"billing-reminder-{account.student_id}",
    )
    return not result.skipped


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
    from .notification_catalog import NotificationEventType
    from .notification_dispatch import NotificationDispatcher
    from .telegram_connect import telegram_message_with_open
    from django.utils import timezone as dj_tz

    period = "weekly" if weekly else "daily"
    day_key = dj_tz.localdate().isoformat()
    # Weekly gated above via notify_billing_weekly_digest; catalog maps digest → daily field.
    result = NotificationDispatcher.notify(
        teacher,
        NotificationEventType.BILLING_DIGEST,
        title=title,
        message=text,
        payload={
            "type": "billing_digest",
            "event_type": "billing_digest",
            "period": period,
            "url": "/cabinet/payments",
        },
        url="/cabinet/payments",
        dedup_key=f"billing_digest:{period}:{teacher.pk}:{day_key}",
        recipient_teacher=teacher,
        skip_actor=False,
        force=weekly,  # weekly already checked its own pref; bypass daily-field gate
        create_telegram=True,
        telegram_text=telegram_message_with_open(text, "/cabinet/payments", "Открыть оплаты"),
        push_tag=f"billing-digest-{period}",
        private_title=title,
        private_message="Финансовая сводка за период",
    )
    return not result.skipped
