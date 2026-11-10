"""Публичная сумма сбора: подписки T-Bank с даты отсечки плюс ручная поправка.

Ответ не содержит персональных данных. Сумма кэшируется на 8 минут;
сохранение записи в админке сбрасывает кэш.
"""
from __future__ import annotations

from decimal import Decimal

from django.core.cache import cache
from django.db.models import Sum
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from .models import Fundraiser, Payment

CACHE_KEY = "fundraiser:current:v1"
CACHE_SECONDS = 480  # 8 минут, внутри окна 5–10 минут
_MISSING = {"__missing": True}

PUBLIC_KEYS = ("amount_rub", "updated_at", "goal_rub")


def invalidate_fundraiser_cache() -> None:
    cache.delete(CACHE_KEY)


def _rub_number(value: Decimal):
    quantized = Decimal(value).quantize(Decimal("0.01"))
    if quantized == quantized.to_integral_value():
        return int(quantized)
    return float(quantized)


def active_fundraiser():
    return Fundraiser.objects.filter(is_active=True).order_by("-start_date", "-id").first()


def subscription_total(fundraiser: Fundraiser) -> Decimal:
    total = (
        Payment.objects.filter(
            provider="tbank",
            purpose=Payment.Purpose.SUBSCRIPTION,
            status=Payment.Status.PAID,
            paid_at__gte=fundraiser.include_subscriptions_since,
            final_amount__isnull=False,
        ).aggregate(total=Sum("final_amount"))["total"]
    )
    return total or Decimal("0")


def build_public_payload(fundraiser: Fundraiser | None = None) -> dict | None:
    fundraiser = fundraiser if fundraiser is not None else active_fundraiser()
    if fundraiser is None:
        return None
    amount = subscription_total(fundraiser) + (fundraiser.manual_adjustment_rub or Decimal("0"))
    payload = {
        "amount_rub": _rub_number(amount),
        "updated_at": timezone.now().isoformat(),
    }
    if fundraiser.goal_rub is not None:
        payload["goal_rub"] = _rub_number(fundraiser.goal_rub)
    return payload


def _cached_payload():
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return cached
    payload = build_public_payload()
    cache.set(CACHE_KEY, payload if payload is not None else _MISSING, CACHE_SECONDS)
    return payload if payload is not None else _MISSING


@require_GET
def api_fundraiser_current(request):
    cached = _cached_payload()
    if not cached or cached.get("__missing"):
        response = JsonResponse({"detail": "not found"}, status=404)
    else:
        response = JsonResponse({key: cached[key] for key in PUBLIC_KEYS if key in cached})
    response["Cache-Control"] = "public, max-age=480"
    return response
