"""Unified notification dispatch for schedule events."""

import logging
from datetime import datetime

from django.utils import timezone

from .choices import NotificationChannel, NotificationStatus, ParticipantStatus
from .models import Notification, NotificationPreference, ScheduleEvent, ScheduleEventParticipant
from .vk_notifications import VKNotificationService

logger = logging.getLogger(__name__)


def get_or_create_preferences(user):
    prefs, _ = NotificationPreference.objects.get_or_create(user=user)
    return prefs


def _event_payload(event):
    return {
        "event_id": event.pk,
        "series_id": event.series_id,
        "title": event.title,
        "starts_at": event.starts_at.isoformat() if event.starts_at else None,
        "ends_at": event.ends_at.isoformat() if event.ends_at else None,
    }


def _iter_recipients(event):
    seen_users = set()
    for p in event.participants.filter(
        status__in=[ParticipantStatus.INVITED, ParticipantStatus.ACCEPTED],
    ).select_related("user", "student", "student__user", "teacher"):
        user = p.user or (p.student.user if p.student else None) or p.teacher
        if user and user.pk not in seen_users:
            seen_users.add(user.pk)
            yield user, p


def _create_notification(*, user, title, message, channel, payload, status=NotificationStatus.PENDING):
    return Notification.objects.create(
        recipient_user=user,
        channel=channel,
        title=title,
        message=message,
        payload=payload,
        status=status,
    )


def _dispatch_to_user(user, participant, title, message, payload, vk_formatter=None):
    prefs = get_or_create_preferences(user)
    notifications = []

    if prefs.in_app_enabled and participant.notification_enabled:
        n = _create_notification(
            user=user,
            title=title,
            message=message,
            channel=NotificationChannel.IN_APP,
            payload=payload,
            status=NotificationStatus.SENT,
        )
        n.sent_at = timezone.now()
        n.save(update_fields=["sent_at"])
        notifications.append(n)

    vk_user_id = (participant.vk_user_id or prefs.vk_user_id or "").strip()
    if prefs.vk_enabled and vk_user_id and participant.notification_enabled:
        vk_text = vk_formatter() if vk_formatter else message
        ok, err = VKNotificationService.send_message(vk_user_id, vk_text, payload)
        status = NotificationStatus.SENT if ok else (
            NotificationStatus.SKIPPED if err == "VK not configured" else NotificationStatus.FAILED
        )
        n = _create_notification(
            user=user,
            title=title,
            message=vk_text,
            channel=NotificationChannel.VK,
            payload=payload,
            status=status,
        )
        if ok:
            n.sent_at = timezone.now()
            n.save(update_fields=["sent_at"])
        elif err:
            n.error_message = err
            n.save(update_fields=["error_message"])
        notifications.append(n)

    return notifications


def _notify_all(event, title, message, vk_formatter=None, change_type=None):
    if change_type:
        prefs_check = {
            "created": "notify_lesson_created",
            "moved": "notify_lesson_moved",
            "cancelled": "notify_lesson_cancelled",
            "updated": "notify_lesson_updated",
            "participants_changed": "notify_participants_changed",
        }
    payload = _event_payload(event)
    all_notes = []
    for user, participant in _iter_recipients(event):
        if change_type:
            field = prefs_check.get(change_type)
            if field and not getattr(get_or_create_preferences(user), field, True):
                continue
        try:
            all_notes.extend(
                _dispatch_to_user(user, participant, title, message, payload, vk_formatter)
            )
        except Exception:
            logger.exception("Failed to notify user %s for event %s", user.pk, event.pk)
    return all_notes


class NotificationService:
    @staticmethod
    def notify_event_created(event):
        title = "Новое занятие"
        message = f'Занятие «{event.title}» запланировано на {_local_time(event.starts_at)}.'
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: VKNotificationService.format_lesson_created(event),
            change_type="created",
        )

    @staticmethod
    def notify_event_moved(event, old_start_at=None, old_end_at=None):
        title = "Занятие перенесено"
        message = VKNotificationService.format_lesson_moved(event, old_start_at, old_end_at)
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: VKNotificationService.format_lesson_moved(event, old_start_at, old_end_at),
            change_type="moved",
        )

    @staticmethod
    def notify_event_cancelled(event):
        title = "Занятие отменено"
        message = VKNotificationService.format_lesson_cancelled(event)
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: VKNotificationService.format_lesson_cancelled(event),
            change_type="cancelled",
        )

    @staticmethod
    def notify_event_updated(event, changes=None):
        title = "Занятие изменено"
        message = VKNotificationService.format_lesson_updated(event)
        payload = _event_payload(event)
        if changes:
            payload["changes"] = changes
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: VKNotificationService.format_lesson_updated(event),
            change_type="updated",
        )

    @staticmethod
    def notify_participants_changed(event, added=None, removed=None):
        added = added or []
        removed = removed or []
        results = []
        for participant in added:
            user = participant.user or (
                participant.student.user if participant.student else None
            ) or participant.teacher
            if not user:
                continue
            title = "Вас добавили на занятие"
            message = VKNotificationService.format_participant_added(event)
            results.extend(
                _dispatch_to_user(
                    user,
                    participant,
                    title,
                    message,
                    _event_payload(event),
                    vk_formatter=lambda: VKNotificationService.format_participant_added(event),
                )
            )
        for participant in removed:
            user = participant.user or (
                participant.student.user if participant.student else None
            ) or participant.teacher
            if not user:
                continue
            title = "Изменение участников"
            message = VKNotificationService.format_participant_removed(event)
            results.extend(
                _dispatch_to_user(
                    user,
                    participant,
                    title,
                    message,
                    _event_payload(event),
                    vk_formatter=lambda: VKNotificationService.format_participant_removed(event),
                )
            )
        if added or removed:
            _notify_all(
                event,
                "Изменён состав участников",
                f'Состав занятия «{event.title}» обновлён.',
                change_type="participants_changed",
            )
        return results

    @staticmethod
    def notify_before_lesson(event, minutes):
        title = "Напоминание о занятии"
        message = VKNotificationService.format_before_lesson(event, minutes)
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: VKNotificationService.format_before_lesson(event, minutes),
        )


def _local_time(dt):
    if isinstance(dt, datetime):
        return timezone.localtime(dt).strftime("%d.%m.%Y, %H:%M")
    return str(dt)
