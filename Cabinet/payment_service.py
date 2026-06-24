"""
PaymentProviderService — заглушка платёжной интеграции.

Секреты провайдера берутся из settings, не хардкодятся.
Для реального подключения нужно реализовать методы под конкретный провайдер
(Prodamus / ЮKassa / CloudPayments) и задать в settings.py:
    PAYMENT_PROVIDER = "yookassa"
    PAYMENT_SECRET_KEY = env("PAYMENT_SECRET_KEY")
    PAYMENT_SHOP_ID = env("PAYMENT_SHOP_ID")
"""

import uuid

from django.conf import settings
from django.utils import timezone


class PaymentProviderService:

    PROVIDER = getattr(settings, "PAYMENT_PROVIDER", "mock")
    SECRET_KEY = getattr(settings, "PAYMENT_SECRET_KEY", "")
    SHOP_ID = getattr(settings, "PAYMENT_SHOP_ID", "")

    @classmethod
    def create_payment(cls, teacher, plan, billing_period: str = "month",
                       promo_code: str = None, discount_info: dict = None):
        """
        Создаёт запись платежа и возвращает payment_url.
        В mock-режиме возвращает заглушку.
        """
        from decimal import Decimal
        from .models import Payment, TeacherSubscription
        from .subscription_service import SubscriptionLimitService

        original_amount = plan.price_year if billing_period == "year" else plan.price_month
        final_amount = Decimal(str(discount_info["final_amount"])) if discount_info else Decimal(str(original_amount))

        # Получаем или создаём подписку
        sub = SubscriptionLimitService.get_or_create_subscription(teacher)

        payment = Payment.objects.create(
            teacher=teacher,
            subscription=sub,
            amount=final_amount,
            currency=plan.currency,
            status=Payment.Status.PENDING,
            provider=cls.PROVIDER,
            provider_payment_id=f"mock_{uuid.uuid4().hex[:16]}",
        )

        # Применяем промокод, если передан
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
                pass  # применение уже прошло валидацию раньше

        if cls.PROVIDER == "mock":
            payment_url = f"/cabinet/upgrade?payment_id={payment.pk}&status=mock"
        else:
            payment_url = cls._create_real_payment_url(payment, plan)

        result = {
            "payment_id": payment.pk,
            "provider_payment_id": payment.provider_payment_id,
            "status": payment.status,
            "payment_url": payment_url,
            "amount": str(final_amount),
            "currency": payment.currency,
        }
        if discount_info:
            result["discount"] = discount_info
        return result

    @classmethod
    def check_payment_status(cls, payment):
        """Проверяет статус платежа у провайдера."""
        if cls.PROVIDER == "mock":
            return {"status": payment.status, "provider_payment_id": payment.provider_payment_id}
        return cls._check_real_payment_status(payment)

    @classmethod
    def handle_webhook(cls, payload: dict):
        """Обрабатывает webhook от платёжного провайдера."""
        if cls.PROVIDER == "mock":
            return cls._handle_mock_webhook(payload)
        return cls._handle_real_webhook(payload)

    @classmethod
    def _handle_mock_webhook(cls, payload: dict):
        from .models import Payment
        payment_id = payload.get("payment_id")
        new_status = payload.get("status", "paid")
        try:
            payment = Payment.objects.get(pk=payment_id)
            payment.status = new_status
            if new_status == "paid":
                payment.paid_at = timezone.now()
                # Активируем подписку
                if payment.subscription:
                    sub = payment.subscription
                    sub.status = "active"
                    sub.save(update_fields=["status", "updated_at"])
            payment.save(update_fields=["status", "paid_at", "updated_at"])
        except Payment.DoesNotExist:
            pass

    @classmethod
    def _create_real_payment_url(cls, payment, plan) -> str:
        # Место для интеграции с реальным провайдером
        raise NotImplementedError("Real payment provider not configured")

    @classmethod
    def _check_real_payment_status(cls, payment) -> dict:
        raise NotImplementedError("Real payment provider not configured")

    @classmethod
    def _handle_real_webhook(cls, payload: dict):
        raise NotImplementedError("Real payment provider not configured")
