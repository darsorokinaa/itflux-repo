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


def _set_teacher_role(user):
    profile = user.profile
    profile.role = Profile.Role.TEACHER
    profile.save(update_fields=["role"])


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
        promo_patcher = mock.patch(
            "Cabinet.registration_promo.ensure_registration_promo",
            return_value=None,
        )
        promo_patcher.start()
        self.addCleanup(promo_patcher.stop)
        self.user = User.objects.create_user("teacher1", "t1@example.com", "pass")
        _set_teacher_role(self.user)
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

    def test_higher_plans_include_lower_tier_content(self):
        other = User.objects.create_user("other_ladder", "ol@example.com", "pass")
        levels = [
            (ContentAccessLevel.FREE, 0),
            (ContentAccessLevel.TEACHER, 1),
            (ContentAccessLevel.PROFESSIONAL, 2),
            (ContentAccessLevel.PREMIUM, 3),
            (ContentAccessLevel.CORPORATE, 4),
        ]
        materials = {
            level: Material.objects.create(
                title=f"{level} material",
                teacher=other,
                access_level=level,
                is_public=True,
            )
            for level, _rank in levels
        }
        sub = self.user.subscription
        for plan_slug, plan_rank in (
            ("start", 0),
            ("teacher", 1),
            ("pro", 2),
            ("premium", 3),
            ("school", 4),
        ):
            sub.plan = self.plans[plan_slug]
            sub.save(update_fields=["plan"])
            for level, required in levels:
                allowed = SubscriptionAccessService.can_access_content(
                    self.user, materials[level]
                )
                self.assertEqual(
                    allowed,
                    plan_rank >= required,
                    msg=f"{plan_slug} vs {level}: expected {plan_rank >= required}",
                )

    def test_plan_slug_rank_floor_when_db_rank_too_low(self):
        premium = self.plans["premium"]
        premium.content_access_rank = 0
        premium.save(update_fields=["content_access_rank"])
        other = User.objects.create_user("other_floor", "of@example.com", "pass")
        material = Material.objects.create(
            title="Teacher material",
            teacher=other,
            access_level=ContentAccessLevel.TEACHER,
            is_public=True,
        )
        sub = self.user.subscription
        sub.plan = premium
        sub.save(update_fields=["plan"])
        self.assertEqual(SubscriptionAccessService.get_content_rank_for_user(self.user), 3)
        self.assertTrue(SubscriptionAccessService.can_access_content(self.user, material))

    def test_owner_bypasses_content_gate(self):
        material = Material.objects.create(
            title="Own premium",
            teacher=self.user,
            access_level=ContentAccessLevel.PREMIUM,
        )
        self.assertTrue(SubscriptionAccessService.can_access_content(self.user, material))

    def test_student_does_not_bypass_catalog_material_gate(self):
        student_user = User.objects.create_user("stu1", "s1@example.com", "pass")
        student_user.profile.role = Profile.Role.STUDENT
        student_user.profile.save(update_fields=["role"])
        other = User.objects.create_user("other_prem", "op@example.com", "pass")
        material = Material.objects.create(
            title="Premium catalog",
            teacher=other,
            access_level=ContentAccessLevel.PREMIUM,
            is_public=True,
        )
        self.assertFalse(SubscriptionAccessService.can_access_content(student_user, material))
        gate = SubscriptionAccessService.serialize_access_gate(student_user, material)
        self.assertFalse(gate["allowed"])
        with self.assertRaises(AccessDenied):
            SubscriptionAccessService.raise_if_cannot_access_content(student_user, material)
        self.assertFalse(SubscriptionAccessService.can_access_content(self.user, material))
        self.assertFalse(SubscriptionAccessService.can_access_content(None, material))

    def test_anonymous_variant_limit(self):
        request = self.factory.post("/")
        request.user = mock.Mock(is_authenticated=False)
        request.COOKIES = {}
        request.session = mock.Mock(session_key="")
        for _ in range(5):
            SubscriptionAccessService.enforce_variant_creation(request)
        with self.assertRaises(AccessDenied):
            SubscriptionAccessService.enforce_variant_creation(request)

    def test_anonymous_workbook_limit_returns_register_payload(self):
        client = Client()
        for _ in range(3):
            res = client.post(
                "/api/cabinet/usage/workbook/",
                {},
                content_type="application/json",
            )
            self.assertEqual(res.status_code, 201, res.content)
        res = client.post(
            "/api/cabinet/usage/workbook/",
            {},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 403)
        data = res.json()
        self.assertEqual(data["code"], "ANON_WORKBOOK_LIMIT_REACHED")
        self.assertTrue(data["upgrade_required"])
        self.assertIn("Зарегистрируйтесь", data["message"])

    def test_lesson_catalog_hides_locked_file_urls(self):
        from django.contrib.auth.models import AnonymousUser

        from Generator.models import Lesson
        from Generator.serializers import LessonCatalogSerializer

        lesson = Lesson.objects.create(
            title="Закрытый урок",
            slug="closed-lesson-access-gate",
            subject="Информатика",
            access_level="premium",
            status=Lesson.Status.PUBLISHED,
        )
        request = self.factory.get("/")
        request.user = AnonymousUser()
        data = LessonCatalogSerializer(lesson, context={"request": request}).data
        self.assertFalse(data["access"]["allowed"])
        self.assertEqual(data["access"]["min_plan"], "premium")
        self.assertIsNone(data["file_url"])
        self.assertIsNone(data["archive_url"])

    def test_public_pricing_endpoint(self):
        client = Client()
        res = client.get("/api/cabinet/pricing/plans/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(any(p["slug"] == "premium" for p in data["plans"]))
        for plan in data["plans"]:
            self.assertNotIn("ai_requests", plan.get("limits", {}))
            self.assertIn("storage_mb", plan.get("limits", {}))
            self.assertIn("interactives", plan.get("limits", {}))
            self.assertIn("teacher_tasks", plan.get("limits", {}))
            self.assertIn("teacher_task_copies_monthly", plan.get("limits", {}))
            self.assertIn("teacher_task_attachments", plan.get("features", {}))
        self.assertIn("anonymous", data)

    def test_cabinet_plans_include_ai_and_storage(self):
        client = Client()
        client.force_login(self.user)
        res = client.get("/api/cabinet/subscription/plans/")
        self.assertEqual(res.status_code, 200)
        for plan in res.json()["plans"]:
            limits = plan.get("limits", {})
            self.assertIn("storage_mb", limits)
            self.assertIn("ai_requests", limits)


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
        promo_patcher = mock.patch(
            "Cabinet.registration_promo.ensure_registration_promo",
            return_value=None,
        )
        promo_patcher.start()
        self.addCleanup(promo_patcher.stop)
        self.user = User.objects.create_user("exp1", "exp1@example.com", "pass")
        _set_teacher_role(self.user)
        TeacherSubscription.objects.update_or_create(
            teacher=self.user,
            defaults={
                "plan": self.plans["premium"],
                "status": TeacherSubscription.Status.ACTIVE,
                "source": TeacherSubscription.Source.PAYMENT,
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

    def test_admin_assigned_pro_stays_pro_even_if_expires_at_is_past(self):
        from Cabinet.subscription_service import SubscriptionLimitService

        sub = self.user.subscription
        sub.plan = self.plans["pro"]
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.source = TeacherSubscription.Source.SELF
        sub.auto_renew = False
        sub.tbank_rebill_id = ""
        sub.expires_at = timezone.now() - timedelta(days=1)
        sub.save(update_fields=["plan", "status", "source", "auto_renew", "tbank_rebill_id", "expires_at"])
        plan = SubscriptionLimitService.get_current_plan(self.user)
        self.assertEqual(plan.slug, "pro")
        sub.refresh_from_db()
        self.assertEqual(sub.plan.slug, "pro")
        self.assertEqual(sub.status, TeacherSubscription.Status.ACTIVE)
        self.assertTrue(sub.is_valid())
        self.assertTrue(SubscriptionAccessService.can_use_schedule(self.user))


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
