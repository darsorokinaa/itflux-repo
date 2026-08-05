"""
API для тарифной системы.

Endpoints:
  GET  /api/cabinet/subscription/current/
  GET  /api/cabinet/subscription/usage/
  GET  /api/cabinet/subscription/plans/
  GET  /api/cabinet/pricing/plans/          (public)
  GET  /api/cabinet/library/new-this-month/
  POST /api/cabinet/subscription/change-plan/
  POST /api/cabinet/subscription/create-payment/
  POST /api/cabinet/subscription/referral-link/
  POST /api/cabinet/usage/workbook/
  POST /payments/webhook/<provider>/
"""

from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Interactive, Lesson, Material, Payment, ReferralLink, TariffPlan, TeacherSubscription
from .permissions import IsCabinetTeacher
from .subscription_access import AccessDenied, SubscriptionAccessService
from .subscription_service import SubscriptionLimitService


def _plan_is_free(plan) -> bool:
    """is_free из модели; school (cta=contact) не считается бесплатным даже при цене 0."""
    if getattr(plan, "cta_type", "") == TariffPlan.CtaType.CONTACT:
        return False
    if getattr(plan, "is_free", False):
        return True
    return Decimal(str(plan.price_month or 0)) == 0


def _year_savings_months(price_month, price_year) -> int | None:
    """Сколько месяцев экономии при годовой оплате (только если экономия реальная)."""
    month = Decimal(str(price_month or 0))
    year = Decimal(str(price_year or 0))
    if month <= 0 or year <= 0:
        return None
    full_year = month * 12
    if year >= full_year:
        return None
    saved = (full_year - year) / month
    months = int(saved.to_integral_value(rounding=ROUND_HALF_UP))
    return months if months > 0 else None


def _plan_public(plan) -> dict:
    """Витрина: без ИИ-лимитов."""
    savings = _year_savings_months(plan.price_month, plan.price_year)
    return {
        "id": plan.pk,
        "name": plan.name,
        "slug": plan.slug,
        "description": plan.description,
        "short_description": getattr(plan, "short_description", "") or "",
        "badge_text": getattr(plan, "badge_text", "") or "",
        "price_month": str(plan.price_month),
        "price_year": str(plan.price_year),
        "currency": plan.currency,
        "is_recommended": plan.is_recommended,
        "is_featured": getattr(plan, "is_featured", False),
        "is_free": _plan_is_free(plan),
        "is_public": getattr(plan, "is_public", True),
        "cta_type": getattr(plan, "cta_type", "checkout"),
        "content_access_rank": getattr(plan, "content_access_rank", 0),
        "monthly_library_promise": getattr(plan, "monthly_library_promise", False),
        "year_savings_months": savings,
        "limits": {
            "students": plan.max_students,
            "groups": plan.max_groups,
            "lessons": plan.max_lessons,
            "interactives": plan.max_interactives,
            "variants_monthly": plan.max_variants_monthly,
            "workbooks_monthly": plan.max_workbooks_monthly,
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
            "mass_actions": getattr(plan, "has_mass_actions", False),
            "priority_support": getattr(plan, "has_priority_support", False),
            "analytics": getattr(plan, "has_analytics", False),
            "simulators": getattr(plan, "has_simulators", False),
        },
    }


