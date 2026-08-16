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
from datetime import timedelta
import logging

from django.conf import settings
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Interactive, Lesson, Material, Payment, ReferralLink, TariffPlan, TeacherSubscription
from .permissions import IsCabinetTeacher
from .subscription_access import AccessDenied, SubscriptionAccessService
from .subscription_service import SubscriptionLimitService

logger = logging.getLogger(__name__)


def _ensure_tariff_catalog():
    """Если в БД нет Старт/Учитель/Профи/Премиум — заполняет каталог."""
    from .management.commands.seed_tariffs import ensure_default_tariff_plans

    ensure_default_tariff_plans()


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


def _plan_public(plan, *, promotion=None) -> dict:
    """Витрина: без ИИ-лимитов."""
    savings = _year_savings_months(plan.price_month, plan.price_year)
    data = {
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
        "promotion": promotion,
    }
    return data


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
        created = latest_payment.created_at
        age = (now - created) if created else None
        stale_pending = (
            latest_payment.status == Payment.Status.PENDING
            and age is not None
            and age > timedelta(hours=24)
        )
        stale_failed = (
            latest_payment.status == Payment.Status.FAILED
            and age is not None
            and age > timedelta(days=7)
        )
        if not stale_pending and not stale_failed:
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

    next_charge = None
    plan = sub.plan
    is_paid_plan = bool(
        plan and not plan.is_free and plan.slug != "start" and sub.is_valid()
    )
    from .subscription_downgrade import DowngradeService, is_free_plan

    pending_change = DowngradeService.payload_for_subscription(sub)
    next_plan = DowngradeService.effective_next_plan(sub) if is_paid_plan else None
    if is_paid_plan and sub.auto_renew and sub.expires_at and next_plan and not is_free_plan(next_plan):
        from .pricing_service import base_plan_price

        amount = base_plan_price(next_plan, sub.billing_period or "month")
        next_charge = {
            "at": sub.expires_at.isoformat(),
            "amount": str(amount),
            "currency": next_plan.currency,
            "plan_slug": next_plan.slug,
            "plan_name": next_plan.name,
            "has_payment_method": bool(sub.tbank_rebill_id),
            "payment_method_mask": sub.payment_method_mask or None,
        }

    from .subscription_lifecycle import subscription_banner_payload

    banner = subscription_banner_payload(sub)

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
        "plan_price_month": str(plan.price_month) if plan else None,
        "scheduled_plan": scheduled,
        "pending_plan_change": pending_change,
        "latest_payment": payment_state,
        "next_charge": next_charge,
        "has_payment_method": bool(getattr(sub, "tbank_rebill_id", "")),
        "payment_method_mask": getattr(sub, "payment_method_mask", "") or None,
        "banner": banner,
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
    from .pricing_service import (
        REFERRAL_INVITEE_DISCOUNT_PERCENT,
        REFERRAL_REFERRER_BONUS_DAYS,
        is_referral_discount_eligible,
    )
    from .referral_service import ReferralService

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
        }

    stats = ReferralService.referrer_stats(user)
    return {
        "enabled": True,
        "description": (
            "Приглашайте коллег. Поделитесь персональной ссылкой. "
            "Коллеге — 50% на первый месяц. Вам — 14 дней подписки после его первой оплаты."
        ),
        "invitee": {
            "discount_percent": float(REFERRAL_INVITEE_DISCOUNT_PERCENT),
            "label": "50% скидка на первый месяц любого платного тарифа",
        },
        "referrer": {
            "bonus_days": REFERRAL_REFERRER_BONUS_DAYS,
            "label": (
                f"{REFERRAL_REFERRER_BONUS_DAYS} дней текущего тарифа бесплатно "
                "после первой успешной оплаты коллеги"
            ),
        },
        "my_discount": {
            "eligible": is_referral_discount_eligible(user),
            "percent": float(REFERRAL_INVITEE_DISCOUNT_PERCENT),
            "message": (
                "Ваша скидка по приглашению — 50% на первый месяц любого платного тарифа."
                if is_referral_discount_eligible(user)
                else None
            ),
        },
        "stats": {
            "invited": stats["invited"],
            "paid": stats["paid"],
            "bonus_days": stats["bonus_days_total"],
            "bonus_days_available": stats["bonus_days_available"],
        },
        "history": stats["history"],
        "my_link": link_payload,
    }


