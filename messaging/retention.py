"""Виды сроков хранения. Числа дней задаются строками RetentionPolicy, не кодом."""

from __future__ import annotations

from django.conf import settings
from django.utils import timezone

# Отдельный источник срока на каждый вид данных.
KIND_MESSAGE_CONTENT = "message_content"
KIND_MESSAGE_METADATA = "message_metadata"
KIND_ATTACHMENTS = "attachments"
KIND_DELIVERY_METADATA = "delivery_metadata"
KIND_CONSENT_LOGS = "consent_logs"
KIND_CONSENT_EVIDENCE = "consent_evidence"
KIND_ACCESS_LOGS = "access_logs"
KIND_AUDIT_LOGS = "audit_logs"

REQUIRED_RETENTION_KINDS = (
    KIND_MESSAGE_CONTENT,
    KIND_MESSAGE_METADATA,
    KIND_ATTACHMENTS,
    KIND_DELIVERY_METADATA,
    KIND_CONSENT_LOGS,
    KIND_CONSENT_EVIDENCE,
    KIND_ACCESS_LOGS,
    KIND_AUDIT_LOGS,
)


def missing_retention_kinds() -> list[str]:
    from django.db.utils import OperationalError, ProgrammingError

    from .models import RetentionPolicy

    try:
        configured = set(
            RetentionPolicy.objects.filter(retain_days__isnull=False).values_list("object_kind", flat=True)
        )
    except (OperationalError, ProgrammingError):
        return list(REQUIRED_RETENTION_KINDS)
    return [kind for kind in REQUIRED_RETENTION_KINDS if kind not in configured]


def production_blockers() -> list[str]:
    """Почему раздел сообщений нельзя считать включённым в production.

    В development пустая политика и InMemory допустимы.
    """
    if settings.DEBUG:
        return []
    blockers: list[str] = []
    missing = missing_retention_kinds()
    if missing:
        blockers.append(
            "messaging.E001 Retention policy is not configured: " + ", ".join(missing)
        )
    backend = (
        (settings.CHANNEL_LAYERS or {})
        .get("default", {})
        .get("BACKEND", "")
    )
    if "RedisChannelLayer" not in backend:
        blockers.append(
            "messaging.E002 Messaging channel layer is not Redis. "
            "Set CHANNEL_LAYER_BACKEND=redis before production messaging."
        )
    cache_backend = (
        (settings.CACHES or {})
        .get("default", {})
        .get("BACKEND", "")
    )
    if "locmem" in cache_backend.lower():
        blockers.append(
            "messaging.E003 Messaging rate limit cache is process-local. "
            "Use a shared Redis cache before production messaging."
        )
    return blockers


def retention_until_for(kind: str):
    """Вычисленный срок по политике вида. None, если политика не задана.

    Отсутствие срока в development не означает бессрочное удаление и не запускает его.
    """
    from .models import RetentionPolicy

    policy = RetentionPolicy.objects.filter(object_kind=kind, retain_days__isnull=False).first()
    if policy is None:
        return None
    return timezone.now() + timezone.timedelta(days=policy.retain_days)
