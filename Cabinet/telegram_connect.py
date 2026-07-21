"""Привязка аккаунта платформы к Telegram (отдельно от StudentInvitation)."""

from __future__ import annotations

import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .models import NotificationPreference, TelegramConnectToken
from .notifications import get_or_create_preferences

logger = logging.getLogger(__name__)

TELEGRAM_CONNECT_TTL = timedelta(minutes=15)
TOKEN_PREFIX = "tg_"


def telegram_bot_username() -> str:
    return (getattr(settings, "TELEGRAM_BOT_USERNAME", "") or "").strip().lstrip("@")


def telegram_bot_configured() -> bool:
    token = (getattr(settings, "TELEGRAM_BOT_TOKEN", "") or "").strip()
    return bool(token and telegram_bot_username())


def platform_base_url() -> str:
    return (
        getattr(settings, "LK_PUBLIC_URL", "")
        or getattr(settings, "ITFLUX_PUBLIC_HOME_URL", "")
        or ""
    ).rstrip("/")


def platform_path_url(path: str) -> str:
    base = platform_base_url()
    if not path.startswith("/"):
        path = f"/{path}"
    if not base:
        return path
    return f"{base}{path}"


def generate_connect_token() -> str:
    return f"{TOKEN_PREFIX}{secrets.token_urlsafe(24)}"


def telegram_connected(user: User) -> bool:
    prefs = get_or_create_preferences(user)
    return prefs.telegram_connected


def telegram_status_payload(user: User) -> dict:
    prefs = get_or_create_preferences(user)
    return {
        "connected": prefs.telegram_connected,
        "telegram_enabled": prefs.telegram_enabled,
        "telegram_username": prefs.telegram_username or "",
        "bot_configured": telegram_bot_configured(),
        "bot_username": telegram_bot_username(),
        "connected_at": (
            prefs.telegram_connected_at.isoformat() if prefs.telegram_connected_at else None
        ),
        "notify_lesson_created": prefs.notify_lesson_created,
        "notify_lesson_moved": prefs.notify_lesson_moved,
        "notify_lesson_cancelled": prefs.notify_lesson_cancelled,
        "notify_lesson_updated": prefs.notify_lesson_updated,
        "notify_homework": prefs.notify_homework,
        "notify_review": prefs.notify_review,
        "notify_before_lesson_minutes": prefs.notify_before_lesson_minutes,
        "digest_hour": prefs.digest_hour,
        "notify_payment_received": prefs.notify_payment_received,
        "notify_package_low": prefs.notify_package_low,
        "notify_debt_created": prefs.notify_debt_created,
        "notify_billing_daily_digest": prefs.notify_billing_daily_digest,
        "notify_billing_weekly_digest": prefs.notify_billing_weekly_digest,
        "notify_student_payment_recorded": prefs.notify_student_payment_recorded,
        "notify_student_package_low": prefs.notify_student_package_low,
        "notify_student_package_ended": prefs.notify_student_package_ended,
        "notify_student_unpaid_lesson": prefs.notify_student_unpaid_lesson,
        "notify_student_payment_due": prefs.notify_student_payment_due,
        "notify_journal_results": prefs.notify_journal_results,
        "notify_journal_comment": prefs.notify_journal_comment,
        "notify_journal_recommendation": prefs.notify_journal_recommendation,
        "notify_journal_daily_digest": prefs.notify_journal_daily_digest,
    }


@transaction.atomic
def create_telegram_connect_link(user: User) -> dict:
    """Создаёт одноразовую deep-link. Предыдущие неиспользованные токены инвалидируются."""
    if not telegram_bot_configured():
        raise ValueError("Подключение Telegram временно недоступно")

    now = timezone.now()
    TelegramConnectToken.objects.filter(
        user=user,
        used_at__isnull=True,
        expires_at__gte=now,
    ).update(expires_at=now)

    token = generate_connect_token()
    while TelegramConnectToken.objects.filter(token=token).exists():
        token = generate_connect_token()

    row = TelegramConnectToken.objects.create(
        user=user,
        token=token,
        expires_at=now + TELEGRAM_CONNECT_TTL,
    )
    username = telegram_bot_username()
    deep_link = f"https://t.me/{username}?start={row.token}"
    return {
        "deep_link": deep_link,
        "expires_at": row.expires_at.isoformat(),
        "expires_in_seconds": int(TELEGRAM_CONNECT_TTL.total_seconds()),
    }


def get_active_connect_token(raw_token: str) -> TelegramConnectToken | None:
    token = (raw_token or "").strip()
    if not token:
        return None
    try:
        row = TelegramConnectToken.objects.select_related("user").get(token=token)
    except TelegramConnectToken.DoesNotExist:
        return None
    if not row.is_active:
        return None
    return row


