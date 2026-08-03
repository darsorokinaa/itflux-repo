"""
Централизованная отправка уведомлений.

Бизнес-модули вызывают NotificationDispatcher.notify(...) и не работают
с VAPID / PushSubscription / дублями напрямую.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.utils import timezone

from .choices import NotificationChannel, NotificationStatus
from .models import Notification, NotificationPreference, Profile
from .notification_catalog import (
    CHANNEL_IN_APP,
    CHANNEL_PUSH,
    CHANNEL_TELEGRAM,
    ROLE_PARENT,
    ROLE_STUDENT,
    ROLE_TEACHER,
    EventDefinition,
    NotificationEventType,
    get_event_definition,
)

logger = logging.getLogger("cabinet.notifications")


@dataclass
class NotifyResult:
    skipped: bool = False
    reason: str = ""
    in_app: Notification | None = None
    push_sent: int = 0
    push_active: int = 0
    channels: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "skipped": self.skipped,
            "reason": self.reason,
            "in_app_id": self.in_app.pk if self.in_app else None,
            "push_sent": self.push_sent,
            "push_active": self.push_active,
            "channels": self.channels,
        }


def get_or_create_preferences(user: User) -> NotificationPreference:
    """Create missing prefs once; never reset existing values."""
    prefs, _created = NotificationPreference.objects.get_or_create(user=user)
    return prefs


def user_role(user: User | None) -> str:
    if user is None:
        return ""
    role = getattr(getattr(user, "profile", None), "role", None)
    if role == Profile.Role.STUDENT:
        return ROLE_STUDENT
    if role == Profile.Role.PARENT:
        return ROLE_PARENT
    if role == Profile.Role.TEACHER:
        return ROLE_TEACHER
    # Fallbacks when Profile.role is missing
    try:
        from .models import Student

        if Student.objects.filter(user=user).exists():
            return ROLE_STUDENT
    except Exception:
        pass
    if role:
        return str(role)
    return ROLE_TEACHER


def _format_template(template: str, context: dict[str, Any]) -> str:
    if not template:
        return ""
    try:
        return template.format(**context)
    except (KeyError, ValueError):
        return template


class NotificationPreferenceService:
    """Чтение и проверка пользовательских настроек."""

    @staticmethod
    def get_preferences(user: User) -> NotificationPreference:
        return get_or_create_preferences(user)

    @staticmethod
    def is_event_enabled(
        user: User,
        event_type: str,
        *,
        prefs: NotificationPreference | None = None,
        definition: EventDefinition | None = None,
    ) -> tuple[bool, str]:
        definition = definition or get_event_definition(event_type)
        if definition is None:
            return True, "unknown_event_default_allow"
        if not definition.can_disable:
            return True, "required"
        if definition.preference_field is None:
            # Lesson reminders: empty list disables; otherwise enabled
            if event_type == NotificationEventType.LESSON_REMINDER:
                prefs = prefs or get_or_create_preferences(user)
                minutes = prefs.effective_lesson_reminder_minutes()
                if not minutes:
                    return False, "reminders_disabled"
                return True, "reminders_enabled"
            return True, "no_preference_field"

        prefs = prefs or get_or_create_preferences(user)
        field = definition.preference_field
        # Weekly digest shares daily field name in catalog for billing_digest —
        # callers for weekly must check notify_billing_weekly_digest themselves.
        enabled = bool(getattr(prefs, field, definition.default_enabled))
        if not enabled:
            return False, f"pref_disabled:{field}"
        return True, f"pref_enabled:{field}"

    @staticmethod
    def enabled_channels(
        user: User,
        event_type: str,
        *,
        prefs: NotificationPreference | None = None,
        definition: EventDefinition | None = None,
        force_channels: set[str] | None = None,
    ) -> tuple[set[str], str]:
        definition = definition or get_event_definition(event_type)
        prefs = prefs or get_or_create_preferences(user)
        allowed = set(definition.channels) if definition else {CHANNEL_IN_APP, CHANNEL_PUSH}
        if force_channels is not None:
            allowed = allowed & force_channels

        enabled: set[str] = set()
        if CHANNEL_IN_APP in allowed and prefs.in_app_enabled:
            enabled.add(CHANNEL_IN_APP)
        if CHANNEL_PUSH in allowed and prefs.push_enabled:
            enabled.add(CHANNEL_PUSH)
        if CHANNEL_TELEGRAM in allowed and prefs.telegram_connected:
            enabled.add(CHANNEL_TELEGRAM)

        if not enabled:
            return enabled, "no_channels"
        return enabled, "ok"


class NotificationDispatcher:
    """Единая точка создания in-app и отправки Web Push / Telegram."""

    @classmethod
    def notify(
        cls,
        recipient: User,
        event_type: str,
        *,
        title: str,
        message: str,
        actor: User | None = None,
        related_object: Any = None,
        context: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        url: str | None = None,
        dedup_key: str | None = None,
        recipient_student=None,
        recipient_teacher=None,
        skip_actor: bool = True,
        force: bool = False,
        force_channels: set[str] | None = None,
        push_tag: str = "",
        create_in_app: bool | None = None,
        create_push: bool | None = None,
        create_telegram: bool | None = None,
        telegram_text: str | None = None,
        private_title: str | None = None,
        private_message: str | None = None,
    ) -> NotifyResult:
        context = dict(context or {})
        payload = dict(payload or {})
        definition = get_event_definition(event_type)
        result = NotifyResult()

        if recipient is None:
            result.skipped = True
            result.reason = "no_recipient"
            logger.info(
                "notify_skip",
                extra={"event_type": event_type, "reason": result.reason},
            )
            return result

        if skip_actor and actor is not None and actor.pk == recipient.pk:
            result.skipped = True
            result.reason = "actor_is_recipient"
            logger.info(
                "notify_skip event=%s recipient=%s reason=%s",
                event_type,
                recipient.pk,
                result.reason,
            )
            return result

        role = user_role(recipient)
        if definition and definition.roles and role and role not in definition.roles:
            # Soft check: parents rarely have profile; allow if no role mismatch is strict
            if role not in definition.roles:
                result.skipped = True
                result.reason = f"role_not_allowed:{role}"
                logger.info(
                    "notify_skip event=%s recipient=%s reason=%s",
                    event_type,
                    recipient.pk,
                    result.reason,
                )
                return result

        prefs = get_or_create_preferences(recipient)
        if not force:
            enabled, reason = NotificationPreferenceService.is_event_enabled(
                recipient, event_type, prefs=prefs, definition=definition
            )
            if not enabled:
                result.skipped = True
                result.reason = reason
                logger.info(
                    "notify_skip event=%s recipient=%s reason=%s",
                    event_type,
                    recipient.pk,
                    result.reason,
                )
                return result

        channels, ch_reason = NotificationPreferenceService.enabled_channels(
            recipient,
            event_type,
            prefs=prefs,
            definition=definition,
            force_channels=force_channels,
        )
        if create_in_app is False:
            channels.discard(CHANNEL_IN_APP)
        if create_push is False:
            channels.discard(CHANNEL_PUSH)
        if create_telegram is False:
            channels.discard(CHANNEL_TELEGRAM)
        elif create_telegram is True:
            if prefs.telegram_connected:
                channels.add(CHANNEL_TELEGRAM)
        # create_telegram is None → leave channel decision to prefs + catalog

        if force and force_channels:
            channels = set(force_channels)

        if not channels and not force:
            result.skipped = True
            result.reason = ch_reason or "no_channels"
            logger.info(
                "notify_skip event=%s recipient=%s reason=%s",
                event_type,
                recipient.pk,
                result.reason,
            )
            return result

        # Build URL / payload
        if url:
            payload["url"] = url
        elif "url" not in payload and definition:
            payload["url"] = definition.url_default

        payload.setdefault("type", event_type)
        payload.setdefault("event_type", event_type)
        if related_object is not None:
            payload.setdefault("source_object_type", related_object.__class__.__name__)
            payload.setdefault("source_object_id", getattr(related_object, "pk", None))

        event_key = dedup_key or None
        if event_key:
            existing = Notification.objects.filter(
                recipient_user=recipient,
                event_key=event_key,
                channel=NotificationChannel.IN_APP,
            ).first()
            if existing:
                result.skipped = True
                result.reason = "duplicate"
                result.in_app = existing
                logger.info(
                    "notify_skip event=%s recipient=%s reason=duplicate key=%s",
                    event_type,
                    recipient.pk,
                    event_key,
                )
                return result

        priority = definition.priority if definition else "important"
        urgent = bool(definition.urgent) if definition else False

        in_app_note = None
        if CHANNEL_IN_APP in channels or (force and create_in_app is not False and CHANNEL_IN_APP in (force_channels or {CHANNEL_IN_APP})):
            if prefs.in_app_enabled or force:
                try:
                    with transaction.atomic():
                        in_app_note = Notification.objects.create(
                            recipient_user=recipient,
                            recipient_student=recipient_student,
                            recipient_teacher=recipient_teacher,
                            actor=actor,
                            channel=NotificationChannel.IN_APP,
                            event_type=event_type,
                            event_key=event_key or "",
                            title=title[:255],
                            message=message,
                            payload=payload,
                            status=NotificationStatus.SENT,
                            sent_at=timezone.now(),
                        )
                except IntegrityError:
                    existing = Notification.objects.filter(
                        recipient_user=recipient,
                        event_key=event_key,
                        channel=NotificationChannel.IN_APP,
                    ).first()
                    result.skipped = True
                    result.reason = "duplicate"
                    result.in_app = existing
                    logger.info(
                        "notify_skip event=%s recipient=%s reason=duplicate_integrity",
                        event_type,
                        recipient.pk,
                    )
                    return result
                result.in_app = in_app_note
                result.channels.append(CHANNEL_IN_APP)
                logger.info(
                    "notify_in_app event=%s recipient=%s notification_id=%s",
                    event_type,
                    recipient.pk,
                    in_app_note.pk,
                )

        push_title = title
        push_body = message
        if getattr(prefs, "push_privacy_mode", False) and not force:
            push_title = private_title or "Новое уведомление"
            push_body = private_message or "На платформе появилось новое событие"

        push_result = {"sent": 0, "active": 0, "reason": ""}
        if CHANNEL_PUSH in channels or (force and create_push is not False):
            from .webpush import send_web_push_to_user

            push_url = payload.get("url") if isinstance(payload.get("url"), str) else "/cabinet"
            push_result = send_web_push_to_user(
                recipient,
                title=push_title,
                body=push_body,
                url=push_url,
                tag=push_tag or event_type,
                priority=priority,
                urgent=urgent,
                payload_extra=payload,
                create_log=True,
                force=force,
                notification=in_app_note,
                event_type=event_type,
            )
            result.push_sent = int(push_result.get("sent") or 0)
            result.push_active = int(push_result.get("active") or 0)
            if result.push_sent:
                result.channels.append(CHANNEL_PUSH)
            logger.info(
                "notify_push event=%s recipient=%s sent=%s active=%s reason=%s",
                event_type,
                recipient.pk,
                result.push_sent,
                result.push_active,
                push_result.get("reason") or "",
            )

        if CHANNEL_TELEGRAM in channels:
            try:
                from .telegram_connect import send_telegram_to_user

                if getattr(prefs, "push_privacy_mode", False) and not force:
                    text = telegram_text or (
                        f"{private_title or 'Новое уведомление'}\n\n"
                        f"{private_message or 'На платформе появилось новое событие'}"
                    )
                else:
                    text = telegram_text or f"{title}\n\n{message}"
                ok = send_telegram_to_user(recipient, text)
                Notification.objects.create(
                    recipient_user=recipient,
                    recipient_student=recipient_student,
                    recipient_teacher=recipient_teacher,
                    actor=actor,
                    channel=NotificationChannel.TELEGRAM,
                    event_type=event_type,
                    event_key=(f"{event_key}:tg" if event_key else ""),
                    title=title[:255],
                    message=message,
                    payload=payload,
                    status=NotificationStatus.SENT if ok else NotificationStatus.FAILED,
                    sent_at=timezone.now() if ok else None,
                    is_read=True,
                )
                if ok:
                    result.channels.append(CHANNEL_TELEGRAM)
            except Exception:
                logger.exception(
                    "notify_telegram_failed event=%s recipient=%s",
                    event_type,
                    recipient.pk,
                )

        if not result.channels and not result.in_app:
            result.skipped = True
            result.reason = push_result.get("reason") or "not_delivered"
        return result

    @classmethod
    def notify_many(
        cls,
        recipients: list[User],
        event_type: str,
        **kwargs,
    ) -> list[NotifyResult]:
        results = []
        seen = set()
        for user in recipients:
            if user is None or user.pk in seen:
                continue
            seen.add(user.pk)
            results.append(cls.notify(user, event_type, **kwargs))
        return results

    @classmethod
    def mark_as_read(cls, user: User, notification_id: int) -> bool:
        updated = Notification.objects.filter(
            pk=notification_id,
            recipient_user=user,
            channel=NotificationChannel.IN_APP,
            is_read=False,
        ).update(is_read=True)
        return updated > 0

    @classmethod
    def mark_all_as_read(cls, user: User) -> int:
        return Notification.objects.filter(
            recipient_user=user,
            channel=NotificationChannel.IN_APP,
            is_read=False,
        ).update(is_read=True)

    @classmethod
    def unread_count(cls, user: User) -> int:
        return Notification.objects.filter(
            recipient_user=user,
            channel=NotificationChannel.IN_APP,
            is_read=False,
        ).count()


# Backward-compatible alias used by schedule module historically
def ensure_preferences(user: User) -> NotificationPreference:
    return get_or_create_preferences(user)
