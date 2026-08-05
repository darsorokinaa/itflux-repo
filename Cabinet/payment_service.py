"""
PaymentProviderInterface — payment-agnostic слой для подписки платформы.

Секреты из settings:
    PAYMENT_PROVIDER = "mock" | "tbank" | "tinkoff" | …
    Для Т-Банка: TBANK_TERMINAL_KEY + TBANK_PASSWORD
    (или совместимость: PAYMENT_SHOP_ID + PAYMENT_SECRET_KEY)

Документация формы банка:
    https://developer.tbank.ru/eacq/scenarios/payments/nonPCI/

Не смешивать с StudentPayment / биллингом учеников.
"""

from __future__ import annotations

import abc
import calendar
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone


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


class PaymentProviderInterface(abc.ABC):
    @abc.abstractmethod
    def create_checkout(self, payment, plan) -> str:
        """Возвращает URL оплаты."""

    @abc.abstractmethod
    def check_status(self, payment) -> dict:
        ...

    @abc.abstractmethod
    def parse_webhook(self, payload: dict) -> dict:
        """Нормализованный результат: payment_id, status, event_id, provider_payment_id."""


class MockPaymentProvider(PaymentProviderInterface):
    def create_checkout(self, payment, plan) -> str:
        return f"/cabinet/upgrade?payment_id={payment.pk}&status=mock"

    def check_status(self, payment) -> dict:
        return {
            "status": payment.status,
            "provider_payment_id": payment.provider_payment_id,
        }

    def parse_webhook(self, payload: dict) -> dict:
        return {
            "payment_id": payload.get("payment_id"),
            "status": payload.get("status", "paid"),
            "event_id": payload.get("event_id") or f"mock_{payload.get('payment_id')}_{payload.get('status', 'paid')}",
            "provider_payment_id": payload.get("provider_payment_id") or "",
        }


class UnconfiguredPaymentProvider(PaymentProviderInterface):
    def create_checkout(self, payment, plan) -> str:
        raise NotImplementedError("Real payment provider not configured")

    def check_status(self, payment) -> dict:
        raise NotImplementedError("Real payment provider not configured")

    def parse_webhook(self, payload: dict) -> dict:
        raise NotImplementedError("Real payment provider not configured")


def get_payment_provider(name: str | None = None) -> PaymentProviderInterface:
    provider = (name or getattr(settings, "PAYMENT_PROVIDER", "mock") or "mock").strip().lower()
    if provider == "mock":
        return MockPaymentProvider()
    if provider in ("tbank", "tinkoff"):
        from .tbank_payment import TBankPaymentProvider

        return TBankPaymentProvider()
    return UnconfiguredPaymentProvider()


