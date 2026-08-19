"""Готовый урок Generator.Lesson: entitlement, demo 40 мин, покупка. Не Cabinet.Material."""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from Cabinet.choices import ContentAccessLevel, MaterialStatus
from Cabinet.lesson_access import (
    ACCESS_DEMO,
    ACCESS_FREE_START,
    ACCESS_LOCKED,
    ACCESS_PURCHASED,
    ACCESS_SUBSCRIPTION,
    DEFAULT_DEMO_MINUTES,
    LessonAccessService,
    LessonPurchaseService,
)
from Cabinet.models import (
    DirectMaterialAssignment,
    LessonDemoAccess,
    LessonPurchase,
    Material,
    Profile,
    Student,
    TariffPlan,
    TeacherSubscription,
)
from Cabinet.payment_service import PaymentProviderService
from Cabinet.subscription_access import AccessDenied, SubscriptionAccessService
from Generator.models import Lesson


def _set_teacher(user):
    profile = user.profile
    profile.role = Profile.Role.TEACHER
    profile.save(update_fields=["role"])
    return user


def _ensure_plans():
    plans = {}
    specs = [
        ("start", "Старт", 0, 0, True),
        ("teacher", "Учитель", 1990, 1, False),
        ("pro", "Профи", 2990, 2, False),
        ("premium", "Премиум", 3990, 3, False),
    ]
    for i, (slug, name, price, rank, is_free) in enumerate(specs):
        plans[slug], _ = TariffPlan.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "price_month": Decimal(price),
                "price_year": Decimal(price * 10),
                "content_access_rank": rank,
                "is_free": is_free,
                "is_active": True,
                "is_public": True,
                "sort_order": i,
            },
        )
    return plans


class LessonAccessBase(TestCase):
    def setUp(self):
        self.plans = _ensure_plans()
        promo = mock.patch("Cabinet.registration_promo.ensure_registration_promo", return_value=None)
        promo.start()
        self.addCleanup(promo.stop)
        self.user = _set_teacher(User.objects.create_user("teacher_l", "tl@example.com", "pass"))
        TeacherSubscription.objects.update_or_create(
            teacher=self.user,
            defaults={"plan": self.plans["start"], "status": TeacherSubscription.Status.ACTIVE},
        )
        self.free = Lesson.objects.create(
            title="Бесплатный готовый урок",
            slug="free-ready-lesson",
            subject="Математика",
            access_level=Lesson.AccessLevel.FREE,
            status=Lesson.Status.PUBLISHED,
            short_description="Публичное описание",
            teacher_goal="Научиться решать",
        )
        self.paid = Lesson.objects.create(
            title="Премиум готовый урок",
            slug="paid-ready-lesson",
            subject="Информатика",
            access_level=Lesson.AccessLevel.PREMIUM,
            status=Lesson.Status.PUBLISHED,
            standalone_purchase_enabled=True,
            standalone_price=Decimal("790"),
            demo_enabled=True,
            demo_duration_minutes=90,
            short_description="Платный урок",
            teacher_goal="Оценить качество",
        )
        self.paid.file.save("paid.bin", ContentFile(b"paid-original-secret"), save=True)
        self.client = Client()

    def _login(self, user=None):
        self.client.force_login(user or self.user)
        return self.client

    def _set_plan(self, slug):
        sub = self.user.subscription
        sub.plan = self.plans[slug]
        sub.status = TeacherSubscription.Status.ACTIVE
        sub.expires_at = None
        sub.save(update_fields=["plan", "status", "expires_at"])


