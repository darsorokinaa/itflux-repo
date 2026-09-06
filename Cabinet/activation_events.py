"""Record teacher activation events with per-event idempotency.

Intent events may originate from the authenticated frontend.
Confirmed events are written only after a successful backend transaction.

Time to first value (authenticated): compare occurred_at of teacher_registered
or first_cabinet_opened with the earliest of lesson_preview_viewed,
lesson_demo_started, lesson_opened_demo, lesson_opened_free,
lesson_opened_purchase, lesson_opened_subscription.
Public funnel events (value_path_selected, lesson_catalog_opened,
generator_opened, generator_result_created) stay in Metrika trackGoal —
ActivationEvent requires a user and is not duplicated here.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urlparse

from django.db import IntegrityError
from django.utils import timezone

from .activation_models import ActivationEvent

logger = logging.getLogger("cabinet.activation")

TEACHER_REGISTERED = "teacher_registered"
FIRST_CABINET_OPENED = "first_cabinet_opened"
CABINET_SESSION_STARTED = "cabinet_session_started"
STUDENTS_PAGE_OPENED = "students_page_opened"

ADD_STUDENT_CTA_VIEWED = "add_student_cta_viewed"
ADD_STUDENT_CLICKED = "add_student_clicked"
STUDENT_FORM_OPENED = "student_form_opened"
STUDENT_FORM_VALIDATION_FAILED = "student_form_validation_failed"
STUDENT_CREATED = "student_created"

STUDENT_INVITE_CREATED = "student_invite_created"
STUDENT_INVITE_COPY_CLICKED = "student_invite_copy_clicked"
STUDENT_INVITE_SHARE_CLICKED = "student_invite_share_clicked"
STUDENT_INVITE_OPENED = "student_invite_opened"
STUDENT_INVITE_WRONG_ACCOUNT = "student_invite_wrong_account"
STUDENT_INVITE_REGISTRATION_STARTED = "student_invite_registration_started"
STUDENT_INVITE_REGISTRATION_COMPLETED = "student_invite_registration_completed"
STUDENT_INVITE_ACCEPTED = "student_invite_accepted"
STUDENT_INVITE_ACCEPT_FAILED = "student_invite_accept_failed"

SUBJECT_CREATION_STARTED = "subject_creation_started"
SUBJECT_CREATED = "subject_created"

LESSON_CREATION_STARTED = "lesson_creation_started"
LESSON_CREATED = "lesson_created"
LESSON_STARTED = "lesson_started"
LESSON_COMPLETED = "lesson_completed"

CORE_ACTIVATED = "core_activated"
REPEAT_CORE = "repeat_core"

LESSON_PREVIEW_VIEWED = "lesson_preview_viewed"
LESSON_PAYWALL_VIEWED = "lesson_paywall_viewed"
LESSON_REGISTRATION_REQUIRED = "lesson_registration_required"
LESSON_DEMO_WARNING_VIEWED = "lesson_demo_warning_viewed"
LESSON_DEMO_STARTED = "lesson_demo_started"
LESSON_DEMO_FINISHED = "lesson_demo_finished"
LESSON_DEMO_EXPIRED = "lesson_demo_expired"
LESSON_DEMO_REOPEN_DENIED = "lesson_demo_reopen_denied"
LESSON_PURCHASE_STARTED = "lesson_purchase_started"
LESSON_PURCHASE_COMPLETED = "lesson_purchase_completed"
LESSON_OPENED_SUBSCRIPTION = "lesson_opened_subscription"
LESSON_OPENED_PURCHASE = "lesson_opened_purchase"
LESSON_OPENED_FREE = "lesson_opened_free"
LESSON_OPENED_DEMO = "lesson_opened_demo"

TEACHER_TASK_CREATED = "teacher_task_created"
TEACHER_TASK_EDITED = "teacher_task_edited"
TEACHER_TASK_DUPLICATED = "teacher_task_duplicated"
TEACHER_TASK_COPIED_FROM_GLOBAL = "teacher_task_copied_from_global"
TEACHER_TASK_ADDED_TO_VARIANT = "teacher_task_added_to_variant"
TEACHER_TASK_ARCHIVED = "teacher_task_archived"
TEACHER_TASK_LIMIT_REACHED = "teacher_task_limit_reached"
TEACHER_TASK_COPY_LIMIT_REACHED = "teacher_task_copy_limit_reached"
TEACHER_TASK_ATTACHMENT_PAYWALL = "teacher_task_attachment_paywall_viewed"

INTENT_EVENTS = frozenset(
    {
        ADD_STUDENT_CTA_VIEWED,
        ADD_STUDENT_CLICKED,
        STUDENT_FORM_OPENED,
        STUDENT_FORM_VALIDATION_FAILED,
        STUDENT_INVITE_COPY_CLICKED,
        STUDENT_INVITE_SHARE_CLICKED,
        STUDENT_INVITE_REGISTRATION_STARTED,
        SUBJECT_CREATION_STARTED,
        LESSON_CREATION_STARTED,
        LESSON_DEMO_WARNING_VIEWED,
    }
)

CONFIRMED_EVENTS = frozenset(
    {
        TEACHER_REGISTERED,
        FIRST_CABINET_OPENED,
        CABINET_SESSION_STARTED,
        STUDENTS_PAGE_OPENED,
        STUDENT_CREATED,
        STUDENT_INVITE_CREATED,
        STUDENT_INVITE_OPENED,
        STUDENT_INVITE_WRONG_ACCOUNT,
        STUDENT_INVITE_REGISTRATION_COMPLETED,
        STUDENT_INVITE_ACCEPTED,
        STUDENT_INVITE_ACCEPT_FAILED,
        SUBJECT_CREATED,
        LESSON_CREATED,
        LESSON_STARTED,
        LESSON_COMPLETED,
        CORE_ACTIVATED,
        REPEAT_CORE,
        LESSON_PREVIEW_VIEWED,
        LESSON_PAYWALL_VIEWED,
        LESSON_REGISTRATION_REQUIRED,
        LESSON_DEMO_STARTED,
        LESSON_DEMO_FINISHED,
        LESSON_DEMO_EXPIRED,
        LESSON_DEMO_REOPEN_DENIED,
        LESSON_PURCHASE_STARTED,
        LESSON_PURCHASE_COMPLETED,
        LESSON_OPENED_SUBSCRIPTION,
        LESSON_OPENED_PURCHASE,
        LESSON_OPENED_FREE,
        LESSON_OPENED_DEMO,
        TEACHER_TASK_CREATED,
        TEACHER_TASK_EDITED,
        TEACHER_TASK_DUPLICATED,
        TEACHER_TASK_COPIED_FROM_GLOBAL,
        TEACHER_TASK_ADDED_TO_VARIANT,
        TEACHER_TASK_ARCHIVED,
        TEACHER_TASK_LIMIT_REACHED,
        TEACHER_TASK_COPY_LIMIT_REACHED,
        TEACHER_TASK_ATTACHMENT_PAYWALL,
    }
)

ALLOWED_EVENTS = INTENT_EVENTS | CONFIRMED_EVENTS

ONCE_PER_USER_EVENTS = frozenset(
    {
        TEACHER_REGISTERED,
        FIRST_CABINET_OPENED,
        STUDENTS_PAGE_OPENED,
        ADD_STUDENT_CTA_VIEWED,
        ADD_STUDENT_CLICKED,
        STUDENT_FORM_OPENED,
        SUBJECT_CREATION_STARTED,
        LESSON_CREATION_STARTED,
        CORE_ACTIVATED,
        REPEAT_CORE,
    }
)

ONCE_PER_OBJECT_EVENTS = frozenset(
    {
        STUDENT_CREATED,
        STUDENT_INVITE_CREATED,
        STUDENT_INVITE_COPY_CLICKED,
        STUDENT_INVITE_SHARE_CLICKED,
        STUDENT_INVITE_OPENED,
        STUDENT_INVITE_REGISTRATION_STARTED,
        STUDENT_INVITE_REGISTRATION_COMPLETED,
        STUDENT_INVITE_ACCEPTED,
        SUBJECT_CREATED,
        LESSON_CREATED,
        LESSON_STARTED,
        LESSON_COMPLETED,
        LESSON_PREVIEW_VIEWED,
        LESSON_DEMO_STARTED,
        LESSON_DEMO_EXPIRED,
        LESSON_DEMO_REOPEN_DENIED,
        LESSON_PURCHASE_COMPLETED,
        LESSON_OPENED_SUBSCRIPTION,
        LESSON_OPENED_PURCHASE,
        LESSON_OPENED_FREE,
        LESSON_OPENED_DEMO,
    }
)

BLOCKED_METADATA_KEYS = frozenset(
    {
        "email",
        "name",
        "first_name",
        "last_name",
        "surname",
        "fio",
        "phone",
        "token",
        "invite_token",
        "telegram",
        "telegram_token",
        "message",
        "answer",
        "content",
        "password",
        "homework",
        "description",
        "referrer",
        "url",
        "href",
    }
)

_SAFE_TOKEN = re.compile(r"^[a-zA-Z0-9._-]{0,64}$")
_SEARCH_HOSTS = ("google.", "yandex.", "bing.", "duckduckgo.", "yahoo.")
_SOCIAL_HOSTS = (
    "t.me",
    "telegram.",
    "vk.com",
    "vk.ru",
    "facebook.",
    "instagram.",
    "ok.ru",
    "twitter.",
    "x.com",
)


def _role_of(user) -> str:
    profile = getattr(user, "profile", None)
    return str(getattr(profile, "role", "") or "")


def _session_key(request) -> str:
    if request is None:
        return ""
    session = getattr(request, "session", None)
    if session is None:
        return ""
    key = getattr(session, "session_key", None) or ""
    return str(key)[:64]


def sanitize_metadata(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    clean: dict[str, Any] = {}
    for key, value in list(raw.items())[:24]:
        name = str(key).strip().lower()[:40]
        if not name or name in BLOCKED_METADATA_KEYS:
            continue
        if any(part in name for part in ("email", "phone", "token", "telegram", "password", "name")):
            continue
        if isinstance(value, bool) or value is None:
            clean[name] = value
        elif isinstance(value, int) and not isinstance(value, bool):
            clean[name] = int(value)
        elif isinstance(value, float):
            clean[name] = round(float(value), 4)
        elif isinstance(value, str):
            text = value.strip()[:64]
            if "@" in text or "http://" in text or "https://" in text:
                continue
            clean[name] = text
    return clean


def sanitize_source(value: Any) -> str:
    text = str(value or "").strip().lower()[:64]
    if not text or not _SAFE_TOKEN.match(text.replace(":", "").replace("/", "")):
        text = re.sub(r"[^a-z0-9._:-]", "", text)[:64]
    return text


def classify_acquisition(
    *,
    referral_code: str = "",
    utm_source: str = "",
    utm_medium: str = "",
    utm_campaign: str = "",
    referrer: str = "",
) -> tuple[str, str, str]:
    """Return (source_bucket, medium, campaign). Never stores a full referrer URL."""
    ref_code = str(referral_code or "").strip()[:32]
    source = _SAFE_TOKEN.match(str(utm_source or "").strip()) and str(utm_source).strip()[:32] or ""
    medium = _SAFE_TOKEN.match(str(utm_medium or "").strip()) and str(utm_medium).strip()[:32] or ""
    campaign = _SAFE_TOKEN.match(str(utm_campaign or "").strip()) and str(utm_campaign).strip()[:64] or ""
    source_l = source.lower()
    if ref_code:
        return "referral", (medium or "referral")[:32], (campaign or "")[:64]
    if source_l in {"google", "yandex", "bing", "duckduckgo"} or (medium.lower() == "organic" and source_l):
        return "search", (medium or "organic")[:32], campaign
    if source_l in {"vk", "telegram", "instagram", "facebook", "ok", "twitter", "x"}:
        return "social", (medium or "social")[:32], campaign
    if source or campaign:
        return "campaign", medium, campaign
    host = ""
    try:
        host = (urlparse(str(referrer or "")).netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]
    except Exception:
        host = ""
    if host:
        if any(part in host for part in _SEARCH_HOSTS):
            return "search", "organic", ""
        if any(part in host for part in _SOCIAL_HOSTS):
            return "social", "social", ""
        return "unknown", "referral", ""
    return "direct", "", ""


def default_idempotency_key(
    event_name: str,
    user_id: int,
    *,
    object_id: int | None = None,
    session_key: str = "",
    extra: str = "",
) -> str:
    if event_name == CABINET_SESSION_STARTED:
        session = (session_key or "none")[:64]
        return f"{event_name}:{user_id}:{session}"
    if event_name in ONCE_PER_USER_EVENTS:
        return f"{event_name}:{user_id}"
    if event_name in ONCE_PER_OBJECT_EVENTS and object_id:
        return f"{event_name}:{int(object_id)}"
    if event_name == STUDENT_INVITE_WRONG_ACCOUNT:
        actor = extra or "anon"
        return f"{event_name}:{object_id or 0}:{actor}"
    if event_name == STUDENT_INVITE_ACCEPT_FAILED:
        return f"{event_name}:{object_id or 0}:{extra or 'failed'}"
    if event_name == STUDENT_FORM_VALIDATION_FAILED:
        return f"{event_name}:{user_id}:{extra or 'form'}"
    if extra:
        return f"{event_name}:{user_id}:{extra}"[:160]
    return f"{event_name}:{user_id}:{timezone.now().strftime('%Y%m%d%H%M%S')}"[:160]


def record_event(
    event_name: str,
    user,
    *,
    kind: str | None = None,
    object_type: str = "",
    object_id: int | None = None,
    source: str = "",
    metadata: dict | None = None,
    session_key: str = "",
    request=None,
    idempotency_key: str = "",
    extra_idempotency: str = "",
) -> ActivationEvent | None:
    """Insert one event. Duplicate idempotency keys are ignored. Never raises."""
    try:
        if user is None or not event_name:
            return None
        if event_name not in ALLOWED_EVENTS:
            return None
        if kind is None:
            kind = (
                ActivationEvent.Kind.INTENT
                if event_name in INTENT_EVENTS
                else ActivationEvent.Kind.CONFIRMED
            )
        if event_name in CONFIRMED_EVENTS:
            kind = ActivationEvent.Kind.CONFIRMED
        elif event_name in INTENT_EVENTS:
            kind = ActivationEvent.Kind.INTENT
        session = session_key or _session_key(request)
        key = (idempotency_key or "").strip()[:160] or default_idempotency_key(
            event_name,
            int(user.pk),
            object_id=object_id,
            session_key=session,
            extra=extra_idempotency,
        )
        payload = sanitize_metadata(metadata)
        obj_type = str(object_type or "")[:32]
        src = sanitize_source(source)
        role = _role_of(user)
        try:
            obj, _created = ActivationEvent.objects.get_or_create(
                idempotency_key=key,
                defaults={
                    "event_name": event_name,
                    "user": user,
                    "role": role,
                    "occurred_at": timezone.now(),
                    "session_key": session,
                    "object_type": obj_type,
                    "object_id": object_id,
                    "source": src,
                    "metadata": payload,
                    "kind": kind,
                },
            )
            return obj
        except IntegrityError:
            return ActivationEvent.objects.filter(idempotency_key=key).first()
    except Exception:
        logger.exception("activation event failed name=%s user=%s", event_name, getattr(user, "pk", None))
        return None


def record_event_on_commit(*args, **kwargs) -> None:
    """Write inside the current transaction so a rollback drops the event too."""
    record_event(*args, **kwargs)


def record_teacher_cabinet_presence(request) -> None:
    user = getattr(request, "user", None)
    if user is None or not user.is_authenticated:
        return
    if _role_of(user) != "teacher":
        return
    record_event(
        FIRST_CABINET_OPENED,
        user,
        kind=ActivationEvent.Kind.CONFIRMED,
        source="cabinet_me",
        request=request,
    )
    record_event(
        CABINET_SESSION_STARTED,
        user,
        kind=ActivationEvent.Kind.CONFIRMED,
        source="cabinet_me",
        request=request,
    )


def record_students_page_opened(teacher, *, request=None) -> None:
    if teacher is None:
        return
    record_event(
        STUDENTS_PAGE_OPENED,
        teacher,
        kind=ActivationEvent.Kind.CONFIRMED,
        source="students_api",
        request=request,
    )


def maybe_record_core(
    teacher,
    *,
    source: str,
    object_type: str = "",
    object_id: int | None = None,
    request=None,
) -> None:
    """First CORE-qualifying action → core_activated; later different object → repeat_core."""
    try:
        from .onboarding_service import (
            teacher_has_completed_journal,
            teacher_has_conducted_lesson,
            teacher_has_homework_submission,
            teacher_has_assigned_homework,
        )
        from .models import VideoMeeting

        qualifies = False
        if teacher_has_conducted_lesson(teacher) or teacher_has_completed_journal(teacher):
            qualifies = True
        elif teacher_has_assigned_homework(teacher) and teacher_has_homework_submission(teacher):
            qualifies = True
        elif VideoMeeting.objects.filter(
            schedule_event__owner=teacher,
            status=VideoMeeting.Status.FINISHED,
        ).exists():
            qualifies = True
        if not qualifies:
            return

        existing = (
            ActivationEvent.objects.filter(user=teacher, event_name=CORE_ACTIVATED)
            .only("pk", "object_id", "metadata")
            .first()
        )
        if existing is None:
            record_event(
                CORE_ACTIVATED,
                teacher,
                kind=ActivationEvent.Kind.CONFIRMED,
                object_type=object_type,
                object_id=object_id,
                source=source,
                request=request,
                metadata={"object_id": object_id} if object_id else None,
            )
            return
        first_oid = existing.object_id
        if first_oid is None and isinstance(existing.metadata, dict):
            first_oid = existing.metadata.get("object_id")
        if object_id and first_oid and int(object_id) == int(first_oid):
            return
        record_event(
            REPEAT_CORE,
            teacher,
            kind=ActivationEvent.Kind.CONFIRMED,
            object_type=object_type,
            object_id=object_id,
            source=source,
            request=request,
        )
    except Exception:
        logger.exception("core activation record failed teacher=%s", getattr(teacher, "pk", None))
