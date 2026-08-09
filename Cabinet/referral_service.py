"""
ReferralService — реферальные ссылки, скидка приглашённому 50%, +14 дней рефереру.
"""

from __future__ import annotations

import calendar
import logging
from datetime import timedelta
from typing import Optional

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import (
    Profile,
    ReferralLink,
    ReferralLinkRegistration,
    ReferralReward,
    TariffPlan,
    TeacherSubscription,
)
from .pricing_service import (
    REFERRAL_INVITEE_DISCOUNT_PERCENT,
    REFERRAL_REFERRER_BONUS_DAYS,
    teacher_has_successful_paid_subscription,
)
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
    """Legacy helper — retained for admin / old links."""
    plan = TariffPlan.objects.filter(slug="pro", is_active=True).first()
    if plan:
        return plan
    return (
        TariffPlan.objects.filter(is_active=True)
        .order_by("-sort_order", "-price_month")
        .first()
    )


def _is_paid_active_subscription(sub: TeacherSubscription) -> bool:
    if not sub or not sub.is_valid():
        return False
    plan = sub.plan
    if not plan:
        return False
    if getattr(plan, "is_free", False) or plan.slug == "start":
        return False
    if sub.source == TeacherSubscription.Source.PAYMENT:
        return True
    # Платный тариф с активным сроком (в т.ч. продлённый реферальными днями).
    from decimal import Decimal

    return Decimal(str(plan.price_month or 0)) > 0


