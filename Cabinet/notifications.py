"""Schedule-event notification helpers (delegates prefs to notification_dispatch)."""

import hashlib
import html
import logging

from django.utils import timezone

from .choices import NotificationChannel, NotificationStatus, ParticipantStatus
from .models import Notification, ScheduleEvent, ScheduleEventParticipant
from .notification_catalog import NotificationEventType
from .notification_dispatch import get_or_create_preferences  # noqa: F401 — public re-export
from .vk_notifications import VKNotificationService

logger = logging.getLogger(__name__)


def _event_payload(event):
    meeting_uuid = ""
    try:
        vm = getattr(event, "video_meeting", None)
        if vm is not None:
            meeting_uuid = str(getattr(vm, "uuid", "") or "")
    except Exception:
        meeting_uuid = ""
    url = f"/cabinet/meetings/{meeting_uuid}" if meeting_uuid else f"/cabinet/schedule?event={event.pk}"
    return {
        "type": "schedule_event",
        "event_id": event.pk,
        "series_id": event.series_id,
        "title": event.title,
        "starts_at": event.starts_at.isoformat() if event.starts_at else None,
        "ends_at": event.ends_at.isoformat() if event.ends_at else None,
        "url": url,
        "meeting_uuid": meeting_uuid or None,
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


def _create_notification(
    *,
    user,
    title,
    message,
    channel,
    payload,
    status=NotificationStatus.PENDING,
    event_type="",
    event_key="",
):
    resolved = event_type or (payload or {}).get("event_type") or (payload or {}).get("type") or ""
    return Notification.objects.create(
        recipient_user=user,
        channel=channel,
        event_type=resolved,
        event_key=event_key or "",
        title=title,
        message=message,
        payload=payload,
        status=status,
    )


def _dispatch_to_user(
    user,
    participant,
    title,
    message,
    payload,
    vk_formatter=None,
    *,
    event_type="",
    event_key="",
):
    prefs = get_or_create_preferences(user)
    notifications = []
    resolved_type = event_type or (payload or {}).get("event_type") or ""

    def _channel_exists(channel):
        if not event_key:
            return False
        return Notification.objects.filter(
            recipient_user=user,
            channel=channel,
            event_key=event_key,
        ).exists()

    if prefs.in_app_enabled and participant.notification_enabled:
        if not _channel_exists(NotificationChannel.IN_APP):
            n = _create_notification(
                user=user,
                title=title,
                message=message,
                channel=NotificationChannel.IN_APP,
                payload=payload,
                status=NotificationStatus.SENT,
                event_type=resolved_type,
                event_key=event_key,
            )
            n.sent_at = timezone.now()
            n.save(update_fields=["sent_at"])
            notifications.append(n)

    vk_user_id = (participant.vk_user_id or prefs.vk_user_id or "").strip()
    if prefs.vk_enabled and vk_user_id and participant.notification_enabled:
        if not _channel_exists(NotificationChannel.VK):
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
                event_type=resolved_type,
                event_key=event_key,
            )
            if ok:
                n.sent_at = timezone.now()
                n.save(update_fields=["sent_at"])
            elif err:
                n.error_message = err
                n.save(update_fields=["error_message"])
            notifications.append(n)

    if prefs.telegram_connected and participant.notification_enabled:
        from .models import Profile
        from .telegram_connect import platform_path_url, send_telegram_to_user
        from Generator.telegram_utils import escape_telegram_html

        if not _channel_exists(NotificationChannel.TELEGRAM):
            # Постоянные маршруты платформы — без одноразовых/секретных токенов.
            role = getattr(getattr(user, "profile", None), "role", None)
            if role == Profile.Role.STUDENT:
                cabinet_path = "/cabinet/student/lessons"
            else:
                cabinet_path = "/cabinet/schedule/"
            cabinet_url = platform_path_url(cabinet_path)
            tg_text = (
                f"{escape_telegram_html(title)}\n\n{escape_telegram_html(message)}\n\n"
                f'<a href="{html.escape(cabinet_url, quote=True)}">Открыть в кабинете</a>'
            )
            ok = send_telegram_to_user(user, tg_text)
            status = NotificationStatus.SENT if ok else NotificationStatus.FAILED
            n = _create_notification(
                user=user,
                title=title,
                message=message,
                channel=NotificationChannel.TELEGRAM,
                payload={**payload, "cabinet_url": cabinet_url},
                status=status,
                event_type=resolved_type,
                event_key=event_key,
            )
            if ok:
                n.sent_at = timezone.now()
                n.save(update_fields=["sent_at"])
            notifications.append(n)

    if prefs.push_enabled and participant.notification_enabled:
        from .webpush import send_web_push_to_user
        from .notification_links import resolve_notification_url

        class _Tmp:
            pass

        tmp = _Tmp()
        tmp.payload = payload
        tmp.title = title
        push_url = payload.get("url") if isinstance(payload.get("url"), str) else resolve_notification_url(tmp)
        change = (payload or {}).get("change_type") or ""
        reminder_minutes = (payload or {}).get("reminder_minutes")
        try:
            reminder_minutes = int(reminder_minutes) if reminder_minutes is not None else None
        except (TypeError, ValueError):
            reminder_minutes = None
        urgent = change in ("cancelled", "moved") or (
            change == "reminder" and reminder_minutes is not None and reminder_minutes <= 15
        )
        push_title, push_body = title, message
        send_web_push_to_user(
            user,
            title=push_title,
            body=push_body,
            url=push_url or cabinet_path_for_user(user),
            tag=f"schedule-{payload.get('event_id')}-{change or 'event'}",
            priority="important" if urgent else "normal",
            urgent=urgent,
            payload_extra=payload,
            create_log=False,
        )

    return notifications


