"""Доступ к тренажёрам «Интересное»: тариф, покупка или одно демо на 10 минут."""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal
from typing import Any, Optional

from django.db import IntegrityError, transaction
from django.utils import timezone

from .lesson_access import LessonAccessService, plan_display_name
from .pricing_service import PRODUCT_INTERESTING, calculate_catalog_price, catalog_price_payload
from .subscription_access import AccessDenied, SubscriptionAccessService

logger = logging.getLogger(__name__)

INTERESTING_DEMO_MINUTES = 10
ACCESS_FREE = "free"
ACCESS_SUBSCRIPTION = "subscription"
ACCESS_PURCHASED = "purchase"
ACCESS_DEMO = "demo"
ACCESS_LOCKED = "locked"
ACCESS_STAFF = "staff"
ACCESS_COLLECTION = "collection"


def is_interesting_payment(payment) -> bool:
    if getattr(payment, "purpose", "") == "interesting":
        return True
    meta = payment.metadata if isinstance(getattr(payment, "metadata", None), dict) else {}
    return meta.get("purpose") == "interesting"


def _is_free(item) -> bool:
    level = getattr(item, "access_level", None) or "free"
    return SubscriptionAccessService.content_level_rank(level) <= 0


def _purchase_enabled(item) -> bool:
    if _is_free(item):
        return False
    if not getattr(item, "standalone_purchase_enabled", False):
        return False
    price = getattr(item, "standalone_price", None)
    return price is not None and Decimal(str(price)) > 0


