"""
Стартовая акция при регистрации: тариф «Премиум» на N месяцев с даты регистрации.

Параметры (тариф, срок, даты, тексты) живут в БД — модель Promotion, код
``launch-premium``. В админке: Cabinet → Акции.

Кампания по умолчанию выключена (``is_active=False``): новые учителя получают
«Старт». Чтобы снова выдавать тариф при регистрации — включите «Активна»
и проверьте даты «Можно получить с/до». Уже выданные Premium не отзываются.

Выдача — отдельная от оплаты: эта запись не применяется как скидка на кассе.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .models import Profile, Promotion, TariffPlan, TeacherSubscription
from .referral_service import ReferralService, add_months

logger = logging.getLogger(__name__)

LAUNCH_PROMO_CODE = "launch-premium"
PROMO_PLAN_SLUG = "premium"
LEGACY_LOWER_SLUGS = frozenset({"start", "teacher", "repetitor", "profi", "pro"})
PROMO_MONTHS = 3
PROMO_UNTIL_DATE = datetime(2027, 1, 1, 0, 0, 0)
PROMO_START_DATE = datetime(2026, 1, 1, 0, 0, 0)
PROMO_TZ = ZoneInfo("Europe/Moscow")

_PLAN_RANK = {
    "start": 0,
    "teacher": 1,
    "repetitor": 1,
    "profi": 2,
    "pro": 2,
    "premium": 3,
    "school": 4,
}

_MONTHS_RU = (
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
)


def _aware(dt):
    if dt is None:
        return None
    if timezone.is_naive(dt):
        return timezone.make_aware(dt, PROMO_TZ)
    return dt


def _plan_rank(slug: str) -> int:
    return _PLAN_RANK.get(slug or "", 0)


def get_launch_promotion() -> Optional[Promotion]:
    return (
        Promotion.objects.select_related("plan")
        .filter(code=LAUNCH_PROMO_CODE)
        .first()
    )


def ensure_launch_promotion() -> Optional[Promotion]:
    """Создаёт запись акции, если её ещё нет. Существующую не перезаписывает."""
    existing = get_launch_promotion()
    if existing:
        return existing

    plan = TariffPlan.objects.filter(slug=PROMO_PLAN_SLUG, is_active=True).first()
    if plan is None:
        plan = TariffPlan.objects.filter(slug=PROMO_PLAN_SLUG).first()
    if plan is None:
        logger.warning("Launch promo: tariff «%s» not found", PROMO_PLAN_SLUG)
        return None

    starts = _aware(PROMO_START_DATE)
    ends = _aware(PROMO_UNTIL_DATE)
    return Promotion.objects.create(
        code=LAUNCH_PROMO_CODE,
        name="Стартовая акция: Премиум",
        title="Акция до 1 января",
        short_description=(
            "Всем зарегистрировавшимся на платформе — тариф «Премиум» "
            "на 3 месяца с даты регистрации."
        ),
        description=(
            "Стартовая акция: при регистрации учитель получает тариф «Премиум» "
            "на 3 месяца с даты регистрации. Сейчас акция выключена — новые "
            "пользователи получают «Старт». Чтобы включить, поставьте «Активна». "
            "Код launch-premium не меняйте — по нему выдаётся тариф."
        ),
        how_to_get=(
            "Выдаётся автоматически при регистрации учителя, если акция активна. "
            "Не меняйте код launch-premium. Чтобы выключить — снимите «Активна»."
        ),
        terms="Срок считается с даты регистрации, не с момента входа.",
        button_text="Выбрать тариф",
        plan=plan,
        benefit_type=Promotion.BenefitType.FREE_PERIOD,
        promo_price=None,
        free_months=PROMO_MONTHS,
        starts_at=starts,
        ends_at=ends,
        display_starts_at=starts,
        display_ends_at=ends,
        is_active=False,
        eligibility_type=Promotion.EligibilityType.ALL,
        claim_mode=Promotion.ClaimMode.AUTOMATIC,
        allow_promo_codes=False,
        max_redemptions=None,
        max_redemptions_per_user=None,
        priority=100,
    )


def promo_deadline():
    promo = get_launch_promotion()
    if promo and promo.ends_at:
        return _aware(promo.ends_at)
    return timezone.make_aware(PROMO_UNTIL_DATE, PROMO_TZ)


def promo_starts_at():
    promo = get_launch_promotion()
    if promo and promo.starts_at:
        return _aware(promo.starts_at)
    return timezone.make_aware(PROMO_START_DATE, PROMO_TZ)


def promo_months() -> int:
    promo = get_launch_promotion()
    months = int(getattr(promo, "free_months", None) or PROMO_MONTHS)
    return months if months >= 1 else PROMO_MONTHS


def promo_plan_slug() -> str:
    promo = get_launch_promotion()
    slug = getattr(getattr(promo, "plan", None), "slug", None)
    return slug or PROMO_PLAN_SLUG


def is_promo_window_open(now=None) -> bool:
    """Показывать акцию в UI / выдавать новым регистрациям."""
    promo = get_launch_promotion()
    if promo is None or not promo.is_active:
        return False
    now = now or timezone.now()
    start = _aware(promo.starts_at)
    end = _aware(promo.ends_at)
    if start and now < start:
        return False
    if end and now >= end:
        return False
    return True


def registration_qualifies_for_promo(started_at) -> bool:
    if not started_at:
        return False
    promo = get_launch_promotion()
    if promo is None or not promo.is_active:
        return False
    started_at = _aware(started_at)
    end = _aware(promo.ends_at) or promo_deadline()
    return started_at < end


def _until_label(deadline) -> str:
    if not deadline:
        return ""
    local = timezone.localtime(_aware(deadline), PROMO_TZ)
    return f"{local.day} {_MONTHS_RU[local.month - 1]} {local.year}"


def _until_date(deadline):
    if not deadline:
        return None
    return timezone.localtime(_aware(deadline), PROMO_TZ).date()


def promo_payload() -> dict:
    promo = get_launch_promotion()
    deadline = promo_deadline()
    months = promo_months()
    plan = getattr(promo, "plan", None)
    plan_name = getattr(plan, "name", None) or "Премиум"
    title = (getattr(promo, "title", None) or "").strip() or "Стартовая акция"
    message = (
        (getattr(promo, "short_description", None) or "").strip()
        or (
            f"Всем зарегистрировавшимся на платформе — тариф «{plan_name}» "
            f"на {months} месяца с даты регистрации."
        )
    )
    return {
        "active": is_promo_window_open(),
        "plan_slug": promo_plan_slug(),
        "plan_name": plan_name,
        "months": months,
        "until": _until_date(deadline).isoformat() if deadline else None,
        "until_label": _until_label(deadline),
        "title": title,
        "message": message,
    }


def _resolve_promo_plan() -> TariffPlan | None:
    promo = get_launch_promotion()
    plan = getattr(promo, "plan", None)
    if plan and plan.is_active:
        return plan
    plan = TariffPlan.objects.filter(slug=PROMO_PLAN_SLUG, is_active=True).first()
    if plan:
        return plan
    return TariffPlan.objects.filter(slug=PROMO_PLAN_SLUG).first()


def _should_skip_existing(sub: TeacherSubscription, promo_expires_at, *, promo_plan: TariffPlan) -> bool:
    """Не затираем школьный тариф и уже достаточный Премиум."""
    if not sub or not sub.plan_id:
        return False
    slug = sub.plan.slug
    if _plan_rank(slug) > _plan_rank(promo_plan.slug):
        return True
    if not sub.is_valid():
        return False
    if sub.plan_id == promo_plan.pk:
        if sub.expires_at is None:
            return True
        if sub.expires_at >= promo_expires_at:
            return True
    return False


def _keep_unlimited(sub: TeacherSubscription, promo_plan: TariffPlan) -> bool:
    """Платный безлимит ниже Премиума — только поднимаем тариф, срок не режем."""
    if not sub or not sub.plan_id or sub.expires_at is not None:
        return False
    if not sub.is_valid():
        return False
    slug = sub.plan.slug
    if _plan_rank(slug) >= _plan_rank(promo_plan.slug):
        return False
    return float(sub.plan.price_month or 0) > 0


@transaction.atomic
def apply_registration_promo(user: User, *, force: bool = False) -> Optional[dict]:
    """
    Выдаёт тариф стартовой акции (Премиум) на N месяцев с даты регистрации.
    Возвращает dict с деталями или None, если акция не применена.
    """
    profile = getattr(user, "profile", None)
    if not profile or profile.role != Profile.Role.TEACHER:
        return None

    started_at = ReferralService.registration_started_at(user)
    if not force and not registration_qualifies_for_promo(started_at):
        return None

    plan = _resolve_promo_plan()
    if not plan:
        logger.warning("Registration promo: plan «%s» not found", PROMO_PLAN_SLUG)
        return None

    months = promo_months()
    promo_expires = add_months(started_at, months)
    now = timezone.now()

    from .subscription_service import SubscriptionLimitService

    sub = SubscriptionLimitService.get_or_create_subscription(user, apply_promo=False)
    sub = TeacherSubscription.objects.select_related("plan").get(pk=sub.pk)

    if not force and _should_skip_existing(sub, promo_expires, promo_plan=plan):
        return None

    keep_unlimited = _keep_unlimited(sub, plan)
    period_over = (not keep_unlimited) and promo_expires <= now
    if period_over and not force:
        current_slug = sub.plan.slug if sub.plan_id else None
        if current_slug and current_slug not in LEGACY_LOWER_SLUGS:
            return None
        if current_slug in LEGACY_LOWER_SLUGS and sub.is_valid():
            sub.plan = plan
            sub.source = TeacherSubscription.Source.LAUNCH_PROMO
            sub.is_legacy_promo = True
            sub.save(update_fields=["plan", "source", "is_legacy_promo", "updated_at"])
            return {
                "plan_slug": plan.slug,
                "plan_name": plan.name,
                "months": months,
                "started_at": started_at.isoformat(),
                "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
                "source": "launch_promo",
                "remapped_from": current_slug,
            }
        return None

    expires_at = None if keep_unlimited else promo_expires
    if (
        not keep_unlimited
        and sub.expires_at
        and sub.expires_at > expires_at
    ):
        expires_at = sub.expires_at

    sub.plan = plan
    sub.status = TeacherSubscription.Status.TRIAL
    sub.source = TeacherSubscription.Source.LAUNCH_PROMO
    sub.is_legacy_promo = True
    sub.started_at = started_at
    if not keep_unlimited:
        sub.expires_at = expires_at
        sub.promo_started_at = started_at
        sub.promo_ends_at = expires_at
        sub.current_period_start = started_at
        sub.current_period_end = expires_at
    sub.auto_renew = False
    update_fields = [
        "plan",
        "status",
        "source",
        "is_legacy_promo",
        "started_at",
        "auto_renew",
        "updated_at",
    ]
    if not keep_unlimited:
        update_fields.extend([
            "expires_at",
            "promo_started_at",
            "promo_ends_at",
            "current_period_start",
            "current_period_end",
        ])
    sub.save(update_fields=update_fields)
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
        "months": months,
        "started_at": started_at.isoformat(),
        "expires_at": expires_at.isoformat() if expires_at else None,
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