def cabinet_path_for_user(user):
    from .models import Profile
    role = getattr(getattr(user, "profile", None), "role", None)
    if role == Profile.Role.STUDENT:
        return "/cabinet/student/lessons"
    return "/cabinet/schedule"

_CHANGE_TO_EVENT = {
    "created": NotificationEventType.LESSON_CREATED,
    "moved": NotificationEventType.LESSON_MOVED,
    "cancelled": NotificationEventType.LESSON_CANCELLED,
    "updated": NotificationEventType.LESSON_UPDATED,
    "participants_changed": NotificationEventType.LESSON_PARTICIPANTS,
    "reminder": NotificationEventType.LESSON_REMINDER,
}


def _notify_all(
    event,
    title,
    message,
    vk_formatter=None,
    change_type=None,
    skip_user_id=None,
    extra_payload=None,
    dedup_suffix="",
):
    prefs_check = {
        "created": "notify_lesson_created",
        "moved": "notify_lesson_moved",
        "cancelled": "notify_lesson_cancelled",
        "updated": "notify_lesson_updated",
        "participants_changed": "notify_participants_changed",
    }
    payload = _event_payload(event)
    event_code = _CHANGE_TO_EVENT.get(change_type or "", NotificationEventType.SCHEDULE_EVENT)
    if change_type:
        payload["change_type"] = change_type
    payload["event_type"] = event_code
    skip_extra_ids = set()
    if extra_payload:
        raw_skip = extra_payload.pop("skip_user_ids", None)
        if raw_skip:
            skip_extra_ids = {int(x) for x in raw_skip if x is not None}
        payload.update(extra_payload)
    all_notes = []
    for user, participant in _iter_recipients(event):
        if skip_user_id and user.pk == skip_user_id:
            continue
        if user.pk in skip_extra_ids:
            continue
        if change_type and change_type != "reminder":
            field = prefs_check.get(change_type)
            if field and not getattr(get_or_create_preferences(user), field, True):
                continue
        try:
            event_key = _schedule_event_key(
                event_code,
                event,
                user,
                change_type=change_type,
                title=title,
                message=message,
                dedup_suffix=dedup_suffix,
                extra_payload=extra_payload,
            )
            all_notes.extend(
                _dispatch_to_user(
                    user,
                    participant,
                    title,
                    message,
                    payload,
                    vk_formatter,
                    event_type=event_code,
                    event_key=event_key,
                )
            )
        except Exception:
            logger.exception("Failed to notify user %s for event %s", user.pk, event.pk)
    return all_notes