def _subscription_payload(sub: TeacherSubscription) -> dict:
    import math

    now = timezone.now()
    expires_at = sub.expires_at
    days_remaining = None
    if expires_at:
        seconds = (expires_at - now).total_seconds()
        days_remaining = max(0, math.ceil(seconds / 86400)) if seconds > 0 else 0

    is_launch_promo = (
        getattr(sub, "source", "") == TeacherSubscription.Source.LAUNCH_PROMO
        or bool(getattr(sub, "is_legacy_promo", False))
    )
    # Акция как источник текущего доступа — только пока подписка ещё действует.
    launch_promo_active = bool(is_launch_promo and sub.is_valid())

    latest_payment = (
        Payment.objects.filter(teacher=sub.teacher)
        .order_by("-created_at")
        .first()
    )
    payment_state = None
    if latest_payment and latest_payment.status in (
        Payment.Status.PENDING,
        Payment.Status.FAILED,
    ):
        payment_state = {
            "status": latest_payment.status,
            "plan_slug": latest_payment.plan.slug if latest_payment.plan_id else None,
            "plan_name": latest_payment.plan.name if latest_payment.plan_id else None,
            "final_amount": str(
                latest_payment.final_amount
                if latest_payment.final_amount is not None
                else latest_payment.amount
            ),
            "created_at": latest_payment.created_at.isoformat() if latest_payment.created_at else None,
        }

    scheduled = None
    if sub.scheduled_plan_id and sub.scheduled_change_at:
        scheduled = {
            "plan_slug": sub.scheduled_plan.slug,
            "plan_name": sub.scheduled_plan.name,
            "change_at": sub.scheduled_change_at.isoformat(),
        }

    return {
        "status": sub.status,
        "source": getattr(sub, "source", "self"),
        "started_at": sub.started_at.isoformat() if sub.started_at else None,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "promo_ends_at": sub.promo_ends_at.isoformat() if getattr(sub, "promo_ends_at", None) else None,
        "promo_started_at": (
            sub.promo_started_at.isoformat() if getattr(sub, "promo_started_at", None) else None
        ),
        "current_period_start": (
            sub.current_period_start.isoformat() if getattr(sub, "current_period_start", None) else None
        ),
        "current_period_end": (
            sub.current_period_end.isoformat() if getattr(sub, "current_period_end", None) else None
        ),
        "billing_period": sub.billing_period,
        "auto_renew": sub.auto_renew,
        "is_valid": sub.is_valid(),
        "cancelled_at": sub.cancelled_at.isoformat() if getattr(sub, "cancelled_at", None) else None,
        "days_remaining": days_remaining,
        "is_launch_promo": is_launch_promo,
        "launch_promo_active": launch_promo_active,
        "plan_name": sub.plan.name if sub.plan_id else None,
        "plan_slug": sub.plan.slug if sub.plan_id else None,
        "scheduled_plan": scheduled,
        "latest_payment": payment_state,
    }


def _anonymous_payload() -> dict:
    return {
        "title": "Попробовать без регистрации",
        "description": (
            "Можно собрать варианты и рабочие тетради в пределах лимита. "
            "Без личного кабинета и доступа к платным материалам."
        ),
        "limits": {
            "variants": getattr(settings, "ANON_VARIANTS_MONTHLY_LIMIT", 5),
            "workbooks": getattr(settings, "ANON_WORKBOOKS_MONTHLY_LIMIT", 3),
        },
    }


def _referral_program_payload(user) -> dict:
    from .referral_service import get_default_reward_plan

    reward_plan = get_default_reward_plan()
    # Условия из дефолтов модели / активных ссылок (не хардкод витрины).
    sample_link = (
        ReferralLink.objects.filter(is_active=True)
        .order_by("-created_at")
        .first()
    )
    invitee_months = (
        sample_link.reward_months
        if sample_link
        else ReferralLink._meta.get_field("reward_months").default
    )
    # Награда рефереру за оплату приглашённого — см. ReferralReward.reward_months default.
    from .models import ReferralReward

    referrer_months = ReferralReward._meta.get_field("reward_months").default

    my_link = (
        ReferralLink.objects.filter(owner=user, is_active=True)
        .order_by("-created_at")
        .first()
    )
    link_payload = None
    if my_link:
        link_payload = {
            "code": my_link.code,
            "url": f"/cabinet/login?ref={my_link.code}",
            "reward_months": my_link.reward_months,
            "reward_plan_name": (
                my_link.reward_plan.name
                if my_link.reward_plan_id
                else (reward_plan.name if reward_plan else None)
            ),
        }

    return {
        "enabled": True,
        "description": (
            "Приглашайте коллег: приглашённый получает бонусный доступ при регистрации, "
            "а вы — награду после его первой успешной оплаты."
        ),
        "invitee": {
            "months": invitee_months,
            "plan_slug": reward_plan.slug if reward_plan else None,
            "plan_name": reward_plan.name if reward_plan else None,
        },
        "referrer": {
            "months": referrer_months,
            "plan_slug": reward_plan.slug if reward_plan else None,
            "plan_name": reward_plan.name if reward_plan else None,
        },
        "my_link": link_payload,
    }


