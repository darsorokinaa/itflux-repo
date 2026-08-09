"""Тесты автопродления, напоминаний и webhook-идемпотентности подписки."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from Cabinet.models import (
    Notification,
    Payment,
    Profile,
    TariffPlan,
    TeacherSubscription,
)
from Cabinet.payment_service import PaymentProviderService
from Cabinet.subscription_lifecycle import (
    process_auto_renewals,
    process_expired_subscriptions,
    process_expiry_reminders,
)
from Cabinet.subscription_notifications import notify_subscription_expiry_reminder
from Cabinet.tbank_payment import amount_to_kopecks, build_tbank_token


def _teacher(username: str = "pay_teacher") -> User:
    user = User.objects.create_user(username=username, email=f"{username}@ex.com", password="x")
    Profile.objects.update_or_create(
        user=user,
        defaults={"role": Profile.Role.TEACHER},
    )
    return user


def _plan(slug: str, price: str) -> TariffPlan:
    plan, _ = TariffPlan.objects.update_or_create(
        slug=slug,
        defaults={
            "name": slug.title(),
            "price_month": Decimal(price),
            "price_year": Decimal(price) * 10,
            "currency": "RUB",
            "is_active": True,
            "is_public": True,
            "is_free": Decimal(price) == 0,
            "cta_type": TariffPlan.CtaType.CHECKOUT,
            "sort_order": 10,
        },
    )
    return plan


@override_settings(PAYMENT_PROVIDER="mock", DEBUG=True, PAYMENTS_ENABLED=True)
class SubscriptionRenewalTests(TestCase):
    def setUp(self):
        self.teacher = _teacher()
        self.pro = _plan("pro", "2990")
        self.start = _plan("start", "0")
        self.sub = TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=self.pro,
            status=TeacherSubscription.Status.ACTIVE,
            expires_at=timezone.now() + timedelta(hours=2),
            auto_renew=True,
            tbank_rebill_id="rebill-test-1",
            tbank_customer_key="teacher_1",
            billing_period="month",
            source=TeacherSubscription.Source.PAYMENT,
        )

    def test_disable_auto_renew_keeps_expires_at(self):
        expires = self.sub.expires_at
        self.sub.auto_renew = False
        self.sub.save(update_fields=["auto_renew", "updated_at"])
        self.sub.refresh_from_db()
        self.assertFalse(self.sub.auto_renew)
        self.assertEqual(self.sub.expires_at, expires)

    def test_recurrent_mock_extends_subscription(self):
        before = self.sub.expires_at
        result = PaymentProviderService.create_recurrent_payment(self.sub)
        self.assertTrue(result["ok"])
        payment = result["payment"]
        self.assertEqual(payment.status, Payment.Status.PAID)
        self.assertTrue(payment.is_recurrent)
        self.assertEqual(payment.final_amount, Decimal("2990.00"))
        self.sub.refresh_from_db()
        self.assertGreater(self.sub.expires_at, before)

    def test_failed_renewal_does_not_extend(self):
        self.sub.tbank_rebill_id = ""
        self.sub.save(update_fields=["tbank_rebill_id"])
        with self.assertRaises(ValueError):
            PaymentProviderService.create_recurrent_payment(self.sub)
        self.sub.refresh_from_db()
        # expires unchanged
        self.assertTrue(self.sub.expires_at > timezone.now())

    def test_renewal_uses_full_price_not_discount(self):
        result = PaymentProviderService.create_recurrent_payment(self.sub)
        payment = result["payment"]
        self.assertEqual(payment.discount_amount, Decimal("0"))
        self.assertEqual(payment.referral_discount_amount, Decimal("0"))
        self.assertEqual(payment.final_amount, Decimal("2990.00"))

    def test_duplicate_confirmed_webhook_idempotent(self):
        payment = Payment.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            status=Payment.Status.PENDING,
            provider="mock",
            idempotency_key="idem_dup_1",
            billing_period="month",
            metadata={"plan_slug": "pro", "auto_renew": True},
        )
        first = PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "paid",
                "event_id": "evt_dup_1",
                "provider_payment_id": "p1",
                "rebill_id": "rebill-xyz",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.assertTrue(first["ok"])
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PAID)
        expires_after_first = TeacherSubscription.objects.get(pk=self.sub.pk).expires_at

        second = PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "paid",
                "event_id": "evt_dup_1",
                "provider_payment_id": "p1",
                "rebill_id": "rebill-xyz",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.assertTrue(second.get("duplicate"))
        self.assertEqual(
            TeacherSubscription.objects.get(pk=self.sub.pk).expires_at,
            expires_after_first,
        )

    def test_amount_mismatch_rejects_paid(self):
        payment = Payment.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            status=Payment.Status.PENDING,
            provider="tbank",
            idempotency_key="idem_amt_1",
            billing_period="month",
            metadata={"plan_slug": "pro"},
        )
        result = PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "paid",
                "event_id": "evt_amt_1",
                "provider_payment_id": "p2",
                "amount_kopecks": 100,  # 1 ₽ вместо 2990
            },
            provider_name="tbank",
            skip_provider_parse=True,
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "amount_mismatch")
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PENDING)

    def test_rebill_saved_on_subscription(self):
        payment = Payment.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            status=Payment.Status.PENDING,
            provider="mock",
            idempotency_key="idem_rebill_1",
            billing_period="month",
            metadata={"plan_slug": "pro", "auto_renew": True},
        )
        PaymentProviderService.handle_webhook(
            {
                "payment_id": payment.pk,
                "status": "paid",
                "event_id": "evt_rebill_1",
                "provider_payment_id": "p3",
                "rebill_id": "rebill-new",
                "pan_mask": "430000******1111",
                "customer_key": "teacher_x",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.tbank_rebill_id, "rebill-new")
        self.assertEqual(self.sub.payment_method_mask, "430000******1111")

    def test_expire_moves_to_start(self):
        self.sub.expires_at = timezone.now() - timedelta(days=2)
        self.sub.auto_renew = False
        self.sub.tbank_rebill_id = ""
        self.sub.save(update_fields=["expires_at", "auto_renew", "tbank_rebill_id"])
        result = process_expired_subscriptions()
        self.assertGreaterEqual(result["moved_to_start"], 1)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "start")
        self.assertEqual(self.sub.status, TeacherSubscription.Status.EXPIRED)


class SubscriptionReminderTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("remind_teacher")
        self.pro = _plan("pro", "2990")
        self.start = _plan("start", "0")

    def _sub(self, *, days: int, auto_renew: bool):
        from datetime import datetime, time as time_cls

        now = timezone.localtime(timezone.now())
        target = (now + timedelta(days=days)).date()
        tz = timezone.get_current_timezone()
        expires = timezone.make_aware(datetime.combine(target, time_cls(12, 0)), tz)
        return TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=self.pro,
            status=TeacherSubscription.Status.ACTIVE,
            expires_at=expires,
            auto_renew=auto_renew,
            billing_period="month",
            source=TeacherSubscription.Source.PAYMENT,
        )

    def test_reminder_7_days_no_duplicate(self):
        sub = self._sub(days=7, auto_renew=False)
        from Cabinet.subscription_lifecycle import _local_day_bounds

        start, end = _local_day_bounds(7)
        c1 = notify_subscription_expiry_reminder(days_ahead=7, window_start=start, window_end=end)
        c2 = notify_subscription_expiry_reminder(days_ahead=7, window_start=start, window_end=end)
        self.assertEqual(c1, 1)
        self.assertEqual(c2, 0)
        note = Notification.objects.filter(recipient_user=self.teacher).first()
        self.assertIsNotNone(note)
        self.assertIn("Старт", note.message)
        self.assertFalse(note.payload.get("auto_renew"))

    def test_reminder_auto_renew_text(self):
        self._sub(days=3, auto_renew=True)
        from Cabinet.subscription_lifecycle import _local_day_bounds

        start, end = _local_day_bounds(3)
        created = notify_subscription_expiry_reminder(
            days_ahead=3, window_start=start, window_end=end
        )
        self.assertEqual(created, 1)
        note = Notification.objects.filter(recipient_user=self.teacher).first()
        self.assertIn("автоматически", note.message.lower())
        compact = note.message.replace("\xa0", " ").replace(" ", "")
        self.assertIn("2990", compact)

    def test_start_plan_no_reminder(self):
        from datetime import datetime, time as time_cls

        now = timezone.localtime(timezone.now())
        target = (now + timedelta(days=1)).date()
        tz = timezone.get_current_timezone()
        expires = timezone.make_aware(datetime.combine(target, time_cls(12, 0)), tz)
        TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=self.start,
            status=TeacherSubscription.Status.ACTIVE,
            expires_at=expires,
            auto_renew=False,
        )
        from Cabinet.subscription_lifecycle import _local_day_bounds

        start, end = _local_day_bounds(1)
        created = notify_subscription_expiry_reminder(
            days_ahead=1, window_start=start, window_end=end
        )
        self.assertEqual(created, 0)

    def test_ends_at_change_uses_new_key(self):
        sub = self._sub(days=7, auto_renew=False)
        from Cabinet.subscription_lifecycle import _local_day_bounds

        start, end = _local_day_bounds(7)
        self.assertEqual(
            notify_subscription_expiry_reminder(days_ahead=7, window_start=start, window_end=end),
            1,
        )
        # Продлили — старые reminders для прошлой даты больше не шлём.
        sub.expires_at = timezone.now() + timedelta(days=40)
        sub.save(update_fields=["expires_at"])
        self.assertEqual(
            notify_subscription_expiry_reminder(days_ahead=7, window_start=start, window_end=end),
            0,
        )


class FrontendCannotSetAmountTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("amt_teacher")
        self.pro = _plan("pro", "2990")
        TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=_plan("start", "0"),
            status=TeacherSubscription.Status.ACTIVE,
        )

    @override_settings(PAYMENT_PROVIDER="mock", DEBUG=True, PAYMENTS_ENABLED=True)
    @patch("Cabinet.payment_service.get_payment_provider")
    def test_create_payment_ignores_client_amount(self, mock_prov):
        class Fake:
            def create_checkout(self, payment, plan):
                return f"/cabinet/upgrade?payment_id={payment.pk}&status=mock"

        mock_prov.return_value = Fake()
        result = PaymentProviderService.create_payment(
            teacher=self.teacher,
            plan=self.pro,
            billing_period="month",
            discount_info={"amount": 1},  # попытка подмены
        )
        self.assertEqual(Decimal(result["amount"]), Decimal("2990.00"))
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.final_amount, Decimal("2990.00"))


class TBankTokenReceiptTests(TestCase):
    def test_teacher_pro_premium_kopecks(self):
        self.assertEqual(amount_to_kopecks("1990"), 199000)
        self.assertEqual(amount_to_kopecks("2990"), 299000)
        self.assertEqual(amount_to_kopecks("3990"), 399000)

    def test_token_with_password(self):
        body = {"TerminalKey": "T", "Amount": 199000, "OrderId": "1-abc"}
        token = build_tbank_token(body, password="pwd")
        self.assertEqual(len(token), 64)
