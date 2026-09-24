"""Наборы готовых уроков: доступ, покупка, демо и контекст навигации."""

from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from Cabinet.lesson_access import ACCESS_COLLECTION, ACCESS_COLLECTION_DEMO, ACCESS_LOCKED, LessonAccessService
from Cabinet.lesson_collection_access import LessonCollectionAccess, LessonCollectionPurchaseService
from Cabinet.models import CollectionPurchase
from Cabinet.payment_service import PaymentProviderService
from Generator.models import Lesson, LessonCollection, LessonCollectionItem, LessonCollectionSection

from .tests_lesson_access import LessonAccessBase


class LessonCollectionAccessTests(LessonAccessBase):
    def setUp(self):
        super().setUp()
        self.other = Lesson.objects.create(
            title="Второй урок",
            slug="second-ready-lesson",
            subject="Математика",
            access_level=Lesson.AccessLevel.PREMIUM,
            status=Lesson.Status.PUBLISHED,
        )
        self.collection = LessonCollection.objects.create(
            title="Геометрия — 7 класс",
            slug="geometry-7",
            subject="Математика",
            grade=7,
            status=LessonCollection.Status.PUBLISHED,
            access_mode=LessonCollection.AccessMode.PURCHASE,
            price=Decimal("1490"),
            compare_at_price=Decimal("1990"),
        )
        LessonCollectionItem.objects.create(collection=self.collection, lesson=self.paid, position=0, is_demo=True)
        LessonCollectionItem.objects.create(collection=self.collection, lesson=self.other, position=1, is_demo=False)
        self.paid.primary_collection = self.collection
        self.paid.save(update_fields=["primary_collection"])

    def test_demo_lesson_opens_without_unlocking_the_rest(self):
        demo = LessonAccessService.get_access(self.user, self.paid)
        locked = LessonAccessService.get_access(self.user, self.other)
        self.assertEqual(demo.access_type, ACCESS_COLLECTION_DEMO)
        self.assertTrue(demo.can_view)
        self.assertFalse(demo.can_download)
        self.assertEqual(locked.access_type, ACCESS_LOCKED)

    def test_purchase_unlocks_member_lessons_without_copying_them(self):
        CollectionPurchase.objects.create(
            user=self.user,
            collection=self.collection,
            source=CollectionPurchase.Source.ADMIN,
            status=CollectionPurchase.Status.PAID,
            amount=Decimal("1490"),
            purchased_at=timezone.now(),
        )
        access = LessonAccessService.get_access(self.user, self.other)
        self.assertEqual(access.access_type, ACCESS_COLLECTION)
        self.assertTrue(access.can_view)
        self.assertEqual(Lesson.objects.filter(pk=self.other.pk).count(), 1)

    def test_expired_purchase_closes_access_and_lifetime_purchase_stays(self):
        CollectionPurchase.objects.create(
            user=self.user,
            collection=self.collection,
            status=CollectionPurchase.Status.PAID,
            amount=Decimal("1490"),
            purchased_at=timezone.now(),
            valid_until=timezone.now() - timedelta(days=1),
        )
        self.assertEqual(LessonAccessService.get_access(self.user, self.other).access_type, ACCESS_LOCKED)
        purchase = CollectionPurchase.objects.get(user=self.user, collection=self.collection)
        purchase.valid_until = None
        purchase.save(update_fields=["valid_until"])
        self.assertEqual(LessonAccessService.get_access(self.user, self.other).access_type, ACCESS_COLLECTION)

    def test_tariff_and_purchase_modes(self):
        self.collection.access_mode = LessonCollection.AccessMode.SUBSCRIPTION
        self.collection.plan_slugs = ["teacher"]
        self.collection.save(update_fields=["access_mode", "plan_slugs"])
        self.assertFalse(LessonCollectionAccess.has_entitlement(self.user, self.collection))
        self._set_plan("teacher")
        self.assertTrue(LessonCollectionAccess.has_entitlement(self.user, self.collection))
        self.assertEqual(LessonAccessService.get_access(self.user, self.other).access_type, ACCESS_COLLECTION)

        self._set_plan("start")
        self.collection.access_mode = LessonCollection.AccessMode.SUBSCRIPTION_OR_PURCHASE
        self.collection.save(update_fields=["access_mode"])
        self.assertFalse(LessonCollectionAccess.has_entitlement(self.user, self.collection))
        CollectionPurchase.objects.create(
            user=self.user,
            collection=self.collection,
            status=CollectionPurchase.Status.PAID,
            amount=Decimal("1490"),
            purchased_at=timezone.now(),
        )
        self.assertTrue(LessonCollectionAccess.has_entitlement(self.user, self.collection))

    def test_free_collection_requires_account(self):
        self.collection.access_mode = LessonCollection.AccessMode.FREE
        self.collection.save(update_fields=["access_mode"])
        self.assertFalse(LessonCollectionAccess.has_entitlement(None, self.collection))
        self.assertTrue(LessonCollectionAccess.has_entitlement(self.user, self.collection))

    def test_forged_collection_does_not_grant_or_switch_context(self):
        other = LessonCollection.objects.create(
            title="Чужой набор",
            slug="other-pack",
            status=LessonCollection.Status.PUBLISHED,
            access_mode=LessonCollection.AccessMode.PURCHASE,
            price=Decimal("500"),
        )
        LessonCollectionItem.objects.create(collection=other, lesson=self.free, position=0)
        CollectionPurchase.objects.create(
            user=self.user,
            collection=other,
            status=CollectionPurchase.Status.PAID,
            amount=Decimal("500"),
            purchased_at=timezone.now(),
        )
        self.assertEqual(LessonAccessService.get_access(self.user, self.other).access_type, ACCESS_LOCKED)
        self._login()
        response = self.client.get(f"/api/lessons/{self.other.slug}/?collection={other.slug}")
        self.assertEqual(response.status_code, 200)
        context = response.json()["lesson"]["collection_context"]
        self.assertEqual(context["slug"], "geometry-7")
        self.assertEqual(context["prev"]["slug"], self.paid.slug)
        self.assertIsNone(context["next"])

    def test_navigation_follows_requested_collection(self):
        second = LessonCollection.objects.create(
            title="Повторение",
            slug="review-pack",
            status=LessonCollection.Status.PUBLISHED,
            access_mode=LessonCollection.AccessMode.FREE,
        )
        LessonCollectionItem.objects.create(collection=second, lesson=self.other, position=0)
        later = Lesson.objects.create(
            title="Третий урок",
            slug="third-ready-lesson",
            subject="Математика",
            access_level=Lesson.AccessLevel.FREE,
            status=Lesson.Status.PUBLISHED,
        )
        LessonCollectionItem.objects.create(collection=second, lesson=later, position=1)
        self._login()
        response = self.client.get(f"/api/lessons/{self.other.slug}/?collection=review-pack")
        context = response.json()["lesson"]["collection_context"]
        self.assertEqual(context["slug"], "review-pack")
        self.assertEqual(context["next"]["slug"], later.slug)
        self.assertEqual(context["also_count"], 1)

    def test_archive_keeps_purchase_and_delete_keeps_lessons(self):
        CollectionPurchase.objects.create(
            user=self.user,
            collection=self.collection,
            status=CollectionPurchase.Status.PAID,
            amount=Decimal("1490"),
            purchased_at=timezone.now(),
        )
        self.collection.status = LessonCollection.Status.ARCHIVED
        self.collection.save(update_fields=["status"])
        self.assertEqual(LessonAccessService.get_access(self.user, self.other).access_type, ACCESS_COLLECTION)
        lesson_id = self.other.pk
        self.collection.delete()
        self.assertTrue(Lesson.objects.filter(pk=lesson_id).exists())
        self.assertEqual(LessonAccessService.get_access(self.user, self.other).access_type, ACCESS_LOCKED)

    def test_sections_keep_order(self):
        chapter = LessonCollectionSection.objects.create(collection=self.collection, title="Углы", position=1)
        item = self.collection.items.get(lesson=self.other)
        item.section = chapter
        item.position = 0
        item.save(update_fields=["section", "position"])
        self._login()
        payload = self.client.get("/api/lesson-collections/geometry-7/").json()["collection"]
        self.assertEqual(payload["lessons"][0]["slug"], self.paid.slug)
        self.assertEqual(payload["sections"][0]["title"], "Углы")
        self.assertEqual(payload["sections"][0]["lessons"][0]["slug"], self.other.slug)

    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock", PAYMENTS_ENABLED=True)
    def test_checkout_fulfills_collection_purchase(self):
        result = LessonCollectionPurchaseService.create_checkout(
            self.user,
            self.collection,
            idempotency_key="col-buy-1",
        )
        from Cabinet.models import Payment

        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.purpose, Payment.Purpose.COLLECTION)
        PaymentProviderService.handle_webhook(
            {"payment_id": payment.pk, "status": "paid", "event_id": f"evt-col-{payment.pk}"},
            provider_name="mock",
        )
        self.assertEqual(LessonAccessService.get_access(self.user, self.other).access_type, ACCESS_COLLECTION)
        self.assertEqual(CollectionPurchase.objects.filter(user=self.user, status="paid").count(), 1)

    def test_file_and_variant_follow_collection_access(self):
        from Cabinet.models import Material
        from Generator.models import Level, Subject, Variant

        material = Material.objects.create(title="Памятка", description="Короткая памятка")
        level = Level.objects.create(level="ege-col")
        subject = Subject.objects.create(subject_short="math-col", subject_name="Математика")
        variant = Variant.objects.create(var_subject=subject, level=level, local_number=12)
        file_item = LessonCollectionItem.objects.create(collection=self.collection, material=material, position=2)
        LessonCollectionItem.objects.create(collection=self.collection, variant=variant, position=3)

        self.assertIsNone(LessonCollectionAccess.grant_for_material(self.user, material))
        self.assertIsNone(LessonCollectionAccess.grant_for_variant(self.user, variant))
        locked = self.client.get(f"/api/lesson-collections/geometry-7/files/{file_item.pk}/")
        self.assertEqual(locked.status_code, 403)

        CollectionPurchase.objects.create(
            user=self.user,
            collection=self.collection,
            source=CollectionPurchase.Source.ADMIN,
            amount=Decimal("1490"),
            status=CollectionPurchase.Status.PAID,
            purchased_at=timezone.now(),
        )
        self.assertEqual(LessonCollectionAccess.grant_for_material(self.user, material), "full")
        self.assertEqual(LessonCollectionAccess.grant_for_variant(self.user, variant), "full")
        self._login()
        payload = self.client.get("/api/lesson-collections/geometry-7/").json()["collection"]
        kinds = {row["kind"] for row in payload["lessons"]}
        self.assertIn("file", kinds)
        self.assertIn("variant", kinds)
        variant_row = next(row for row in payload["lessons"] if row["kind"] == "variant")
        self.assertIn("/ege-col/math-col/variant/", variant_row["url"])
        self.assertTrue(variant_row["can_open"])
