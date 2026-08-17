"""Contextual in-app nudges for unfinished teacher onboarding.

Only teachers registered within NUDGE_MAX_AGE_DAYS who have not conducted
a first lesson. One notification per stage, deduped by event_key.
Push/Telegram are off — in-app only, no spam.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone

from .activation_analytics import NUDGE_MAX_AGE_DAYS, _teacher_qs
from .models import Student
from .notification_catalog import CHANNEL_IN_APP, NotificationEventType
from .notification_dispatch import NotificationDispatcher
from .onboarding_service import (
    build_teacher_onboarding_state,
    teacher_has_conducted_lesson,
)

NUDGE_DELAY = timedelta(hours=24)

NUDGE_COPY = {
    "student": {
        "event_type": NotificationEventType.ONBOARDING_ADD_STUDENT,
        "title": "Добавьте первого ученика",
        "message": "После этого можно сразу запланировать занятие — ждать входа ученика не нужно.",
        "url": "/cabinet/students?invite=1",
        "key": "onboarding:student",
    },
    "schedule": {
        "event_type": NotificationEventType.ONBOARDING_SCHEDULE_LESSON,
        "title": "Запланируйте первое занятие",
        "message": "Первый ученик уже добавлен. Материалы можно подготовить сразу внутри занятия.",
        "url": "/cabinet/schedule",
        "key": "onboarding:schedule",
    },
    "materials": {
        "event_type": NotificationEventType.ONBOARDING_ADD_MATERIALS,
        "title": "Подготовьте занятие",
        "message": "Занятие уже в расписании. Добавьте доску, готовый урок, интерактив или задания.",
        "url": "/cabinet/schedule",
        "key": "onboarding:materials",
    },
}


def _eligible_teachers(*, now=None):
    now = now or timezone.now()
    min_joined = now - timedelta(days=NUDGE_MAX_AGE_DAYS)
    return _teacher_qs().filter(date_joined__gte=min_joined, is_active=True)


def send_onboarding_nudges(*, now=None) -> dict[str, int]:
    now = now or timezone.now()
    sent = 0
    skipped = 0
    for teacher in _eligible_teachers(now=now).iterator():
        result = _nudge_teacher(teacher, now=now)
        if result == "sent":
            sent += 1
        else:
            skipped += 1
    return {"sent": sent, "skipped": skipped}


def _nudge_teacher(teacher: User, *, now) -> str:
    if teacher_has_conducted_lesson(teacher):
        return "activated"
    age = now - teacher.date_joined
    if age < NUDGE_DELAY:
        return "too_soon"

    state = build_teacher_onboarding_state(teacher)
    next_step = state.get("next_step")
    if next_step == "invite":
        return "no_nudge"
    if next_step not in NUDGE_COPY:
        return "no_nudge"

    if next_step == "schedule":
        first_student = (
            Student.objects.filter(teacher=teacher).order_by("created_at").first()
        )
        if first_student and (now - first_student.created_at) < NUDGE_DELAY:
            return "too_soon"
    if next_step == "materials":
        from .onboarding_service import _teacher_events_qs

        first_event = _teacher_events_qs(teacher).order_by("created_at").first()
        if first_event and (now - first_event.created_at) < NUDGE_DELAY:
            return "too_soon"

    spec = NUDGE_COPY[next_step]
    href = (state.get("cta") or {}).get("href") or spec["url"]
    result = NotificationDispatcher.notify(
        teacher,
        spec["event_type"],
        title=spec["title"],
        message=spec["message"],
        url=href,
        dedup_key=f"{spec['key']}:{teacher.pk}",
        payload={"type": spec["event_type"], "url": href},
        skip_actor=False,
        force=True,
        force_channels={CHANNEL_IN_APP},
        create_push=False,
        create_telegram=False,
        recipient_teacher=teacher,
    )
    if result.skipped:
        return result.reason or "skipped"
    return "sent"
