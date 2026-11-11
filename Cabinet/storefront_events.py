"""Запись событий витрины. Клиент не может подставить чужой user_id."""

from __future__ import annotations

from django.db import IntegrityError, transaction

from .acquisition import clean_acquisition_token
from .storefront_models import StorefrontEvent

CLIENT_EVENTS = frozenset({
    StorefrontEvent.Name.PRICING_VIEW,
    StorefrontEvent.Name.TARIFF_CLICK,
    StorefrontEvent.Name.PROMO_APPLIED,
})
SERVER_EVENTS = frozenset({
    StorefrontEvent.Name.PAYMENT_CREATED,
    StorefrontEvent.Name.HOMEWORK_CREATED,
    StorefrontEvent.Name.INVITE_ACCEPTED,
})
_META_KEYS = ("plan_slug", "promo_code", "billing_period")


def sanitize_storefront_metadata(raw, *, payment_id=None, object_id=None) -> dict:
    source = raw if isinstance(raw, dict) else {}
    meta = {}
    plan = clean_acquisition_token(source.get("plan_slug"), limit=32)
    if plan:
        meta["plan_slug"] = plan
    code = clean_acquisition_token(source.get("promo_code"), limit=64)
    if code:
        meta["promo_code"] = code
    period = str(source.get("billing_period") or "").strip().lower()
    if period in ("month", "year"):
        meta["billing_period"] = period
    if payment_id:
        try:
            meta["payment_id"] = int(payment_id)
        except (TypeError, ValueError):
            pass
    if object_id:
        try:
            meta["object_id"] = int(object_id)
        except (TypeError, ValueError):
            pass
    return meta


def record_storefront_event(
    *,
    event_name: str,
    user=None,
    metadata=None,
    idempotency_key: str = "",
    payment_id=None,
    object_id=None,
):
    """Возвращает (event, created). Повтор с тем же ключом не создаёт вторую строку."""
    name = str(event_name or "").strip()
    allowed = set(CLIENT_EVENTS) | set(SERVER_EVENTS)
    if name not in allowed:
        raise ValueError("unknown storefront event")
    key = clean_acquisition_token(idempotency_key, limit=80) or ""
    meta = sanitize_storefront_metadata(metadata, payment_id=payment_id, object_id=object_id)
    if key:
        existing = StorefrontEvent.objects.filter(idempotency_key=key).first()
        if existing:
            return existing, False
    try:
        with transaction.atomic():
            event = StorefrontEvent.objects.create(
                event_name=name,
                user=user if getattr(user, "is_authenticated", False) else None,
                metadata=meta,
                idempotency_key=key or None,
            )
    except IntegrityError:
        if key:
            existing = StorefrontEvent.objects.filter(idempotency_key=key).first()
            if existing:
                return existing, False
        raise
    return event, True
