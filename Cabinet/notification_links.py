"""Разрешение ссылок и очистка текста in-app уведомлений."""

from __future__ import annotations

import re

from django.contrib.auth.models import User

from .models import Profile

_OPEN_PATH_RE = re.compile(r"(?:\n|^)\s*Открыть:\s*/[^\s]+\s*", re.IGNORECASE)


def strip_open_path_from_message(message: str) -> str:
    """Убирает сырые «Открыть: /cabinet/…» из текста — ссылка идёт отдельным полем."""
    text = _OPEN_PATH_RE.sub("\n", str(message or ""))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _is_student_user(user: User | None) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    profile = getattr(user, "profile", None)
    return bool(profile is not None and profile.role == Profile.Role.STUDENT)


def resolve_notification_url(notification, request=None) -> str:
    """Внутренний путь кабинета для клика по уведомлению."""
    payload = notification.payload if isinstance(notification.payload, dict) else {}
    for key in ("url", "link", "path"):
        val = payload.get(key)
        if isinstance(val, str) and val.startswith("/"):
            return val

    ntype = str(payload.get("type") or "").strip()
    user = getattr(request, "user", None) if request is not None else None
    student = _is_student_user(user)

    # TEMP: раздел оплат временно недоступен — не ведём туда из уведомлений
    if ntype in ("billing_payment", "billing_digest", "billing_reminder", "billing_package_low", "billing_unpaid_lesson"):
        student_id = payload.get("student_id")
        if student_id and not student:
            return f"/cabinet/payments?student={student_id}"
        return "/cabinet/schedule" if not student else "/cabinet/student/lessons"
    if ntype in ("homework_checked", "homework_returned"):
        hw_id = payload.get("homework_id")
        if hw_id:
            suffix = "?focus=results" if ntype == "homework_checked" else ""
            return f"/cabinet/student/assignments/{hw_id}{suffix}"
        return "/cabinet/student/assignments"
    if ntype == "journal_results":
        record_id = payload.get("record_id")
        if record_id:
            return f"/cabinet/student/results/{record_id}"
        return "/cabinet/student/results"
    if ntype == "overdue_homework_digest":
        return "/cabinet/review?filter=overdue"
    if ntype in ("homework_submitted", "homework_resubmitted", "homework_review_digest", "auto_check_attention", "student_message", "homework_updated"):
        review_id = payload.get("review_id")
        if review_id:
            return f"/cabinet/review/{review_id}"
        hw_id = payload.get("homework_id")
        if ntype == "homework_updated" and hw_id:
            return f"/cabinet/student/assignments/{hw_id}"
        return "/cabinet/review"
    if ntype == "new_student":
        sid = payload.get("student_id")
        return f"/cabinet/students?student={sid}" if sid else "/cabinet/students"
    if ntype in ("student_entered_room", "student_absent"):
        meeting_uuid = payload.get("meeting_uuid")
        if meeting_uuid:
            return f"/cabinet/meetings/{meeting_uuid}"
        return "/cabinet/schedule"
    if ntype == "daily_schedule":
        return "/cabinet/schedule"
    if ntype in ("schedule_event", "lesson", "event") or payload.get("event_id"):
        event_id = payload.get("event_id")
        if event_id:
            if student:
                return f"/cabinet/student/lessons?event={event_id}"
            return f"/cabinet/schedule?event={event_id}"
        return "/cabinet/student/lessons" if student else "/cabinet/schedule"

    title = (notification.title or "").lower()
    # TEMP: оплаты скрыты — финансовые уведомления ведут в расписание/занятия
    if "оплат" in title or "абонемент" in title or "задолжен" in title:
        return "/cabinet/schedule" if not student else "/cabinet/student/lessons"
    if any(word in title for word in ("домашн", "дз", "сдано", "проверк", "работ")):
        return "/cabinet/review" if not student else "/cabinet/student/assignments"
    if any(word in title for word in ("занят", "урок", "перенес", "отмен")):
        event_id = payload.get("event_id")
        if event_id:
            if student:
                return f"/cabinet/student/lessons?event={event_id}"
            return f"/cabinet/schedule?event={event_id}"
        return "/cabinet/student/lessons" if student else "/cabinet/schedule"
    if "итог" in title or "журнал" in title:
        return "/cabinet/student/results" if student else "/cabinet/journal"

    return ""
