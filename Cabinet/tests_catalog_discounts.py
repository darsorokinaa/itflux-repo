"""Промокоды каталога, персональная скидка, тренажёры и скидка журнала."""

import io
import zipfile
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from Cabinet.billing_models import BillingTransaction, TransactionType
from Cabinet.billing_service import (
    compute_account_balance,
    finalize_event_billing,
    get_or_create_billing_account,
    update_student_settings,
)
from Cabinet.catalog_checkout import checkout_amounts_match
from Cabinet.interesting_access import InterestingAccessService
from Cabinet.models import (
    InterestingDemoAccess,
    InterestingPurchase,
    Payment,
    Profile,
    PromoCode,
    PromoCodeUsage,
    ScheduleEvent,
    Student,
    TariffPlan,
    TeacherSubscription,
    UserDiscount,
)
from Cabinet.pricing_service import (
    PRODUCT_INTERESTING,
    PRODUCT_LESSON,
    calculate_catalog_price,
)
from Cabinet.tbank_payment import amount_to_kopecks, build_receipt
from Generator.models import InterestingItem


def _teacher(username):
    user = User.objects.create_user(username, f"{username}@example.com", password=None)
    profile = user.profile
    profile.role = Profile.Role.TEACHER
    profile.save(update_fields=["role"])
    return user


def _plans():
    specs = [
        ("start", "Старт", 0, 0, True),
        ("teacher", "Репетитор", 1990, 1, False),
        ("premium", "Полный доступ", 3990, 3, False),
    ]
    plans = {}
    for index, (slug, name, price, rank, is_free) in enumerate(specs):
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
                "sort_order": index,
            },
        )
    return plans


class CatalogPricingTests(TestCase):
    def setUp(self):
        promo = mock.patch("Cabinet.registration_promo.ensure_registration_promo", return_value=None)
        promo.start()
        self.addCleanup(promo.stop)
        self.user = _teacher("price_user")

    def _promo(self, code, value, product_types, discount_type="percent"):
        return PromoCode.objects.create(
            code=code,
            discount_type=discount_type,
            discount_value=Decimal(value),
            applicable_product_types=product_types,
            is_active=True,
        )

    def test_promo_individual_best_wins_and_zero(self):
        self._promo("LESSON10", "10", ["lesson"])
        UserDiscount.objects.create(
            user=self.user,
            discount_type=UserDiscount.DiscountType.PERCENT,
            discount_value=Decimal("30"),
            product_types=["lesson"],
            is_active=True,
        )
        calc = calculate_catalog_price(self.user, Decimal("1000"), PRODUCT_LESSON, promo_code="LESSON10")
        self.assertEqual(calc["applied_discount_source"], "user_discount")
        self.assertEqual(calc["final_price"], Decimal("700.00"))
        self.assertEqual(calc["applied_discount"], Decimal("300.00"))
        self.assertIn("наиболее выгодная", calc["message"])
        self.assertIn("Персональная", calc["message"])

        stronger = self._promo("LESSON50", "50", ["lesson"])
        calc = calculate_catalog_price(self.user, Decimal("1000"), PRODUCT_LESSON, promo_code=stronger.code)
        self.assertEqual(calc["applied_discount_source"], "promo")
        self.assertEqual(calc["final_price"], Decimal("500.00"))
        self.assertIn("промокод", calc["message"].lower())

        free = self._promo("FREE", "100", ["interesting"])
        calc = calculate_catalog_price(self.user, Decimal("790"), PRODUCT_INTERESTING, promo_code=free.code)
        self.assertEqual(calc["final_price"], Decimal("0.00"))
        self.assertEqual(calc["list_price"], Decimal("790.00"))

    def test_subscription_only_code_does_not_apply_to_lesson(self):
        self._promo("SUBONLY", "20", ["subscription"])
        with self.assertRaises(Exception):
            calculate_catalog_price(self.user, Decimal("1000"), PRODUCT_LESSON, promo_code="SUBONLY")

    def test_receipt_amount_equals_discounted_final(self):
        payment = Payment(
            teacher=self.user,
            amount=Decimal("1000.00"),
            discount_amount=Decimal("209.50"),
            final_amount=Decimal("790.50"),
            currency="RUB",
            purpose=Payment.Purpose.INTERESTING,
            metadata={"purpose": "interesting", "interesting_title": "Дроби"},
        )
        kopecks = amount_to_kopecks(payment.final_amount)
        receipt = build_receipt(payment, None, amount_kopecks=kopecks)
        item = receipt["Items"][0]
        self.assertEqual(item["Name"], "Цифровой поток — тренажёр «Дроби»")
        self.assertEqual(item["Price"] * item["Quantity"], item["Amount"])
        self.assertEqual(item["Amount"], kopecks)
        self.assertTrue(checkout_amounts_match(payment))


