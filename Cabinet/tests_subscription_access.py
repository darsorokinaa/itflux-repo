"""Тесты тарифов, доступа и mock-платежей."""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.test import Client, RequestFactory, TestCase, override_settings
from django.utils import timezone

from Cabinet.models import (
    AnonymousUsage,
    Material,
    Payment,
    Profile,
    TariffPlan,
    TeacherSubscription,
)
from Cabinet.choices import ContentAccessLevel
from Cabinet.payment_service import PaymentProviderService
from Cabinet.subscription_access import AccessDenied, SubscriptionAccessService


def _ensure_plans():
    plans = {}
    specs = [
        ("start", "Старт", 0, 0, True, "register"),
        ("teacher", "Учитель", 1990, 1, False, "checkout"),
        ("pro", "Профи", 2990, 2, False, "checkout"),
        ("premium", "Премиум", 3990, 3, False, "checkout"),
        ("school", "Школа", 0, 4, False, "contact"),
    ]
    for i, (slug, name, price, rank, is_free, cta) in enumerate(specs):
        plans[slug], _ = TariffPlan.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "price_month": Decimal(price),
                "price_year": Decimal(price * 10),
                "content_access_rank": rank,
                "is_free": is_free,
                "cta_type": cta,
                "is_active": True,
                "is_public": True,
                "max_students": 5 if slug == "start" else 10,
                "max_variants_monthly": 2 if slug == "start" else None,
                "max_workbooks_monthly": 1 if slug == "start" else None,
                "sort_order": i,
            },
        )
    return plans


