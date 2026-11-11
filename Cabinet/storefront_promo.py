"""Публичный расчёт промокода для /pricing.

Цена считается тем же promo_discount_breakdown / calculate_subscription_price,
что и оплата. Витрина только показывает результат.
"""

from __future__ import annotations

from decimal import Decimal

from django.utils import timezone

from .pricing_service import (
    _q,
    base_plan_price,
    calculate_subscription_price,
    promo_allows_product,
    promo_discount_breakdown,
)
from .r50_tariffs import OFFER_CODE_MONTH
from .subscription_service import PromoCodeError, PromoCodeService

_MONTHS = (
    "", "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)
_PER_PLAN_SKIP = frozenset({"PROMO_NOT_APPLICABLE", "PROMO_PERIOD_MISMATCH", "PROMO_NOT_COMBINABLE"})


def ru_date_label(dt) -> str:
    if not dt:
        return ""
    local = timezone.localtime(dt)
    return f"{local.day} {_MONTHS[local.month]} {local.year}"


def _money(value) -> str:
    return str(_q(value))


def _invalid(code: str, message: str, *, suggested: bool, error_code: str) -> dict:
    return {
        "valid": False,
        "suggested": suggested,
        "code": code,
        "error_code": error_code,
        "message": message,
        "valid_until": None,
        "valid_until_label": "",
        "first_payment_only": False,
        "billing_period": "month",
        "discount_type": "",
        "discount_value": "",
        "plans": {},
    }


def _load_month_promo(code: str):
    """Промокод, который можно показать на помесячной витрине. Годовые коды не рекламируем."""
    from .models import PromoCode, PromoCodeUsage

    promo = PromoCode.objects.filter(code__iexact=code.strip()).first()
    if promo is None:
        raise PromoCodeError("PROMO_NOT_FOUND", "Промокод не найден.")
    if not promo.is_active:
        raise PromoCodeError("PROMO_INACTIVE", "Промокод больше не действует.")
    now = timezone.now()
    if promo.valid_from and now < promo.valid_from:
        raise PromoCodeError("PROMO_NOT_STARTED", "Промокод пока недоступен.")
    if promo.valid_until and now > promo.valid_until:
        raise PromoCodeError("PROMO_EXPIRED", "Срок действия промокода истёк.")
    if promo.max_uses is not None:
        reserved = PromoCodeUsage.objects.filter(
            promo_code=promo,
            status=PromoCodeUsage.Status.RESERVED,
        ).count()
        if int(promo.uses_count or 0) + reserved >= promo.max_uses:
            raise PromoCodeError("PROMO_LIMIT", "Промокод уже использован.")
    if not promo_allows_product(promo, "subscription"):
        raise PromoCodeError("PROMO_NOT_APPLICABLE", "Промокод не действует для подписки.")
    period = (promo.billing_period or "").strip()
    if period == "year":
        raise PromoCodeError(
            "PROMO_PERIOD_MISMATCH",
            "Этот промокод не применяется к помесячной оплате.",
        )
    return promo


def _plan_applies(promo, plan) -> bool:
    if not promo.applicable_plans.exists():
        return True
    return promo.applicable_plans.filter(pk=plan.pk).exists()


def _guest_plan_quote(promo, plan) -> dict:
    base = base_plan_price(plan, "month")
    if not _plan_applies(promo, plan):
        return {
            "applies": False,
            "promo_applied": False,
            "name": plan.name,
            "base_price": _money(base),
            "final_price": _money(base),
            "renewal_price": _money(base),
            "message": "",
        }
    breakdown = promo_discount_breakdown(promo, base)
    final = breakdown["final_amount"]
    renewal = base if promo.first_payment_only else final
    applied = final < base or int(breakdown.get("bonus_days") or 0) or int(breakdown.get("extra_free_months") or 0)
    return {
        "applies": True,
        "promo_applied": bool(applied),
        "name": plan.name,
        "base_price": _money(base),
        "final_price": _money(final),
        "renewal_price": _money(renewal),
        "message": "",
    }


def _user_plan_quote(user, promo, plan, code: str) -> dict:
    base = base_plan_price(plan, "month")
    try:
        PromoCodeService.validate(user, code, plan.slug, billing_period="month")
    except PromoCodeError as exc:
        if exc.code in _PER_PLAN_SKIP:
            return {
                "applies": False,
                "promo_applied": False,
                "name": plan.name,
                "base_price": _money(base),
                "final_price": _money(base),
                "renewal_price": _money(base),
                "message": exc.message,
            }
        raise
    calc = calculate_subscription_price(
        user,
        plan,
        billing_period="month",
        promo_code=code,
        validate_promo=True,
    )
    final = calc["final_price"]
    renewal = base if promo.first_payment_only else final
    promo_applied = calc.get("applied_discount_source") == "promo" or bool(calc.get("stacked_promo"))
    return {
        "applies": True,
        "promo_applied": bool(promo_applied),
        "name": plan.name,
        "base_price": _money(base),
        "final_price": _money(final),
        "renewal_price": _money(renewal if promo_applied else base),
        "message": calc.get("message") or "",
    }


def preview_storefront_promo(code: str | None, *, user=None) -> dict:
    """Расчёт для витрины. Пустой code — действующий код кампании из настроек, если он ещё жив."""
    raw = (code or "").strip()
    suggested = not raw
    resolved = raw or OFFER_CODE_MONTH
    try:
        promo = _load_month_promo(resolved)
        if user and getattr(user, "is_authenticated", False):
            PromoCodeService.validate(user, promo.code, plan_slug=None, billing_period="month")
    except PromoCodeError as exc:
        return _invalid(resolved, exc.message, suggested=suggested, error_code=exc.code)

    from .models import TariffPlan
    from .subscription_api import _plan_is_free

    plans = [
        plan
        for plan in TariffPlan.objects.filter(is_active=True, is_public=True).order_by("sort_order", "id")
        if not _plan_is_free(plan) and getattr(plan, "cta_type", "") != TariffPlan.CtaType.CONTACT
    ]
    quoted = {}
    for plan in plans:
        if user and getattr(user, "is_authenticated", False):
            try:
                quoted[plan.slug] = _user_plan_quote(user, promo, plan, promo.code)
            except PromoCodeError as exc:
                if exc.code in _PER_PLAN_SKIP:
                    base = base_plan_price(plan, "month")
                    quoted[plan.slug] = {
                        "applies": False,
                        "promo_applied": False,
                        "name": plan.name,
                        "base_price": _money(base),
                        "final_price": _money(base),
                        "renewal_price": _money(base),
                        "message": exc.message,
                    }
                    continue
                return _invalid(promo.code, exc.message, suggested=suggested, error_code=exc.code)
        else:
            quoted[plan.slug] = _guest_plan_quote(promo, plan)

    if not any(item.get("applies") for item in quoted.values()):
        return _invalid(
            promo.code,
            "Промокод не действует для помесячной оплаты.",
            suggested=suggested,
            error_code="PROMO_NOT_APPLICABLE",
        )

    return {
        "valid": True,
        "suggested": suggested,
        "code": promo.code,
        "error_code": "",
        "message": "",
        "valid_until": promo.valid_until.isoformat() if promo.valid_until else None,
        "valid_until_label": ru_date_label(promo.valid_until),
        "first_payment_only": bool(promo.first_payment_only),
        "billing_period": (promo.billing_period or "month") or "month",
        "discount_type": promo.discount_type,
        "discount_value": str(promo.discount_value),
        "plans": quoted,
    }


def teacher_offer_amount(preview: dict) -> Decimal | None:
    plan = (preview.get("plans") or {}).get("teacher") or {}
    if not preview.get("valid") or not plan.get("promo_applied"):
        return None
    return _q(plan.get("final_price") or 0)