class LessonAccessPolicyTests(LessonAccessBase):
    def test_access_service_uses_generator_lesson(self):
        access = LessonAccessService.get_access(self.user, self.paid)
        self.assertEqual(access.access_type, ACCESS_LOCKED)
        self.assertTrue(access.demo_available)

    def test_cabinet_material_is_not_a_purchasable_ready_lesson(self):
        material = Material.objects.create(
            title="Файл учителя",
            teacher=self.user,
            is_public=True,
            status=MaterialStatus.PUBLISHED,
            access_level=ContentAccessLevel.FREE,
        )
        self.assertIs(LessonPurchase._meta.get_field("lesson").related_model, Lesson)
        self.assertEqual(LessonPurchase.objects.count(), 0)
        self.assertTrue(SubscriptionAccessService.can_access_content(self.user, material))

    def test_anonymous_free_lesson_denied_with_registration(self):
        access = LessonAccessService.get_access(None, self.free)
        self.assertEqual(access.access_type, ACCESS_LOCKED)
        self.assertFalse(access.can_view)
        self.assertEqual(access.reason_code, "REGISTRATION_REQUIRED")
        res = self.client.get(f"/api/lessons/{self.free.slug}/")
        self.assertEqual(res.status_code, 200)
        data = res.json()["lesson"]
        self.assertFalse(data["access"]["can_view"])
        self.assertEqual(data["short_description"], self.free.short_description)
        self.assertFalse(data.get("file_url"))

    def test_start_user_gets_full_free_lesson(self):
        access = LessonAccessService.get_access(self.user, self.free)
        self.assertEqual(access.access_type, ACCESS_FREE_START)
        self.assertTrue(access.is_full)

    def test_anonymous_paid_no_full_access(self):
        access = LessonAccessService.get_access(None, self.paid)
        self.assertFalse(access.can_view)
        self.assertFalse(access.demo_available)

    def test_anonymous_demo_requires_registration(self):
        res = self.client.post(
            f"/api/lessons/{self.paid.slug}/demo/",
            data='{"terms_accepted": true}',
            content_type="application/json",
        )
        self.assertIn(res.status_code, (401, 403))
        self.assertFalse(LessonDemoAccess.objects.exists())

    def test_warning_without_terms_does_not_create_demo(self):
        self._login()
        res = self.client.post(
            f"/api/lessons/{self.paid.slug}/demo/",
            data='{"terms_accepted": false}',
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(LessonDemoAccess.objects.count(), 0)

    def test_demo_is_exactly_40_minutes_on_lesson(self):
        self.assertEqual(DEFAULT_DEMO_MINUTES, 40)
        demo = LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        self.assertEqual(demo.expires_at - demo.opened_at, timedelta(minutes=40))
        self.assertEqual(demo.lesson_id, self.paid.pk)
        self.assertIsNotNone(demo.terms_accepted_at)

    def test_demo_active_at_39_denied_after_40(self):
        demo = LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        still_open = demo.opened_at + timedelta(minutes=39)
        with mock.patch("django.utils.timezone.now", return_value=still_open):
            self.assertTrue(LessonDemoAccess.objects.get(pk=demo.pk).is_session_active())
            self.assertEqual(LessonAccessService.get_access(self.user, self.paid).access_type, ACCESS_DEMO)
        expired = demo.opened_at + timedelta(minutes=40, seconds=1)
        with mock.patch("django.utils.timezone.now", return_value=expired):
            self.assertFalse(LessonDemoAccess.objects.get(pk=demo.pk).is_session_active())
            access = LessonAccessService.get_access(self.user, self.paid)
            self.assertFalse(access.can_view)
            with self.assertRaises(AccessDenied) as ctx:
                LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
            self.assertEqual(ctx.exception.code, "DEMO_ALREADY_USED")

    def test_demo_does_not_give_original_file(self):
        LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        self._login()
        res = self.client.get(f"/api/lessons/{self.paid.slug}/view/")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn(b"paid-original-secret", res.content)

    def test_unique_demo_per_user_lesson(self):
        LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        from django.db import IntegrityError, transaction

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                LessonDemoAccess.objects.create(
                    user=self.user,
                    lesson=self.paid,
                    opened_at=timezone.now(),
                    expires_at=timezone.now() + timedelta(minutes=10),
                )

    def test_other_user_cannot_use_demo(self):
        LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        other = _set_teacher(User.objects.create_user("other_l", "ol@example.com", "pass"))
        TeacherSubscription.objects.update_or_create(
            teacher=other,
            defaults={"plan": self.plans["start"], "status": TeacherSubscription.Status.ACTIVE},
        )
        self._login(other)
        res = self.client.get(f"/api/lessons/{self.paid.slug}/view/")
        self.assertEqual(res.status_code, 403)

    def test_premium_full_hides_purchase(self):
        self._set_plan("premium")
        access = LessonAccessService.get_access(self.user, self.paid)
        self.assertEqual(access.access_type, ACCESS_SUBSCRIPTION)
        self.assertFalse(access.can_purchase)

    def test_upgrade_cta(self):
        access = LessonAccessService.get_access(self.user, self.paid)
        upgrade = next(c for c in access.cta if c["type"] == "upgrade")
        self.assertIn("Премиум", upgrade["label"])


class LessonPurchaseTests(LessonAccessBase):
    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock", PAYMENTS_ENABLED=True)
    def test_buy_gives_full_access_to_generator_lesson(self):
        result = LessonPurchaseService.create_checkout(self.user, self.paid, idempotency_key="les-buy-1")
        from Cabinet.models import Payment

        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.purpose, Payment.Purpose.LESSON)
        self.assertEqual(payment.metadata.get("lesson_id"), self.paid.pk)
        PaymentProviderService.handle_webhook(
            {"payment_id": payment.pk, "status": "paid", "event_id": f"evt-{payment.pk}"},
            provider_name="mock",
        )
        access = LessonAccessService.get_access(self.user, self.paid)
        self.assertEqual(access.access_type, ACCESS_PURCHASED)
        self.assertEqual(LessonPurchase.objects.filter(user=self.user, lesson=self.paid, status="paid").count(), 1)
        self.assertFalse(hasattr(Material, "standalone_purchase_enabled"))

    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock", PAYMENTS_ENABLED=True)
    def test_webhook_replay_one_purchase(self):
        result = LessonPurchaseService.create_checkout(self.user, self.paid, idempotency_key="les-idem")
        from Cabinet.models import Payment

        payment = Payment.objects.get(pk=result["payment_id"])
        payload = {"payment_id": payment.pk, "status": "paid", "event_id": "same-les"}
        PaymentProviderService.handle_webhook(payload, provider_name="mock")
        PaymentProviderService.handle_webhook(payload, provider_name="mock")
        self.assertEqual(LessonPurchase.objects.filter(user=self.user, lesson=self.paid, status="paid").count(), 1)

    def test_pending_is_not_full(self):
        LessonPurchase.objects.create(
            user=self.user,
            lesson=self.paid,
            amount=Decimal("790"),
            status=LessonPurchase.Status.PENDING,
        )
        self.assertEqual(LessonAccessService.get_access(self.user, self.paid).access_type, ACCESS_LOCKED)

    def test_purchase_survives_expired_subscription(self):
        LessonPurchase.objects.create(
            user=self.user,
            lesson=self.paid,
            amount=Decimal("790"),
            status=LessonPurchase.Status.PAID,
            purchased_at=timezone.now(),
        )
        sub = self.user.subscription
        sub.status = TeacherSubscription.Status.EXPIRED
        sub.plan = self.plans["start"]
        sub.expires_at = timezone.now() - timedelta(days=1)
        sub.save(update_fields=["status", "plan", "expires_at"])
        access = LessonAccessService.get_access(self.user, self.paid)
        self.assertEqual(access.access_type, ACCESS_PURCHASED)

    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock", PAYMENTS_ENABLED=True)
    def test_payment_metadata_does_not_use_material_id(self):
        result = LessonPurchaseService.create_checkout(self.user, self.paid, idempotency_key="les-meta")
        from Cabinet.models import Payment

        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertNotIn("material_id", payment.metadata)
        self.assertEqual(payment.metadata.get("lesson_id"), self.paid.pk)


