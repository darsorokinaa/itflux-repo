"""
Акция при регистрации: тариф «Профи» на 3 месяца с даты регистрации
для всех учителей, зарегистрировавшихся до 1 октября 2026.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .models import Profile, TariffPlan, TeacherSubscription
from .referral_service import ReferralService, add_months, get_default_reward_plan

logger = logging.getLogger(__name__)

PROMO_PLAN_SLUG = "pro"
PROMO_MONTHS = 3
# Акция действует для регистраций строго до этой даты (1 октября не включается).
PROMO_UNTIL_DATE = datetime(2026, 10, 1, 0, 0, 0)
PROMO_TZ = ZoneInfo("Europe/Moscow")

_PLAN_RANK = {"start": 0, "repetitor": 1, "pro": 2, "school": 3}


def promo_deadline():
    return timezone.make_aware(PROMO_UNTIL_DATE, PROMO_TZ)


def is_promo_window_open(now=None) -> bool:
    """Показывать акцию в UI / выдавать новым регистрациям."""
    now = now or timezone.now()
    return now < promo_deadline()


def registration_qualifies_for_promo(started_at) -> bool:
    if not started_at:
        return False
    if timezone.is_naive(started_at):
        started_at = timezone.make_aware(started_at, PROMO_TZ)
    return started_at < promo_deadline()


def promo_payload() -> dict:
    deadline = promo_deadline()
    return {
        "active": is_promo_window_open(),
        "plan_slug": PROMO_PLAN_SLUG,
        "plan_name": "Профи",
        "months": PROMO_MONTHS,
        "until": deadline.date().isoformat(),
        "until_label": "1 октября 2026",
        "title": "Акция до 1 октября",
        "message": (
            "Всем зарегистрировавшимся на платформе — тариф «Профи» "
            "на 3 месяца с даты регистрации."
        ),
    }


def _plan_rank(slug: str) -> int:
    return _PLAN_RANK.get(slug or "", 0)


def _should_skip_existing(sub: TeacherSubscription, promo_expires_at) -> bool:
    """Не затираем более выгодную или уже выданную подписку."""
    if not sub or not sub.plan_id:
        return False
    if not sub.is_valid():
        return False
    slug = sub.plan.slug
    if _plan_rank(slug) > _plan_rank(PROMO_PLAN_SLUG):
        return True
    if slug == PROMO_PLAN_SLUG:
        if sub.expires_at is None:
            return True
        if sub.expires_at >= promo_expires_at:
            return True
    # Платный активный тариф без срока (ручная выдача) — не трогаем.
    if (
        sub.status == TeacherSubscription.Status.ACTIVE
        and sub.expires_at is None
        and float(sub.plan.price_month or 0) > 0
    ):
        return True
    return False


@transaction.atomic
def apply_registration_promo(user: User, *, force: bool = False) -> Optional[dict]:
    """
    Выдаёт Профи на 3 месяца с даты регистрации.
    Возвращает dict с деталями или None, если акция не применена.
    """
    profile = getattr(user, "profile", None)
    if not profile or profile.role != Profile.Role.TEACHER:
        return None

    started_at = ReferralService.registration_started_at(user)
    if not force and not registration_qualifies_for_promo(started_at):
        return None

    plan = TariffPlan.objects.filter(slug=PROMO_PLAN_SLUG, is_active=True).first()
    if not plan:
        plan = get_default_reward_plan()
    if not plan or plan.slug != PROMO_PLAN_SLUG:
        logger.warning("Registration promo: plan «pro» not found")
        return None

    promo_expires = add_months(started_at, PROMO_MONTHS)
    from .subscription_service import SubscriptionLimitService

    sub = SubscriptionLimitService.get_or_create_subscription(user, apply_promo=False)
    sub = TeacherSubscription.objects.select_related("plan").get(pk=sub.pk)
    if not force and _should_skip_existing(sub, promo_expires):
        return None

    sub, expires_at = ReferralService.grant_subscription(
        user,
        plan,
        PROMO_MONTHS,
        started_at=started_at,
    )
    logger.info(
        "Registration promo: user=%s plan=%s until=%s",
        user.pk,
        plan.slug,
        expires_at,
    )
    return {
        "plan_slug": plan.slug,
        "plan_name": plan.name,
        "months": PROMO_MONTHS,
        "started_at": started_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "source": "registration_promo",
    }


def ensure_registration_promo(user: User) -> Optional[dict]:
    """Идемпотентная выдача акции (регистрация + первый заход в кабинет)."""
    try:
        return apply_registration_promo(user, force=False)
    except Exception:
        logger.exception("Registration promo failed for user=%s", getattr(user, "pk", None))
        return None