def _get_or_create_teacher_referral_link(user) -> ReferralLink:
    from .referral_service import get_default_reward_plan
    import secrets
    import re

    existing = (
        ReferralLink.objects.filter(owner=user, is_active=True)
        .order_by("-created_at")
        .first()
    )
    if existing:
        return existing

    base = re.sub(r"[^A-Za-z0-9]", "", (user.username or "TEACHER").upper())[:8] or "TEACHER"
    code = f"{base}{secrets.token_hex(2).upper()}"
    while ReferralLink.objects.filter(code__iexact=code).exists():
        code = f"{base}{secrets.token_hex(2).upper()}"

    return ReferralLink.objects.create(
        code=code,
        title=f"Ссылка {user.get_full_name() or user.username}",
        owner=user,
        reward_plan=get_default_reward_plan(),
        reward_months=ReferralLink._meta.get_field("reward_months").default,
        is_active=True,
    )


def _plan_short(plan) -> dict:
    """Кабинет: совместимость + публичные поля (ИИ скрыт от витрины, в кабинете тоже не акцентируем)."""
    data = _plan_public(plan)
    return data


class SubscriptionCurrentView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        sub = SubscriptionLimitService.get_or_create_subscription(request.user)
        sub = (
            TeacherSubscription.objects.select_related("plan", "scheduled_plan")
            .get(pk=sub.pk)
        )
        return Response({
            "subscription": _subscription_payload(sub),
            "plan": _plan_short(sub.plan),
        })