class CabinetMaterialStillWorksTests(LessonAccessBase):
    def test_teacher_can_create_cabinet_material(self):
        material = Material.objects.create(
            title="Конспект к занятию",
            teacher=self.user,
            status=MaterialStatus.PUBLISHED,
        )
        self.assertEqual(material.teacher_id, self.user.pk)
        self.assertTrue(SubscriptionAccessService.can_access_content(self.user, material))
        self.assertFalse(hasattr(material, "standalone_purchase_enabled"))
        self.assertFalse(hasattr(material, "demo_enabled"))

    def test_direct_material_assignment_still_works(self):
        material = Material.objects.create(
            title="Раздатка",
            teacher=self.user,
            status=MaterialStatus.PUBLISHED,
        )
        student = Student.objects.create(teacher=self.user, first_name="Иван")
        assignment = DirectMaterialAssignment.objects.create(
            teacher=self.user,
            material=material,
            student=student,
        )
        self.assertEqual(assignment.material_id, material.pk)
        self.assertEqual(assignment.student_id, student.pk)

    def test_material_shop_endpoints_are_gone(self):
        material = Material.objects.create(
            title="Файл учителя",
            teacher=self.user,
            status=MaterialStatus.PUBLISHED,
        )
        self._login()
        self.assertEqual(self.client.post(f"/api/cabinet/materials/{material.pk}/demo/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/cabinet/materials/{material.pk}/purchase/").status_code, 404)
        self.assertEqual(self.client.get("/api/cabinet/materials/purchases/").status_code, 404)

    def test_material_id_does_not_open_purchased_lesson(self):
        LessonPurchase.objects.create(
            user=self.user,
            lesson=self.paid,
            amount=Decimal("790"),
            status=LessonPurchase.Status.PAID,
            purchased_at=timezone.now(),
        )
        material = Material.objects.create(
            title="Подмена",
            teacher=self.user,
            status=MaterialStatus.PUBLISHED,
            is_public=True,
        )
        self._login()
        res = self.client.get(f"/api/cabinet/materials/{material.pk}/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertNotEqual(data.get("title"), self.paid.title)
        self.assertFalse(data.get("access", {}).get("access_type") == ACCESS_PURCHASED)
        view = self.client.get(f"/api/lessons/{self.paid.slug}/view/")
        self.assertEqual(view.status_code, 200)


class LessonShopIsolationTests(LessonAccessBase):
    def test_lesson_purchase_fk_is_generator_lesson(self):
        self.assertIs(LessonPurchase._meta.get_field("lesson").related_model, Lesson)
        self.assertIs(LessonDemoAccess._meta.get_field("lesson").related_model, Lesson)

    def test_reuse_forbidden_in_demo(self):
        LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        with self.assertRaises(AccessDenied):
            LessonAccessService.raise_if_cannot_reuse(self.user, self.paid)


class LessonFileProtectionTests(LessonAccessBase):
    def setUp(self):
        super().setUp()
        self.paid.file.save(
            "index.html",
            ContentFile(
                b'<!DOCTYPE html><html><head></head><body><link rel="stylesheet" href="style.css"/>secret</body></html>'
            ),
            save=True,
        )
        file_dir = self.paid.file.name.rsplit("/", 1)[0]
        self.paid.file.storage.save(f"{file_dir}/style.css", ContentFile(b"body{color:red}"))

    def test_direct_media_lesson_file_forbidden(self):
        res = self.client.get(self.paid.file.url)
        self.assertEqual(res.status_code, 403)

    def test_anonymous_cannot_fetch_protected_asset(self):
        res = self.client.get(f"/api/lessons/{self.paid.slug}/assets/style.css")
        self.assertEqual(res.status_code, 403)

    def test_demo_user_can_fetch_protected_asset(self):
        LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        self._login()
        res = self.client.get(f"/api/lessons/{self.paid.slug}/assets/style.css")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"color:red", res.content)

    def test_asset_path_traversal_denied(self):
        LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        self._login()
        res = self.client.get(f"/api/lessons/{self.paid.slug}/assets/../index.html")
        self.assertIn(res.status_code, (403, 404))

    def test_other_lesson_asset_idor_denied(self):
        other = Lesson.objects.create(
            title="Другой урок",
            slug="other-paid-lesson",
            subject="Физика",
            access_level=Lesson.AccessLevel.PREMIUM,
            status=Lesson.Status.PUBLISHED,
            demo_enabled=True,
        )
        other.file.save("index.html", ContentFile(b"<html></html>"), save=True)
        other_dir = other.file.name.rsplit("/", 1)[0]
        other.file.storage.save(f"{other_dir}/secret.css", ContentFile(b"other-secret"))
        LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        self._login()
        res = self.client.get(f"/api/lessons/{other.slug}/assets/secret.css")
        self.assertEqual(res.status_code, 403)