def _get_or_create_teacher_referral_link(user) -> ReferralLink:
    import re
    import secrets

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
        reward_plan=None,
        reward_months=0,
        is_active=True,
    )


def _plan_short(plan, *, promotion=None) -> dict:
    """Кабинет: совместимость + публичные поля (ИИ скрыт от витрины, в кабинете тоже не акцентируем)."""
    return _plan_public(plan, promotion=promotion)


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
        # Сначала эффективный план (может демотировать истёкший → Старт).
        _ensure_tariff_catalog()
        SubscriptionLimitService.get_or_create_subscription(request.user)
        from .tariff_usage import TariffUsageService

        payload = TariffUsageService.get_tariff_usage(request.user)
        plan = payload["plan"]
        sub = (
            TeacherSubscription.objects.select_related("plan", "scheduled_plan")
            .get(teacher=request.user)
        )
        if sub.plan_id != plan.pk:
            sub.plan = plan

        return Response({
            "plan": _plan_short(plan),
            "subscription": _subscription_payload(sub),
            "tariff": payload["tariff"],
            "period_start": payload["period_start"],
            "period_end": payload["period_end"],
            "usage_items": payload["usage"],
            "limits": TariffUsageService.limits_dict(plan),
            "usage": TariffUsageService.usage_dict(payload),
            "features": {
                "homework": plan.has_homework,
                "review": plan.has_review,
                "basic_notifications": plan.has_basic_notifications,
                "advanced_notifications": plan.has_advanced_notifications,
                "extended_library": plan.has_extended_library,
                "multi_teacher": plan.has_multi_teacher,
                "mass_actions": getattr(plan, "has_mass_actions", False),
                "analytics": getattr(plan, "has_analytics", False),
                "simulators": getattr(plan, "has_simulators", False),
            },
        })


