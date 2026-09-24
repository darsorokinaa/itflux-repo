"""Доступ к наборам готовых уроков. Покупки и тарифы — те же, что у уроков."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any, Iterable

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .lesson_access import (
    ACCESS_COLLECTION,
    ACCESS_COLLECTION_DEMO,
    LessonAccessService,
    _money,
)
from .subscription_access import (
    PLAN_SLUG_TO_RANK,
    AccessDenied,
    SubscriptionAccessService,
)

logger = logging.getLogger(__name__)

COLLECTION_VIEW = "collection_view"
COLLECTION_LESSON_OPEN = "collection_lesson_open"
COLLECTION_DEMO_OPEN = "collection_demo_open"
COLLECTION_PURCHASE_CLICK = "collection_purchase_click"
COLLECTION_PURCHASE_STARTED = "collection_purchase_started"
COLLECTION_PURCHASED = "collection_purchased"
RELATED_COLLECTION_OPENED = "related_collection_opened_from_lesson"
NEXT_COLLECTION_LESSON_CLICKED = "next_collection_lesson_clicked"
PREVIOUS_COLLECTION_LESSON_CLICKED = "previous_collection_lesson_clicked"

COLLECTION_CLICK_EVENTS = frozenset(
    {
        COLLECTION_PURCHASE_CLICK,
        RELATED_COLLECTION_OPENED,
        NEXT_COLLECTION_LESSON_CLICKED,
        PREVIOUS_COLLECTION_LESSON_CLICKED,
    }
)

PLAN_LABELS = {
    "start": "Старт",
    "teacher": "Учитель",
    "repetitor": "Учитель",
    "pro": "Профи",
    "profi": "Профи",
    "professional": "Профи",
    "premium": "Премиум",
    "school": "Школа",
    "corporate": "Корпоративный",
}

PLAN_ALIASES = {
    "professional": "pro",
    "profi": "pro",
    "repetitor": "teacher",
    "corporate": "school",
    "paid": "pro",
}


def canonical_plan_slug(slug: str) -> str:
    raw = (slug or "").strip().lower()
    return PLAN_ALIASES.get(raw, raw)


def plan_label(slug: str) -> str:
    key = canonical_plan_slug(slug)
    return PLAN_LABELS.get(key, PLAN_LABELS.get(slug, slug or "Тариф"))


def is_collection_payment(payment) -> bool:
    if getattr(payment, "purpose", "") == "collection":
        return True
    meta = payment.metadata if isinstance(getattr(payment, "metadata", None), dict) else {}
    return meta.get("purpose") == "collection"


def _record(event_name: str, user, collection, *, lesson_id=None, extra: str = ""):
    if user is None or not getattr(user, "is_authenticated", False):
        return
    try:
        from .activation_events import record_event

        collection_id = getattr(collection, "pk", None) or 0
        record_event(
            event_name,
            user,
            object_type="collection",
            object_id=collection_id or None,
            source="lesson_collection",
            metadata={
                "collection_id": collection_id or None,
                "collection_slug": getattr(collection, "slug", "") or "",
                "lesson_id": lesson_id,
            },
            idempotency_key=f"{event_name}:{user.pk}:{collection_id}:{lesson_id or 0}:{extra}"[:160],
        )
    except Exception:
        logger.exception("collection_event_failed name=%s", event_name)


class LessonCollectionAccess:
    """Право на набор и на урок через набор. Не доверяет параметрам запроса."""

    @staticmethod
    def _published_statuses():
        from Generator.models import LessonCollection

        return (
            LessonCollection.Status.PUBLISHED,
            LessonCollection.Status.HIDDEN,
            LessonCollection.Status.ARCHIVED,
        )

    @classmethod
    def sells_separately(cls, collection) -> bool:
        from Generator.models import LessonCollection

        if collection is None:
            return False
        if collection.access_mode not in (
            LessonCollection.AccessMode.PURCHASE,
            LessonCollection.AccessMode.SUBSCRIPTION_OR_PURCHASE,
        ):
            return False
        price = getattr(collection, "price", None)
        return price is not None and Decimal(str(price)) > 0

    @classmethod
    def subscription_covers(cls, user, collection) -> bool:
        from Generator.models import LessonCollection

        if not LessonAccessService.is_authenticated(user) or collection is None:
            return False
        if SubscriptionAccessService.is_student_user(user):
            return False
        if collection.access_mode not in (
            LessonCollection.AccessMode.SUBSCRIPTION,
            LessonCollection.AccessMode.SUBSCRIPTION_OR_PURCHASE,
        ):
            return False
        slugs = [canonical_plan_slug(item) for item in (collection.plan_slugs or []) if item]
        ranks = [PLAN_SLUG_TO_RANK.get(slug, 99) for slug in slugs]
        if not ranks:
            return False
        required = min(ranks)
        return SubscriptionAccessService.get_content_rank_for_user(user) >= required

    @classmethod
    def active_purchase_ids(cls, user, collection_ids: Iterable[int]) -> set[int]:
        ids = [int(pk) for pk in collection_ids if pk]
        if not ids or not LessonAccessService.is_authenticated(user):
            return set()
        from .models import CollectionPurchase

        now = timezone.now()
        return set(
            CollectionPurchase.objects.filter(
                user=user,
                collection_id__in=ids,
                status=CollectionPurchase.Status.PAID,
            )
            .filter(Q(valid_until__isnull=True) | Q(valid_until__gt=now))
            .values_list("collection_id", flat=True)
        )

    @classmethod
    def has_purchase(cls, user, collection) -> bool:
        if collection is None:
            return False
        return collection.pk in cls.active_purchase_ids(user, [collection.pk])

    @classmethod
    def has_entitlement(cls, user, collection, *, purchased_ids: set[int] | None = None) -> bool:
        from Generator.models import LessonCollection

        if collection is None or not LessonAccessService.is_authenticated(user):
            return False
        if LessonAccessService.is_staff(user):
            return True
        bought = (
            collection.pk in purchased_ids
            if purchased_ids is not None
            else cls.has_purchase(user, collection)
        )
        if bought and collection.status in cls._published_statuses():
            return True
        if collection.status != LessonCollection.Status.PUBLISHED:
            return False
        if collection.access_mode == LessonCollection.AccessMode.FREE:
            return not SubscriptionAccessService.is_student_user(user)
        return cls.subscription_covers(user, collection)

    @classmethod
    def _grants_for_field(cls, user, field: str, object_ids: Iterable[int]) -> dict[int, str]:
        ids = [int(pk) for pk in object_ids if pk]
        if not ids:
            return {}
        from Generator.models import LessonCollection, LessonCollectionItem

        items = list(
            LessonCollectionItem.objects.filter(**{f"{field}__in": ids})
            .filter(collection__status__in=cls._published_statuses())
            .select_related("collection")
        )
        if not items:
            return {}
        purchased = cls.active_purchase_ids(user, {row.collection_id for row in items})
        grouped: dict[int, list] = {}
        for row in items:
            grouped.setdefault(getattr(row, field), []).append(row)
        grants: dict[int, str] = {}
        for object_id, rows in grouped.items():
            full = False
            demo = False
            for row in rows:
                if cls.has_entitlement(user, row.collection, purchased_ids=purchased):
                    full = True
                    break
                if (
                    row.is_demo
                    and row.collection.status == LessonCollection.Status.PUBLISHED
                    and LessonAccessService.is_authenticated(user)
                ):
                    demo = True
            if full:
                grants[object_id] = "full"
            elif demo:
                grants[object_id] = "demo"
        return grants

    @classmethod
    def grants_for_lessons(cls, user, lesson_ids: Iterable[int]) -> dict[int, str]:
        """lesson_id -> 'full' | 'demo'."""
        return cls._grants_for_field(user, "lesson_id", lesson_ids)

    @classmethod
    def grants_for_interesting(cls, user, item_ids: Iterable[int]) -> dict[int, str]:
        return cls._grants_for_field(user, "interesting_item_id", item_ids)

    @classmethod
    def grants_for_materials(cls, user, material_ids: Iterable[int]) -> dict[int, str]:
        return cls._grants_for_field(user, "material_id", material_ids)

    @classmethod
    def grants_for_variants(cls, user, variant_ids: Iterable[int]) -> dict[int, str]:
        return cls._grants_for_field(user, "variant_id", variant_ids)

    @classmethod
    def grant_for_interesting(cls, user, item) -> str | None:
        if item is None:
            return None
        return cls.grants_for_interesting(user, [item.pk]).get(item.pk)

    @classmethod
    def grant_for_lesson(cls, user, lesson) -> str | None:
        if lesson is None:
            return None
        return cls.grants_for_lessons(user, [lesson.pk]).get(lesson.pk)

    @classmethod
    def grant_for_material(cls, user, material) -> str | None:
        if material is None:
            return None
        return cls.grants_for_materials(user, [material.pk]).get(material.pk)

    @classmethod
    def grant_for_variant(cls, user, variant) -> str | None:
        if variant is None:
            return None
        return cls.grants_for_variants(user, [variant.pk]).get(variant.pk)

    @classmethod
    def required_plan_slug(cls, collection) -> str:
        slugs = [canonical_plan_slug(item) for item in (getattr(collection, "plan_slugs", None) or [])]
        ranked = [(PLAN_SLUG_TO_RANK.get(slug, 99), slug) for slug in slugs if slug in PLAN_SLUG_TO_RANK]
        if not ranked:
            return "teacher"
        ranked.sort()
        return ranked[0][1]

    @classmethod
    def describe(cls, user, collection, *, purchased: bool | None = None) -> dict[str, Any]:
        from Generator.models import LessonCollection

        bought = purchased if purchased is not None else cls.has_purchase(user, collection)
        entitled = cls.has_entitlement(
            user,
            collection,
            purchased_ids={collection.pk} if bought else set(),
        )
        mode = collection.access_mode
        price = _money(collection.price) if cls.sells_separately(collection) else None
        compare = _money(collection.compare_at_price)
        plans = []
        for slug in collection.plan_slugs or []:
            canonical = canonical_plan_slug(slug)
            if canonical and canonical not in {row["slug"] for row in plans}:
                plans.append({"slug": canonical, "name": plan_label(canonical)})
        via = "none"
        if entitled and bought:
            via = "purchase"
        elif entitled and mode == LessonCollection.AccessMode.FREE:
            via = "free"
        elif entitled:
            via = "subscription"
        can_purchase = (
            LessonAccessService.is_authenticated(user)
            and not entitled
            and cls.sells_separately(collection)
            and collection.status == LessonCollection.Status.PUBLISHED
        )
        return {
            "mode": mode,
            "has_access": entitled,
            "via": via,
            "can_purchase": can_purchase,
            "price": price,
            "compare_at_price": compare if price is not None else None,
            "currency": collection.currency or "RUB",
            "price_label": LessonAccessService.format_price(price, collection.currency or "RUB") if price else "",
            "compare_at_label": (
                LessonAccessService.format_price(compare, collection.currency or "RUB")
                if price is not None and compare
                else ""
            ),
            "plans": plans,
            "required_plan": cls.required_plan_slug(collection) if plans else "",
            "required_plan_name": plan_label(cls.required_plan_slug(collection)) if plans else "",
            "valid_days": collection.purchase_valid_days,
        }


class LessonCollectionPurchaseService:
    @classmethod
    def create_checkout(cls, user, collection, *, idempotency_key: str | None = None) -> dict:
        from django.conf import settings as django_settings

        from Generator.models import LessonCollection
        from .models import Payment
        from .payment_service import get_payment_provider

        if collection.status != LessonCollection.Status.PUBLISHED:
            raise AccessDenied(
                code="COLLECTION_UNAVAILABLE",
                message="Этот набор сейчас нельзя купить.",
                feature="content",
                min_plan="teacher",
            )
        access = LessonCollectionAccess.describe(user, collection)
        if access["has_access"]:
            raise AccessDenied(
                code="ALREADY_OWNED",
                message="У вас уже есть доступ к этому набору.",
                feature="content",
                min_plan=access.get("required_plan") or "teacher",
            )
        if not access["can_purchase"]:
            raise AccessDenied(
                code="PURCHASE_UNAVAILABLE",
                message="Отдельная покупка этого набора недоступна.",
                feature="content",
                min_plan=access.get("required_plan") or "teacher",
            )

        provider_name = (getattr(django_settings, "PAYMENT_PROVIDER", None) or "mock").strip().lower()
        payments_on = bool(getattr(django_settings, "PAYMENTS_ENABLED", False))
        if not payments_on and provider_name != "mock":
            raise ValueError("Оплата временно недоступна. Попробуйте позже.")
        if provider_name == "mock" and not django_settings.DEBUG:
            raise ValueError("Mock payments are disabled in production")

        amount = Decimal(str(collection.price))
        currency = (collection.currency or "RUB").upper()
        key = (idempotency_key or "").strip() or f"col_{user.pk}_{collection.pk}_{timezone.now().strftime('%Y%m%d')}"
        existing = Payment.objects.filter(idempotency_key=key).first()
        if existing:
            return cls._payload(existing, collection, idempotent=True)

        from .tbank_payment import customer_key_for_teacher

        payment = Payment.objects.create(
            teacher=user,
            subscription=None,
            plan=None,
            purpose=Payment.Purpose.COLLECTION,
            amount=amount,
            discount_amount=Decimal("0"),
            final_amount=amount,
            currency=currency,
            status=Payment.Status.PENDING,
            provider=provider_name,
            provider_payment_id=f"mock_{uuid.uuid4().hex[:16]}" if provider_name == "mock" else "",
            customer_key=customer_key_for_teacher(user),
            idempotency_key=key,
            metadata={
                "purpose": "collection",
                "collection_id": collection.pk,
                "collection_slug": collection.slug,
                "collection_title": (collection.title or "")[:120],
            },
        )
        provider = get_payment_provider(provider_name)
        try:
            payment_url = provider.create_checkout(payment, None)
        except Exception:
            payment.status = Payment.Status.FAILED
            payment.save(update_fields=["status", "updated_at"])
            raise
        if payment_url:
            meta = dict(payment.metadata or {})
            meta["payment_url"] = payment_url
            payment.metadata = meta
            payment.save(update_fields=["metadata", "updated_at"])
        _record(COLLECTION_PURCHASE_STARTED, user, collection)
        return cls._payload(payment, collection, payment_url=payment_url)

    @staticmethod
    def _payload(payment, collection, *, idempotent: bool = False, payment_url: str = "") -> dict:
        meta = payment.metadata if isinstance(payment.metadata, dict) else {}
        return {
            "payment_id": payment.pk,
            "provider_payment_id": payment.provider_payment_id,
            "provider": payment.provider,
            "status": payment.status,
            "payment_url": payment_url or str(meta.get("payment_url") or ""),
            "amount": str(payment.final_amount or payment.amount),
            "currency": payment.currency,
            "collection_id": collection.pk,
            "collection_slug": collection.slug,
            "idempotent": idempotent,
        }

    @classmethod
    def fulfill_payment(cls, payment):
        from Generator.models import LessonCollection
        from .models import CollectionPurchase, Payment

        if not is_collection_payment(payment):
            return None
        if payment.status != Payment.Status.PAID:
            return None
        meta = payment.metadata if isinstance(payment.metadata, dict) else {}
        collection_id = meta.get("collection_id")
        collection = LessonCollection.objects.filter(pk=collection_id).first() if collection_id else None
        if collection is None:
            logger.error("collection_payment_missing payment_id=%s", payment.pk)
            return None
        valid_until = None
        days = collection.purchase_valid_days
        now = timezone.now()
        if days:
            valid_until = (payment.paid_at or now) + timedelta(days=int(days))
        with transaction.atomic():
            existing = CollectionPurchase.objects.filter(payment=payment).first()
            if existing and existing.status == CollectionPurchase.Status.PAID:
                return existing
            paid = (
                CollectionPurchase.objects.select_for_update()
                .filter(
                    user=payment.teacher,
                    collection=collection,
                    status=CollectionPurchase.Status.PAID,
                )
                .first()
            )
            if paid:
                if paid.payment_id is None:
                    paid.payment = payment
                    paid.save(update_fields=["payment", "updated_at"])
                return paid
            purchase, created = CollectionPurchase.objects.get_or_create(
                payment=payment,
                defaults={
                    "user": payment.teacher,
                    "collection": collection,
                    "source": CollectionPurchase.Source.PAYMENT,
                    "amount": payment.final_amount or payment.amount,
                    "currency": payment.currency or "RUB",
                    "status": CollectionPurchase.Status.PAID,
                    "purchased_at": payment.paid_at or now,
                    "valid_until": valid_until,
                },
            )
            if not created and purchase.status != CollectionPurchase.Status.PAID:
                purchase.status = CollectionPurchase.Status.PAID
                purchase.purchased_at = payment.paid_at or now
                purchase.amount = payment.final_amount or payment.amount
                purchase.valid_until = valid_until
                purchase.save(
                    update_fields=["status", "purchased_at", "amount", "valid_until", "updated_at"]
                )
        _record(COLLECTION_PURCHASED, payment.teacher, collection)
        return purchase
