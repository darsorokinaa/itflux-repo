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
import logging
import uuid
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


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
        requested_promotion_id=None,
    ):
        from django.conf import settings as django_settings

        from .models import Payment, PromoCode, Promotion
        from .pricing_service import calculate_subscription_price, price_payload
        from .promotion_service import PromotionError, reserve_redemption
        from .subscription_service import PromoCodeService, SubscriptionLimitService

        provider_name = (
            getattr(django_settings, "PAYMENT_PROVIDER", None) or cls.PROVIDER or "mock"
        ).strip().lower()

        if billing_period not in ("month", "year"):
            billing_period = "month"

        # Всегда пересчитываем на backend перед Init. promotion_id с фронта не источник цены.
        calc = calculate_subscription_price(
            teacher,
            plan,
            billing_period=billing_period,
            promo_code=promo_code or None,
            validate_promo=True,
            requested_promotion_id=requested_promotion_id,
        )
        original_amount = calc["base_price"]
        final_amount = calc["final_price"]
        discount_amount = calc["applied_discount"]
        price_meta = price_payload(calc)

        if final_amount <= 0:
            if calc.get("applied_discount_source") == "promotion" and calc.get("promotion_id"):
                return cls._grant_zero_price_promotion(
                    teacher=teacher,
                    plan=plan,
                    billing_period=billing_period,
                    calc=calc,
                    discount_info=discount_info,
                    idempotency_key=idempotency_key,
                )
            raise ValueError("Для бесплатного тарифа оплата не требуется")

        if provider_name == "mock" and not django_settings.DEBUG:
            raise ValueError("Mock payments are disabled in production")

        sub = SubscriptionLimitService.get_or_create_subscription(teacher)
        key = (idempotency_key or "").strip() or f"pay_{teacher.pk}_{plan.slug}_{uuid.uuid4().hex[:12]}"

        existing = Payment.objects.filter(idempotency_key=key).first()
        if existing:
            provider = get_payment_provider(provider_name)
            meta = existing.metadata if isinstance(existing.metadata, dict) else {}
            payment_url = str(meta.get("payment_url") or "")
            if existing.status == Payment.Status.PENDING and not payment_url:
                payment_url = provider.create_checkout(existing, existing.plan or plan)
            return {
                "payment_id": existing.pk,
                "provider_payment_id": existing.provider_payment_id,
                "provider": existing.provider,
                "status": existing.status,
                "payment_url": payment_url,
                "amount": str(existing.final_amount or existing.amount),
                "currency": existing.currency,
                "billing_period": existing.billing_period,
                "plan_slug": (existing.plan.slug if existing.plan_id else plan.slug),
                "idempotent": True,
                "pricing": meta.get("pricing") if isinstance(meta, dict) else None,
            }

        promo_obj = None
        if calc.get("promo_code") and (
            calc["applied_discount_source"] == "promo" or calc.get("stacked_promo")
        ):
            promo_obj = PromoCode.objects.filter(
                code__iexact=calc["promo_code"]
            ).first()
        elif promo_code and calc["applied_discount_source"] not in ("referral", "promotion"):
            promo_obj = None

        promotion_obj = None
        if calc["applied_discount_source"] == "promotion" and calc.get("promotion_id"):
            promotion_obj = Promotion.objects.filter(pk=calc["promotion_id"]).first()

        metadata = {
            "plan_slug": plan.slug,
            "billing_period": billing_period,
            "pricing": price_meta,
            "applied_discount_source": calc["applied_discount_source"],
        }
        if calc.get("promotion_id"):
            metadata["promotion_id"] = calc["promotion_id"]
        # Согласие на автопродление: из явного флага в metadata вызывающего слоя
        # или из текущего состояния подписки (пользователь уже включил toggle).
        if discount_info and isinstance(discount_info, dict):
            if discount_info.get("auto_renew") is True:
                metadata["auto_renew"] = True
            elif discount_info.get("consent_auto_renew") is True:
                metadata["consent_auto_renew"] = True
        if sub.auto_renew:
            metadata.setdefault("auto_renew", True)

        from .tbank_payment import customer_key_for_teacher

        payment = Payment.objects.create(
            teacher=teacher,
            subscription=sub,
            plan=plan,
            amount=original_amount,
            discount_amount=discount_amount,
            referral_discount_amount=calc.get("referral_discount") or Decimal("0"),
            final_amount=final_amount,
            currency=plan.currency,
            status=Payment.Status.PENDING,
            provider=provider_name,
            provider_payment_id=(
                f"mock_{uuid.uuid4().hex[:16]}" if provider_name == "mock" else ""
            ),
            customer_key=customer_key_for_teacher(teacher),
            order_id="",  # заполняется в Init
            idempotency_key=key,
            billing_period=billing_period,
            promo_code=promo_obj,
            promotion=promotion_obj,
            promotion_discount_amount=calc.get("promotion_discount") or Decimal("0"),
            metadata=metadata,
        )
        logger.info(
            "payment_created payment_id=%s teacher=%s plan=%s amount=%s",
            payment.pk,
            teacher.pk,
            plan.slug,
            final_amount,
        )

        if promo_obj is not None:
            try:
                PromoCodeService.apply(
                    teacher=teacher,
                    code_str=promo_obj.code,
                    plan_slug=plan.slug,
                    payment=payment,
                )
            except Exception:
                payment.status = Payment.Status.FAILED
                payment.error_message = "Не удалось зарезервировать промокод"
                payment.save(update_fields=["status", "error_message", "updated_at"])
                logger.exception(
                    "promo_reserve_failed payment_id=%s teacher=%s",
                    payment.pk,
                    teacher.pk,
                )
                raise

        if promotion_obj is not None:
            try:
                reserve_redemption(
                    promotion_obj,
                    teacher,
                    payment,
                    original_price=original_amount,
                    final_price=final_amount,
                )
            except PromotionError:
                payment.status = Payment.Status.FAILED
                payment.error_message = "Не удалось зарезервировать акцию"
                payment.save(update_fields=["status", "error_message", "updated_at"])
                raise
            except Exception:
                payment.status = Payment.Status.FAILED
                payment.error_message = "Не удалось зарезервировать акцию"
                payment.save(update_fields=["status", "error_message", "updated_at"])
                logger.exception(
                    "promotion_reserve_failed payment_id=%s teacher=%s",
                    payment.pk,
                    teacher.pk,
                )
                raise

        provider = get_payment_provider(provider_name)
        try:
            payment_url = provider.create_checkout(payment, plan)
        except Exception:
            payment.status = Payment.Status.FAILED
            payment.save(update_fields=["status", "updated_at"])
            from .subscription_service import PromoCodeService as _PCS
            from .promotion_service import release_for_payment as _release_promo

            _PCS.release_for_payment(payment)
            _release_promo(payment)
            raise

        payment.refresh_from_db()
        if payment_url:
            meta = dict(payment.metadata or {})
            if not meta.get("payment_url"):
                meta["payment_url"] = payment_url
                payment.metadata = meta
                payment.save(update_fields=["metadata", "updated_at"])
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
            "pricing": price_meta,
            "discount": {
                "original_amount": str(original_amount),
                "discount": str(discount_amount),
                "final_amount": str(final_amount),
                "applied_discount_source": calc["applied_discount_source"],
                "message": calc.get("message"),
            },
        }
        return result

    @classmethod
    def _grant_zero_price_promotion(
        cls,
        *,
        teacher,
        plan,
        billing_period,
        calc,
        discount_info=None,
        idempotency_key=None,
    ):
        """Бесплатная акция без Init в банке. Сумма фиксируется нулевым Payment."""
        from .models import Payment
        from .pricing_service import price_payload
        from .promotion_service import (
            PromotionError,
            confirm_for_payment,
            get_applicable_promotion,
            reserve_redemption,
        )
        from .subscription_service import SubscriptionLimitService

        key = (idempotency_key or "").strip() or (
            f"promo_grant_{teacher.pk}_{plan.slug}_{calc.get('promotion_id')}"
        )
        existing = Payment.objects.filter(idempotency_key=key).first()
        if existing:
            return {
                "payment_id": existing.pk,
                "provider_payment_id": existing.provider_payment_id,
                "provider": existing.provider,
                "status": existing.status,
                "payment_url": "",
                "amount": str(existing.final_amount or 0),
                "currency": existing.currency,
                "billing_period": existing.billing_period,
                "plan_slug": (existing.plan.slug if existing.plan_id else plan.slug),
                "idempotent": True,
                "granted": existing.status == Payment.Status.PAID,
                "pricing": (existing.metadata or {}).get("pricing") if isinstance(existing.metadata, dict) else None,
            }

        price_meta = price_payload(calc)
        sub = SubscriptionLimitService.get_or_create_subscription(teacher, apply_promo=False)

        with transaction.atomic():
            promotion = get_applicable_promotion(
                teacher, plan, billing_period, lock=True
            )
            if promotion is None or promotion.pk != calc.get("promotion_id"):
                raise PromotionError("PROMOTION_INACTIVE", "Акция больше недоступна.")

            metadata = {
                "plan_slug": plan.slug,
                "billing_period": billing_period,
                "pricing": price_meta,
                "applied_discount_source": "promotion",
                "promotion_id": promotion.pk,
                "granted": True,
            }
            if discount_info and isinstance(discount_info, dict):
                if discount_info.get("auto_renew") is True:
                    metadata["auto_renew"] = True

            payment = Payment.objects.create(
                teacher=teacher,
                subscription=sub,
                plan=plan,
                amount=calc["base_price"],
                discount_amount=calc["applied_discount"],
                referral_discount_amount=Decimal("0"),
                promotion_discount_amount=calc.get("promotion_discount") or Decimal("0"),
                final_amount=Decimal("0.00"),
                currency=plan.currency,
                status=Payment.Status.PAID,
                provider="internal",
                provider_payment_id=f"grant_{uuid.uuid4().hex[:16]}",
                idempotency_key=key,
                billing_period=billing_period,
                promotion=promotion,
                paid_at=timezone.now(),
                metadata=metadata,
            )
            reserve_redemption(
                promotion,
                teacher,
                payment,
                original_price=calc["base_price"],
                final_price=Decimal("0.00"),
            )
            confirm_for_payment(payment)
            cls.activate_subscription_from_payment(payment)

        logger.info(
            "promotion_granted payment_id=%s teacher=%s plan=%s promotion=%s",
            payment.pk,
            teacher.pk,
            plan.slug,
            promotion.pk,
        )
        return {
            "payment_id": payment.pk,
            "provider_payment_id": payment.provider_payment_id,
            "provider": "internal",
            "status": payment.status,
            "payment_url": "",
            "amount": "0.00",
            "currency": payment.currency,
            "billing_period": billing_period,
            "plan_slug": plan.slug,
            "granted": True,
            "pricing": price_meta,
            "discount": {
                "original_amount": str(calc["base_price"]),
                "discount": str(calc["applied_discount"]),
                "final_amount": "0.00",
                "applied_discount_source": "promotion",
                "message": calc.get("message"),
            },
        }

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

        provider_name = (
            provider_name
            or getattr(django_settings, "PAYMENT_PROVIDER", None)
            or cls.PROVIDER
            or "mock"
        )
        provider_name = str(provider_name).strip().lower()
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
                "rebill_id": (payload or {}).get("rebill_id") or "",
                "amount_kopecks": (payload or {}).get("amount_kopecks"),
                "pan_mask": (payload or {}).get("pan_mask") or "",
                "customer_key": (payload or {}).get("customer_key") or "",
                "error_code": (payload or {}).get("error_code") or "",
                "error_message": (payload or {}).get("error_message") or "",
            }
        else:
            try:
                parsed = provider.parse_webhook(payload or {})
            except ValueError as exc:
                return {"ok": False, "error": str(exc)}

        # Промежуточные статусы Т-Банка не меняют подписку
        if parsed.get("status") == "pending":
            # RebillId может прийти на AUTHORIZED — сохраняем заранее.
            rebill_early = str(parsed.get("rebill_id") or "").strip()
            if rebill_early and parsed.get("payment_id"):
                try:
                    p = Payment.objects.select_for_update().filter(pk=parsed["payment_id"]).first()
                    if p and not p.rebill_id:
                        p.rebill_id = rebill_early
                        p.save(update_fields=["rebill_id", "updated_at"])
                        cls._store_rebill_on_subscription(
                            p,
                            rebill_id=rebill_early,
                            customer_key=parsed.get("customer_key") or "",
                            pan_mask=parsed.get("pan_mask") or "",
                        )
                except Exception:
                    logger.exception("early rebill store failed")
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

        # Сверка суммы (копейки) — защита от подмены.
        amount_kopecks = parsed.get("amount_kopecks")
        if (
            new_status == "paid"
            and amount_kopecks is not None
            and provider_name in ("tbank", "tinkoff")
        ):
            expected = payment.final_amount if payment.final_amount is not None else payment.amount
            from .tbank_payment import amount_to_kopecks

            try:
                expected_k = amount_to_kopecks(expected)
            except ValueError:
                expected_k = None
            if expected_k is not None and int(amount_kopecks) != int(expected_k):
                logger.error(
                    "payment_amount_mismatch payment_id=%s expected=%s got=%s",
                    payment.pk,
                    expected_k,
                    amount_kopecks,
                )
                event.processed = True
                event.processed_at = timezone.now()
                event.save()
                return {"ok": False, "error": "amount_mismatch"}

        rebill_id = str(parsed.get("rebill_id") or "").strip()
        if rebill_id:
            payment.rebill_id = rebill_id
        if parsed.get("customer_key"):
            payment.customer_key = str(parsed["customer_key"])[:64]

        if new_status == "paid" and payment.status != Payment.Status.PAID:
            payment.status = Payment.Status.PAID
            payment.paid_at = timezone.now()
            if parsed.get("provider_payment_id"):
                payment.provider_payment_id = parsed["provider_payment_id"]
            payment.error_code = ""
            payment.error_message = ""
            payment.save(
                update_fields=[
                    "status",
                    "paid_at",
                    "provider_payment_id",
                    "rebill_id",
                    "customer_key",
                    "error_code",
                    "error_message",
                    "updated_at",
                ]
            )
            cls._store_rebill_on_subscription(
                payment,
                rebill_id=rebill_id or payment.rebill_id,
                customer_key=payment.customer_key,
                pan_mask=parsed.get("pan_mask") or "",
            )
            cls.activate_subscription_from_payment(payment)
            from .subscription_service import PromoCodeService
            from .promotion_service import confirm_for_payment as confirm_promotion

            PromoCodeService.confirm_for_payment(payment)
            confirm_promotion(payment)
            logger.info("payment_confirmed payment_id=%s teacher=%s", payment.pk, payment.teacher_id)
        elif new_status in ("failed", "cancelled", "refunded"):
            payment.status = new_status
            if parsed.get("error_code"):
                payment.error_code = str(parsed["error_code"])[:64]
            if parsed.get("error_message"):
                payment.error_message = str(parsed["error_message"])[:512]
            update_fields = ["status", "rebill_id", "customer_key", "error_code", "error_message", "updated_at"]
            if parsed.get("provider_payment_id") and not payment.provider_payment_id:
                payment.provider_payment_id = parsed["provider_payment_id"]
                update_fields.append("provider_payment_id")
            payment.save(update_fields=update_fields)
            from .subscription_service import PromoCodeService
            from .promotion_service import release_for_payment as release_promotion

            PromoCodeService.release_for_payment(payment)
            release_promotion(payment)
            logger.info(
                "payment_failed payment_id=%s status=%s code=%s",
                payment.pk,
                new_status,
                payment.error_code,
            )
            if payment.is_recurrent:
                try:
                    from .subscription_notifications import notify_auto_renew_failed

                    notify_auto_renew_failed(payment)
                except Exception:
                    logger.exception("notify_auto_renew_failed failed")

        event.processed = True
        event.processed_at = timezone.now()
        event.save()
        return {"ok": True, "payment_id": payment.pk, "status": payment.status}

    @classmethod
    def _store_rebill_on_subscription(
        cls,
        payment,
        *,
        rebill_id: str = "",
        customer_key: str = "",
        pan_mask: str = "",
    ):
        """Сохраняет допустимые идентификаторы COF на подписке (без PAN/CVV)."""
        from .models import TeacherSubscription

        rebill_id = str(rebill_id or "").strip()
        customer_key = str(customer_key or payment.customer_key or "").strip()
        pan_mask = str(pan_mask or "").strip()
        if not rebill_id and not customer_key and not pan_mask:
            return
        sub = payment.subscription
        if sub is None:
            try:
                sub = TeacherSubscription.objects.get(teacher_id=payment.teacher_id)
            except TeacherSubscription.DoesNotExist:
                return
        update_fields = ["updated_at"]
        if rebill_id and sub.tbank_rebill_id != rebill_id:
            sub.tbank_rebill_id = rebill_id
            update_fields.append("tbank_rebill_id")
        if customer_key and sub.tbank_customer_key != customer_key:
            sub.tbank_customer_key = customer_key
            update_fields.append("tbank_customer_key")
        if pan_mask and sub.payment_method_mask != pan_mask:
            # Т-Банк иногда отдаёт маску вида 430000******9956 — храним как есть.
            sub.payment_method_mask = pan_mask[:32]
            update_fields.append("payment_method_mask")
        if len(update_fields) > 1:
            sub.save(update_fields=update_fields)

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

        # Сериализуем активации одного учителя: два webhook/платежа не теряют месяцы.
        sub = (
            TeacherSubscription.objects.select_for_update()
            .select_related("plan")
            .get(pk=sub.pk)
        )

        now = timezone.now()
        months = 12 if payment.billing_period == "year" else 1
        bonus_days = 0
        meta = payment.metadata if isinstance(payment.metadata, dict) else {}
        pricing = meta.get("pricing") if isinstance(meta.get("pricing"), dict) else {}

        if payment.promo_code_id and meta.get("applied_discount_source") == "promo":
            promo = payment.promo_code
            if promo.discount_type == PromoCode.DiscountType.FREE_MONTHS:
                months = max(months, int(promo.discount_value or 0) or months)
            elif promo.discount_type == PromoCode.DiscountType.BONUS_DAYS:
                bonus_days = int(promo.discount_value or 0)
            bonus_days += int(getattr(promo, "bonus_days", 0) or 0)
        elif pricing.get("extra_free_months"):
            extra = int(pricing.get("extra_free_months") or 0)
            if extra:
                if meta.get("applied_discount_source") == "promotion":
                    months = extra
                else:
                    months = max(months, extra)
        if pricing.get("bonus_days") and meta.get("applied_discount_source") == "promo":
            bonus_days = max(bonus_days, int(pricing.get("bonus_days") or 0))

        was_active = bool(sub.expires_at and sub.expires_at > now and sub.is_valid())
        old_expires = sub.expires_at
        from .subscription_downgrade import DowngradeService, is_downgrade

        # Ранняя оплата будущего (более дешёвого) тарифа: не отнимаем остаток текущего.
        # Включая рекуррентный Charge при scheduled downgrade.
        if (
            was_active
            and plan
            and sub.plan_id
            and is_downgrade(sub.plan, plan)
        ):
            DowngradeService.mark_prepaid(sub, payment, plan)
            logger.info(
                "subscription_prepaid_downgrade payment_id=%s teacher=%s keep=%s next=%s "
                "old_expires_at=%s prepaid_until=%s recurrent=%s",
                payment.pk,
                payment.teacher_id,
                sub.plan.slug,
                plan.slug,
                old_expires.isoformat() if old_expires else None,
                sub.prepaid_until.isoformat() if sub.prepaid_until else None,
                payment.is_recurrent,
            )
            if payment.is_recurrent:
                try:
                    from .subscription_notifications import notify_auto_renew_success

                    notify_auto_renew_success(payment, sub)
                except Exception:
                    logger.exception("notify_auto_renew_success failed")
            try:
                ReferralService.apply_available_bonus_days(payment.teacher)
            except Exception:
                logger.exception("apply_available_bonus_days failed for %s", payment.teacher_id)
            try:
                ReferralService.mark_invitee_discount_consumed(payment)
            except Exception:
                logger.exception("mark_invitee_discount_consumed failed for payment %s", payment.pk)
            try:
                ReferralService.grant_payment_reward_if_applicable(payment)
            except Exception:
                logger.exception("grant_payment_reward_if_applicable failed for payment %s", payment.pk)
            try:
                sub.refresh_from_db()
                DowngradeService.sync_effective_at_to_expires(sub)
            except Exception:
                logger.exception("sync_effective_at_to_expires failed")
            return

        base = sub.expires_at if sub.expires_at and sub.expires_at > now else now
        expires = add_months(base, months)
        if bonus_days:
            expires = expires + timedelta(days=bonus_days)

        # Автопродление:
        # - явный consent в metadata платежа;
        # - иначе сохраняем текущий флаг (рекуррентное продление не сбрасывает);
        # - если есть RebillId и пользователь уже включил auto_renew — оставляем True.
        if meta.get("auto_renew") is True or meta.get("consent_auto_renew") is True:
            auto_renew = True
        elif payment.is_recurrent:
            auto_renew = bool(sub.auto_renew)
        else:
            auto_renew = bool(sub.auto_renew)

        # Если карта сохранена (rebill) и это первая оплата без явного отказа — не трогаем False.
        # Пользователь включает автопродление отдельным toggle в ЛК.
        if meta.get("auto_renew") is False:
            auto_renew = False

        sub.plan = plan
        if (
            meta.get("applied_discount_source") == "promotion"
            and (payment.final_amount is None or payment.final_amount <= 0)
        ):
            sub.status = TeacherSubscription.Status.TRIAL
            sub.source = TeacherSubscription.Source.PROMOTION
            sub.promo_started_at = now
            sub.promo_ends_at = expires
        else:
            sub.status = TeacherSubscription.Status.ACTIVE
            sub.source = TeacherSubscription.Source.PAYMENT
        sub.billing_period = payment.billing_period
        sub.current_period_start = now
        sub.current_period_end = expires
        sub.expires_at = expires
        sub.auto_renew = auto_renew
        sub.cancelled_at = None
        sub.last_renewal_error = ""
        sub.prepaid_until = None
        # Успешная оплата текущего/upgrade снимает pending downgrade на другой план.
        sub.scheduled_plan = None
        sub.scheduled_change_at = None
        update_fields = [
            "plan",
            "status",
            "source",
            "billing_period",
            "current_period_start",
            "current_period_end",
            "expires_at",
            "auto_renew",
            "cancelled_at",
            "last_renewal_error",
            "prepaid_until",
            "scheduled_plan",
            "scheduled_change_at",
            "updated_at",
        ]
        if sub.source == TeacherSubscription.Source.PROMOTION:
            update_fields.extend(["promo_started_at", "promo_ends_at"])
        sub.save(update_fields=update_fields)
        # Закрыть pending change как applied/superseded.
        try:
            from .models import SubscriptionPlanChange

            active = DowngradeService.get_active_change(sub)
            if active:
                if active.to_plan_id == plan.pk:
                    active.status = SubscriptionPlanChange.Status.APPLIED
                    active.applied_at = now
                    active.payment = payment
                    active.save(
                        update_fields=["status", "applied_at", "payment", "updated_at"]
                    )
                    try:
                        DowngradeService._enforce_limits_after_plan(sub, active)
                    except Exception:
                        logger.exception("enforce limits after renew failed")
                else:
                    active.status = SubscriptionPlanChange.Status.SUPERSEDED
                    active.canceled_at = now
                    active.save(update_fields=["status", "canceled_at", "updated_at"])
        except Exception:
            logger.exception("close plan change after payment failed")

        logger.info(
            "%s payment_id=%s teacher=%s plan=%s old_expires_at=%s new_expires_at=%s",
            "subscription_extended" if was_active else "subscription_activated",
            payment.pk,
            payment.teacher_id,
            plan.slug,
            old_expires.isoformat() if old_expires else None,
            expires.isoformat(),
        )

        if payment.is_recurrent:
            try:
                from .subscription_notifications import notify_auto_renew_success

                notify_auto_renew_success(payment, sub)
            except Exception:
                logger.exception("notify_auto_renew_success failed")

        # Накопленные +14 дней реферала (если покупатель сам кого-то приглашал ранее).
        try:
            ReferralService.apply_available_bonus_days(payment.teacher)
        except Exception:
            logger.exception("apply_available_bonus_days failed for %s", payment.teacher_id)

        # Закрыть eligibility 50% у приглашённого (после любой первой успешной оплаты).
        try:
            ReferralService.mark_invitee_discount_consumed(payment)
        except Exception:
            logger.exception("mark_invitee_discount_consumed failed for payment %s", payment.pk)

        # +14 дней пригласившему (идемпотентно).
        try:
            ReferralService.grant_payment_reward_if_applicable(payment)
        except Exception:
            logger.exception("grant_payment_reward_if_applicable failed for payment %s", payment.pk)

        try:
            sub.refresh_from_db()
            DowngradeService.sync_effective_at_to_expires(sub)
        except Exception:
            logger.exception("sync_effective_at_to_expires failed")

    @classmethod
    def create_recurrent_payment(cls, subscription):
        """
        Создаёт Payment на полную цену СЛЕДУЮЩЕГО тарифа (pending downgrade) и Charge.
        Скидки referral/promo НЕ переносятся на автопродление.
        """
        from django.db import IntegrityError

        from .models import Payment
        from .pricing_service import base_plan_price
        from .subscription_downgrade import DowngradeService, is_free_plan
        from .tbank_payment import customer_key_for_teacher

        subscription.refresh_from_db()
        if not subscription.auto_renew:
            return {"ok": True, "skipped": True, "reason": "auto_renew_off"}

        # Если следующий период уже предоплачен — Charge не нужен.
        change = DowngradeService.get_active_change(subscription)
        if change and change.status == "prepaid":
            return {"ok": True, "prepaid": True, "change_id": change.pk}

        plan = DowngradeService.effective_next_plan(subscription)
        if not plan or is_free_plan(plan):
            # Переход на Старт — не списываем.
            return {"ok": True, "skipped": True, "reason": "next_plan_free"}

        rebill_id = (subscription.tbank_rebill_id or "").strip()
        if not rebill_id:
            raise ValueError("Нет сохранённого RebillId для автопродления")

        billing_period = subscription.billing_period or "month"
        amount = base_plan_price(plan, billing_period)
        if amount <= 0:
            raise ValueError("Цена тарифа должна быть больше нуля")

        key = f"renew_{subscription.pk}_{subscription.expires_at.date().isoformat() if subscription.expires_at else 'na'}_{plan.slug}"
        existing = Payment.objects.filter(idempotency_key=key).first()
        if existing:
            return cls._resume_recurrent_payment(existing, subscription)

        teacher = subscription.teacher
        try:
            payment = Payment.objects.create(
                teacher=teacher,
                subscription=subscription,
                plan=plan,
                amount=amount,
                discount_amount=Decimal("0"),
                referral_discount_amount=Decimal("0"),
                final_amount=amount,
                currency=plan.currency,
                status=Payment.Status.PENDING,
                provider=(getattr(settings, "PAYMENT_PROVIDER", "tbank") or "tbank").strip().lower(),
                customer_key=subscription.tbank_customer_key or customer_key_for_teacher(teacher),
                rebill_id=rebill_id,
                is_recurrent=True,
                idempotency_key=key,
                billing_period=billing_period,
                metadata={
                    "plan_slug": plan.slug,
                    "billing_period": billing_period,
                    "auto_renew": True,
                    "is_recurrent": True,
                    "pending_downgrade": bool(change),
                    "pricing": {
                        "base_price": str(amount),
                        "final_price": str(amount),
                        "applied_discount_source": "none",
                    },
                },
            )
        except IntegrityError:
            existing = Payment.objects.filter(idempotency_key=key).first()
            if existing:
                return cls._resume_recurrent_payment(existing, subscription)
            raise
        logger.info(
            "payment_created recurrent payment_id=%s subscription=%s amount=%s",
            payment.pk,
            subscription.pk,
            amount,
        )

        provider_name = (payment.provider or "tbank").strip().lower()
        if provider_name == "mock":
            # В DEBUG mock сразу подтверждает.
            if settings.DEBUG:
                cls.handle_webhook(
                    {
                        "payment_id": payment.pk,
                        "status": "paid",
                        "event_id": f"mock_renew_{payment.pk}",
                        "provider_payment_id": payment.provider_payment_id or f"mock_{payment.pk}",
                        "rebill_id": rebill_id,
                    },
                    provider_name="mock",
                    skip_provider_parse=True,
                )
                payment.refresh_from_db()
                return {"ok": True, "payment": payment, "mock": True}
            raise ValueError("Mock recurrent disabled outside DEBUG")

        provider = get_payment_provider(provider_name)
        if not hasattr(provider, "charge_recurrent"):
            raise ValueError("Провайдер не поддерживает рекуррентные платежи")

        subscription.refresh_from_db()
        if not subscription.auto_renew:
            if payment.status == Payment.Status.PENDING:
                payment.status = Payment.Status.CANCELLED
                payment.error_message = "auto_renew_off"
                payment.save(update_fields=["status", "error_message", "updated_at"])
            return {"ok": True, "skipped": True, "reason": "auto_renew_off", "payment": payment}

        try:
            result = provider.charge_recurrent(payment, plan, rebill_id=rebill_id)
        except Exception as exc:
            payment.refresh_from_db()
            if payment.status == Payment.Status.FAILED:
                try:
                    from .subscription_notifications import notify_auto_renew_failed

                    notify_auto_renew_failed(payment)
                except Exception:
                    logger.exception("notify_auto_renew_failed")
                logger.info("auto_renew_failed payment_id=%s error=%s", payment.pk, exc)
                return {"ok": False, "payment": payment, "error": str(exc)}
            # Сеть/timeout: статус оставляем pending — следующий cron сделает GetState.
            payment.error_message = str(exc)[:512]
            payment.save(update_fields=["error_message", "updated_at"])
            logger.info("auto_renew_awaiting payment_id=%s error=%s", payment.pk, exc)
            return {
                "ok": True,
                "payment": payment,
                "awaiting": True,
                "error": str(exc),
            }

        mapped = (result.get("mapped_status") or "").strip().lower()
        if mapped == "paid":
            cls.handle_webhook(
                {
                    "payment_id": payment.pk,
                    "status": "paid",
                    "event_id": f"charge_{payment.provider_payment_id}_CONFIRMED",
                    "provider_payment_id": payment.provider_payment_id,
                    "rebill_id": rebill_id,
                },
                provider_name=provider_name,
                skip_provider_parse=True,
            )
            payment.refresh_from_db()
            logger.info("auto_renew_success payment_id=%s", payment.pk)
            return {"ok": True, "payment": payment, "charged": True}

        # Иначе ждём webhook / GetState.
        logger.info(
            "auto_renew_started awaiting_webhook payment_id=%s status=%s",
            payment.pk,
            result.get("provider_status"),
        )
        return {"ok": True, "payment": payment, "awaiting": True, "provider_status": result.get("provider_status")}

    @classmethod
    def _resume_recurrent_payment(cls, existing, subscription):
        """Повтор cron по тому же billing cycle: не создаём второй Charge."""
        from .models import Payment

        if existing.status == Payment.Status.PAID:
            return {"ok": True, "payment": existing, "duplicate": True}
        if existing.status == Payment.Status.FAILED:
            return {"ok": False, "payment": existing, "error": "already_failed"}
        if existing.status == Payment.Status.CANCELLED:
            return {"ok": True, "skipped": True, "reason": "cancelled", "payment": existing}
        if existing.status == Payment.Status.PENDING:
            if existing.provider_payment_id:
                synced = cls.sync_payment_from_provider(existing)
                existing.refresh_from_db()
                if existing.status == Payment.Status.PAID:
                    return {"ok": True, "payment": existing, "synced": True}
                if existing.status == Payment.Status.FAILED:
                    return {"ok": False, "payment": existing, "error": "already_failed"}
                logger.info(
                    "auto_renew_pending_sync payment_id=%s synced=%s",
                    existing.pk,
                    synced,
                )
                return {"ok": True, "payment": existing, "pending": True}
            return {"ok": True, "payment": existing, "pending": True}
        return {"ok": True, "payment": existing}
