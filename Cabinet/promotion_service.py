"""
Единая точка определения применимой акции (Promotion).

Не путать с PromoCode. Акция выбирается детерминированно:
eligibility → даты → тариф → лимиты → priority (больше важнее) → id.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Q
from django.utils import timezone


def _pricing():
    from . import pricing_service as ps

    return ps


class PromotionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def to_dict(self):
        return {"code": self.code, "message": self.message}


def _now(now=None):
    return now or timezone.now()


def _aware(dt):
    if dt is None:
        return None
    if timezone.is_naive(dt):
        return timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


def display_start(promotion) -> datetime:
    return promotion.display_starts_at or promotion.starts_at


def display_end(promotion) -> datetime:
    return promotion.display_ends_at or promotion.ends_at


def is_in_apply_window(promotion, now=None) -> bool:
    now = _now(now)
    if promotion.starts_at is None or promotion.ends_at is None:
        return False
    return promotion.starts_at <= now < promotion.ends_at


def is_in_display_window(promotion, now=None) -> bool:
    now = _now(now)
    start = display_start(promotion)
    end = display_end(promotion)
    if start is None or end is None:
        return False
    return start <= now < end


def _counted_statuses():
    from .models import PromotionRedemption

    return (PromotionRedemption.Status.RESERVED, PromotionRedemption.Status.APPLIED)


def redemption_count(promotion, teacher=None) -> int:
    from .models import PromotionRedemption

    qs = promotion.redemptions.filter(status__in=_counted_statuses())
    if teacher is not None:
        qs = qs.filter(teacher=teacher)
    return qs.count()


def limits_available(promotion, teacher=None) -> bool:
    if promotion.max_redemptions is not None:
        if redemption_count(promotion) >= promotion.max_redemptions:
            return False
    if teacher is not None and promotion.max_redemptions_per_user is not None:
        if redemption_count(promotion, teacher) >= promotion.max_redemptions_per_user:
            return False
    return True


def compute_status(promotion, now=None) -> str:
    now = _now(now)
    if not promotion.is_active:
        return "disabled"
    if promotion.starts_at is None or promotion.ends_at is None:
        return "scheduled"
    if now < promotion.starts_at:
        return "scheduled"
    if now >= promotion.ends_at:
        return "ended"
    if promotion.max_redemptions is not None and redemption_count(promotion) >= promotion.max_redemptions:
        return "limit_reached"
    return "active"


def _registration_at(user: User):
    from .referral_service import ReferralService

    return _aware(ReferralService.registration_started_at(user))


def _current_plan(user: User):
    from .models import TeacherSubscription
    from .subscription_downgrade import is_free_plan

    sub = (
        TeacherSubscription.objects.select_related("plan")
        .filter(teacher=user)
        .first()
    )
    return sub, (sub.plan if sub else None), is_free_plan(sub.plan if sub else None)


def user_eligible(user: Optional[User], promotion, now=None) -> bool:
    from .models import Promotion
    from .subscription_downgrade import is_free_plan

    now = _now(now)
    et = promotion.eligibility_type

    if user is None:
        return et in (
            Promotion.EligibilityType.ALL,
            Promotion.EligibilityType.NEW_USERS,
        )

    registered = _registration_at(user)
    if promotion.registered_from and registered < _aware(promotion.registered_from):
        return False
    if promotion.registered_until and registered >= _aware(promotion.registered_until):
        return False

    has_paid = _pricing().teacher_has_successful_paid_subscription(user)
    sub, plan, on_free = _current_plan(user)
    paid_valid = bool(
        sub
        and sub.is_valid()
        and plan
        and not is_free_plan(plan)
    )

    if et == Promotion.EligibilityType.ALL:
        return True
    if et == Promotion.EligibilityType.NEW_USERS:
        return not has_paid
    if et == Promotion.EligibilityType.EXISTING_USERS:
        return has_paid
    if et == Promotion.EligibilityType.CURRENT_FREE_PLAN:
        return on_free
    if et == Promotion.EligibilityType.CURRENT_PAID_USERS:
        return paid_valid
    if et == Promotion.EligibilityType.SPECIFIC_USERS:
        return promotion.eligible_users.filter(pk=user.pk).exists()
    return False


def _plan_ok(promotion) -> bool:
    plan = getattr(promotion, "plan", None)
    if plan is None or not plan.is_active:
        return False
    return True


def _is_launch_registration_promo(promotion) -> bool:
    """Стартовая выдача тарифа при регистрации — не скидка на кассе."""
    from .registration_promo import LAUNCH_PROMO_CODE

    return (getattr(promotion, "code", None) or "") == LAUNCH_PROMO_CODE


def _base_queryset(plan=None, *, lock=False):
    from .models import Promotion

    qs = Promotion.objects.select_related("plan").filter(is_active=True)
    if plan is not None:
        qs = qs.filter(plan=plan)
    qs = qs.order_by("-priority", "id")
    if lock:
        qs = qs.select_for_update()
    return qs


def get_applicable_promotion(
    user: Optional[User],
    plan,
    billing_period: str = "month",
    *,
    now=None,
    lock: bool = False,
    for_display: bool = False,
):
    """
    Одна акция для тарифа. None, если нет подходящей.

    for_display=False — можно получить (окно starts/ends + лимиты + eligibility).
    for_display=True — окно показа; лимиты не блокируют показ «завершена».
    """
    from .models import Promotion

    if plan is None or not getattr(plan, "is_active", False):
        return None
    now = _now(now)
    if billing_period not in ("month", "year"):
        billing_period = "month"

    qs = _base_queryset(plan, lock=lock)
    for promotion in qs:
        if _is_launch_registration_promo(promotion):
            continue
        if not _plan_ok(promotion):
            continue
        if for_display:
            if not is_in_display_window(promotion, now):
                continue
        else:
            if not is_in_apply_window(promotion, now):
                continue
        if not user_eligible(user, promotion, now):
            continue
        if not for_display:
            if (
                promotion.benefit_type == Promotion.BenefitType.FIXED_PRICE
                and billing_period == "year"
            ):
                continue
            if not limits_available(promotion, user):
                continue
        else:
            # Показ: скрыть, если пользователь уже исчерпал личный лимит
            # (кроме статуса ended в окне показа).
            status = compute_status(promotion, now)
            if status not in ("ended", "scheduled") and user is not None:
                if promotion.max_redemptions_per_user is not None:
                    if redemption_count(promotion, user) >= promotion.max_redemptions_per_user:
                        continue
        return promotion
    return None


def list_displayable_promotions(user: Optional[User], *, now=None):
    from .models import Promotion

    now = _now(now)
    items = []
    seen = set()
    qs = (
        Promotion.objects.select_related("plan")
        .filter(is_active=True)
        .filter(Q(plan__is_active=True))
        .order_by("-priority", "id")
    )
    for promotion in qs:
        if _is_launch_registration_promo(promotion):
            continue
        if not is_in_display_window(promotion, now):
            continue
        if not user_eligible(user, promotion, now):
            continue
        status = compute_status(promotion, now)
        if status not in ("ended", "scheduled") and user is not None:
            if promotion.max_redemptions_per_user is not None:
                if redemption_count(promotion, user) >= promotion.max_redemptions_per_user:
                    continue
        if promotion.pk in seen:
            continue
        seen.add(promotion.pk)
        items.append(promotion)
    return items


def promotion_pricing(promotion, plan, billing_period: str = "month") -> dict:
    from .models import Promotion

    ps = _pricing()
    base = ps.base_plan_price(plan, billing_period)
    if promotion.benefit_type == Promotion.BenefitType.FREE_PERIOD:
        current = ps.ZERO
        extra_free_months = int(promotion.free_months or 0)
    else:
        current = ps._q(promotion.promo_price)
        extra_free_months = 0
        if current > base:
            current = base
        if current < ps.ZERO:
            current = ps.ZERO
    discount = max(ps.ZERO, base - current)
    return {
        "original": base,
        "current": current,
        "renewal": base,
        "discount": discount,
        "currency": getattr(plan, "currency", None) or "RUB",
        "extra_free_months": extra_free_months,
        "free_months": extra_free_months,
        "benefit_type": promotion.benefit_type,
        "duration": promotion.pricing_duration,
    }


def serialize_promotion(promotion, user=None, *, billing_period: str = "month", now=None) -> dict:
    now = _now(now)
    plan = promotion.plan
    pricing = promotion_pricing(promotion, plan, billing_period)
    status = compute_status(promotion, now)
    can_redeem = bool(
        status == "active"
        and is_in_apply_window(promotion, now)
        and user_eligible(user, promotion, now)
        and limits_available(promotion, user)
        and not (
            promotion.benefit_type == promotion.BenefitType.FIXED_PRICE
            and billing_period == "year"
        )
    )
    button = (promotion.button_text or "").strip() or "Выбрать тариф"
    return {
        "id": promotion.pk,
        "code": promotion.code,
        "title": promotion.title,
        "name": promotion.name,
        "short_description": promotion.short_description or "",
        "description": promotion.description or "",
        "how_to_get": promotion.how_to_get or "",
        "terms": promotion.terms or "",
        "button_text": button,
        "claim_mode": promotion.claim_mode,
        "allow_promo_codes": bool(promotion.allow_promo_codes),
        "benefit_type": promotion.benefit_type,
        "plan": {
            "id": plan.pk,
            "name": plan.name,
            "slug": plan.slug,
        },
        "pricing": {
            "original": str(pricing["original"]),
            "current": str(pricing["current"]),
            "renewal": str(pricing["renewal"]),
            "currency": pricing["currency"],
            "duration": pricing["duration"],
        },
        "free_months": pricing["free_months"] or None,
        "starts_at": promotion.starts_at.isoformat() if promotion.starts_at else None,
        "ends_at": promotion.ends_at.isoformat() if promotion.ends_at else None,
        "status": status,
        "can_redeem": can_redeem,
    }


def serialize_plan_promotion(user, plan, billing_period: str = "month", now=None):
    promotion = get_applicable_promotion(
        user, plan, billing_period, now=now, for_display=False
    )
    if promotion is None:
        # Показать завершённую в окне display, без CTA.
        display = get_applicable_promotion(
            user, plan, billing_period, now=now, for_display=True
        )
        if display is None:
            return None
        payload = serialize_promotion(display, user, billing_period=billing_period, now=now)
        if not payload["can_redeem"] and payload["status"] not in ("ended", "scheduled"):
            return None
        if payload["status"] in ("ended", "scheduled"):
            return payload
        return None
    return serialize_promotion(promotion, user, billing_period=billing_period, now=now)


@transaction.atomic
def reserve_redemption(promotion, teacher, payment, *, original_price, final_price):
    from .models import Promotion, PromotionRedemption

    locked = (
        Promotion.objects.select_for_update()
        .select_related("plan")
        .get(pk=promotion.pk)
    )
    now = timezone.now()
    if not locked.is_active or not is_in_apply_window(locked, now):
        raise PromotionError("PROMOTION_INACTIVE", "Акция больше недоступна.")
    if not user_eligible(teacher, locked, now):
        raise PromotionError("PROMOTION_NOT_ELIGIBLE", "Акция недоступна для этого аккаунта.")
    if payment and locked.plan_id != payment.plan_id:
        raise PromotionError("PROMOTION_WRONG_PLAN", "Акция не относится к выбранному тарифу.")
    if not limits_available(locked, teacher):
        raise PromotionError("PROMOTION_LIMIT", "Лимит акции исчерпан.")

    if payment is not None:
        existing = PromotionRedemption.objects.filter(
            promotion=locked,
            teacher=teacher,
            payment=payment,
            status=PromotionRedemption.Status.RESERVED,
        ).first()
        if existing:
            return existing

    return PromotionRedemption.objects.create(
        promotion=locked,
        teacher=teacher,
        plan=locked.plan,
        payment=payment,
        subscription=getattr(payment, "subscription", None),
        original_price=_pricing()._q(original_price),
        final_price=_pricing()._q(final_price),
        benefit_type=locked.benefit_type,
        free_months=int(locked.free_months or 0),
        status=PromotionRedemption.Status.RESERVED,
    )


@transaction.atomic
def confirm_for_payment(payment) -> None:
    from .models import PromotionRedemption

    usages = list(
        PromotionRedemption.objects.select_for_update()
        .filter(payment=payment, status=PromotionRedemption.Status.RESERVED)
    )
    for usage in usages:
        usage.status = PromotionRedemption.Status.APPLIED
        usage.subscription_id = payment.subscription_id
        usage.save(update_fields=["status", "subscription"])


@transaction.atomic
def release_for_payment(payment) -> None:
    from .models import PromotionRedemption

    PromotionRedemption.objects.filter(
        payment=payment,
        status=PromotionRedemption.Status.RESERVED,
    ).update(status=PromotionRedemption.Status.CANCELLED)