class InterestingAccessService:
    @staticmethod
    def is_authenticated(user) -> bool:
        return LessonAccessService.is_authenticated(user)

    @classmethod
    def has_purchase(cls, user, item) -> bool:
        if not cls.is_authenticated(user) or item is None:
            return False
        from .models import InterestingPurchase

        row = (
            InterestingPurchase.objects.filter(
                user=user,
                item=item,
                status=InterestingPurchase.Status.PAID,
            )
            .order_by("-purchased_at", "-id")
            .first()
        )
        return bool(row and row.is_active())

    @classmethod
    def get_demo_row(cls, user, item):
        if not cls.is_authenticated(user) or item is None:
            return None
        from .models import InterestingDemoAccess

        return InterestingDemoAccess.objects.filter(user=user, item=item).first()

    @classmethod
    def get_access(cls, user, item) -> dict[str, Any]:
        required = SubscriptionAccessService.get_minimum_plan_for_content(item)
        required_name = plan_display_name(required)
        free = _is_free(item)
        purchase_available = _purchase_enabled(item)
        price = None
        currency = getattr(item, "standalone_currency", None) or "RUB"
        if purchase_available:
            price = getattr(item, "standalone_price", None)

        result = {
            "allowed": False,
            "can_view": False,
            "is_full": False,
            "access_type": ACCESS_LOCKED,
            "min_plan": required,
            "required_plan": required,
            "required_plan_name": required_name,
            "access_level": getattr(item, "access_level", "free"),
            "standalone_purchase_available": purchase_available,
            "standalone_price": _number(price) if price is not None else None,
            "standalone_currency": currency,
            "can_purchase": False,
            "can_start_demo": False,
            "demo_active": False,
            "demo_used": False,
            "demo_expired": False,
            "demo_expires_at": None,
            "demo_remaining_seconds": None,
            "demo_duration_minutes": INTERESTING_DEMO_MINUTES,
            "pricing": None,
            "message": "",
        }

        if item is None:
            result["message"] = "Материал не найден."
            return result

        if user is not None and getattr(user, "is_authenticated", False):
            if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
                return cls._open(result, ACCESS_STAFF)

        if free:
            return cls._open(result, ACCESS_FREE)

        from .lesson_collection_access import LessonCollectionAccess
        from .student_content_access import (
            is_real_linked_student,
            student_can_access_catalog_interesting,
        )

        if is_real_linked_student(user) and student_can_access_catalog_interesting(user, item):
            return cls._open(result, ACCESS_COLLECTION)

        grant = LessonCollectionAccess.grant_for_interesting(user, item)
        if grant == "full":
            return cls._open(result, ACCESS_COLLECTION)

        if cls.has_purchase(user, item):
            return cls._open(result, ACCESS_PURCHASED)

        if (
            cls.is_authenticated(user)
            and not SubscriptionAccessService.is_student_user(user)
            and SubscriptionAccessService.can_access_content(user, item)
        ):
            return cls._open(result, ACCESS_SUBSCRIPTION)

        demo = cls.get_demo_row(user, item)
        if demo is not None and demo.is_session_active():
            remaining = int((demo.expires_at - timezone.now()).total_seconds())
            result.update(
                {
                    "allowed": True,
                    "can_view": True,
                    "is_full": False,
                    "access_type": ACCESS_DEMO,
                    "demo_active": True,
                    "demo_used": True,
                    "demo_expires_at": demo.expires_at.isoformat(),
                    "demo_remaining_seconds": max(0, remaining),
                    "can_purchase": purchase_available and cls.is_authenticated(user),
                    "message": "Демо открыто на 10 минут. После этого материал снова закроется.",
                }
            )
            cls._attach_pricing(user, result)
            return result

        result["demo_used"] = demo is not None
        result["demo_expired"] = demo is not None
        result["can_start_demo"] = cls.is_authenticated(user) and demo is None
        result["can_purchase"] = cls.is_authenticated(user) and purchase_available
        result["allowed"] = False
        result["can_view"] = grant == "demo"
        if result["can_view"]:
            result["access_type"] = ACCESS_DEMO
            result["allowed"] = True
        if result["demo_expired"]:
            result["message"] = (
                "Демо этого тренажёра уже закончилось. Купите его или откройте по тарифу."
            )
        elif not cls.is_authenticated(user):
            result["message"] = (
                f"Тренажёр доступен после регистрации и с тарифа «{required_name}»."
            )
        elif purchase_available:
            result["message"] = (
                f"Тренажёр доступен на тарифе «{required_name}» или отдельно."
            )
        else:
            result["message"] = f"Тренажёр доступен на тарифе «{required_name}»."
        cls._attach_pricing(user, result)
        return result

    @staticmethod
    def _open(result: dict, access_type: str) -> dict:
        result.update(
            {
                "allowed": True,
                "can_view": True,
                "is_full": True,
                "access_type": access_type,
                "can_purchase": False,
                "can_start_demo": False,
                "message": "",
            }
        )
        return result

    @staticmethod
    def _attach_pricing(user, result: dict) -> None:
        if not result.get("can_purchase") or result.get("standalone_price") is None:
            return
        try:
            calc = calculate_catalog_price(
                user,
                result["standalone_price"],
                PRODUCT_INTERESTING,
                promo_code=None,
                validate_promo=False,
            )
        except Exception:
            logger.exception("interesting_price_failed")
            return
        result["pricing"] = catalog_price_payload(calc)
        if calc["applied_discount"] > 0:
            result["message"] = calc.get("message") or result["message"]

    @classmethod
    def start_demo(cls, user, item):
        from .models import InterestingDemoAccess

        access = cls.get_access(user, item)
        if access["is_full"]:
            raise AccessDenied(
                code="ALREADY_OWNED",
                message="Полный доступ уже есть, демо не нужно.",
                feature="content",
                min_plan=access["required_plan"],
            )
        if not cls.is_authenticated(user):
            raise AccessDenied(
                code="AUTH_REQUIRED",
                message="Войдите, чтобы открыть демо.",
                feature="content",
                min_plan=access["required_plan"],
            )
        if access["demo_active"]:
            return cls.get_demo_row(user, item)
        if not access["can_start_demo"]:
            raise AccessDenied(
                code="DEMO_EXPIRED",
                message="Демо этого тренажёра уже использовано.",
                feature="content",
                min_plan=access["required_plan"],
            )
        now = timezone.now()
        try:
            with transaction.atomic():
                demo = InterestingDemoAccess.objects.create(
                    user=user,
                    item=item,
                    opened_at=now,
                    expires_at=now + timedelta(minutes=INTERESTING_DEMO_MINUTES),
                )
        except IntegrityError:
            demo = InterestingDemoAccess.objects.get(user=user, item=item)
            if not demo.is_session_active():
                raise AccessDenied(
                    code="DEMO_EXPIRED",
                    message="Демо этого тренажёра уже использовано.",
                    feature="content",
                    min_plan="teacher",
                )
        return demo

    @classmethod
    def create_checkout(cls, user, item, *, idempotency_key: str | None = None, promo_code: str | None = None, quote_only: bool = False) -> dict:
        from .catalog_checkout import open_catalog_checkout
        from .models import Payment

        access = cls.get_access(user, item)
        if access["is_full"]:
            raise AccessDenied(
                code="ALREADY_OWNED",
                message="У вас уже есть полный доступ к этому тренажёру.",
                feature="content",
                min_plan=access["required_plan"],
            )
        if not access["can_purchase"]:
            raise AccessDenied(
                code="PURCHASE_UNAVAILABLE",
                message="Отдельная покупка этого тренажёра недоступна.",
                feature="content",
                min_plan=access["required_plan"],
            )

        key = (idempotency_key or "").strip() or (
            f"int_{user.pk}_{item.pk}_{timezone.now().strftime('%Y%m%d')}"
        )
        opened = open_catalog_checkout(
            user=user,
            product_type=PRODUCT_INTERESTING,
            list_price=item.standalone_price,
            currency=item.standalone_currency or "RUB",
            purpose=Payment.Purpose.INTERESTING,
            metadata={
                "purpose": "interesting",
                "interesting_id": item.pk,
                "interesting_slug": item.slug,
                "interesting_title": (item.title or "")[:120],
            },
            idempotency_key=key,
            promo_code=promo_code,
            quote_only=quote_only,
        )
        if opened["granted"] and opened["payment"] is not None and not opened["idempotent"]:
            cls.fulfill_payment(opened["payment"])
        elif opened["granted"] and opened["idempotent"]:
            cls.fulfill_payment(opened["payment"])
        return cls._payload(opened, item)

    @staticmethod
    def _payload(opened: dict, item) -> dict:
        payment = opened["payment"]
        pricing = opened["pricing"]
        body = {
            "quote": opened["quote"],
            "granted": opened["granted"],
            "pricing": pricing,
            "amount": pricing.get("final_amount"),
            "list_price": pricing.get("list_price"),
            "currency": getattr(item, "standalone_currency", None) or "RUB",
            "interesting_id": item.pk,
            "interesting_slug": item.slug,
            "message": (pricing or {}).get("message"),
            "idempotent": opened["idempotent"],
            "payment_url": opened.get("payment_url") or "",
        }
        if payment is not None:
            meta = payment.metadata if isinstance(payment.metadata, dict) else {}
            body.update(
                {
                    "payment_id": payment.pk,
                    "provider_payment_id": payment.provider_payment_id,
                    "provider": payment.provider,
                    "status": payment.status,
                    "payment_url": opened.get("payment_url") or str(meta.get("payment_url") or ""),
                    "amount": str(payment.final_amount if payment.final_amount is not None else payment.amount),
                }
            )
        return body

    @classmethod
    def fulfill_payment(cls, payment) -> Optional[Any]:
        from Generator.models import InterestingItem
        from .models import InterestingPurchase, Payment

        if not is_interesting_payment(payment):
            return None
        if payment.status != Payment.Status.PAID:
            return None
        meta = payment.metadata if isinstance(payment.metadata, dict) else {}
        item_id = meta.get("interesting_id")
        item = InterestingItem.objects.filter(pk=item_id).first() if item_id else None
        if item is None:
            logger.error("interesting_payment_missing payment_id=%s", payment.pk)
            return None
        with transaction.atomic():
            existing = InterestingPurchase.objects.filter(payment=payment).first()
            if existing and existing.status == InterestingPurchase.Status.PAID:
                return existing
            paid = (
                InterestingPurchase.objects.select_for_update()
                .filter(
                    user=payment.teacher,
                    item=item,
                    status=InterestingPurchase.Status.PAID,
                )
                .first()
            )
            if paid:
                if paid.payment_id is None:
                    paid.payment = payment
                    paid.save(update_fields=["payment", "updated_at"])
                return paid
            now = timezone.now()
            purchase, created = InterestingPurchase.objects.get_or_create(
                payment=payment,
                defaults={
                    "user": payment.teacher,
                    "item": item,
                    "amount": payment.final_amount or payment.amount,
                    "currency": payment.currency or "RUB",
                    "status": InterestingPurchase.Status.PAID,
                    "purchased_at": payment.paid_at or now,
                },
            )
            if not created and purchase.status != InterestingPurchase.Status.PAID:
                purchase.status = InterestingPurchase.Status.PAID
                purchase.purchased_at = payment.paid_at or now
                purchase.amount = payment.final_amount or payment.amount
                purchase.save(update_fields=["status", "purchased_at", "amount", "updated_at"])
        return purchase


def _number(value):
    try:
        number = Decimal(str(value))
    except Exception:
        return None
    if number == number.to_integral_value():
        return int(number)
    return float(number)