class SubscriptionAccessTests(TestCase):
    def setUp(self):
        self.plans = _ensure_plans()
        self.factory = RequestFactory()
        self.user = User.objects.create_user("teacher1", "t1@example.com", "pass")
        Profile.objects.get_or_create(
            user=self.user,
            defaults={"role": Profile.Role.TEACHER},
        )
        TeacherSubscription.objects.update_or_create(
            teacher=self.user,
            defaults={
                "plan": self.plans["start"],
                "status": TeacherSubscription.Status.ACTIVE,
            },
        )

    def test_content_access_by_rank(self):
        other = User.objects.create_user("other_t", "o@example.com", "pass")
        material = Material.objects.create(
            title="Pro material",
            teacher=other,
            access_level=ContentAccessLevel.PROFESSIONAL,
        )
        self.assertFalse(SubscriptionAccessService.can_access_content(self.user, material))
        sub = self.user.subscription
        sub.plan = self.plans["pro"]
        sub.save(update_fields=["plan"])
        self.assertTrue(SubscriptionAccessService.can_access_content(self.user, material))

    def test_owner_bypasses_content_gate(self):
        material = Material.objects.create(
            title="Own premium",
            teacher=self.user,
            access_level=ContentAccessLevel.PREMIUM,
        )
        self.assertTrue(SubscriptionAccessService.can_access_content(self.user, material))

    def test_anonymous_variant_limit(self):
        request = self.factory.post("/")
        request.user = mock.Mock(is_authenticated=False)
        request.COOKIES = {}
        request.session = mock.Mock(session_key="")
        for _ in range(5):
            SubscriptionAccessService.enforce_variant_creation(request)
        with self.assertRaises(AccessDenied):
            SubscriptionAccessService.enforce_variant_creation(request)

    def test_public_pricing_endpoint(self):
        client = Client()
        res = client.get("/api/cabinet/pricing/plans/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(any(p["slug"] == "premium" for p in data["plans"]))
        for plan in data["plans"]:
            self.assertNotIn("ai_requests", plan.get("limits", {}))
        self.assertIn("anonymous", data)


@override_settings(DEBUG=True, PAYMENT_PROVIDER="mock")
class PaymentActivationTests(TestCase):
    def setUp(self):
        self.plans = _ensure_plans()
        self.user = User.objects.create_user("payer", "p@example.com", "pass")
        Profile.objects.get_or_create(
            user=self.user,
            defaults={"role": Profile.Role.TEACHER},
        )
        TeacherSubscription.objects.create(
            teacher=self.user,
            plan=self.plans["start"],
            status=TeacherSubscription.Status.ACTIVE,
        )

    def test_webhook_assigns_paid_plan(self):
        result = PaymentProviderService.create_payment(
            teacher=self.user,
            plan=self.plans["teacher"],
            billing_period="month",
        )
        payment_id = result["payment_id"]
        PaymentProviderService.handle_webhook(
            {"payment_id": payment_id, "status": "paid", "event_id": "evt-1"}
        )
        sub = TeacherSubscription.objects.get(teacher=self.user)
        self.assertEqual(sub.plan.slug, "teacher")
        self.assertEqual(sub.status, TeacherSubscription.Status.ACTIVE)
        self.assertEqual(sub.source, TeacherSubscription.Source.PAYMENT)
        self.assertIsNotNone(sub.expires_at)

    def test_webhook_idempotent(self):
        result = PaymentProviderService.create_payment(
            teacher=self.user,
            plan=self.plans["pro"],
            billing_period="month",
            idempotency_key="idem-test-1",
        )
        pid = result["payment_id"]
        PaymentProviderService.handle_webhook(
            {"payment_id": pid, "status": "paid", "event_id": "evt-dup"}
        )
        again = PaymentProviderService.handle_webhook(
            {"payment_id": pid, "status": "paid", "event_id": "evt-dup"}
        )
        self.assertTrue(again.get("duplicate"))
        self.assertEqual(Payment.objects.filter(pk=pid, status=Payment.Status.PAID).count(), 1)


class RemapTariffTests(TestCase):
    def test_seed_has_teacher_not_active_repetitor(self):
        _ensure_plans()
        self.assertTrue(TariffPlan.objects.filter(slug="teacher", is_active=True).exists())
        legacy = TariffPlan.objects.filter(slug="repetitor").first()
        if legacy:
            self.assertFalse(legacy.is_active)


class ExpiredPlanAccessTests(TestCase):
    def setUp(self):
        self.plans = _ensure_plans()
        self.user = User.objects.create_user("exp1", "exp1@example.com", "pass")
        Profile.objects.get_or_create(user=self.user, defaults={"role": Profile.Role.TEACHER})
        TeacherSubscription.objects.update_or_create(
            teacher=self.user,
            defaults={
                "plan": self.plans["premium"],
                "status": TeacherSubscription.Status.ACTIVE,
                "expires_at": timezone.now() - timedelta(days=1),
            },
        )

    def test_expired_plan_falls_back_to_start(self):
        from Cabinet.subscription_service import SubscriptionLimitService

        plan = SubscriptionLimitService.get_current_plan(self.user)
        self.assertEqual(plan.slug, "start")
        other = User.objects.create_user("own2", "own2@example.com", "pass")
        material = Material.objects.create(
            title="Prem",
            teacher=other,
            access_level=ContentAccessLevel.PREMIUM,
            is_public=True,
        )
        self.assertFalse(SubscriptionAccessService.can_access_content(self.user, material))


@override_settings(DEBUG=True, PAYMENT_PROVIDER="mock")
class PromoReserveTests(TestCase):
    def setUp(self):
        from Cabinet.models import PromoCode

        self.plans = _ensure_plans()
        self.user = User.objects.create_user("promo1", "promo1@example.com", "pass")
        Profile.objects.get_or_create(user=self.user, defaults={"role": Profile.Role.TEACHER})
        TeacherSubscription.objects.create(
            teacher=self.user,
            plan=self.plans["start"],
            status=TeacherSubscription.Status.ACTIVE,
        )
        self.promo = PromoCode.objects.create(
            code="SAVE50",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("50"),
            max_uses=10,
            max_uses_per_user=1,
        )

    def test_promo_reserved_until_paid(self):
        from Cabinet.models import PromoCodeUsage

        result = PaymentProviderService.create_payment(
            teacher=self.user,
            plan=self.plans["teacher"],
            billing_period="month",
            promo_code="SAVE50",
            discount_info={
                "original_amount": "1990",
                "discount": "995",
                "final_amount": "995",
            },
        )
        usage = PromoCodeUsage.objects.get(teacher=self.user, promo_code=self.promo)
        self.assertEqual(usage.status, PromoCodeUsage.Status.RESERVED)
        self.promo.refresh_from_db()
        self.assertEqual(self.promo.uses_count, 0)

        PaymentProviderService.handle_webhook(
            {
                "payment_id": result["payment_id"],
                "status": "paid",
                "event_id": "promo-paid-1",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        usage.refresh_from_db()
        self.promo.refresh_from_db()
        self.assertEqual(usage.status, PromoCodeUsage.Status.APPLIED)
        self.assertEqual(self.promo.uses_count, 1)


@override_settings(DEBUG=False, PAYMENT_PROVIDER="mock")
class MockDisabledInProductionTests(TestCase):
    def test_mock_webhook_rejected(self):
        result = PaymentProviderService.handle_webhook(
            {"payment_id": 1, "status": "paid", "event_id": "x"},
            provider_name="mock",
        )
        self.assertFalse(result.get("ok"))
        self.assertEqual(result.get("error"), "mock_disabled")
