"""
SubscriptionLimitService — проверка тарифных лимитов учителя.

Все проверки выполняются ТОЛЬКО по данным текущего учителя.
Никаких данных других пользователей здесь не используется.
"""

from datetime import date
from typing import Optional

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone


class LimitExceeded(Exception):
    """Исключение при превышении тарифного лимита."""

    def __init__(self, code: str, message: str, limit: int, current: int, recommended_plan: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.limit = limit
        self.current = current
        self.recommended_plan = recommended_plan

    def to_dict(self):
        return {
            "code": self.code,
            "message": self.message,
            "limit": self.limit,
            "current": self.current,
            "upgrade_required": True,
            "recommended_plan": self.recommended_plan,
        }


def _get_next_plan_slug(current_slug: str) -> str:
    """Возвращает следующий по уровню тариф."""
    from .subscription_access import next_plan_slug

    return next_plan_slug(current_slug)


class SubscriptionLimitService:

    @staticmethod
    def get_current_subscription(teacher: User):
        """Возвращает активную подписку учителя или None."""
        from .models import TeacherSubscription
        try:
            sub = teacher.subscription
        except TeacherSubscription.DoesNotExist:
            return None
        if sub.is_valid():
            return sub
        return sub  # возвращаем даже истёкшую — caller решает что делать

    @staticmethod
    def get_or_create_subscription(teacher: User, *, apply_promo: bool = False):
        """Возвращает подписку, создавая бесплатный тариф «Старт» при необходимости.

        Всегда читает строку из БД (без кэша related-object): webhook/оплата
        могут обновить expires_at параллельно.

        apply_promo=True — явная выдача стартовой акции (если она активна в админке).
        По умолчанию не выдаём: новые учителя остаются на «Старте», уже полученные
        Premium не трогаем. Регистрация вызывает apply_registration_promo отдельно.
        """
        from .models import TariffPlan, TeacherSubscription

        sub = (
            TeacherSubscription.objects.select_related("plan")
            .filter(teacher=teacher)
            .first()
        )
        if sub is None:
            start_plan = TariffPlan.objects.filter(slug="start", is_active=True).first()
            if not start_plan:
                start_plan, _ = TariffPlan.objects.get_or_create(
                    slug="start",
                    defaults={"name": "Старт", "price_month": 0, "sort_order": 0},
                )
            sub = TeacherSubscription.objects.create(
                teacher=teacher,
                plan=start_plan,
                status=TeacherSubscription.Status.ACTIVE,
            )
            sub = TeacherSubscription.objects.select_related("plan").get(pk=sub.pk)
        if apply_promo:
            from .registration_promo import ensure_registration_promo

            ensure_registration_promo(teacher)
            sub = (
                TeacherSubscription.objects.select_related("plan")
                .filter(teacher=teacher)
                .first()
            ) or sub
        return sub

    @staticmethod
    def get_current_plan(teacher: User):
        """Эффективный тариф: при истечении/невалидной подписке — «Старт»."""
        from .models import TeacherSubscription
        from .subscription_access import SubscriptionAccessService

        sub = SubscriptionLimitService.get_or_create_subscription(teacher)
        if sub.is_valid():
            return sub.plan

        start_plan = SubscriptionAccessService.get_start_plan()
        # Доступ уже как «Старт». Persist-демотирование — только если период
        # всё ещё истёк (не затираем параллельный webhook) и нет prepaid/grace.
        now = timezone.now()
        if sub.expires_at and sub.status in (
            TeacherSubscription.Status.ACTIVE,
            TeacherSubscription.Status.TRIAL,
        ):
            from .subscription_downgrade import DowngradeService
            from .subscription_lifecycle import RENEW_GRACE

            change = DowngradeService.get_active_change(sub)
            in_renew_grace = bool(
                sub.auto_renew
                and (sub.tbank_rebill_id or "").strip()
                and sub.expires_at >= now - RENEW_GRACE
            )
            if change or in_renew_grace:
                return start_plan
            TeacherSubscription.objects.filter(
                pk=sub.pk,
                expires_at__lte=now,
                status__in=[
                    TeacherSubscription.Status.ACTIVE,
                    TeacherSubscription.Status.TRIAL,
                ],
            ).update(
                status=TeacherSubscription.Status.EXPIRED,
                plan_id=start_plan.pk,
            )
        return start_plan

    @staticmethod
    def get_current_period() -> tuple[date, date]:
        """Начало и конец текущего месячного периода."""
        today = timezone.now().date()
        period_start = today.replace(day=1)
        if today.month == 12:
            period_end = today.replace(year=today.year + 1, month=1, day=1)
        else:
            period_end = today.replace(month=today.month + 1, day=1)
        return period_start, period_end

    @staticmethod
    def get_ai_usage(teacher: User):
        """Возвращает (или создаёт) запись использования ИИ за текущий месяц."""
        from .models import AIUsage, TariffPlan
        plan = SubscriptionLimitService.get_current_plan(teacher)
        period_start, period_end = SubscriptionLimitService.get_current_period()
        usage, _ = AIUsage.objects.get_or_create(
            teacher=teacher,
            period_start=period_start,
            defaults={
                "period_end": period_end,
                "used_requests": 0,
                "limit_requests": plan.ai_requests_monthly_limit,
            },
        )
        # Синхронизируем лимит если тариф изменился
        if usage.limit_requests != plan.ai_requests_monthly_limit:
            usage.limit_requests = plan.ai_requests_monthly_limit
            usage.save(update_fields=["limit_requests", "updated_at"])
        return usage

    @staticmethod
    def get_usage(teacher: User) -> dict:
        """Полный срез текущего использования ресурсов учителя.

        Интерактивы/варианты/тетради — за текущий календарный месяц
        (как can_create_interactive / enforce_variant_creation).
        Ученики/группы/уроки — фактическое текущее количество.
        """
        from .tariff_usage import TariffUsageService

        counts = TariffUsageService.collect_counts(teacher)
        return {
            "students": counts["students"],
            "groups": counts["groups"],
            "lessons": counts["lessons"],
            "interactives": counts["interactives"],
            "variants": counts["variants"],
            "workbooks": counts["workbooks"],
            "ai_requests": counts["ai_requests"],
            "storage_bytes": counts["storage_bytes"],
        }

    # ── can_* методы ─────────────────────────────────────────────────────────

    @staticmethod
    def can_create_student(teacher: User) -> bool:
        from .tariff_usage import TariffUsageService

        return TariffUsageService.is_within_limit(teacher, "students")

    @staticmethod
    def can_create_group(teacher: User) -> bool:
        from .tariff_usage import TariffUsageService

        return TariffUsageService.is_within_limit(teacher, "groups")

    @staticmethod
    def can_create_lesson(teacher: User) -> bool:
        return True

    @staticmethod
    def can_create_interactive(teacher: User) -> bool:
        from .tariff_usage import TariffUsageService

        return TariffUsageService.is_within_limit(teacher, "interactives")

    @staticmethod
    def can_use_ai(teacher: User, cost_units: int = 1) -> bool:
        plan = SubscriptionLimitService.get_current_plan(teacher)
        ai_usage = SubscriptionLimitService.get_ai_usage(teacher)
        return (ai_usage.used_requests + cost_units) <= plan.ai_requests_monthly_limit

    @staticmethod
    def can_use_notifications(teacher: User) -> bool:
        plan = SubscriptionLimitService.get_current_plan(teacher)
        return plan.has_basic_notifications or plan.has_advanced_notifications

    # ── raise_if_* методы ────────────────────────────────────────────────────

    @staticmethod
    def raise_if_student_limit_reached(teacher: User):
        from .tariff_usage import TariffUsageService

        item = TariffUsageService.get_item(teacher, "students")
        if item and not item["unlimited"] and item["exhausted"]:
            raise LimitExceeded(
                code="STUDENT_LIMIT_REACHED",
                message="Лимит учеников исчерпан",
                limit=item["limit"],
                current=item["used"],
                recommended_plan=_get_next_plan_slug(
                    SubscriptionLimitService.get_current_plan(teacher).slug
                ),
            )

    @staticmethod
    def raise_if_group_limit_reached(teacher: User):
        from .tariff_usage import TariffUsageService

        item = TariffUsageService.get_item(teacher, "groups")
        if item and not item["unlimited"] and item["exhausted"]:
            raise LimitExceeded(
                code="GROUP_LIMIT_REACHED",
                message="Лимит групп исчерпан",
                limit=item["limit"],
                current=item["used"],
                recommended_plan=_get_next_plan_slug(
                    SubscriptionLimitService.get_current_plan(teacher).slug
                ),
            )

    @staticmethod
    def raise_if_lesson_limit_reached(teacher: User):
        return

    @staticmethod
    def raise_if_interactive_limit_reached(teacher: User):
        from .tariff_usage import TariffUsageService

        item = TariffUsageService.get_item(teacher, "interactives")
        if item and not item["unlimited"] and item["exhausted"]:
            raise LimitExceeded(
                code="INTERACTIVE_LIMIT_REACHED",
                message="Лимит создания интерактивов на этот месяц исчерпан",
                limit=item["limit"],
                current=item["used"],
                recommended_plan=_get_next_plan_slug(
                    SubscriptionLimitService.get_current_plan(teacher).slug
                ),
            )

    @staticmethod
    @transaction.atomic
    def consume_interactive_creation(teacher: User):
        """Увеличивает месячный счётчик созданных интерактивов."""
        from django.db.models import F
        from django.utils import timezone

        from .subscription_access import SubscriptionAccessService

        usage = SubscriptionAccessService.get_teacher_monthly_usage(teacher)
        type(usage).objects.filter(pk=usage.pk).update(
            interactives_created=F("interactives_created") + 1,
            updated_at=timezone.now(),
        )

    @staticmethod
    def raise_if_ai_limit_reached(teacher: User, cost_units: int = 1):
        plan = SubscriptionLimitService.get_current_plan(teacher)
        ai_usage = SubscriptionLimitService.get_ai_usage(teacher)
        if (ai_usage.used_requests + cost_units) > plan.ai_requests_monthly_limit:
            raise LimitExceeded(
                code="AI_LIMIT_REACHED",
                message="Лимит ИИ-запросов исчерпан",
                limit=plan.ai_requests_monthly_limit,
                current=ai_usage.used_requests,
                recommended_plan=_get_next_plan_slug(plan.slug),
            )

    @staticmethod
    @transaction.atomic
    def consume_ai_request(teacher: User, cost_units: int = 1):
        """Увеличивает счётчик использованных ИИ-запросов."""
        ai_usage = SubscriptionLimitService.get_ai_usage(teacher)
        ai_usage.used_requests = ai_usage.used_requests + cost_units
        ai_usage.save(update_fields=["used_requests", "updated_at"])
        return ai_usage


# ── Промокоды ─────────────────────────────────────────────────────────────────

class PromoCodeError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    def to_dict(self):
        return {"code": self.code, "message": self.message, "valid": False}


class PromoCodeService:

    @staticmethod
    def validate(teacher: User, code_str: str, plan_slug: Optional[str] = None):
        """
        Проверяет промокод для учителя. Не применяет — только валидирует.
        Возвращает объект PromoCode или выбрасывает PromoCodeError.
        """
        from django.utils import timezone as tz

        from .models import PromoCode, PromoCodeUsage

        try:
            promo = PromoCode.objects.get(code__iexact=code_str.strip())
        except PromoCode.DoesNotExist:
            raise PromoCodeError("PROMO_NOT_FOUND", "Промокод не найден.")

        if not promo.is_active:
            raise PromoCodeError("PROMO_INACTIVE", "Промокод больше не действует.")

        now = tz.now()
        if promo.valid_from and now < promo.valid_from:
            raise PromoCodeError("PROMO_NOT_STARTED", "Промокод пока недоступен.")
        if promo.valid_until and now > promo.valid_until:
            raise PromoCodeError("PROMO_EXPIRED", "Срок действия промокода истёк.")

        # Глобальный лимит с учётом активных резервов (uses_count растёт только после оплаты).
        if promo.max_uses is not None:
            reserved = PromoCodeUsage.objects.filter(
                promo_code=promo,
                status=PromoCodeUsage.Status.RESERVED,
            ).count()
            if int(promo.uses_count or 0) + reserved >= promo.max_uses:
                raise PromoCodeError("PROMO_LIMIT", "Промокод уже использован.")

        user_uses = PromoCodeUsage.objects.filter(
            promo_code=promo,
            teacher=teacher,
            status__in=[
                PromoCodeUsage.Status.APPLIED,
                PromoCodeUsage.Status.RESERVED,
            ],
        ).count()
        if user_uses >= promo.max_uses_per_user:
            raise PromoCodeError("PROMO_ALREADY_USED", "Промокод уже использован.")

        if plan_slug and promo.applicable_plans.exists():
            if not promo.applicable_plans.filter(slug=plan_slug).exists():
                raise PromoCodeError(
                    "PROMO_NOT_APPLICABLE",
                    "Промокод не действует для этого тарифа.",
                )

        if getattr(promo, "first_payment_only", False):
            from .models import Payment

            if Payment.objects.filter(teacher=teacher, status=Payment.Status.PAID).exists():
                raise PromoCodeError(
                    "PROMO_FIRST_PAYMENT_ONLY",
                    "Промокод действует только на первый платёж.",
                )

        return promo

    @staticmethod
    def calculate_discount(promo, original_amount) -> dict:
        """Рассчитывает скидку. Возвращает итоговую сумму и размер скидки."""
        from decimal import Decimal

        from .pricing_service import _q, promo_discount_breakdown

        breakdown = promo_discount_breakdown(promo, original_amount)
        amount = _q(original_amount)
        return {
            "original_amount": str(amount),
            "discount": str(breakdown["discount"]),
            "final_amount": str(breakdown["final_amount"]),
            "discount_type": breakdown["discount_type"],
            "discount_value": breakdown["discount_value"],
            "bonus_days": breakdown["bonus_days"],
        }

    @staticmethod
    @transaction.atomic
    def apply(teacher: User, code_str: str, plan_slug: Optional[str] = None, payment=None):
        """
        Резервирует промокод на время оплаты (status=reserved).
        Счётчик uses_count увеличивается только после успешной оплаты (confirm).
        """
        from .models import PromoCodeUsage, TariffPlan

        promo = PromoCodeService.validate(teacher, code_str, plan_slug)
        plan = None
        if plan_slug:
            plan = TariffPlan.objects.filter(slug=plan_slug, is_active=True).first()
        if plan is None and payment is not None:
            plan = getattr(payment, "plan", None)
        if plan is None:
            plan = SubscriptionLimitService.get_current_plan(teacher)

        original_amount = plan.price_month
        if payment is not None and getattr(payment, "billing_period", "") == "year":
            original_amount = plan.price_year
        discount_info = PromoCodeService.calculate_discount(promo, original_amount)

        # Не дублируем reserve для того же платежа
        if payment is not None:
            existing = PromoCodeUsage.objects.filter(
                promo_code=promo,
                teacher=teacher,
                payment=payment,
                status=PromoCodeUsage.Status.RESERVED,
            ).first()
            if existing:
                return promo, discount_info

        PromoCodeUsage.objects.create(
            promo_code=promo,
            teacher=teacher,
            payment=payment,
            status=PromoCodeUsage.Status.RESERVED,
            discount_applied=discount_info["discount"],
        )
        return promo, discount_info

    @staticmethod
    @transaction.atomic
    def confirm_for_payment(payment) -> None:
        """Фиксирует reserved→applied после успешной оплаты и увеличивает uses_count."""
        from .models import PromoCodeUsage

        usages = list(
            PromoCodeUsage.objects.select_for_update()
            .select_related("promo_code")
            .filter(payment=payment, status=PromoCodeUsage.Status.RESERVED)
        )
        for usage in usages:
            promo = usage.promo_code
            usage.status = PromoCodeUsage.Status.APPLIED
            usage.save(update_fields=["status"])
            promo.uses_count = int(promo.uses_count or 0) + 1
            promo.save(update_fields=["uses_count", "updated_at"])

    @staticmethod
    @transaction.atomic
    def release_for_payment(payment) -> None:
        """Снимает резерв промокода при неуспешной/отменённой оплате."""
        from .models import PromoCodeUsage

        PromoCodeUsage.objects.filter(
            payment=payment,
            status=PromoCodeUsage.Status.RESERVED,
        ).update(status=PromoCodeUsage.Status.CANCELLED)
