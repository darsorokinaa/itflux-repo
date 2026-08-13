"""
Акция при регистрации: тариф «Профи» (slug=pro) на 3 месяца с даты регистрации
для всех учителей, зарегистрировавшихся до 1 января 2027.

Legacy-тариф slug=profi (rank=0) считается тем же продуктом и принудительно
мигрируется на актуальный slug=pro (rank=2).
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
LEGACY_PRO_SLUGS = frozenset({"profi", "pro"})
PROMO_MONTHS = 3
# Акция действует для регистраций строго до этой даты (1 января 2027 не включается).
PROMO_UNTIL_DATE = datetime(2027, 1, 1, 0, 0, 0)
PROMO_TZ = ZoneInfo("Europe/Moscow")

_PLAN_RANK = {
    "start": 0,
    "teacher": 1,
    "repetitor": 1,  # legacy
    "profi": 2,  # legacy alias of pro
    "pro": 2,
    "premium": 3,
    "school": 4,
}


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
        "until_label": "1 января 2027",
        "title": "Акция до 1 января",
        "message": (
            "Всем зарегистрировавшимся на платформе — тариф «Профи» "
            "на 3 месяца с даты регистрации."
        ),
    }


def _plan_rank(slug: str) -> int:
    return _PLAN_RANK.get(slug or "", 0)


def _resolve_pro_plan() -> TariffPlan | None:
    plan = TariffPlan.objects.filter(slug=PROMO_PLAN_SLUG, is_active=True).first()
    if plan:
        return plan
    plan = get_default_reward_plan()
    if plan and plan.slug == PROMO_PLAN_SLUG:
        return plan
    # Fallback: legacy «profi», если seed ещё не создал pro
    return TariffPlan.objects.filter(slug="profi", is_active=True).first()


def _should_skip_existing(sub: TeacherSubscription, promo_expires_at, *, pro_plan: TariffPlan) -> bool:
    """Не затираем более выгодную подписку. Legacy profi → всегда мигрируем на pro."""
    if not sub or not sub.plan_id:
        return False
    slug = sub.plan.slug

    # Legacy «profi» с нулевым rank — нельзя оставлять: нет доступа уровня Профи.
    if slug == "profi" and sub.plan_id != pro_plan.pk:
        return False

    if not sub.is_valid():
        return False

    if _plan_rank(slug) > _plan_rank(PROMO_PLAN_SLUG):
        return True

    if slug in LEGACY_PRO_SLUGS and sub.plan_id == pro_plan.pk:
        if sub.expires_at is None:
            return True
        if sub.expires_at >= promo_expires_at:
            return True

    # Платный активный тариф без срока (ручная выдача) — не трогаем.
    if (
        sub.status == TeacherSubscription.Status.ACTIVE
        and sub.expires_at is None
        and float(sub.plan.price_month or 0) > 0
        and slug not in LEGACY_PRO_SLUGS
    ):
        return True
    return False


@transaction.atomic
def apply_registration_promo(user: User, *, force: bool = False) -> Optional[dict]:
    """
    Выдаёт актуальный тариф «Профи» (slug=pro) на 3 месяца с даты регистрации.
    Возвращает dict с деталями или None, если акция не применена.
    """
    profile = getattr(user, "profile", None)
    if not profile or profile.role != Profile.Role.TEACHER:
        return None

    started_at = ReferralService.registration_started_at(user)
    if not force and not registration_qualifies_for_promo(started_at):
        return None

    plan = _resolve_pro_plan()
    if not plan:
        logger.warning("Registration promo: plan «pro» not found")
        return None

    # Ровно 3 месяца с даты регистрации (не от «сейчас»).
    promo_expires = add_months(started_at, PROMO_MONTHS)
    now = timezone.now()

    from .subscription_service import SubscriptionLimitService

    sub = SubscriptionLimitService.get_or_create_subscription(user, apply_promo=False)
    sub = TeacherSubscription.objects.select_related("plan").get(pk=sub.pk)

    if not force and _should_skip_existing(sub, promo_expires, pro_plan=plan):
        return None

    # Если период с даты регистрации уже закончился — только мигрируем legacy profi→pro,
    # не продлевая доступ «задним числом».
    period_over = promo_expires <= now
    if period_over and not force:
        if sub.plan_id == plan.pk or (sub.plan and sub.plan.slug not in ("profi", "start", None)):
            if sub.plan and sub.plan.slug != "profi":
                return None
        # legacy profi без актуального срока — переведём на pro, сохранив expires_at
        if sub.plan and sub.plan.slug == "profi" and sub.is_valid() and sub.expires_at and sub.expires_at > now:
            sub.plan = plan
            sub.source = TeacherSubscription.Source.LAUNCH_PROMO
            sub.is_legacy_promo = True
            sub.save(update_fields=["plan", "source", "is_legacy_promo", "updated_at"])
            return {
                "plan_slug": plan.slug,
                "plan_name": plan.name,
                "months": PROMO_MONTHS,
                "started_at": started_at.isoformat(),
                "expires_at": sub.expires_at.isoformat(),
                "source": "launch_promo",
                "remapped_from": "profi",
            }
        return None

    # Не сокращаем уже более длинный срок на том же уровне Профи.
    expires_at = promo_expires
    if (
        sub.plan_id
        and sub.plan.slug in LEGACY_PRO_SLUGS
        and sub.expires_at
        and sub.expires_at > expires_at
    ):
        expires_at = sub.expires_at

    sub.plan = plan
    sub.status = TeacherSubscription.Status.TRIAL
    sub.source = TeacherSubscription.Source.LAUNCH_PROMO
    sub.is_legacy_promo = True
    sub.started_at = started_at
    sub.expires_at = expires_at
    sub.promo_started_at = started_at
    sub.promo_ends_at = expires_at
    sub.current_period_start = started_at
    sub.current_period_end = expires_at
    sub.auto_renew = False
    sub.save(update_fields=[
        "plan",
        "status",
        "source",
        "is_legacy_promo",
        "started_at",
        "expires_at",
        "promo_started_at",
        "promo_ends_at",
        "current_period_start",
        "current_period_end",
        "auto_renew",
        "updated_at",
    ])
    logger.info(
        "Registration promo: user=%s plan=%s until=%s (from registration %s)",
        user.pk,
        plan.slug,
        expires_at,
        started_at,
    )
    return {
        "plan_slug": plan.slug,
        "plan_name": plan.name,
        "months": PROMO_MONTHS,
        "started_at": started_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "source": "launch_promo",
    }


def ensure_registration_promo(user: User) -> Optional[dict]:
    """Идемпотентная выдача акции (регистрация + первый заход в кабинет)."""
    try:
        return apply_registration_promo(user, force=False)
    except Exception:
        logger.exception("Registration promo failed for user=%s", getattr(user, "pk", None))
        return None


def grant_promo_to_all_teachers(*, force: bool = False) -> dict:
    """Массовая выдача/миграция для всех учителей. Используется командой и миграцией."""
    teachers = (
        User.objects.filter(profile__role=Profile.Role.TEACHER)
        .select_related("profile", "subscription", "subscription__plan")
        .order_by("date_joined")
    )
    granted = 0
    skipped = 0
    for teacher in teachers:
        result = apply_registration_promo(teacher, force=force)
        if result:
            granted += 1
        else:
            skipped += 1
    return {"granted": granted, "skipped": skipped}
