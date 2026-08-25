"""
Единый расчёт стоимости подписки: тариф + акция + реферальная скидка + промокод.

Все пути (preview, create-payment, Init/Receipt) должны использовать этот модуль.
Акция (Promotion) применяется первой, если пользователь eligible.
Реферальная 50% и промокод НЕ суммируются — выбирается наиболее выгодная скидка.
Промокод суммируется с акцией только если Promotion.allow_promo_codes=True.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from django.contrib.auth.models import User

REFERRAL_INVITEE_DISCOUNT_PERCENT = Decimal("50")
REFERRAL_REFERRER_BONUS_DAYS = 14

ZERO = Decimal("0.00")


def _q(amount) -> Decimal:
    return Decimal(str(amount or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def base_plan_price(plan, billing_period: str = "month") -> Decimal:
    if billing_period == "year":
        return _q(plan.price_year)
    return _q(plan.price_month)


def teacher_has_successful_paid_subscription(teacher: User) -> bool:
    """Первая успешная платная покупка подписки (CONFIRMED → Payment.PAID)."""
    from .models import Payment

    return Payment.objects.filter(
        teacher=teacher,
        status=Payment.Status.PAID,
    ).exists()


def get_referral_registration(teacher: User):
    from .models import ReferralLinkRegistration

    return (
        ReferralLinkRegistration.objects.select_related("referral_link", "referral_link__owner")
        .filter(user=teacher)
        .first()
    )


def is_referral_discount_eligible(teacher: User) -> bool:
    """
    50% на первый оплачиваемый период: только приглашённые по referral,
    у которых ещё не было успешной платной покупки подписки.
    """
    reg = get_referral_registration(teacher)
    if not reg:
        return False
    if not getattr(reg, "invitee_discount_eligible", True):
        return False
    if teacher_has_successful_paid_subscription(teacher):
        return False
    return True


def referral_discount_amount(base_price: Decimal) -> Decimal:
    amount = _q(base_price)
    if amount <= ZERO:
        return ZERO
    return _q(amount * REFERRAL_INVITEE_DISCOUNT_PERCENT / Decimal("100"))


def promo_discount_breakdown(promo, base_price: Decimal) -> dict:
    """Считает скидку промокода без побочных эффектов."""
    from .models import PromoCode

    amount = _q(base_price)
    discount_value = Decimal(str(promo.discount_value or 0))
    bonus_days = int(getattr(promo, "bonus_days", 0) or 0)
    extra_free_months = 0

    if promo.discount_type == PromoCode.DiscountType.PERCENT:
        discount = _q(amount * discount_value / Decimal("100"))
        final = max(ZERO, amount - discount)
    elif promo.discount_type == PromoCode.DiscountType.FIXED:
        discount = min(amount, _q(discount_value))
        final = max(ZERO, amount - discount)
    elif promo.discount_type == PromoCode.DiscountType.FREE_MONTHS:
        discount = amount
        final = ZERO
        extra_free_months = int(discount_value or 0)
    elif promo.discount_type == PromoCode.DiscountType.BONUS_DAYS:
        discount = ZERO
        final = amount
        bonus_days += int(discount_value or 0)
    else:
        discount = ZERO
        final = amount

    return {
        "discount": discount,
        "final_amount": final,
        "discount_type": promo.discount_type,
        "discount_value": str(promo.discount_value),
        "bonus_days": bonus_days,
        "extra_free_months": extra_free_months,
        "code": promo.code,
    }


def calculate_subscription_price(
    user: Optional[User],
    plan,
    billing_period: str = "month",
    promo_code: Optional[str] = None,
    *,
    validate_promo: bool = True,
    requested_promotion_id=None,
):
    """
    Возвращает полный расчёт цены.

    Порядок:
      base → Promotion (если применимо) → PromoCode (только если allow_promo_codes)
      без акции: referral XOR promo (как раньше).

    applied_discount_source: "promotion" | "referral" | "promo" | "none"
    """
    from .promotion_service import get_applicable_promotion, promotion_pricing
    from .subscription_service import PromoCodeError, PromoCodeService

    if billing_period not in ("month", "year"):
        billing_period = "month"

    base_price = base_plan_price(plan, billing_period)
    referral_eligible = bool(user and is_referral_discount_eligible(user))
    referral_disc = referral_discount_amount(base_price) if referral_eligible else ZERO
    referral_final = max(ZERO, base_price - referral_disc)

    promotion = get_applicable_promotion(user, plan, billing_period) if user else None
    requested_ignored = False
    if requested_promotion_id:
        try:
            requested_id = int(requested_promotion_id)
        except (TypeError, ValueError):
            requested_id = None
        if requested_id is not None and (promotion is None or promotion.pk != requested_id):
            requested_ignored = True

    promo = None
    promo_error = None
    promo_breakdown = None

    applied_source = "none"
    applied_discount = ZERO
    final_price = base_price
    applied_label = ""
    bonus_days = 0
    extra_free_months = 0
    applied_promo_code = None
    applied_discount_type = None
    applied_discount_value = None
    promotion_discount = ZERO
    renewal_price = base_price
    stacked_promo = False

    if promotion is not None:
        offer = promotion_pricing(promotion, plan, billing_period)
        final_price = max(ZERO, offer["current"])
        promotion_discount = max(ZERO, offer["discount"])
        extra_free_months = int(offer["extra_free_months"] or 0)
        applied_source = "promotion"
        applied_discount = promotion_discount
        applied_discount_type = promotion.benefit_type
        applied_discount_value = (
            str(offer["current"])
            if promotion.benefit_type == "fixed_price"
            else str(extra_free_months)
        )
        applied_label = promotion.title or promotion.name
        renewal_price = offer["renewal"]

        if promo_code and user:
            if not promotion.allow_promo_codes:
                if validate_promo:
                    raise PromoCodeError(
                        "PROMO_NOT_COMBINABLE",
                        "Эту акцию нельзя совместить с промокодом.",
                    )
            else:
                try:
                    if validate_promo:
                        promo = PromoCodeService.validate(user, promo_code, plan.slug)
                    else:
                        from .models import PromoCode

                        promo = PromoCode.objects.filter(code__iexact=promo_code.strip()).first()
                        if not promo:
                            raise PromoCodeError("PROMO_NOT_FOUND", "Промокод не найден")
                    promo_breakdown = promo_discount_breakdown(promo, final_price)
                    final_price = max(ZERO, promo_breakdown["final_amount"])
                    stacked_promo = True
                    applied_promo_code = promo_breakdown["code"]
                    bonus_days = promo_breakdown["bonus_days"]
                    extra_free_months = max(
                        extra_free_months, int(promo_breakdown["extra_free_months"] or 0)
                    )
                    applied_discount = max(ZERO, base_price - final_price)
                except PromoCodeError as exc:
                    promo_error = exc
                    if validate_promo:
                        raise
    else:
        if promo_code and user:
            try:
                if validate_promo:
                    promo = PromoCodeService.validate(user, promo_code, plan.slug)
                else:
                    from .models import PromoCode

                    promo = PromoCode.objects.filter(code__iexact=promo_code.strip()).first()
                    if not promo:
                        raise PromoCodeError("PROMO_NOT_FOUND", "Промокод не найден")
                promo_breakdown = promo_discount_breakdown(promo, base_price)
            except PromoCodeError as exc:
                promo_error = exc
                if validate_promo:
                    raise

        candidates = []
        if referral_eligible and referral_disc > ZERO:
            candidates.append(
                {
                    "source": "referral",
                    "discount": referral_disc,
                    "final": referral_final,
                    "label": (
                        f"Реферальная скидка −{REFERRAL_INVITEE_DISCOUNT_PERCENT:g}% "
                        "на первый месяц"
                    ),
                    "discount_type": "percent",
                    "discount_value": str(REFERRAL_INVITEE_DISCOUNT_PERCENT),
                    "bonus_days": 0,
                    "extra_free_months": 0,
                    "promo_code": None,
                }
            )
        if promo_breakdown is not None:
            candidates.append(
                {
                    "source": "promo",
                    "discount": promo_breakdown["discount"],
                    "final": promo_breakdown["final_amount"],
                    "label": f"Промокод {promo_breakdown['code']}",
                    "discount_type": promo_breakdown["discount_type"],
                    "discount_value": promo_breakdown["discount_value"],
                    "bonus_days": promo_breakdown["bonus_days"],
                    "extra_free_months": promo_breakdown["extra_free_months"],
                    "promo_code": promo_breakdown["code"],
                }
            )

        if candidates:
            best = max(
                candidates,
                key=lambda c: (c["discount"], 1 if c["source"] == "referral" else 0),
            )
            applied_source = best["source"]
            applied_discount = best["discount"]
            final_price = best["final"]
            applied_label = best["label"]
            bonus_days = best["bonus_days"]
            extra_free_months = best["extra_free_months"]
            applied_promo_code = best["promo_code"]
            applied_discount_type = best["discount_type"]
            applied_discount_value = best["discount_value"]

    final_price = max(ZERO, _q(final_price))
    applied_discount = max(ZERO, _q(applied_discount))

    message = None
    if applied_source == "promotion":
        if stacked_promo and applied_promo_code:
            message = f"{applied_label}. Применён промокод {applied_promo_code}."
        else:
            message = applied_label or "Специальное предложение."
        if extra_free_months:
            message = (
                f"{applied_label}: {extra_free_months} "
                f"{'месяц' if extra_free_months == 1 else 'месяца' if extra_free_months in (2, 3, 4) else 'месяцев'} бесплатно."
            )
        elif final_price < base_price:
            message = (
                f"{applied_label}: {final_price} ₽ сейчас, далее {renewal_price} ₽ "
                f"{'в год' if billing_period == 'year' else 'в месяц'}."
            )
    elif applied_source == "referral" and promo_breakdown is not None:
        message = (
            f"Применена наиболее выгодная скидка — реферальная "
            f"−{REFERRAL_INVITEE_DISCOUNT_PERCENT:g}%."
        )
    elif applied_source == "promo" and referral_eligible:
        message = (
            f"Применена наиболее выгодная скидка — промокод {applied_promo_code}."
        )
    elif applied_source == "referral":
        message = "Скидка 50% по приглашению на первый месяц."
    elif applied_source == "promo":
        message = f"Применён промокод {applied_promo_code}."

    if bonus_days:
        mod10 = bonus_days % 10
        mod100 = bonus_days % 100
        if mod10 == 1 and mod100 != 11:
            days_word = "день"
        elif 2 <= mod10 <= 4 and not (12 <= mod100 <= 14):
            days_word = "дня"
        else:
            days_word = "дней"
        bonus_bit = f"+{bonus_days} {days_word} к подписке"
        message = f"{message.rstrip('.')} · {bonus_bit}." if message else f"{bonus_bit}."

    return {
        "base_price": base_price,
        "billing_period": billing_period,
        "plan_slug": plan.slug,
        "plan_name": plan.name,
        "referral_eligible": referral_eligible,
        "referral_discount_percent": (
            REFERRAL_INVITEE_DISCOUNT_PERCENT if referral_eligible else ZERO
        ),
        "referral_discount": referral_disc if referral_eligible else ZERO,
        "promo_discount": (
            promo_breakdown["discount"] if promo_breakdown is not None else ZERO
        ),
        "promo_code": applied_promo_code if (applied_source == "promo" or stacked_promo) else (
            promo_breakdown["code"] if promo_breakdown else None
        ),
        "applied_discount_source": applied_source,
        "applied_discount_type": applied_discount_type,
        "applied_discount_value": applied_discount_value,
        "applied_discount": applied_discount,
        "applied_label": applied_label,
        "final_price": final_price,
        "bonus_days": bonus_days,
        "extra_free_months": extra_free_months,
        "message": message,
        "promo_error": promo_error.to_dict() if promo_error else None,
        "promotion_id": promotion.pk if promotion is not None else None,
        "promotion_title": (promotion.title if promotion is not None else None),
        "promotion_discount": promotion_discount,
        "renewal_price": renewal_price,
        "pricing_duration": (
            promotion.pricing_duration if promotion is not None else None
        ),
        "promotion_request_ignored": requested_ignored,
        "stacked_promo": stacked_promo,
    }


def price_payload(calc: dict) -> dict:
    """JSON-friendly копия расчёта."""
    def s(v):
        if isinstance(v, Decimal):
            return str(v)
        return v

    return {
        "base_price": s(calc["base_price"]),
        "billing_period": calc["billing_period"],
        "plan_slug": calc["plan_slug"],
        "plan_name": calc["plan_name"],
        "referral_eligible": calc["referral_eligible"],
        "referral_discount_percent": s(calc["referral_discount_percent"]),
        "referral_discount": s(calc["referral_discount"]),
        "promo_discount": s(calc["promo_discount"]),
        "promo_code": calc.get("promo_code"),
        "applied_discount_source": calc["applied_discount_source"],
        "applied_discount_type": calc.get("applied_discount_type"),
        "applied_discount_value": s(calc.get("applied_discount_value")),
        "applied_discount": s(calc["applied_discount"]),
        "applied_label": calc.get("applied_label") or "",
        "final_price": s(calc["final_price"]),
        "final_amount": s(calc["final_price"]),  # alias for older clients
        "discount": s(calc["applied_discount"]),
        "bonus_days": calc.get("bonus_days") or 0,
        "extra_free_months": calc.get("extra_free_months") or 0,
        "message": calc.get("message"),
        "promotion_id": calc.get("promotion_id"),
        "promotion_title": calc.get("promotion_title"),
        "promotion_discount": s(calc.get("promotion_discount") or ZERO),
        "renewal_price": s(calc.get("renewal_price") or calc["base_price"]),
        "pricing_duration": calc.get("pricing_duration"),
        "promotion_request_ignored": bool(calc.get("promotion_request_ignored")),
        "stacked_promo": bool(calc.get("stacked_promo")),
    }