class SubscriptionPlansView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        from .promotion_service import (
            list_displayable_promotions,
            serialize_plan_promotion,
            serialize_promotion,
        )
        from .registration_promo import promo_payload

        _ensure_tariff_catalog()

        plans = (
            TariffPlan.objects.filter(is_active=True)
            .order_by("sort_order", "price_month")
        )
        SubscriptionLimitService.get_or_create_subscription(request.user)
        current_plan = SubscriptionLimitService.get_current_plan(request.user)
        sub = (
            TeacherSubscription.objects.select_related("plan", "scheduled_plan")
            .get(teacher=request.user)
        )
        if sub.plan_id != current_plan.pk:
            sub.plan = current_plan

        paid_plans = [p for p in plans if not _plan_is_free(p) and p.cta_type != TariffPlan.CtaType.CONTACT]
        year_savings = None
        for p in paid_plans:
            s = _year_savings_months(p.price_month, p.price_year)
            if s:
                year_savings = s
                break

        plan_payloads = []
        for p in plans:
            offer = serialize_plan_promotion(request.user, p, billing_period="month")
            plan_payloads.append(_plan_short(p, promotion=offer))

        promotions = [
            serialize_promotion(item, request.user, billing_period="month")
            for item in list_displayable_promotions(request.user)
        ]

        from .tariff_usage import TariffUsageService

        usage_payload = None
        try:
            usage_payload = TariffUsageService.get_tariff_usage(request.user)
        except Exception:
            logger.exception("Failed to build tariff usage payload")
            usage_payload = None

        return Response({
            "current_slug": current_plan.slug,
            "plans": plan_payloads,
            "promotions": promotions,
            "registration_promo": promo_payload(),
            "subscription": _subscription_payload(sub),
            "anonymous": _anonymous_payload(),
            "referral": _referral_program_payload(request.user),
            "payments_enabled": bool(getattr(settings, "PAYMENTS_ENABLED", False)),
            "tariff": usage_payload["tariff"] if usage_payload else {
                "code": current_plan.slug,
                "name": current_plan.name,
            },
            "usage_items": usage_payload["usage"] if usage_payload else [],
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
        from .promotion_service import (
            list_displayable_promotions,
            serialize_plan_promotion,
            serialize_promotion,
        )
        from .registration_promo import promo_payload

        _ensure_tariff_catalog()

        plans = (
            TariffPlan.objects.filter(is_active=True, is_public=True)
            .order_by("sort_order", "price_month")
        )
        user = request.user if getattr(request.user, "is_authenticated", False) else None
        plan_payloads = []
        for p in plans:
            offer = serialize_plan_promotion(user, p, billing_period="month")
            plan_payloads.append(_plan_public(p, promotion=offer))
        promotions = [
            serialize_promotion(item, user, billing_period="month")
            for item in list_displayable_promotions(user)
        ]
        return Response({
            "plans": plan_payloads,
            "promotions": promotions,
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
            from django.db import transaction

            with transaction.atomic():
                locked = (
                    TeacherSubscription.objects.select_for_update()
                    .select_related("plan", "scheduled_plan")
                    .get(pk=sub.pk)
                )
                return _set_auto_renew_locked(locked, enabled)

        def _set_auto_renew_locked(sub, enabled: bool):
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
                if _plan_is_free(sub.plan) or (sub.plan and sub.plan.slug == "start"):
                    return Response(
                        {"detail": "Автопродление доступно только для платного тарифа."},
                        status=400,
                    )
                if not (sub.tbank_rebill_id or "").strip():
                    return Response(
                        {
                            "detail": (
                                "Нет сохранённого способа оплаты. "
                                "Оплатите тариф ещё раз — карта сохранится для автопродления."
                            ),
                            "code": "NO_PAYMENT_METHOD",
                        },
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
            ends_note = (
                f" Тариф продолжит действовать до {sub.expires_at.date().isoformat()}."
                if sub.expires_at and sub.expires_at > now
                else ""
            )
            return Response({
                "ok": True,
                "message": f"Автопродление отключено.{ends_note}",
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
            # Переход на Старт после окончания оплаченного периода (= downgrade на start).
            start_plan = TariffPlan.objects.filter(slug="start", is_active=True).first()
            if (
                start_plan
                and sub.is_valid()
                and sub.expires_at
                and sub.expires_at > now
                and not _plan_is_free(sub.plan)
            ):
                from .subscription_downgrade import DowngradeService

                try:
                    DowngradeService.schedule(request.user, start_plan)
                except ValueError as exc:
                    return Response({"detail": str(exc)}, status=400)
                sub = TeacherSubscription.objects.select_related("plan", "scheduled_plan").get(
                    pk=sub.pk
                )
                return Response({
                    "ok": True,
                    "message": (
                        "После окончания текущего периода будет активирован тариф «Старт». "
                        f"Доступ сохранится до {sub.expires_at.date().isoformat()}."
                    ),
                    "subscription": _subscription_payload(sub),
                })
            if sub.cancelled_at and not sub.auto_renew:
                return Response({
                    "ok": True,
                    "message": "Подписка уже отменена.",
                    "subscription": _subscription_payload(sub),
                })
            sub.auto_renew = False
            sub.cancelled_at = sub.cancelled_at or now
            if not sub.expires_at or sub.expires_at <= now:
                sub.status = TeacherSubscription.Status.CANCELLED
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

        if action == "cancel_pending_plan":
            from .subscription_downgrade import DowngradeService

            try:
                result = DowngradeService.cancel(request.user)
            except ValueError as exc:
                return Response({"detail": str(exc), "code": "PREPAID_LOCKED"}, status=400)
            sub = TeacherSubscription.objects.select_related("plan", "scheduled_plan").get(
                pk=sub.pk
            )
            return Response({**result, "subscription": _subscription_payload(sub)})

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
        from .subscription_downgrade import DowngradeService, is_downgrade, is_free_plan

        slug = request.data.get("plan_slug") or request.data.get("plan")
        billing_period = request.data.get("billing_period", "month")
        preview_only = str(request.data.get("preview") or "").lower() in ("1", "true", "yes")
        confirm = str(request.data.get("confirm") or "").lower() in ("1", "true", "yes")
        student_ids = request.data.get("student_ids")
        group_ids = request.data.get("group_ids")

        plan = TariffPlan.objects.filter(slug=slug, is_active=True).first()
        if not plan:
            return Response({"detail": "Тарифный план не найден."}, status=404)

        if getattr(plan, "cta_type", "") == TariffPlan.CtaType.CONTACT:
            return Response({
                "ok": False,
                "requires_contact": True,
                "plan": _plan_short(plan),
            })

        sub = SubscriptionLimitService.get_or_create_subscription(request.user)
        current = sub.plan

        # Preview downgrade
        if preview_only or (
            is_downgrade(current, plan)
            and sub.is_valid()
            and sub.expires_at
            and sub.expires_at > timezone.now()
            and not confirm
        ):
            preview = DowngradeService.preview(request.user, plan)
            if preview["can_schedule"] or preview_only:
                return Response({
                    "ok": True,
                    "requires_downgrade_confirm": preview["can_schedule"],
                    "requires_payment": False,
                    "preview": preview,
                    "plan": _plan_short(plan),
                })

        # Schedule confirmed downgrade (включая Старт).
        if (
            is_downgrade(current, plan)
            and sub.is_valid()
            and sub.expires_at
            and sub.expires_at > timezone.now()
        ):
            try:
                result = DowngradeService.schedule(
                    request.user,
                    plan,
                    student_ids=student_ids,
                    group_ids=group_ids,
                )
            except ValueError as exc:
                return Response({"detail": str(exc), "code": "DOWNGRADE_INVALID"}, status=400)
            sub = TeacherSubscription.objects.select_related("plan", "scheduled_plan").get(
                teacher=request.user
            )
            return Response({
                "ok": True,
                "scheduled": True,
                "requires_payment": False,
                "plan": _plan_short(plan),
                "subscription": _subscription_payload(sub),
                **result,
            })

        # Мгновенный Старт только если нет оплаченного периода.
        if is_free_plan(plan):
            sub.plan = plan
            sub.billing_period = billing_period
            sub.status = TeacherSubscription.Status.ACTIVE
            sub.source = TeacherSubscription.Source.SELF
            sub.expires_at = None
            sub.auto_renew = False
            sub.scheduled_plan = None
            sub.scheduled_change_at = None
            sub.save()
            return Response({
                "ok": True,
                "plan": _plan_short(plan),
                "requires_payment": False,
                "subscription": _subscription_payload(sub),
            })

        return Response({
            "ok": False,
            "requires_payment": True,
            "plan": _plan_short(plan),
            "billing_period": billing_period,
        })


class SubscriptionCancelPendingPlanView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        from .subscription_downgrade import DowngradeService

        try:
            result = DowngradeService.cancel(request.user)
        except ValueError as exc:
            return Response({"detail": str(exc), "code": "PREPAID_LOCKED"}, status=400)
        sub = TeacherSubscription.objects.select_related("plan", "scheduled_plan").get(
            teacher=request.user
        )
        return Response({
            **result,
            "subscription": _subscription_payload(sub),
        })


class SubscriptionCreatePaymentView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        from .payment_service import PaymentProviderService
        from .pricing_service import calculate_subscription_price
        from .promotion_service import PromotionError
        from .subscription_service import PromoCodeError

        slug = request.data.get("plan_slug") or request.data.get("plan")
        billing_period = (request.data.get("billing_period") or "month").strip().lower()
        if billing_period in ("monthly", "month"):
            billing_period = "month"
        elif billing_period in ("yearly", "year", "annual"):
            billing_period = "year"
        promo_code = (request.data.get("promo_code") or "").strip()
        idempotency_key = (request.data.get("idempotency_key") or "").strip() or None
        requested_promotion_id = request.data.get("promotion_id")
        # Frontend не передаёт amount — цена только на backend.
        # auto_renew / consent — опционально.
        consent = request.data.get("auto_renew")
        if consent is None:
            consent = request.data.get("consent_auto_renew")
        discount_info = None
        if isinstance(consent, bool):
            discount_info = {"auto_renew": consent}
        elif str(consent or "").strip().lower() in ("1", "true", "yes", "on"):
            discount_info = {"auto_renew": True}

        plan = TariffPlan.objects.filter(slug=slug, is_active=True).first()
        if not plan:
            return Response({"detail": "Тарифный план не найден."}, status=404)
        if getattr(plan, "cta_type", "") == TariffPlan.CtaType.CONTACT:
            return Response({"detail": "Тариф оформляется по заявке.", "code": "CONTACT_ONLY"}, status=400)

        payments_on = bool(getattr(settings, "PAYMENTS_ENABLED", False))
        if not payments_on:
            try:
                preview = calculate_subscription_price(
                    request.user,
                    plan,
                    billing_period=billing_period,
                    promo_code=promo_code or None,
                    validate_promo=bool(promo_code),
                    requested_promotion_id=requested_promotion_id,
                )
            except PromoCodeError as exc:
                return Response(exc.to_dict(), status=400)
            if not (
                preview.get("applied_discount_source") == "promotion"
                and preview.get("final_price") is not None
                and preview["final_price"] <= 0
            ):
                return Response(
                    {
                        "detail": "Оплата временно недоступна. Попробуйте позже.",
                        "code": "PAYMENTS_DISABLED",
                    },
                    status=503,
                )

        try:
            result = PaymentProviderService.create_payment(
                teacher=request.user,
                plan=plan,
                billing_period=billing_period,
                promo_code=promo_code or None,
                discount_info=discount_info,
                idempotency_key=idempotency_key,
                requested_promotion_id=requested_promotion_id,
            )
        except PromoCodeError as exc:
            return Response(exc.to_dict(), status=400)
        except PromotionError as exc:
            return Response(exc.to_dict(), status=400)
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
        from .subscription_service import SubscriptionLimitService

        plan = payment.plan
        payload = {
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
        if payment.status == Payment.Status.PAID:
            # Актуальный тариф после активации — для мгновенного обновления UI.
            sub = SubscriptionLimitService.get_or_create_subscription(
                payment.teacher, apply_promo=False
            )
            sub = (
                TeacherSubscription.objects.select_related("plan", "scheduled_plan")
                .filter(pk=sub.pk)
                .first()
            )
            if sub:
                effective = SubscriptionLimitService.get_current_plan(payment.teacher)
                payload["subscription"] = _subscription_payload(sub)
                payload["current_plan"] = _plan_short(effective)
                payload["current_slug"] = effective.slug
                payload["plan_slug"] = effective.slug
                payload["plan_name"] = effective.name
        return payload


class PromoCodeValidateView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        from .pricing_service import calculate_subscription_price, price_payload
        from .subscription_service import PromoCodeError

        code_str = (request.data.get("code") or "").strip()
        plan_slug = (request.data.get("plan_slug") or "").strip() or None
        billing_period = (request.data.get("billing_period") or "month").strip()
        if billing_period not in ("month", "year"):
            billing_period = "month"

        if plan_slug:
            plan = TariffPlan.objects.filter(slug=plan_slug, is_active=True).first()
        else:
            plan = (
                TariffPlan.objects.filter(is_active=True, is_recommended=True).first()
                or SubscriptionLimitService.get_current_plan(request.user)
            )
        if not plan:
            return Response({"detail": "Тарифный план не найден."}, status=404)

        if not code_str:
            return Response({"detail": "Укажите промокод.", "code": "PROMO_EMPTY"}, status=400)

        try:
            calc = calculate_subscription_price(
                request.user,
                plan,
                billing_period=billing_period,
                promo_code=code_str,
                validate_promo=True,
            )
        except PromoCodeError as exc:
            return Response(exc.to_dict(), status=400)

        payload = {
            "valid": True,
            "code": code_str,
            "billing_period": billing_period,
            "plan_slug": plan.slug,
            **price_payload(calc),
        }
        if calc.get("message"):
            payload["message"] = calc["message"]
        return Response(payload)


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