class NotificationService:
    @staticmethod
    def notify_event_created(event):
        from .schedule_notification_text import schedule_notification_copy

        title, message = schedule_notification_copy(event, "created")
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: message,
            change_type="created",
        )

    @staticmethod
    def notify_event_moved(event, old_start_at=None, old_end_at=None):
        from .schedule_notification_text import schedule_notification_copy

        title, message = schedule_notification_copy(
            event,
            "moved",
            old_start_at=old_start_at,
            old_end_at=old_end_at,
        )
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: message,
            change_type="moved",
        )

    @staticmethod
    def notify_event_cancelled(event, *, events_count=1, skip_user_id=None):
        from .schedule_notification_text import schedule_notification_copy

        title, message = schedule_notification_copy(
            event,
            "cancelled",
            events_count=events_count,
        )
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: message,
            change_type="cancelled",
            skip_user_id=skip_user_id,
        )

    @staticmethod
    def notify_event_updated(event, changes=None):
        from .schedule_notification_text import schedule_notification_copy

        title, message = schedule_notification_copy(event, "updated", changes=changes)
        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: message,
            change_type="updated",
            extra_payload={"changes": list(changes.keys()) if isinstance(changes, dict) else []},
        )

    @staticmethod
    def notify_participants_changed(event, added=None, removed=None, *, skip_user_id=None):
        added = added or []
        removed = removed or []
        results = []
        prefs_field = "notify_participants_changed"
        touched_ids = set()
        for participant in added:
            user = participant.user or (
                participant.student.user if participant.student else None
            ) or participant.teacher
            if not user:
                continue
            if skip_user_id and user.pk == skip_user_id:
                continue
            if not getattr(get_or_create_preferences(user), prefs_field, True):
                continue
            touched_ids.add(user.pk)
            from .schedule_notification_text import schedule_notification_copy

            title, message = schedule_notification_copy(event, "added")
            payload = _event_payload(event)
            payload["change_type"] = "participants_changed"
            payload["event_type"] = NotificationEventType.LESSON_PARTICIPANTS
            results.extend(
                _dispatch_to_user(
                    user,
                    participant,
                    title,
                    message,
                    payload,
                    vk_formatter=lambda: message,
                    event_type=NotificationEventType.LESSON_PARTICIPANTS,
                    event_key=f"lesson_participants:{event.pk}:{user.pk}:added",
                )
            )
        for participant in removed:
            user = participant.user or (
                participant.student.user if participant.student else None
            ) or participant.teacher
            if not user:
                continue
            if skip_user_id and user.pk == skip_user_id:
                continue
            if not getattr(get_or_create_preferences(user), prefs_field, True):
                continue
            touched_ids.add(user.pk)
            from .schedule_notification_text import schedule_notification_copy

            title, message = schedule_notification_copy(event, "removed")
            payload = _event_payload(event)
            payload["change_type"] = "participants_changed"
            payload["event_type"] = NotificationEventType.LESSON_PARTICIPANTS
            results.extend(
                _dispatch_to_user(
                    user,
                    participant,
                    title,
                    message,
                    payload,
                    vk_formatter=lambda: message,
                    event_type=NotificationEventType.LESSON_PARTICIPANTS,
                    event_key=f"lesson_participants:{event.pk}:{user.pk}:removed",
                )
            )
        # Broadcast to remaining participants once (skip those already notified as added/removed)
        if added or removed:
            from .schedule_notification_text import schedule_notification_copy

            title, message = schedule_notification_copy(event, "broadcast")
            _notify_all(
                event,
                title,
                message,
                change_type="participants_changed",
                skip_user_id=skip_user_id,
                dedup_suffix="broadcast",
                extra_payload={"skip_user_ids": list(touched_ids)},
            )
        return results

    @staticmethod
    def notify_before_lesson(event, minutes):
        from .schedule_notification_text import event_detail_lines, event_kind

        if minutes >= 1400:
            title = "Урок завтра"
        elif minutes >= 50:
            title = "Урок начнётся через 1 час"
        elif minutes <= 15:
            title = "До урока осталось 10 минут"
        else:
            title = "Напоминание о занятии"

        extra = []
        if minutes <= 15 and event_kind(event) not in ("personal", "blocked"):
            extra.append("Комната занятия уже доступна")
        message = "\n".join(event_detail_lines(event, extra_lines=extra))

        return _notify_all(
            event,
            title,
            message,
            vk_formatter=lambda: message,
            change_type="reminder",
            extra_payload={"reminder_minutes": minutes, "change_type": "reminder"},
            dedup_suffix=f"{minutes}_minutes",
        )


def _schedule_event_key(
    event_code,
    event,
    user,
    *,
    change_type=None,
    title="",
    message="",
    dedup_suffix="",
    extra_payload=None,
) -> str:
    if dedup_suffix:
        suffix = str(dedup_suffix)
    elif change_type == "moved":
        suffix = event.starts_at.isoformat() if event.starts_at else "moved"
    elif change_type == "updated":
        digest = hashlib.sha256(f"{title}\n{message}".encode("utf-8")).hexdigest()[:16]
        suffix = digest
    elif change_type == "reminder":
        suffix = str((extra_payload or {}).get("reminder_minutes") or "reminder")
    else:
        suffix = change_type or "event"
    return f"{event_code}:{event.pk}:{user.pk}:{suffix}"