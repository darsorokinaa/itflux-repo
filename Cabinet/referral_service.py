"""
ReferralService — реферальные ссылки и бонусная подписка при регистрации.
"""

import calendar
import logging
from typing import Optional

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .models import Profile, ReferralLink, ReferralLinkRegistration, TariffPlan, TeacherSubscription
from .subscription_service import SubscriptionLimitService

logger = logging.getLogger(__name__)


class ReferralError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def to_dict(self):
        return {"code": self.code, "message": self.message, "valid": False}


def add_months(dt, months: int):
    month_index = dt.month - 1 + int(months)
    year = dt.year + month_index // 12
    month = month_index % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(
        year=year,
        month=month,
        day=day,
        hour=dt.hour,
        minute=dt.minute,
        second=dt.second,
        microsecond=dt.microsecond,
    )


def get_default_reward_plan() -> Optional[TariffPlan]:
    plan = TariffPlan.objects.filter(slug="pro", is_active=True).first()
    if plan:
        return plan
    return (
        TariffPlan.objects.filter(is_active=True)
        .order_by("-sort_order", "-price_month")
        .first()
    )


class ReferralService:

    @staticmethod
    def get_link(code_str: str) -> ReferralLink:
        code = (code_str or "").strip()
        if not code:
            raise ReferralError("REFERRAL_EMPTY", "Код реферальной ссылки не указан")
        try:
            return ReferralLink.objects.select_related("reward_plan").get(code__iexact=code)
        except ReferralLink.DoesNotExist:
            raise ReferralError("REFERRAL_NOT_FOUND", "Реферальная ссылка не найдена")

    @staticmethod
    def validate(code_str: str) -> ReferralLink:
        link = ReferralService.get_link(code_str)
        if not link.is_valid_now():
            raise ReferralError("REFERRAL_EXPIRED", "Реферальная ссылка недействительна или истекла")
        return link

    @staticmethod
    def resolve_reward_plan(link: ReferralLink) -> TariffPlan:
        if link.reward_plan_id and link.reward_plan.is_active:
            return link.reward_plan
        plan = get_default_reward_plan()
        if not plan:
            raise ReferralError("REFERRAL_NO_PLAN", "Не настроен тариф для реферальной программы")
        return plan

    @staticmethod
    def preview_payload(link: ReferralLink) -> dict:
        plan = ReferralService.resolve_reward_plan(link)
        return {
            "valid": True,
            "code": link.code,
            "title": link.title or link.code,
            "reward_months": link.reward_months,
            "reward_plan": {
                "slug": plan.slug,
                "name": plan.name,
            },
            "message": (
                f"{link.reward_months} "
                f"{'месяц' if link.reward_months == 1 else 'месяца' if 2 <= link.reward_months <= 4 else 'месяцев'} "
                f"тарифа «{plan.name}»"
            ),
        }

    @staticmethod
    def registration_started_at(user: User):
        profile = getattr(user, "profile", None)
        if profile and profile.reg_date:
            return profile.reg_date
        if user.date_joined:
            return user.date_joined
        return timezone.now()

    @staticmethod
    @transaction.atomic
    def grant_subscription(teacher: User, plan: TariffPlan, months: int, started_at=None):
        """
        Выдаёт/продлевает бонусный доступ.
        Не понижает уже оплаченный тариф с более высоким content_access_rank —
        только продлевает expires_at.
        """
        # Без apply_promo: иначе ensure_registration_promo → grant → рекурсия.
        sub = SubscriptionLimitService.get_or_create_subscription(teacher, apply_promo=False)
        now = timezone.now()
        base_start = started_at or ReferralService.registration_started_at(teacher)
        bonus_expires = add_months(max(base_start, now), months)

        current_rank = int(getattr(sub.plan, "content_access_rank", 0) or 0)
        reward_rank = int(getattr(plan, "content_access_rank", 0) or 0)
        paid_active = (
            sub.is_valid()
            and sub.source == TeacherSubscription.Source.PAYMENT
            and current_rank > reward_rank
        )

        if paid_active:
            # Продлеваем текущий оплаченный период, план не трогаем.
            base = sub.expires_at if sub.expires_at and sub.expires_at > now else now
            expires_at = add_months(base, months)
            sub.expires_at = expires_at
            sub.current_period_end = expires_at
            sub.save(update_fields=["expires_at", "current_period_end", "updated_at"])
            return sub, expires_at

        # Если уже есть валидный план того же/выше ранга — только продлеваем срок.
        if sub.is_valid() and current_rank >= reward_rank and sub.expires_at:
            expires_at = add_months(max(sub.expires_at, now), months)
            sub.expires_at = expires_at
            sub.current_period_end = expires_at
            if sub.status not in (TeacherSubscription.Status.ACTIVE, TeacherSubscription.Status.TRIAL):
                sub.status = TeacherSubscription.Status.TRIAL
            sub.save(update_fields=[
                "expires_at", "current_period_end", "status", "updated_at",
            ])
            return sub, expires_at

        expires_at = bonus_expires
        sub.plan = plan
        sub.status = TeacherSubscription.Status.TRIAL
        sub.source = TeacherSubscription.Source.REFERRAL
        sub.started_at = base_start
        sub.expires_at = expires_at
        sub.promo_started_at = base_start
        sub.promo_ends_at = expires_at
        sub.current_period_start = base_start
        sub.current_period_end = expires_at
        sub.auto_renew = False
        sub.billing_period = TeacherSubscription.BillingPeriod.MONTH
        sub.save(update_fields=[
            "plan", "status", "source", "started_at", "expires_at",
            "promo_started_at", "promo_ends_at",
            "current_period_start", "current_period_end",
            "auto_renew", "billing_period", "updated_at",
        ])
        return sub, expires_at

    @staticmethod
    @transaction.atomic
    def record_registration(user: User, link: ReferralLink, plan: TariffPlan, expires_at, started_at=None):
        started_at = started_at or ReferralService.registration_started_at(user)
        registration, created = ReferralLinkRegistration.objects.get_or_create(
            user=user,
            defaults={
                "referral_link": link,
                "reward_plan": plan,
                "reward_months": link.reward_months,
                "expires_at": expires_at,
            },
        )
        if not created:
            registration.referral_link = link
            registration.reward_plan = plan
            registration.reward_months = link.reward_months
            registration.expires_at = expires_at
            registration.save(update_fields=[
                "referral_link", "reward_plan", "reward_months", "expires_at",
            ])
        else:
            ReferralLinkRegistration.objects.filter(pk=registration.pk).update(registered_at=started_at)
            link.registrations_count = link.registrations_count + 1
            link.save(update_fields=["registrations_count", "updated_at"])
        return registration

    @staticmethod
    @transaction.atomic
    def apply_on_registration(user: User, code_str: str) -> Optional[dict]:
        if user.profile.role != Profile.Role.TEACHER:
            return None

        if ReferralLinkRegistration.objects.filter(user=user).exists():
            raise ReferralError("REFERRAL_ALREADY_USED", "Реферальный бонус уже был получен")

        email = (user.email or "").strip().lower()
        if email and ReferralLinkRegistration.objects.filter(user__email__iexact=email).exists():
            raise ReferralError("REFERRAL_EMAIL_USED", "Бонус по этому email уже был получен")

        link = ReferralService.validate(code_str)
        if link.owner_id == user.pk:
            raise ReferralError("REFERRAL_SELF", "Нельзя использовать собственную реферальную ссылку")
        plan = ReferralService.resolve_reward_plan(link)
        started_at = ReferralService.registration_started_at(user)
        sub, expires_at = ReferralService.grant_subscription(
            user, plan, link.reward_months, started_at=started_at,
        )
        ReferralService.record_registration(user, link, plan, expires_at, started_at=started_at)

        return {
            "code": link.code,
            "reward_months": link.reward_months,
            "plan_slug": plan.slug,
            "plan_name": plan.name,
            "expires_at": expires_at.isoformat(),
            "subscription_status": sub.status,
        }

    @staticmethod
    @transaction.atomic
    def grant_payment_reward_if_applicable(payment) -> Optional[dict]:
        """
        Награда рефереру после успешной оплаты приглашённого.
        Launch-награда при регистрации не затрагивается.
        """
        from .models import ReferralReward

        teacher = payment.teacher
        registration = (
            ReferralLinkRegistration.objects.select_related("referral_link", "referral_link__owner")
            .filter(user=teacher)
            .first()
        )
        if not registration:
            return None
        link = registration.referral_link
        referrer = link.owner
        if not referrer or referrer.pk == teacher.pk:
            return None

        if ReferralReward.objects.filter(referred_user=teacher, payment=payment).exists():
            return None
        # Один бонус рефереру за приглашённого (после первой успешной оплаты).
        if ReferralReward.objects.filter(
            referred_user=teacher,
            status__in=[ReferralReward.Status.GRANTED, ReferralReward.Status.PENDING],
        ).exists():
            return None

        reward_plan = ReferralService.resolve_reward_plan(link)
        reward_months = max(1, int(getattr(link, "reward_months", 1) or 1))
        # For payment reward give 1 month by default unless link specifies otherwise;
        # keep link.reward_months but cap display as payment bonus.
        reward = ReferralReward.objects.create(
            referral_link=link,
            referrer=referrer,
            referred_user=teacher,
            payment=payment,
            reward_plan=reward_plan,
            reward_months=1,
            status=ReferralReward.Status.PENDING,
        )
        ReferralService.grant_subscription(referrer, reward_plan, reward.reward_months)
        reward.status = ReferralReward.Status.GRANTED
        reward.granted_at = timezone.now()
        reward.save(update_fields=["status", "granted_at"])
        return {
            "referrer_id": referrer.pk,
            "reward_months": reward.reward_months,
            "plan_slug": reward_plan.slug,
        }