class SubscriptionUsageView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        sub = SubscriptionLimitService.get_or_create_subscription(request.user)
        plan = sub.plan
        usage = SubscriptionLimitService.get_usage(request.user)
        monthly = SubscriptionAccessService.get_teacher_monthly_usage(request.user)

        return Response({
            "plan": {"name": plan.name, "slug": plan.slug},
            "subscription": {
                "status": sub.status,
                "source": getattr(sub, "source", "self"),
                "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
            },
            "limits": {
                "students": plan.max_students,
                "groups": plan.max_groups,
                "lessons": plan.max_lessons,
                "interactives": plan.max_interactives,
                "variants_monthly": plan.max_variants_monthly,
                "workbooks_monthly": plan.max_workbooks_monthly,
            },
            "usage": {
                "students": usage["students"],
                "groups": usage["groups"],
                "lessons": usage["lessons"],
                "interactives": usage["interactives"],
                "variants": monthly.variants_created,
                "workbooks": monthly.workbooks_created,
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
        from .registration_promo import promo_payload

        plans = (
            TariffPlan.objects.filter(is_active=True)
            .order_by("sort_order", "price_month")
        )
        current_plan = SubscriptionLimitService.get_current_plan(request.user)
        sub = SubscriptionLimitService.get_or_create_subscription(request.user)
        sub = (
            TeacherSubscription.objects.select_related("plan", "scheduled_plan")
            .get(pk=sub.pk)
        )

        paid_plans = [p for p in plans if not _plan_is_free(p) and p.cta_type != TariffPlan.CtaType.CONTACT]
        year_savings = None
        for p in paid_plans:
            s = _year_savings_months(p.price_month, p.price_year)
            if s:
                year_savings = s
                break

        return Response({
            "current_slug": current_plan.slug,
            "plans": [_plan_short(p) for p in plans],
            "registration_promo": promo_payload(),
            "subscription": _subscription_payload(sub),
            "anonymous": _anonymous_payload(),
            "referral": _referral_program_payload(request.user),
            "payments_enabled": bool(getattr(settings, "PAYMENTS_ENABLED", False)),
            "billing": {
                "year_savings_months": year_savings,
                "year_savings_label": (
                    f"При оплате за год — экономия {year_savings} "
                    f"{'месяц' if year_savings == 1 else 'месяца' if year_savings in (2, 3, 4) else 'месяцев'}"
                    if year_savings
                    else None
                ),
            },
        })


class PublicPricingPlansView(APIView):
    """Публичная витрина /pricing — без auth, без ИИ-полей."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        from .registration_promo import promo_payload

        plans = (
            TariffPlan.objects.filter(is_active=True, is_public=True)
            .order_by("sort_order", "price_month")
        )
        return Response({
            "plans": [_plan_public(p) for p in plans],
            "anonymous": _anonymous_payload(),
            "registration_promo": promo_payload(),
        })


class SubscriptionReferralLinkView(APIView):
    """Создаёт или возвращает персональную реферальную ссылку учителя."""

    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        link = _get_or_create_teacher_referral_link(request.user)
        reward_name = (
            link.reward_plan.name
            if link.reward_plan_id
            else None
        )
        return Response({
            "code": link.code,
            "url": f"/cabinet/login?ref={link.code}",
            "reward_months": link.reward_months,
            "reward_plan_name": reward_name,
        })


class LibraryNewThisMonthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        user = request.user if getattr(request.user, "is_authenticated", False) else None
        items = []

        for model, kind in (
            (Material, "material"),
            (Lesson, "lesson"),
            (Interactive, "interactive"),
        ):
            qs = SubscriptionAccessService.new_this_month_queryset(model, user)[:20]
            for obj in qs:
                gate = SubscriptionAccessService.serialize_access_gate(user, obj)
                items.append({
                    "kind": kind,
                    "id": obj.pk,
                    "title": getattr(obj, "title", str(obj)),
                    "access_level": gate["access_level"],
                    "allowed": gate["allowed"],
                    "min_plan": gate["min_plan"],
                    "is_new": getattr(obj, "is_new", False),
                    "published_at": (
                        obj.published_at.isoformat()
                        if getattr(obj, "published_at", None)
                        else None
                    ),
                })

        items.sort(key=lambda x: x.get("published_at") or "", reverse=True)
        return Response({"items": items[:30]})


class WorkbookUsageTrackView(APIView):
    """Учёт создания рабочей тетради (клиентская сборка → серверный счётчик)."""

    permission_classes = [AllowAny]

    def post(self, request):
        try:
            usage = SubscriptionAccessService.enforce_workbook_creation(request)
        except AccessDenied as exc:
            return Response(exc.to_dict(), status=403)

        response = Response({
            "ok": True,
            "workbooks_created": getattr(usage, "workbooks_created", None),
        }, status=201)
        if not getattr(request.user, "is_authenticated", False):
            SubscriptionAccessService.set_anonymous_cookie(
                response,
                SubscriptionAccessService.get_or_create_anonymous_id(request),
            )
        return response


class VariantUsageCheckView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        can = SubscriptionAccessService.can_create_variant(request)
        return Response({"allowed": can})


class SubscriptionManageView(APIView):
    """
    Управление текущей подпиской:
      action=set_auto_renew + enabled=true|false — вкл/выкл автопродление
      action=disable_auto_renew — алиас выключения
      action=enable_auto_renew — алиас включения
      action=cancel — отменить подписку (доступ до expires_at сохраняется)
    """

    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        action = (request.data.get("action") or "").strip()
        sub = SubscriptionLimitService.get_or_create_subscription(request.user)
        sub = (
            TeacherSubscription.objects.select_related("plan", "scheduled_plan")
            .get(pk=sub.pk)
        )
        now = timezone.now()

        def _set_auto_renew(enabled: bool):
            if enabled:
                if sub.status in (
                    TeacherSubscription.Status.EXPIRED,
                    TeacherSubscription.Status.SUSPENDED,
                ):
                    return Response(
                        {"detail": "Нельзя включить автопродление для неактивной подписки."},
                        status=400,
                    )
                if sub.expires_at and sub.expires_at <= now:
                    return Response(
                        {"detail": "Подписка истекла. Сначала выберите и оплатите тариф."},
                        status=400,
                    )
                sub.auto_renew = True
                # Возобновление: снимаем отмену, если период ещё действует.
                if sub.cancelled_at and (
                    not sub.expires_at or sub.expires_at > now
                ):
                    sub.cancelled_at = None
                    if sub.status == TeacherSubscription.Status.CANCELLED:
                        sub.status = TeacherSubscription.Status.ACTIVE
                sub.save(update_fields=["auto_renew", "cancelled_at", "status", "updated_at"])
                return Response({
                    "ok": True,
                    "message": "Автопродление включено.",
                    "subscription": _subscription_payload(sub),
                })

            if not sub.auto_renew:
                return Response({
                    "ok": True,
                    "message": "Автопродление уже выключено.",
                    "subscription": _subscription_payload(sub),
                })
            sub.auto_renew = False
            sub.save(update_fields=["auto_renew", "updated_at"])
            return Response({
                "ok": True,
                "message": "Автопродление отключено.",
                "subscription": _subscription_payload(sub),
            })

        if action == "set_auto_renew":
            raw = request.data.get("enabled")
            if isinstance(raw, bool):
                enabled = raw
            elif str(raw).strip().lower() in ("1", "true", "yes", "on"):
                enabled = True
            elif str(raw).strip().lower() in ("0", "false", "no", "off"):
                enabled = False
            else:
                return Response({"detail": "Укажите enabled: true или false."}, status=400)
            return _set_auto_renew(enabled)

        if action == "enable_auto_renew":
            return _set_auto_renew(True)

        if action == "disable_auto_renew":
            return _set_auto_renew(False)

        if action == "cancel":
            if sub.cancelled_at and not sub.auto_renew:
                return Response({
                    "ok": True,
                    "message": "Подписка уже отменена.",
                    "subscription": _subscription_payload(sub),
                })
            sub.auto_renew = False
            sub.cancelled_at = sub.cancelled_at or now
            # Доступ сохраняем до конца оплаченного периода.
            # Статус CANCELLED ставим только если срока уже нет.
            if not sub.expires_at or sub.expires_at <= now:
                sub.status = TeacherSubscription.Status.CANCELLED
                start_plan = TariffPlan.objects.filter(slug="start", is_active=True).first()
                if start_plan and sub.plan_id != start_plan.pk and not _plan_is_free(sub.plan):
                    sub.plan = start_plan
                    sub.expires_at = None
            sub.scheduled_plan = None
            sub.scheduled_change_at = None
            sub.save(update_fields=[
                "auto_renew",
                "cancelled_at",
                "status",
                "plan",
                "expires_at",
                "scheduled_plan",
                "scheduled_change_at",
                "updated_at",
            ])
            message = (
                "Подписка отменена. Доступ сохранится до "
                f"{sub.expires_at.date().isoformat()}."
                if sub.expires_at and sub.expires_at > now
                else "Подписка отменена."
            )
            return Response({
                "ok": True,
                "message": message,
                "subscription": _subscription_payload(sub),
                "current_slug": sub.plan.slug if sub.plan_id else None,
            })

        return Response(
            {
                "detail": (
                    "Неизвестное действие. Допустимо: set_auto_renew, "
                    "enable_auto_renew, disable_auto_renew, cancel."
                ),
            },
            status=400,
        )


class SubscriptionChangePlanView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        slug = request.data.get("plan_slug")
        billing_period = request.data.get("billing_period", "month")

        plan = TariffPlan.objects.filter(slug=slug, is_active=True).first()
        if not plan:
            return Response({"detail": "Тарифный план не найден."}, status=404)

        if getattr(plan, "cta_type", "") == TariffPlan.CtaType.CONTACT:
            return Response({
                "ok": False,
                "requires_contact": True,
                "plan": _plan_short(plan),
            })

        if _plan_is_free(plan):
            sub = SubscriptionLimitService.get_or_create_subscription(request.user)
            sub.plan = plan
            sub.billing_period = billing_period
            sub.status = TeacherSubscription.Status.ACTIVE
            sub.source = TeacherSubscription.Source.SELF
            sub.expires_at = None
            sub.auto_renew = False
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

        if not getattr(settings, "PAYMENTS_ENABLED", False):
            return Response(
                {
                    "detail": "Оплата временно недоступна. Попробуйте позже.",
                    "code": "PAYMENTS_DISABLED",
                },
                status=503,
            )

        slug = request.data.get("plan_slug")
        billing_period = request.data.get("billing_period", "month")
        promo_code = (request.data.get("promo_code") or "").strip()
        idempotency_key = (request.data.get("idempotency_key") or "").strip() or None

        plan = TariffPlan.objects.filter(slug=slug, is_active=True).first()
        if not plan:
            return Response({"detail": "Тарифный план не найден."}, status=404)
        if getattr(plan, "cta_type", "") == TariffPlan.CtaType.CONTACT:
            return Response({"detail": "Тариф оформляется по заявке.", "code": "CONTACT_ONLY"}, status=400)

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
                idempotency_key=idempotency_key,
            )
        except ValueError as exc:
            return Response({"detail": str(exc), "code": "PAYMENT_UNAVAILABLE"}, status=503)
        except NotImplementedError as exc:
            return Response({"detail": str(exc), "code": "PAYMENT_UNAVAILABLE"}, status=503)
        return Response(result, status=201)


class SubscriptionPaymentStatusView(APIView):
    """Статус платежа подписки: sync с банком, confirm mock в DEBUG."""

    permission_classes = [IsCabinetTeacher]

    def get(self, request, payment_id: int):
        from .payment_service import PaymentProviderService

        payment = (
            Payment.objects.select_related("plan")
            .filter(pk=payment_id, teacher=request.user)
            .first()
        )
        if not payment:
            return Response({"detail": "Платёж не найден."}, status=404)

        # ?sync=1 — спросить банк (GetState) и активировать тариф, если оплачено
        if str(request.query_params.get("sync") or "").lower() in ("1", "true", "yes"):
            if payment.status != Payment.Status.PAID:
                PaymentProviderService.sync_payment_from_provider(payment)
                payment.refresh_from_db()
        return Response(self._payload(payment))

    def post(self, request, payment_id: int):
        from django.conf import settings as django_settings

        from .payment_service import PaymentProviderService

        payment = Payment.objects.filter(pk=payment_id, teacher=request.user).first()
        if not payment:
            return Response({"detail": "Платёж не найден."}, status=404)

        action = (request.data.get("action") or "").strip().lower()
        if action in ("sync", "sync_provider"):
            # Возврат с формы банка: подтянуть статус и сменить тариф
            if payment.status != Payment.Status.PAID:
                PaymentProviderService.sync_payment_from_provider(payment)
                payment.refresh_from_db()
            return Response(self._payload(payment))

        if action != "confirm_mock":
            return Response({"detail": "Неизвестное действие."}, status=400)
        if not django_settings.DEBUG or (payment.provider or "") != "mock":
            return Response(
                {"detail": "Подтверждение mock доступно только в DEBUG."},
                status=400,
            )
        if payment.status != Payment.Status.PAID:
            PaymentProviderService.handle_webhook(
                {
                    "payment_id": payment.pk,
                    "status": "paid",
                    "event_id": f"mock_confirm_{payment.pk}",
                    "provider_payment_id": payment.provider_payment_id,
                },
                provider_name="mock",
                skip_provider_parse=True,
            )
            payment.refresh_from_db()
        return Response(self._payload(payment))

    @staticmethod
    def _payload(payment: Payment) -> dict:
        plan = payment.plan
        return {
            "payment_id": payment.pk,
            "status": payment.status,
            "provider": payment.provider,
            "amount": str(payment.final_amount or payment.amount),
            "billing_period": payment.billing_period,
            "plan_slug": plan.slug if plan else (payment.metadata or {}).get("plan_slug"),
            "plan_name": plan.name if plan else None,
            "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
            "is_paid": payment.status == Payment.Status.PAID,
        }


class PromoCodeValidateView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        from .subscription_service import PromoCodeError, PromoCodeService

        code_str = (request.data.get("code") or "").strip()
        plan_slug = (request.data.get("plan_slug") or "").strip() or None
        billing_period = (request.data.get("billing_period") or "month").strip()
        if billing_period not in ("month", "year"):
            billing_period = "month"

        if not code_str:
            return Response({"detail": "Укажите промокод."}, status=400)

        try:
            promo = PromoCodeService.validate(request.user, code_str, plan_slug)
        except PromoCodeError as exc:
            return Response(exc.to_dict(), status=400)

        if plan_slug:
            plan = TariffPlan.objects.filter(slug=plan_slug, is_active=True).first()
        else:
            plan = (
                TariffPlan.objects.filter(is_active=True, is_recommended=True).first()
                or SubscriptionLimitService.get_current_plan(request.user)
            )

        discount_info = {}
        if plan:
            amount = plan.price_year if billing_period == "year" else plan.price_month
            discount_info = PromoCodeService.calculate_discount(promo, amount)

        return Response({
            "valid": True,
            "code": promo.code,
            "discount_type": promo.discount_type,
            "discount_value": str(promo.discount_value),
            "bonus_days": getattr(promo, "bonus_days", 0),
            "billing_period": billing_period,
            "plan_slug": plan.slug if plan else None,
            **discount_info,
        })


class PaymentWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, provider: str):
        from django.http import HttpResponse

        from .payment_service import PaymentProviderService

        result = PaymentProviderService.handle_webhook(
            request.data if hasattr(request, "data") else {},
            provider_name=provider,
        )
        # Т-Банк ожидает тело ответа ровно "OK"
        if (provider or "").strip().lower() in ("tbank", "tinkoff"):
            if result.get("ok"):
                return HttpResponse("OK", content_type="text/plain; charset=utf-8")
            return HttpResponse(
                result.get("error") or "ERROR",
                status=400,
                content_type="text/plain; charset=utf-8",
            )
        status = 200 if result.get("ok") else 400
        return Response(result, status=status)


class ContentAccessCheckView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        kind = (request.data.get("kind") or "").strip()
        obj_id = request.data.get("id")
        model_map = {
            "material": Material,
            "lesson": Lesson,
            "interactive": Interactive,
        }
        model = model_map.get(kind)
        if not model or not obj_id:
            return Response({"detail": "kind и id обязательны"}, status=400)
        obj = model.objects.filter(pk=obj_id).first()
        if not obj:
            return Response({"detail": "Не найдено"}, status=404)
        user = request.user if getattr(request.user, "is_authenticated", False) else None
        try:
            SubscriptionAccessService.raise_if_cannot_access_content(user, obj)
        except AccessDenied as exc:
            return Response(exc.to_dict(), status=403)
        return Response({"allowed": True, **SubscriptionAccessService.serialize_access_gate(user, obj)})
