"""
ReferralService — реферальные ссылки и бонусная подписка при регистрации.
"""

import calendar
from typing import Optional

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .models import Profile, ReferralLink, ReferralLinkRegistration, TariffPlan, TeacherSubscription
from .subscription_service import SubscriptionLimitService


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
    @transaction.atomic
    def grant_subscription(teacher: User, plan: TariffPlan, months: int):
        sub = SubscriptionLimitService.get_or_create_subscription(teacher)
        now = timezone.now()
        base = sub.expires_at if sub.expires_at and sub.expires_at > now else now
        expires_at = add_months(base, months)

        sub.plan = plan
        sub.status = TeacherSubscription.Status.TRIAL
        sub.expires_at = expires_at
        sub.auto_renew = False
        sub.billing_period = TeacherSubscription.BillingPeriod.MONTH
        sub.save(update_fields=[
            "plan", "status", "expires_at", "auto_renew", "billing_period", "updated_at",
        ])
        return sub, expires_at

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
        plan = ReferralService.resolve_reward_plan(link)
        sub, expires_at = ReferralService.grant_subscription(user, plan, link.reward_months)

        ReferralLinkRegistration.objects.create(
            referral_link=link,
            user=user,
            reward_plan=plan,
            reward_months=link.reward_months,
            expires_at=expires_at,
        )
        link.registrations_count = link.registrations_count + 1
        link.save(update_fields=["registrations_count", "updated_at"])

        return {
            "code": link.code,
            "reward_months": link.reward_months,
            "plan_slug": plan.slug,
            "plan_name": plan.name,
            "expires_at": expires_at.isoformat(),
            "subscription_status": sub.status,
        }