class PaymentProviderService:
    """Фасад совместимости со старым API + активация подписки при оплате."""

    PROVIDER = getattr(settings, "PAYMENT_PROVIDER", "mock")
    SECRET_KEY = getattr(settings, "PAYMENT_SECRET_KEY", "")
    SHOP_ID = getattr(settings, "PAYMENT_SHOP_ID", "")

    @classmethod
    def create_payment(
        cls,
        teacher,
        plan,
        billing_period: str = "month",
        promo_code: str = None,
        discount_info: dict = None,
        *,
        idempotency_key: str = None,
    ):
        from django.conf import settings as django_settings

        from .models import Payment, PromoCode
        from .subscription_service import SubscriptionLimitService

        provider_name = (
            getattr(django_settings, "PAYMENT_PROVIDER", None) or cls.PROVIDER or "mock"
        ).strip().lower()
        if provider_name == "mock" and not django_settings.DEBUG:
            raise ValueError("Mock payments are disabled in production")

        if billing_period not in ("month", "year"):
            billing_period = "month"

        original_amount = plan.price_year if billing_period == "year" else plan.price_month
        original_amount = Decimal(str(original_amount or 0))
        if discount_info:
            final_amount = Decimal(str(discount_info["final_amount"]))
            discount_amount = Decimal(str(discount_info.get("discount", 0)))
        else:
            final_amount = original_amount
            discount_amount = Decimal("0")

        if final_amount <= 0:
            raise ValueError("Для бесплатного тарифа оплата не требуется")

        sub = SubscriptionLimitService.get_or_create_subscription(teacher)
        key = (idempotency_key or "").strip() or f"pay_{teacher.pk}_{plan.slug}_{uuid.uuid4().hex[:12]}"

        existing = Payment.objects.filter(idempotency_key=key).first()
        if existing:
            provider = get_payment_provider(provider_name)
            return {
                "payment_id": existing.pk,
                "provider_payment_id": existing.provider_payment_id,
                "provider": existing.provider,
                "status": existing.status,
                "payment_url": provider.create_checkout(existing, plan),
                "amount": str(existing.final_amount or existing.amount),
                "currency": existing.currency,
                "billing_period": existing.billing_period,
                "plan_slug": plan.slug,
                "idempotent": True,
            }

        promo_obj = None
        if promo_code:
            promo_obj = PromoCode.objects.filter(code__iexact=promo_code.strip()).first()

        payment = Payment.objects.create(
            teacher=teacher,
            subscription=sub,
            plan=plan,
            amount=original_amount,
            discount_amount=discount_amount,
            final_amount=final_amount,
            currency=plan.currency,
            status=Payment.Status.PENDING,
            provider=provider_name,
            provider_payment_id=(
                f"mock_{uuid.uuid4().hex[:16]}" if provider_name == "mock" else ""
            ),
            idempotency_key=key,
            billing_period=billing_period,
            promo_code=promo_obj,
            metadata={"plan_slug": plan.slug, "billing_period": billing_period},
        )

        if promo_code and discount_info:
            from .subscription_service import PromoCodeService

            try:
                PromoCodeService.apply(
                    teacher=teacher,
                    code_str=promo_code,
                    plan_slug=plan.slug,
                    payment=payment,
                )
            except Exception:
                pass

        provider = get_payment_provider(provider_name)
        try:
            payment_url = provider.create_checkout(payment, plan)
        except Exception:
            payment.status = Payment.Status.FAILED
            payment.save(update_fields=["status", "updated_at"])
            raise

        payment.refresh_from_db()
        result = {
            "payment_id": payment.pk,
            "provider_payment_id": payment.provider_payment_id,
            "provider": payment.provider,
            "status": payment.status,
            "payment_url": payment_url,
            "amount": str(final_amount),
            "currency": payment.currency,
            "billing_period": billing_period,
            "plan_slug": plan.slug,
        }
        if discount_info:
            result["discount"] = discount_info
        return result

    @classmethod
    def check_payment_status(cls, payment):
        return get_payment_provider(payment.provider or None).check_status(payment)

    @classmethod
    @transaction.atomic
    def sync_payment_from_provider(cls, payment):
        """
        Сверяет статус с банком (GetState) и при CONFIRMED активирует тариф.
        Нужно, когда webhook ушёл не на этот сервер (локальная разработка)
        или задержался.
        """
        from .models import Payment

        # Без select_related: PostgreSQL запрещает FOR UPDATE на OUTER JOIN (nullable plan).
        payment = Payment.objects.select_for_update().get(pk=payment.pk)
        if payment.status == Payment.Status.PAID:
            return {"ok": True, "status": payment.status, "synced": False, "already_paid": True}

        provider_name = (payment.provider or cls.PROVIDER or "mock").strip().lower()
        if provider_name in ("", "mock"):
            return {"ok": True, "status": payment.status, "synced": False}

        try:
            remote = get_payment_provider(provider_name).check_status(payment)
        except Exception as exc:
            return {"ok": False, "error": str(exc), "status": payment.status}

        mapped = (remote.get("status") or "").strip().lower()
        provider_payment_id = remote.get("provider_payment_id") or payment.provider_payment_id
        provider_status = remote.get("provider_status") or mapped

        if mapped == "paid" and payment.status != Payment.Status.PAID:
            # Идемпотентность через тот же webhook-путь
            result = cls.handle_webhook(
                {
                    # Для tbank parse_webhook ждёт Token — обходим через внутренний apply
                    "_internal_sync": True,
                    "payment_id": payment.pk,
                    "status": "paid",
                    "event_id": f"sync_{provider_name}_{provider_payment_id}_{provider_status}",
                    "provider_payment_id": provider_payment_id,
                },
                provider_name=provider_name,
                skip_provider_parse=True,
            )
            payment.refresh_from_db()
            return {
                "ok": bool(result.get("ok")),
                "status": payment.status,
                "synced": True,
                "provider_status": provider_status,
            }

        if mapped in ("failed", "cancelled", "refunded") and payment.status == Payment.Status.PENDING:
            cls.handle_webhook(
                {
                    "payment_id": payment.pk,
                    "status": mapped,
                    "event_id": f"sync_{provider_name}_{provider_payment_id}_{provider_status}",
                    "provider_payment_id": provider_payment_id,
                },
                provider_name=provider_name,
                skip_provider_parse=True,
            )
            payment.refresh_from_db()
            return {
                "ok": True,
                "status": payment.status,
                "synced": True,
                "provider_status": provider_status,
            }

        return {
            "ok": True,
            "status": payment.status,
            "synced": False,
            "provider_status": provider_status,
            "remote_status": mapped,
        }

    @classmethod
    @transaction.atomic
    def handle_webhook(
        cls,
        payload: dict,
        *,
        provider_name: str | None = None,
        skip_provider_parse: bool = False,
    ):
        from django.conf import settings as django_settings

        from .models import Payment, PaymentWebhookEvent

        provider_name = (provider_name or cls.PROVIDER or "").strip().lower()
        if provider_name == "tinkoff":
            provider_name = "tbank"
        configured = (getattr(django_settings, "PAYMENT_PROVIDER", "mock") or "mock").strip().lower()
        if configured == "tinkoff":
            configured = "tbank"
        if (
            not django_settings.DEBUG
            and (provider_name == "mock" or configured == "mock")
        ):
            return {"ok": False, "error": "mock_disabled"}

        provider = get_payment_provider(provider_name or configured)
        if skip_provider_parse:
            parsed = {
                "payment_id": (payload or {}).get("payment_id"),
                "status": (payload or {}).get("status", "paid"),
                "event_id": (payload or {}).get("event_id") or "",
                "provider_payment_id": (payload or {}).get("provider_payment_id") or "",
            }
        else:
            try:
                parsed = provider.parse_webhook(payload or {})
            except ValueError as exc:
                return {"ok": False, "error": str(exc)}

        # Промежуточные статусы Т-Банка не меняют подписку
        if parsed.get("status") == "pending":
            return {"ok": True, "ignored": True, "status": "pending"}

        event_id = str(parsed.get("event_id") or "")
        if not event_id:
            # Без стабильного event_id повторная доставка может создать новый ключ —
            # требуем явный id от провайдера (кроме DEBUG/mock для локальных тестов).
            if not django_settings.DEBUG and provider_name != "mock":
                return {"ok": False, "error": "event_id_required"}
            event_id = f"auto_{uuid.uuid4().hex}"

        event, created = PaymentWebhookEvent.objects.get_or_create(
            provider=provider_name,
            event_id=event_id,
            defaults={"payload": payload or {}},
        )
        if not created and event.processed:
            return {"ok": True, "duplicate": True}

        payment_id = parsed.get("payment_id")
        new_status = parsed.get("status", "paid")
        try:
            # Без select_related на nullable FK: PostgreSQL запрещает FOR UPDATE на OUTER JOIN.
            payment = Payment.objects.select_for_update().get(pk=payment_id)
        except Payment.DoesNotExist:
            event.payload = payload or {}
            event.save(update_fields=["payload"])
            return {"ok": False, "error": "payment_not_found"}

        event.payment = payment
        event.payload = payload or {}

        if new_status == "paid" and payment.status != Payment.Status.PAID:
            payment.status = Payment.Status.PAID
            payment.paid_at = timezone.now()
            if parsed.get("provider_payment_id"):
                payment.provider_payment_id = parsed["provider_payment_id"]
            payment.save(update_fields=["status", "paid_at", "provider_payment_id", "updated_at"])
            cls.activate_subscription_from_payment(payment)
            from .subscription_service import PromoCodeService

            PromoCodeService.confirm_for_payment(payment)
        elif new_status in ("failed", "cancelled", "refunded"):
            payment.status = new_status
            if parsed.get("provider_payment_id") and not payment.provider_payment_id:
                payment.provider_payment_id = parsed["provider_payment_id"]
                payment.save(update_fields=["status", "provider_payment_id", "updated_at"])
            else:
                payment.save(update_fields=["status", "updated_at"])
            from .subscription_service import PromoCodeService

            PromoCodeService.release_for_payment(payment)

        event.processed = True
        event.processed_at = timezone.now()
        event.save()
        return {"ok": True, "payment_id": payment.pk, "status": payment.status}

    @classmethod
    def activate_subscription_from_payment(cls, payment):
        """Назначает plan с платежа и продлевает период — фикс бага mock webhook."""
        from .models import PromoCode, TariffPlan, TeacherSubscription
        from .referral_service import ReferralService
        from .subscription_service import SubscriptionLimitService

        plan = payment.plan
        if plan is None:
            slug = (payment.metadata or {}).get("plan_slug")
            if slug:
                plan = TariffPlan.objects.filter(slug=slug, is_active=True).first()
        if plan is None:
            return

        sub = payment.subscription
        if sub is None:
            sub = SubscriptionLimitService.get_or_create_subscription(
                payment.teacher, apply_promo=False
            )
            payment.subscription = sub
            payment.save(update_fields=["subscription", "updated_at"])

        now = timezone.now()
        months = 12 if payment.billing_period == "year" else 1
        bonus_days = 0
        if payment.promo_code_id:
            promo = payment.promo_code
            if promo.discount_type == PromoCode.DiscountType.FREE_MONTHS:
                months = max(months, int(promo.discount_value or 0) or months)
            elif promo.discount_type == PromoCode.DiscountType.BONUS_DAYS:
                bonus_days = int(promo.discount_value or 0)
            bonus_days += int(getattr(promo, "bonus_days", 0) or 0)

        base = sub.expires_at if sub.expires_at and sub.expires_at > now else now
        expires = add_months(base, months)
        if bonus_days:
            expires = expires + timedelta(days=bonus_days)

        # Автопродление — только при явном согласии (metadata / поле платежа).
        # По умолчанию False: без recurring-провайдера и без opt-in списаний нет.
        meta = payment.metadata if isinstance(payment.metadata, dict) else {}
        auto_renew = bool(meta.get("auto_renew") is True or meta.get("consent_auto_renew") is True)

        sub.plan = plan
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.source = TeacherSubscription.Source.PAYMENT
        sub.billing_period = payment.billing_period
        sub.current_period_start = now
        sub.current_period_end = expires
        sub.expires_at = expires
        sub.auto_renew = auto_renew
        sub.cancelled_at = None
        sub.save(
            update_fields=[
                "plan",
                "status",
                "source",
                "billing_period",
                "current_period_start",
                "current_period_end",
                "expires_at",
                "auto_renew",
                "cancelled_at",
                "updated_at",
            ]
        )

        try:
            ReferralService.grant_payment_reward_if_applicable(payment)
        except Exception:
            pass
