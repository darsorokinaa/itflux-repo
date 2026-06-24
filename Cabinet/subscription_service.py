"""
SubscriptionLimitService — проверка тарифных лимитов учителя.

Все проверки выполняются ТОЛЬКО по данным текущего учителя.
Никаких данных других пользователей здесь не используется.
"""

import uuid
from datetime import date
from typing import Optional

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone

from .choices import GroupStatus, InteractiveStatus, LessonStatus, StudentStatus


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
    ladder = ["start", "repetitor", "pro", "school"]
    try:
        idx = ladder.index(current_slug)
        return ladder[idx + 1] if idx + 1 < len(ladder) else "school"
    except ValueError:
        return "repetitor"


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
    def get_or_create_subscription(teacher: User):
        """Возвращает подписку, создавая бесплатный тариф при необходимости."""
        from .models import TariffPlan, TeacherSubscription
        try:
            return teacher.subscription
        except TeacherSubscription.DoesNotExist:
            start_plan = TariffPlan.objects.filter(slug="start", is_active=True).first()
            if not start_plan:
                start_plan, _ = TariffPlan.objects.get_or_create(
                    slug="start",
                    defaults={"name": "Старт", "price_month": 0, "sort_order": 0},
                )
            return TeacherSubscription.objects.create(
                teacher=teacher,
                plan=start_plan,
                status=TeacherSubscription.Status.ACTIVE,
            )

    @staticmethod
    def get_current_plan(teacher: User):
        """Возвращает текущий тарифный план."""
        sub = SubscriptionLimitService.get_or_create_subscription(teacher)
        return sub.plan

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
        """Полный срез текущего использования ресурсов учителя."""
        from .models import Student, StudentGroup, Lesson, Interactive
        ai_usage = SubscriptionLimitService.get_ai_usage(teacher)
        return {
            "students": Student.objects.filter(
                teacher=teacher
            ).exclude(status=StudentStatus.ARCHIVED).count(),
            "groups": StudentGroup.objects.filter(
                teacher=teacher
            ).exclude(status=GroupStatus.ARCHIVED).count(),
            "lessons": Lesson.objects.filter(
                teacher=teacher
            ).exclude(status=LessonStatus.ARCHIVED).count(),
            "interactives": Interactive.objects.filter(
                teacher=teacher
            ).exclude(status=InteractiveStatus.ARCHIVED).count(),
            "ai_requests": ai_usage.used_requests,
        }

    # ── can_* методы ─────────────────────────────────────────────────────────

    @staticmethod
    def can_create_student(teacher: User) -> bool:
        plan = SubscriptionLimitService.get_current_plan(teacher)
        usage = SubscriptionLimitService.get_usage(teacher)
        return usage["students"] < plan.max_students

    @staticmethod
    def can_create_group(teacher: User) -> bool:
        plan = SubscriptionLimitService.get_current_plan(teacher)
        usage = SubscriptionLimitService.get_usage(teacher)
        return usage["groups"] < plan.max_groups

    @staticmethod
    def can_create_lesson(teacher: User) -> bool:
        plan = SubscriptionLimitService.get_current_plan(teacher)
        usage = SubscriptionLimitService.get_usage(teacher)
        return usage["lessons"] < plan.max_lessons

    @staticmethod
    def can_create_interactive(teacher: User) -> bool:
        plan = SubscriptionLimitService.get_current_plan(teacher)
        usage = SubscriptionLimitService.get_usage(teacher)
        return usage["interactives"] < plan.max_interactives

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
        plan = SubscriptionLimitService.get_current_plan(teacher)
        usage = SubscriptionLimitService.get_usage(teacher)
        if usage["students"] >= plan.max_students:
            raise LimitExceeded(
                code="STUDENT_LIMIT_REACHED",
                message="Лимит учеников исчерпан",
                limit=plan.max_students,
                current=usage["students"],
                recommended_plan=_get_next_plan_slug(plan.slug),
            )

    @staticmethod
    def raise_if_group_limit_reached(teacher: User):
        plan = SubscriptionLimitService.get_current_plan(teacher)
        usage = SubscriptionLimitService.get_usage(teacher)
        if usage["groups"] >= plan.max_groups:
            raise LimitExceeded(
                code="GROUP_LIMIT_REACHED",
                message="Лимит групп исчерпан",
                limit=plan.max_groups,
                current=usage["groups"],
                recommended_plan=_get_next_plan_slug(plan.slug),
            )

    @staticmethod
    def raise_if_lesson_limit_reached(teacher: User):
        plan = SubscriptionLimitService.get_current_plan(teacher)
        usage = SubscriptionLimitService.get_usage(teacher)
        if usage["lessons"] >= plan.max_lessons:
            raise LimitExceeded(
                code="LESSON_LIMIT_REACHED",
                message="Лимит уроков исчерпан",
                limit=plan.max_lessons,
                current=usage["lessons"],
                recommended_plan=_get_next_plan_slug(plan.slug),
            )

    @staticmethod
    def raise_if_interactive_limit_reached(teacher: User):
        plan = SubscriptionLimitService.get_current_plan(teacher)
        usage = SubscriptionLimitService.get_usage(teacher)
        if usage["interactives"] >= plan.max_interactives:
            raise LimitExceeded(
                code="INTERACTIVE_LIMIT_REACHED",
                message="Лимит интерактивов исчерпан",
                limit=plan.max_interactives,
                current=usage["interactives"],
                recommended_plan=_get_next_plan_slug(plan.slug),
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
        from .models import PromoCode, PromoCodeUsage

        try:
            promo = PromoCode.objects.get(code__iexact=code_str.strip())
        except PromoCode.DoesNotExist:
            raise PromoCodeError("PROMO_NOT_FOUND", "Промокод не найден")

        if not promo.is_valid_now():
            raise PromoCodeError("PROMO_EXPIRED", "Промокод недействителен или истёк")

        # Проверка лимита на пользователя
        user_uses = PromoCodeUsage.objects.filter(promo_code=promo, teacher=teacher).count()
        if user_uses >= promo.max_uses_per_user:
            raise PromoCodeError("PROMO_ALREADY_USED", "Промокод уже был использован")

        # Проверка применимости к тарифу
        if plan_slug and promo.applicable_plans.exists():
            if not promo.applicable_plans.filter(slug=plan_slug).exists():
                raise PromoCodeError("PROMO_NOT_APPLICABLE", "Промокод не применим к этому тарифу")

        return promo

    @staticmethod
    def calculate_discount(promo, original_amount) -> dict:
        """Рассчитывает скидку. Возвращает итоговую сумму и размер скидки."""
        from decimal import Decimal
        from .models import PromoCode

        amount = Decimal(str(original_amount))
        discount_value = promo.discount_value

        if promo.discount_type == PromoCode.DiscountType.PERCENT:
            discount = (amount * discount_value / 100).quantize(Decimal("0.01"))
            final = max(Decimal("0"), amount - discount)
        elif promo.discount_type == PromoCode.DiscountType.FIXED:
            discount = min(amount, discount_value)
            final = max(Decimal("0"), amount - discount)
        elif promo.discount_type == PromoCode.DiscountType.FREE_MONTHS:
            discount = amount
            final = Decimal("0")
        else:
            discount = Decimal("0")
            final = amount

        return {
            "original_amount": str(amount),
            "discount": str(discount),
            "final_amount": str(final),
            "discount_type": promo.discount_type,
            "discount_value": str(promo.discount_value),
        }

    @staticmethod
    @transaction.atomic
    def apply(teacher: User, code_str: str, plan_slug: Optional[str] = None, payment=None):
        """
        Применяет промокод: записывает использование и увеличивает счётчик.
        Возвращает (promo, discount_info).
        """
        from .models import PromoCodeUsage

        promo = PromoCodeService.validate(teacher, code_str, plan_slug)
        plan = SubscriptionLimitService.get_current_plan(teacher)

        # Считаем скидку на основе тарифа
        billing_period = "month"
        original_amount = plan.price_month
        discount_info = PromoCodeService.calculate_discount(promo, original_amount)

        PromoCodeUsage.objects.create(
            promo_code=promo,
            teacher=teacher,
            payment=payment,
            discount_applied=discount_info["discount"],
        )

        promo.uses_count = promo.uses_count + 1
        promo.save(update_fields=["uses_count", "updated_at"])

        return promo, discount_info
