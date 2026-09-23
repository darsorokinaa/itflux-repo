"""VK notification adapter — mock when not configured."""

import json
import logging
import random
import urllib.parse
import urllib.request

from django.conf import settings

logger = logging.getLogger(__name__)


def vk_is_configured():
    token = getattr(settings, "VK_ACCESS_TOKEN", "") or ""
    return bool(token.strip())


class VKNotificationService:
    @staticmethod
    def is_configured():
        return vk_is_configured()

    @staticmethod
    def send_message(vk_user_id, text, payload=None):
        if not vk_user_id:
            return False, "vk_user_id missing"
        if not vk_is_configured():
            logger.info("VK not configured; mock send to %s: %s", vk_user_id, text[:80])
            return False, "VK not configured"

        try:
            body = urllib.parse.urlencode({
                "user_id": vk_user_id,
                "message": text,
                "random_id": random.randint(0, 2**31 - 1),
                "access_token": settings.VK_ACCESS_TOKEN,
                "v": getattr(settings, "VK_API_VERSION", "5.131"),
            }).encode()
            req = urllib.request.Request(
                "https://api.vk.com/method/messages.send",
                data=body,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode())
            if "error" in result:
                err = result["error"].get("error_msg", "VK API error")
                logger.warning("VK send failed for %s: %s", vk_user_id, err)
                return False, err
            logger.info("VK message sent to %s", vk_user_id)
            return True, ""
        except Exception as exc:
            logger.exception("VK send exception for %s", vk_user_id)
            return False, str(exc)

    @staticmethod
    def format_lesson_created(event):
        from .schedule_notification_text import schedule_notification_copy

        _title, message = schedule_notification_copy(event, "created")
        return message

    @staticmethod
    def format_lesson_moved(event, old_start_at=None, old_end_at=None):
        from .schedule_notification_text import schedule_notification_copy

        _title, message = schedule_notification_copy(
            event,
            "moved",
            old_start_at=old_start_at,
            old_end_at=old_end_at,
        )
        return message

    @staticmethod
    def format_lesson_cancelled(event):
        from .schedule_notification_text import schedule_notification_copy

        _title, message = schedule_notification_copy(event, "cancelled")
        return message

    @staticmethod
    def format_lesson_updated(event):
        from .schedule_notification_text import schedule_notification_copy

        _title, message = schedule_notification_copy(event, "updated")
        return message

    @staticmethod
    def format_participant_added(event):
        from .schedule_notification_text import schedule_notification_copy

        _title, message = schedule_notification_copy(event, "added")
        return message

    @staticmethod
    def format_participant_removed(event):
        from .schedule_notification_text import schedule_notification_copy

        _title, message = schedule_notification_copy(event, "removed")
        return message

    @staticmethod
    def format_before_lesson(event, minutes):
        from .schedule_notification_text import event_detail_lines

        return "\n".join(event_detail_lines(
            event,
            extra_lines=[f"Через {minutes} мин"],
        ))