@transaction.atomic
def bind_telegram_account(*, token: str, chat_id: str, username: str = "") -> User:
    row = get_active_connect_token(token)
    if row is None:
        raise ValueError("Ссылка для подключения недействительна или истекла")

    chat_id = str(chat_id or "").strip()
    if not chat_id:
        raise ValueError("Не удалось определить Telegram-чат")

    username = (username or "").strip().lstrip("@")

    # Один chat_id — один аккаунт: отвязываем от других пользователей.
    NotificationPreference.objects.filter(telegram_chat_id=chat_id).exclude(
        user_id=row.user_id
    ).update(
        telegram_enabled=False,
        telegram_chat_id="",
        telegram_username="",
        telegram_connected_at=None,
    )

    prefs = get_or_create_preferences(row.user)
    prefs.telegram_enabled = True
    prefs.telegram_chat_id = chat_id
    prefs.telegram_username = username
    prefs.telegram_connected_at = timezone.now()
    prefs.save(
        update_fields=[
            "telegram_enabled",
            "telegram_chat_id",
            "telegram_username",
            "telegram_connected_at",
            "updated_at",
        ]
    )

    row.used_at = timezone.now()
    row.save(update_fields=["used_at"])

    # Инвалидируем остальные активные токены пользователя.
    TelegramConnectToken.objects.filter(
        user=row.user,
        used_at__isnull=True,
    ).exclude(pk=row.pk).update(expires_at=timezone.now())

    return row.user


@transaction.atomic
def disconnect_telegram(user: User) -> None:
    prefs = get_or_create_preferences(user)
    prefs.telegram_enabled = False
    prefs.telegram_chat_id = ""
    prefs.telegram_username = ""
    prefs.telegram_connected_at = None
    prefs.save(
        update_fields=[
            "telegram_enabled",
            "telegram_chat_id",
            "telegram_username",
            "telegram_connected_at",
            "updated_at",
        ]
    )
    TelegramConnectToken.objects.filter(user=user, used_at__isnull=True).update(
        expires_at=timezone.now()
    )


def update_notification_preferences(user: User, data: dict) -> dict:
    prefs = get_or_create_preferences(user)
    bool_fields = (
        "notify_lesson_created",
        "notify_lesson_moved",
        "notify_lesson_cancelled",
        "notify_lesson_updated",
        "notify_homework",
        "notify_review",
        "telegram_enabled",
        "notify_payment_received",
        "notify_package_low",
        "notify_debt_created",
        "notify_billing_daily_digest",
        "notify_billing_weekly_digest",
        "notify_student_payment_recorded",
        "notify_student_package_low",
        "notify_student_package_ended",
        "notify_student_unpaid_lesson",
        "notify_student_payment_due",
        "notify_journal_results",
        "notify_journal_comment",
        "notify_journal_recommendation",
        "notify_journal_daily_digest",
    )
    update_fields = []
    for field in bool_fields:
        if field in data:
            # Нельзя «включить» Telegram без привязанного chat_id.
            if field == "telegram_enabled" and data[field] and not prefs.telegram_chat_id:
                continue
            setattr(prefs, field, bool(data[field]))
            update_fields.append(field)

    if "notify_before_lesson_minutes" in data:
        raw = data.get("notify_before_lesson_minutes")
        if raw is None or raw == "":
            prefs.notify_before_lesson_minutes = None
        else:
            minutes = int(raw)
            if minutes < 0 or minutes > 24 * 60:
                raise ValueError("Некорректное время напоминания")
            prefs.notify_before_lesson_minutes = minutes
        update_fields.append("notify_before_lesson_minutes")

    if "digest_hour" in data:
        hour = int(data["digest_hour"])
        if hour < 0 or hour > 23:
            raise ValueError("Час сводки должен быть от 0 до 23")
        prefs.digest_hour = hour
        update_fields.append("digest_hour")

    if update_fields:
        prefs.save(update_fields=list(dict.fromkeys(update_fields)) + ["updated_at"])
    return telegram_status_payload(user)


def send_telegram_to_user(user: User, text: str) -> bool:
    prefs = get_or_create_preferences(user)
    if not prefs.telegram_connected:
        return False
    from Generator.telegram_utils import send_telegram_message

    return send_telegram_message(text, chat_id=prefs.telegram_chat_id)


def send_test_telegram_notification(user: User) -> None:
    if not telegram_connected(user):
        raise ValueError("Telegram не подключён")
    schedule_url = platform_path_url("/cabinet/schedule/")
    text = (
        "Тестовое уведомление\n\n"
        "Если вы видите это сообщение, Telegram подключён правильно.\n\n"
        f'<a href="{schedule_url}">Открыть расписание</a>'
    )
    ok = send_telegram_to_user(user, text)
    if not ok:
        raise ValueError("Не удалось отправить сообщение в Telegram")


def send_invite_welcome_if_connected(user: User, *, teacher_name: str, group_title: str | None):
    """Одно приветственное сообщение после принятия приглашения, если TG уже подключён."""
    from Generator.telegram_utils import escape_telegram_html

    if not telegram_connected(user):
        return False
    lines = [
        "Вы присоединились к учителю",
        "",
        f"Учитель: {escape_telegram_html(teacher_name)}",
    ]
    if group_title:
        lines.append(f"Группа: {escape_telegram_html(group_title)}")
    lines.extend(
        [
            "",
            "Здесь будут приходить напоминания об уроках и заданиях.",
        ]
    )
    return send_telegram_to_user(user, "\n".join(lines))