class LessonDemoConcurrencyTests(LessonAccessBase):
    def test_double_demo_start_returns_same_session(self):
        first = LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        second = LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(LessonDemoAccess.objects.filter(user=self.user, lesson=self.paid).count(), 1)

    def test_demo_reopen_within_window_same_session(self):
        demo = LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        again = LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        self.assertEqual(demo.pk, again.pk)


class LessonPurchaseApiTests(LessonAccessBase):
    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock", PAYMENTS_ENABLED=True)
    def test_purchase_endpoint_blocks_already_owned(self):
        LessonPurchase.objects.create(
            user=self.user,
            lesson=self.paid,
            amount=Decimal("790"),
            status=LessonPurchase.Status.PAID,
            purchased_at=timezone.now(),
        )
        self._login()
        res = self.client.post(
            f"/api/lessons/{self.paid.slug}/purchase/",
            data='{"idempotency_key":"owned-once"}',
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json().get("code"), "ALREADY_OWNED")

    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock", PAYMENTS_ENABLED=True)
    def test_purchase_endpoint_creates_checkout(self):
        self._login()
        res = self.client.post(
            f"/api/lessons/{self.paid.slug}/purchase/",
            data='{"idempotency_key":"checkout-once"}',
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 201)
        data = res.json()
        self.assertEqual(data.get("lesson_id"), self.paid.pk)
        self.assertTrue(data.get("payment_id"))


