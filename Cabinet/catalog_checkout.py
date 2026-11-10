"""Общий checkout каталога: урок, набор, тренажёр.

Init Amount, чек и final_amount — одна и та же сумма в копейках.
Если итог 0, доступ выдаётся без вызова Init.
"""

from __future__ import annotations

import uuid

from django.utils import timezone

from .pricing_service import calculate_catalog_price, catalog_price_payload


def _provider_name():
    from django.conf import settings as django_settings

    return (getattr(django_settings, "PAYMENT_PROVIDER", None) or "mock").strip().lower()


def assert_payments_available() -> str:
    from django.conf import settings as django_settings

    provider_name = _provider_name()
    payments_on = bool(getattr(django_settings, "PAYMENTS_ENABLED", False))
    if not payments_on and provider_name != "mock":
        raise ValueError("Оплата временно недоступна. Попробуйте позже.")
    if provider_name == "mock" and not django_settings.DEBUG:
        raise ValueError("Mock payments are disabled in production")
    return provider_name


def open_catalog_checkout(
    *,
    user,
    product_type: str,
    list_price,
    currency: str,
    purpose: str,
    metadata: dict,
    idempotency_key: str,
    promo_code: str | None = None,
    quote_only: bool = False,
):
    """
    Считает цену, резервирует промокод и создаёт Payment.
    Нулевая сумма не вызывает платёжного провайдера: Payment сразу paid.
    """
    from .models import Payment, PromoCode
    from .payment_service import get_payment_provider
    from .subscription_service import PromoCodeService
    from .tbank_payment import customer_key_for_teacher

    calc = calculate_catalog_price(
        user,
        list_price,
        product_type,
        promo_code=promo_code or None,
        validate_promo=True,
    )
    pricing = catalog_price_payload(calc)
    if quote_only:
        return {
            "quote": True,
            "granted": False,
            "payment": None,
            "calc": calc,
            "pricing": pricing,
            "payment_url": "",
            "idempotent": False,
        }

    provider_name = assert_payments_available()
    key = (idempotency_key or "").strip()
    existing = Payment.objects.filter(idempotency_key=key).first() if key else None
    if existing is not None:
        meta = existing.metadata if isinstance(existing.metadata, dict) else {}
        return {
            "quote": False,
            "granted": existing.status == Payment.Status.PAID and bool(meta.get("granted")),
            "payment": existing,
            "calc": calc,
            "pricing": meta.get("pricing") if isinstance(meta.get("pricing"), dict) else pricing,
            "payment_url": str(meta.get("payment_url") or ""),
            "idempotent": True,
        }

    list_amount = calc["list_price"]
    final_amount = calc["final_price"]
    discount_amount = calc["applied_discount"]
    promo = calc.get("promo") if calc["applied_discount_source"] == "promo" else None
    if promo is None and calc.get("promo_code"):
        promo = PromoCode.objects.filter(code__iexact=calc["promo_code"]).first()

    pay_meta = dict(metadata or {})
    pay_meta["pricing"] = pricing
    pay_meta["applied_discount_source"] = calc["applied_discount_source"]
    pay_meta["applied_label"] = calc.get("applied_label") or ""
    if calc.get("user_discount_id"):
        pay_meta["user_discount_id"] = calc["user_discount_id"]

    granted = final_amount <= 0
    payment = Payment.objects.create(
        teacher=user,
        subscription=None,
        plan=None,
        purpose=purpose,
        amount=list_amount,
        discount_amount=discount_amount,
        final_amount=final_amount,
        currency=(currency or "RUB").upper(),
        status=Payment.Status.PAID if granted else Payment.Status.PENDING,
        provider="internal" if granted else provider_name,
        provider_payment_id=(
            f"grant_{uuid.uuid4().hex[:16]}"
            if granted
            else (f"mock_{uuid.uuid4().hex[:16]}" if provider_name == "mock" else "")
        ),
        customer_key=customer_key_for_teacher(user),
        idempotency_key=key or None,
        promo_code=promo,
        paid_at=timezone.now() if granted else None,
        metadata={**pay_meta, "granted": granted},
    )

    if promo is not None:
        try:
            PromoCodeService.reserve_usage(
                user,
                promo,
                payment,
                discount_amount,
            )
            if granted:
                PromoCodeService.confirm_for_payment(payment)
        except Exception:
            payment.status = Payment.Status.FAILED
            payment.error_message = "Не удалось зарезервировать промокод"
            payment.save(update_fields=["status", "error_message", "updated_at"])
            PromoCodeService.release_for_payment(payment)
            raise

    payment_url = ""
    if not granted:
        provider = get_payment_provider(provider_name)
        try:
            payment_url = provider.create_checkout(payment, None)
        except Exception:
            payment.status = Payment.Status.FAILED
            payment.save(update_fields=["status", "updated_at"])
            PromoCodeService.release_for_payment(payment)
            raise
        if payment_url:
            meta = dict(payment.metadata or {})
            meta["payment_url"] = payment_url
            payment.metadata = meta
            payment.save(update_fields=["metadata", "updated_at"])

    return {
        "quote": False,
        "granted": granted,
        "payment": payment,
        "calc": calc,
        "pricing": pricing,
        "payment_url": payment_url,
        "idempotent": False,
    }


def checkout_amounts_match(payment) -> bool:
    """Init Amount == Receipt Item Amount == Price * Quantity == final_amount в копейках."""
    from .tbank_payment import amount_to_kopecks, build_receipt

    final = payment.final_amount if payment.final_amount is not None else payment.amount
    kopecks = amount_to_kopecks(final)
    receipt = build_receipt(payment, payment.plan, amount_kopecks=kopecks)
    item = receipt["Items"][0]
    price = int(item["Price"])
    quantity = int(item["Quantity"])
    amount = int(item["Amount"])
    return price * quantity == amount == kopecks