class ReferralService:

    @staticmethod
    def get_link(code_str: str) -> ReferralLink:
        code = (code_str or "").strip()
        if not code:
            raise ReferralError("REFERRAL_EMPTY", "Код реферальной ссылки не указан")
        try:
            return ReferralLink.objects.select_related("reward_plan", "owner").get(
                code__iexact=code
            )
        except ReferralLink.DoesNotExist:
            raise ReferralError("REFERRAL_NOT_FOUND", "Реферальная ссылка не найдена")

    @staticmethod
    def validate(code_str: str) -> ReferralLink:
        link = ReferralService.get_link(code_str)
        if not link.is_valid_now():
            raise ReferralError(
                "REFERRAL_EXPIRED",
                "Реферальная ссылка недействительна или истекла",
            )
        return link

    @staticmethod
    def preview_payload(link: ReferralLink) -> dict:
        return {
            "valid": True,
            "code": link.code,
            "title": link.title or link.code,
            "invitee_discount_percent": float(REFERRAL_INVITEE_DISCOUNT_PERCENT),
            "referrer_bonus_days": REFERRAL_REFERRER_BONUS_DAYS,
            "message": (
                f"Скидка {REFERRAL_INVITEE_DISCOUNT_PERCENT:g}% на первый месяц "
                f"любому платному тарифу. Пригласившему — "
                f"+{REFERRAL_REFERRER_BONUS_DAYS} дней после вашей первой оплаты."
            ),
            # Legacy keys for older frontend
            "reward_months": 0,
            "reward_plan": None,
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
    def apply_on_registration(user: User, code_str: str) -> Optional[dict]:
        """
        Фиксирует referral relationship при регистрации.
        НЕ выдаёт бесплатные месяцы и НЕ начисляет +14 дней.
        """
        role = (
            Profile.objects.filter(user_id=user.pk).values_list("role", flat=True).first()
        )
        if role != Profile.Role.TEACHER:
            return None

        if ReferralLinkRegistration.objects.filter(user=user).exists():
            raise ReferralError(
                "REFERRAL_ALREADY_USED",
                "Реферальная привязка уже зафиксирована",
            )

        email = (user.email or "").strip().lower()
        if email and ReferralLinkRegistration.objects.filter(
            user__email__iexact=email
        ).exclude(user=user).exists():
            logger.info(
                "Referral suspicious: email %s already has referral registration",
                email,
            )

        link = ReferralService.validate(code_str)
        if link.owner_id and link.owner_id == user.pk:
            raise ReferralError(
                "REFERRAL_SELF",
                "Нельзя использовать собственную реферальную ссылку",
            )

        # Уже платившие не получают 50% (на случай редких edge-case).
        eligible = not teacher_has_successful_paid_subscription(user)
        started_at = ReferralService.registration_started_at(user)

        registration = ReferralLinkRegistration.objects.create(
            user=user,
            referral_link=link,
            reward_plan=None,
            reward_months=0,
            expires_at=None,
            invitee_discount_percent=REFERRAL_INVITEE_DISCOUNT_PERCENT,
            invitee_discount_eligible=eligible,
        )
        ReferralLinkRegistration.objects.filter(pk=registration.pk).update(
            registered_at=started_at
        )
        link.registrations_count = int(link.registrations_count or 0) + 1
        link.save(update_fields=["registrations_count", "updated_at"])

        return {
            "code": link.code,
            "invitee_discount_percent": float(REFERRAL_INVITEE_DISCOUNT_PERCENT),
            "invitee_discount_eligible": eligible,
            "referrer_bonus_days": REFERRAL_REFERRER_BONUS_DAYS,
            "message": (
                f"Скидка {REFERRAL_INVITEE_DISCOUNT_PERCENT:g}% на первый месяц "
                "любого платного тарифа"
            ),
        }

    @staticmethod
    def extend_subscription_by_days(teacher: User, days: int) -> TeacherSubscription:
        """Продлевает текущую платную подписку на N дней, план не меняет."""
        sub = SubscriptionLimitService.get_or_create_subscription(
            teacher, apply_promo=False
        )
        now = timezone.now()
        base = sub.expires_at if sub.expires_at and sub.expires_at > now else now
        expires = base + timedelta(days=int(days))
        sub.expires_at = expires
        sub.current_period_end = expires
        if sub.status not in (
            TeacherSubscription.Status.ACTIVE,
            TeacherSubscription.Status.TRIAL,
        ):
            sub.status = TeacherSubscription.Status.ACTIVE
        sub.save(
            update_fields=[
                "expires_at",
                "current_period_end",
                "status",
                "updated_at",
            ]
        )
        try:
            from .subscription_downgrade import DowngradeService

            DowngradeService.sync_effective_at_to_expires(sub)
        except Exception:
            logger.exception("sync_effective_at after referral days failed")
        return sub

    @staticmethod
    @transaction.atomic
    def apply_available_bonus_days(teacher: User) -> int:
        """
        Применяет все AVAILABLE награды к активной платной подписке.
        Возвращает суммарно применённые дни.
        """
        sub = SubscriptionLimitService.get_or_create_subscription(
            teacher, apply_promo=False
        )
        if not _is_paid_active_subscription(sub):
            return 0

        rewards = list(
            ReferralReward.objects.select_for_update()
            .filter(
                referrer=teacher,
                status=ReferralReward.Status.AVAILABLE,
                reward_type=ReferralReward.RewardType.FIRST_PAYMENT_DAYS,
            )
            .order_by("created_at")
        )
        total_days = 0
        now = timezone.now()
        for reward in rewards:
            days = int(reward.reward_days or 0)
            if days <= 0:
                continue
            ReferralService.extend_subscription_by_days(teacher, days)
            reward.status = ReferralReward.Status.GRANTED
            reward.applied_at = now
            if not reward.granted_at:
                reward.granted_at = now
            reward.save(update_fields=["status", "applied_at", "granted_at"])
            total_days += days
        return total_days

    @staticmethod
    @transaction.atomic
    def mark_invitee_discount_consumed(payment) -> None:
        """
        После первой успешной оплаты закрывает eligibility приглашённого,
        даже если фактически применился промокод, а не referral 50%.
        """
        teacher = payment.teacher
        reg = (
            ReferralLinkRegistration.objects.select_for_update()
            .filter(user=teacher)
            .first()
        )
        if not reg:
            return
        if not reg.invitee_discount_eligible and reg.invitee_discount_payment_id:
            return
        reg.invitee_discount_eligible = False
        reg.invitee_discount_used_at = timezone.now()
        reg.invitee_discount_payment = payment
        reg.save(
            update_fields=[
                "invitee_discount_eligible",
                "invitee_discount_used_at",
                "invitee_discount_payment",
            ]
        )

    @staticmethod
    @transaction.atomic
    def grant_payment_reward_if_applicable(payment) -> Optional[dict]:
        """
        +14 дней рефереру после CONFIRMED первой оплаты приглашённого.
        Идемпотентно при повторных webhook.
        """
        teacher = payment.teacher
        registration = (
            ReferralLinkRegistration.objects.select_related(
                "referral_link", "referral_link__owner"
            )
            .filter(user=teacher)
            .first()
        )
        if not registration:
            return None

        link = registration.referral_link
        referrer = link.owner
        if not referrer or referrer.pk == teacher.pk:
            return None

        existing = (
            ReferralReward.objects.select_for_update()
            .filter(
                referred_user=teacher,
                reward_type=ReferralReward.RewardType.FIRST_PAYMENT_DAYS,
            )
            .first()
        )
        if existing:
            return {
                "referrer_id": referrer.pk,
                "reward_days": existing.reward_days,
                "status": existing.status,
                "duplicate": True,
            }

        now = timezone.now()
        try:
            reward = ReferralReward.objects.create(
                referral_link=link,
                referrer=referrer,
                referred_user=teacher,
                payment=payment,
                reward_type=ReferralReward.RewardType.FIRST_PAYMENT_DAYS,
                reward_days=REFERRAL_REFERRER_BONUS_DAYS,
                reward_plan=None,
                reward_months=0,
                status=ReferralReward.Status.PENDING,
                granted_at=now,
            )
        except IntegrityError:
            existing = ReferralReward.objects.filter(
                referred_user=teacher,
                reward_type=ReferralReward.RewardType.FIRST_PAYMENT_DAYS,
            ).first()
            return {
                "referrer_id": referrer.pk,
                "reward_days": existing.reward_days if existing else 0,
                "status": existing.status if existing else None,
                "duplicate": True,
            }

        referrer_sub = SubscriptionLimitService.get_or_create_subscription(
            referrer, apply_promo=False
        )
        if _is_paid_active_subscription(referrer_sub):
            ReferralService.extend_subscription_by_days(
                referrer, REFERRAL_REFERRER_BONUS_DAYS
            )
            reward.status = ReferralReward.Status.GRANTED
            reward.applied_at = now
            reward.save(update_fields=["status", "applied_at"])
            status = ReferralReward.Status.GRANTED
        else:
            reward.status = ReferralReward.Status.AVAILABLE
            reward.save(update_fields=["status"])
            status = ReferralReward.Status.AVAILABLE

        return {
            "referrer_id": referrer.pk,
            "reward_days": REFERRAL_REFERRER_BONUS_DAYS,
            "status": status,
            "duplicate": False,
        }

    @staticmethod
    def referrer_stats(user: User) -> dict:
        invited = ReferralLinkRegistration.objects.filter(
            referral_link__owner=user
        ).count()
        paid = ReferralReward.objects.filter(
            referrer=user,
            reward_type=ReferralReward.RewardType.FIRST_PAYMENT_DAYS,
            status__in=[
                ReferralReward.Status.GRANTED,
                ReferralReward.Status.AVAILABLE,
            ],
        ).count()
        from django.db.models import Sum

        days = (
            ReferralReward.objects.filter(
                referrer=user,
                reward_type=ReferralReward.RewardType.FIRST_PAYMENT_DAYS,
                status__in=[
                    ReferralReward.Status.GRANTED,
                    ReferralReward.Status.AVAILABLE,
                ],
            ).aggregate(total=Sum("reward_days"))["total"]
            or 0
        )
        available_days = (
            ReferralReward.objects.filter(
                referrer=user,
                status=ReferralReward.Status.AVAILABLE,
            ).aggregate(total=Sum("reward_days"))["total"]
            or 0
        )
        history = []
        regs = (
            ReferralLinkRegistration.objects.select_related("user", "user__profile")
            .filter(referral_link__owner=user)
            .order_by("-registered_at")[:20]
        )
        rewards_by_user = {
            r.referred_user_id: r
            for r in ReferralReward.objects.filter(
                referrer=user,
                reward_type=ReferralReward.RewardType.FIRST_PAYMENT_DAYS,
            )
        }
        for reg in regs:
            reward = rewards_by_user.get(reg.user_id)
            profile = getattr(reg.user, "profile", None)
            display = ""
            if profile:
                display = (
                    getattr(profile, "display_name", "")
                    or f"{getattr(profile, 'name', '')} {getattr(profile, 'surname', '')}".strip()
                )
            if not display:
                display = "Коллега"
            if reward and reward.status in (
                ReferralReward.Status.GRANTED,
                ReferralReward.Status.AVAILABLE,
            ):
                status = "paid"
                note = f"+{reward.reward_days} дней"
            else:
                status = "waiting"
                note = "ожидаем первую оплату"
            history.append(
                {
                    "display_name": display,
                    "status": status,
                    "note": note,
                    "granted_at": (
                        reward.granted_at.isoformat()
                        if reward and reward.granted_at
                        else None
                    ),
                    "registered_at": (
                        reg.registered_at.isoformat() if reg.registered_at else None
                    ),
                }
            )
        return {
            "invited": invited,
            "paid": paid,
            "bonus_days_total": int(days),
            "bonus_days_available": int(available_days),
            "history": history,
        }