class LessonAccessStateTests(LessonAccessBase):
    def test_access_payload_includes_can_start_demo(self):
        access = LessonAccessService.get_access(self.user, self.paid)
        payload = access.to_dict()
        self.assertTrue(payload["can_start_demo"])
        self.assertFalse(payload["can_open"])

    def test_demo_active_payload_has_remaining_seconds(self):
        LessonAccessService.start_demo(self.user, self.paid, terms_accepted=True)
        access = LessonAccessService.get_access(self.user, self.paid)
        self.assertEqual(access.access_type, ACCESS_DEMO)
        self.assertTrue(access.demo_active)
        self.assertGreater(access.demo_remaining_seconds, 0)
        self.assertEqual(access.to_dict()["content_mode"], "demo")

    def test_purchased_user_gets_open_cta_only(self):
        LessonPurchase.objects.create(
            user=self.user,
            lesson=self.paid,
            amount=Decimal("790"),
            status=LessonPurchase.Status.PAID,
            purchased_at=timezone.now(),
        )
        access = LessonAccessService.get_access(self.user, self.paid)
        self.assertEqual(access.access_type, ACCESS_PURCHASED)
        self.assertFalse(access.can_purchase)
        self.assertFalse(access.demo_available)
        self.assertEqual(access.cta, [{"type": "open", "label": "Открыть", "primary": True}])