class InterestingPurchaseTests(TestCase):
    def setUp(self):
        promo = mock.patch("Cabinet.registration_promo.ensure_registration_promo", return_value=None)
        promo.start()
        self.addCleanup(promo.stop)
        self.plans = _plans()
        self.user = _teacher("trainer_user")
        TeacherSubscription.objects.update_or_create(
            teacher=self.user,
            defaults={"plan": self.plans["start"], "status": TeacherSubscription.Status.ACTIVE},
        )
        self.item = InterestingItem.objects.create(
            title="Тренажёр дробей",
            slug="trainer-fractions",
            status=InterestingItem.Status.PUBLISHED,
            access_level=InterestingItem.AccessLevel.PREMIUM,
            standalone_purchase_enabled=True,
            standalone_price=Decimal("790.00"),
        )
        self.item.file.save("index.html", ContentFile(b"<html><body>secret trainer</body></html>"), save=True)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("index.html", "<html><body>archive trainer</body></html>")
            archive.writestr("style.css", "body{color:red}")
        self.item.archive.save("pack.zip", ContentFile(buffer.getvalue()), save=True)
        self.client = Client()
        self.client.force_login(self.user)

    def _set_plan(self, slug):
        TeacherSubscription.objects.filter(teacher=self.user).update(plan=self.plans[slug])

    def test_start_locked_subscription_and_purchase_open(self):
        denied = self.client.get(f"/api/interesting/{self.item.slug}/view/")
        self.assertEqual(denied.status_code, 403)
        asset = self.client.get(f"/api/interesting/{self.item.slug}/archive/style.css")
        self.assertEqual(asset.status_code, 403)

        self._set_plan("premium")
        opened = self.client.get(f"/api/interesting/{self.item.slug}/view/")
        self.assertEqual(opened.status_code, 200)
        self.assertIn(b"archive trainer", opened.content)

        self._set_plan("start")
        InterestingPurchase.objects.create(
            user=self.user,
            item=self.item,
            amount=Decimal("790"),
            status=InterestingPurchase.Status.PAID,
            purchased_at=timezone.now(),
        )
        bought = self.client.get(f"/api/interesting/{self.item.slug}/view/")
        self.assertEqual(bought.status_code, 200)
        access = InterestingAccessService.get_access(self.user, self.item)
        self.assertEqual(access["access_type"], "purchase")
        self.assertTrue(access["is_full"])

    def test_demo_expires_on_server(self):
        demo = self.client.post(f"/api/interesting/{self.item.slug}/demo/", content_type="application/json")
        self.assertEqual(demo.status_code, 200)
        view = self.client.get(f"/api/interesting/{self.item.slug}/view/")
        self.assertEqual(view.status_code, 200)
        asset = self.client.get(f"/api/interesting/{self.item.slug}/archive/style.css")
        self.assertEqual(asset.status_code, 200)

        row = InterestingDemoAccess.objects.get(user=self.user, item=self.item)
        row.expires_at = timezone.now() - timedelta(minutes=1)
        row.save(update_fields=["expires_at"])
        expired = self.client.get(f"/api/interesting/{self.item.slug}/view/")
        self.assertEqual(expired.status_code, 403)
        expired_asset = self.client.get(f"/api/interesting/{self.item.slug}/archive/style.css")
        self.assertEqual(expired_asset.status_code, 403)
        again = self.client.post(f"/api/interesting/{self.item.slug}/demo/", content_type="application/json")
        self.assertEqual(again.status_code, 403)

    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock", PAYMENTS_ENABLED=True)
    def test_fulfill_purchase_and_zero_price_skips_init(self):
        PromoCode.objects.create(
            code="TRAINER100",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("100"),
            applicable_product_types=["interesting"],
            is_active=True,
        )
        with mock.patch("Cabinet.payment_service.get_payment_provider") as init:
            response = self.client.post(
                f"/api/interesting/{self.item.slug}/purchase/",
                data='{"promo_code": "TRAINER100", "idempotency_key": "int-zero-1"}',
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["granted"])
        init.assert_not_called()
        payment = Payment.objects.get(idempotency_key="int-zero-1")
        self.assertEqual(payment.amount, Decimal("790.00"))
        self.assertEqual(payment.discount_amount, Decimal("790.00"))
        self.assertEqual(payment.final_amount, Decimal("0.00"))
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertTrue(
            InterestingPurchase.objects.filter(
                user=self.user,
                item=self.item,
                status=InterestingPurchase.Status.PAID,
            ).exists()
        )
        self.assertEqual(PromoCodeUsage.objects.filter(payment=payment, status="applied").count(), 1)
        opened = self.client.get(f"/api/interesting/{self.item.slug}/view/")
        self.assertEqual(opened.status_code, 200)

    @override_settings(DEBUG=True, PAYMENT_PROVIDER="mock", PAYMENTS_ENABLED=True)
    def test_paid_checkout_stores_list_and_discount(self):
        PromoCode.objects.create(
            code="TRAINER10",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("10"),
            applicable_product_types=["interesting"],
            is_active=True,
        )
        response = self.client.post(
            f"/api/interesting/{self.item.slug}/purchase/",
            data='{"promo_code": "TRAINER10", "idempotency_key": "int-ten-1"}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        payment = Payment.objects.get(idempotency_key="int-ten-1")
        self.assertEqual(payment.amount, Decimal("790.00"))
        self.assertEqual(payment.discount_amount, Decimal("79.00"))
        self.assertEqual(payment.final_amount, Decimal("711.00"))
        self.assertTrue(checkout_amounts_match(payment))
        self.assertEqual(
            PromoCodeUsage.objects.filter(payment=payment, status=PromoCodeUsage.Status.RESERVED).count(),
            1,
        )


class LedgerDiscountTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("ledger_teacher")
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Анна",
            last_name="Иванова",
        )
        self.account = get_or_create_billing_account(self.teacher, self.student)
        settings = self.account.settings
        settings.default_lesson_price = Decimal("1600.00")
        settings.platform_discount_active = True
        settings.platform_discount_type = "percent"
        settings.platform_discount_value = Decimal("10")
        settings.platform_discount_note = "Постоянная"
        settings.save()

    def _event(self):
        starts = timezone.now() - timedelta(hours=1)
        return ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок",
            student=self.student,
            starts_at=starts,
            ends_at=starts + timedelta(minutes=60),
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            status=ScheduleEvent.Status.PLANNED,
        )

    def test_platform_discount_reduces_charge_and_writes_ledger(self):
        record = finalize_event_billing(
            event=self._event(),
            teacher=self.teacher,
            financial_action="charge",
            idempotency_key="disc-1",
        )[0]
        self.assertEqual(record.calculated_amount, Decimal("1600.00"))
        self.assertEqual(record.discount_amount, Decimal("160.00"))
        self.assertEqual(record.charged_amount, Decimal("1440.00"))
        self.assertIn("Скидка платформы", record.price_source_label)
        charge = BillingTransaction.objects.get(
            event_billing=record,
            transaction_type=TransactionType.CHARGE,
            is_reversal=False,
        )
        discount = BillingTransaction.objects.get(
            event_billing=record,
            transaction_type=TransactionType.DISCOUNT,
            is_reversal=False,
        )
        self.assertEqual(charge.amount, Decimal("1600.00"))
        self.assertEqual(discount.amount, Decimal("160.00"))
        balance = compute_account_balance(self.account)
        self.assertEqual(balance["balance"], Decimal("-1440.00"))

    def test_teacher_cannot_edit_platform_discount(self):
        update_student_settings(
            self.teacher,
            self.account,
            {
                "default_lesson_price": "1800",
                "platform_discount_active": False,
                "platform_discount_value": "0",
                "platform_discount_type": "",
            },
        )
        self.account.settings.refresh_from_db()
        self.assertEqual(self.account.settings.default_lesson_price, Decimal("1800"))
        self.assertTrue(self.account.settings.platform_discount_active)
        self.assertEqual(self.account.settings.platform_discount_value, Decimal("10"))

    def test_entered_promo_beats_smaller_platform_discount(self):
        PromoCode.objects.create(
            code="LEDGER50",
            discount_type=PromoCode.DiscountType.PERCENT,
            discount_value=Decimal("50"),
            applicable_product_types=["teacher_ledger"],
            is_active=True,
        )
        record = finalize_event_billing(
            event=self._event(),
            teacher=self.teacher,
            financial_action="charge",
            idempotency_key="disc-promo",
            promo_code="LEDGER50",
        )[0]
        self.assertEqual(record.discount_amount, Decimal("800.00"))
        self.assertEqual(record.charged_amount, Decimal("800.00"))
        self.assertEqual(PromoCode.objects.get(code="LEDGER50").uses_count, 1)
