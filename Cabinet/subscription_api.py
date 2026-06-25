"""
API для тарифной системы.

Endpoints:
  GET  /api/cabinet/subscription/current/
  GET  /api/cabinet/subscription/usage/
  GET  /api/cabinet/subscription/plans/
  POST /api/cabinet/subscription/change-plan/
  POST /api/cabinet/subscription/create-payment/
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from .models import TariffPlan, TeacherSubscription
from .permissions import IsCabinetTeacher
from .subscription_service import SubscriptionLimitService


def _plan_short(plan) -> dict:
    return {
        "id": plan.pk,
        "name": plan.name,
        "slug": plan.slug,
        "description": plan.description,
        "price_month": str(plan.price_month),
        "price_year": str(plan.price_year),
        "currency": plan.currency,
        "is_recommended": plan.is_recommended,
        "limits": {
            "students": plan.max_students,
            "groups": plan.max_groups,
            "lessons": plan.max_lessons,
            "interactives": plan.max_interactives,
            "ai_requests": plan.ai_requests_monthly_limit,
            "storage_mb": plan.max_storage_mb,
        },
        "features": {
            "homework": plan.has_homework,
            "review": plan.has_review,
            "basic_notifications": plan.has_basic_notifications,
            "advanced_notifications": plan.has_advanced_notifications,
            "extended_library": plan.has_extended_library,
            "multi_teacher": plan.has_multi_teacher,
            "team_roles": plan.has_team_roles,
        },
    }


class SubscriptionCurrentView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        sub = SubscriptionLimitService.get_or_create_subscription(request.user)
        return Response({
            "subscription": {
                "status": sub.status,
                "started_at": sub.started_at.isoformat() if sub.started_at else None,
                "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
                "billing_period": sub.billing_period,
                "auto_renew": sub.auto_renew,
                "is_valid": sub.is_valid(),
            },
            "plan": _plan_short(sub.plan),
        })


class SubscriptionUsageView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        sub = SubscriptionLimitService.get_or_create_subscription(request.user)
        plan = sub.plan
        usage = SubscriptionLimitService.get_usage(request.user)
        ai_usage = SubscriptionLimitService.get_ai_usage(request.user)

        return Response({
            "plan": {"name": plan.name, "slug": plan.slug},
            "subscription": {
                "status": sub.status,
                "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
            },
            "limits": {
                "students": plan.max_students,
                "groups": plan.max_groups,
                "lessons": plan.max_lessons,
                "interactives": plan.max_interactives,
                "ai_requests": plan.ai_requests_monthly_limit,
            },
            "usage": {
                "students": usage["students"],
                "groups": usage["groups"],
                "lessons": usage["lessons"],
                "interactives": usage["interactives"],
                "ai_requests": ai_usage.used_requests,
            },
            "features": {
                "homework": plan.has_homework,
                "review": plan.has_review,
                "basic_notifications": plan.has_basic_notifications,
                "advanced_notifications": plan.has_advanced_notifications,
                "extended_library": plan.has_extended_library,
                "multi_teacher": plan.has_multi_teacher,
            },
        })


class SubscriptionPlansView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        plans = TariffPlan.objects.filter(is_active=True).order_by("sort_order", "price_month")
        current_plan = SubscriptionLimitService.get_current_plan(request.user)
        return Response({
            "current_slug": current_plan.slug,
            "plans": [_plan_short(p) for p in plans],
        })


class SubscriptionChangePlanView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        slug = request.data.get("plan_slug")
        billing_period = request.data.get("billing_period", "month")

        plan = TariffPlan.objects.filter(slug=slug, is_active=True).first()
        if not plan:
            return Response({"detail": "Тарифный план не найден."}, status=404)

        # Переход на бесплатный тариф — без оплаты
        if plan.price_month == 0:
            sub = SubscriptionLimitService.get_or_create_subscription(request.user)
            sub.plan = plan
            sub.billing_period = billing_period
            sub.status = TeacherSubscription.Status.ACTIVE
            sub.expires_at = None
            sub.save()
            return Response({
                "ok": True,
                "plan": _plan_short(plan),
                "requires_payment": False,
            })

        return Response({
            "ok": False,
            "requires_payment": True,
            "plan": _plan_short(plan),
            "billing_period": billing_period,
        })


class SubscriptionCreatePaymentView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        from .payment_service import PaymentProviderService
        from .subscription_service import PromoCodeError, PromoCodeService

        slug = request.data.get("plan_slug")
        billing_period = request.data.get("billing_period", "month")
        promo_code = (request.data.get("promo_code") or "").strip()

        plan = TariffPlan.objects.filter(slug=slug, is_active=True).first()
        if not plan:
            return Response({"detail": "Тарифный план не найден."}, status=404)

        discount_info = None
        if promo_code:
            try:
                promo = PromoCodeService.validate(request.user, promo_code, slug)
                discount_info = PromoCodeService.calculate_discount(
                    promo,
                    plan.price_year if billing_period == "year" else plan.price_month,
                )
            except PromoCodeError as exc:
                return Response(exc.to_dict(), status=400)

        try:
            result = PaymentProviderService.create_payment(
                teacher=request.user,
                plan=plan,
                billing_period=billing_period,
                promo_code=promo_code or None,
                discount_info=discount_info,
            )
        except ValueError as exc:
            return Response({"detail": str(exc), "code": "PAYMENT_UNAVAILABLE"}, status=503)
        return Response(result, status=201)


class PromoCodeValidateView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        from .subscription_service import PromoCodeError, PromoCodeService

        code_str = (request.data.get("code") or "").strip()
        plan_slug = (request.data.get("plan_slug") or "").strip() or None

        if not code_str:
            return Response({"detail": "Укажите промокод."}, status=400)

        try:
            promo = PromoCodeService.validate(request.user, code_str, plan_slug)
        except PromoCodeError as exc:
            return Response(exc.to_dict(), status=400)

        # Рассчитываем скидку для текущего тарифа или выбранного
        from .models import TariffPlan
        if plan_slug:
            plan = TariffPlan.objects.filter(slug=plan_slug, is_active=True).first()
        else:
            plan = SubscriptionLimitService.get_current_plan(request.user)

        discount_info = {}
        if plan:
            discount_info = PromoCodeService.calculate_discount(promo, plan.price_month)

        return Response({
            "valid": True,
            "code": promo.code,
            "discount_type": promo.discount_type,
            "discount_value": str(promo.discount_value),
            **discount_info,
        })
