"""Регрессии аудита оплаты: гонки, идемпотентность, prepaid, GetState."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from Cabinet.models import (
    Payment,
    Profile,
    SubscriptionPlanChange,
    TariffPlan,
    TeacherSubscription,
)
from Cabinet.payment_service import PaymentProviderService, add_months
from Cabinet.subscription_lifecycle import process_auto_renewals
from Cabinet.subscription_service import SubscriptionLimitService


def _teacher(username: str) -> User:
    user = User.objects.create_user(username=username, email=f"{username}@ex.com", password="x")
    Profile.objects.update_or_create(
        user=user,
        defaults={"role": Profile.Role.TEACHER},
    )
    return user


def _plan(slug: str, price: str, **extra) -> TariffPlan:
    defaults = {
        "name": slug.title(),
        "price_month": Decimal(price),
        "price_year": Decimal(price) * 10,
        "currency": "RUB",
        "is_active": True,
        "is_public": True,
        "is_free": Decimal(price) == 0,
        "cta_type": TariffPlan.CtaType.CHECKOUT,
        "sort_order": 10,
        "content_access_rank": {"start": 0, "teacher": 1, "pro": 2, "premium": 3}.get(slug, 0),
    }
    defaults.update(extra)
    plan, _ = TariffPlan.objects.update_or_create(slug=slug, defaults=defaults)
    return plan


@override_settings(PAYMENT_PROVIDER="mock", DEBUG=True, PAYMENTS_ENABLED=True)
class GetCurrentPlanRaceTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("audit_race")
        self.start = _plan("start", "0")
        self.pro = _plan("pro", "2990")
        self.sub = TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=self.pro,
            status=TeacherSubscription.Status.ACTIVE,
            expires_at=timezone.now() - timedelta(minutes=5),
            auto_renew=True,
            tbank_rebill_id="rebill-audit",
            billing_period="month",
            source=TeacherSubscription.Source.PAYMENT,
        )

    def test_get_current_plan_does_not_overwrite_newer_expires(self):
        new_end = timezone.now() + timedelta(days=30)
        TeacherSubscription.objects.filter(pk=self.sub.pk).update(
            expires_at=new_end,
            status=TeacherSubscription.Status.ACTIVE,
            plan=self.pro,
        )
        now = timezone.now()
        updated = TeacherSubscription.objects.filter(
            pk=self.sub.pk,
            expires_at__lte=now,
            status__in=[
                TeacherSubscription.Status.ACTIVE,
                TeacherSubscription.Status.TRIAL,
            ],
        ).update(
            status=TeacherSubscription.Status.EXPIRED,
            plan_id=self.start.pk,
        )
        self.assertEqual(updated, 0)
        plan = SubscriptionLimitService.get_current_plan(self.teacher)
        self.sub.refresh_from_db()
        self.assertEqual(plan.slug, "pro")
        self.assertEqual(self.sub.plan_id, self.pro.pk)
        self.assertEqual(self.sub.status, TeacherSubscription.Status.ACTIVE)
        self.assertTrue(self.sub.auto_renew)

    def test_expired_without_grace_falls_back_to_start(self):
        self.sub.auto_renew = False
        self.sub.tbank_rebill_id = ""
        self.sub.save(update_fields=["auto_renew", "tbank_rebill_id"])
        plan = SubscriptionLimitService.get_current_plan(self.teacher)
        self.assertEqual(plan.slug, "start")
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "start")
        self.assertEqual(self.sub.status, TeacherSubscription.Status.EXPIRED)

    def test_renew_grace_does_not_kill_auto_renew(self):
        self.sub.expires_at = timezone.now() - timedelta(hours=2)
        self.sub.save(update_fields=["expires_at"])
        plan = SubscriptionLimitService.get_current_plan(self.teacher)
        self.assertEqual(plan.slug, "start")
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan_id, self.pro.pk)
        self.assertTrue(self.sub.auto_renew)
        self.assertEqual(self.sub.status, TeacherSubscription.Status.ACTIVE)

    def test_prepaid_not_demoted_to_start(self):
        teacher_plan = _plan("teacher", "1990")
        SubscriptionPlanChange.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            from_plan=self.pro,
            to_plan=teacher_plan,
            status=SubscriptionPlanChange.Status.PREPAID,
            reason=SubscriptionPlanChange.Reason.DOWNGRADE,
            effective_at=self.sub.expires_at,
        )
        self.sub.auto_renew = False
        self.sub.tbank_rebill_id = ""
        self.sub.prepaid_until = timezone.now() + timedelta(days=30)
        self.sub.save(update_fields=["auto_renew", "tbank_rebill_id", "prepaid_until"])
        plan = SubscriptionLimitService.get_current_plan(self.teacher)
        self.assertEqual(plan.slug, "start")
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan_id, self.pro.pk)
        change = SubscriptionPlanChange.objects.get(subscription=self.sub)
        self.assertEqual(change.status, SubscriptionPlanChange.Status.PREPAID)


@override_settings(PAYMENT_PROVIDER="mock", DEBUG=True, PAYMENTS_ENABLED=True)
class PaymentStackAndIdempotencyTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("audit_stack")
        self.start = _plan("start", "0")
        self.pro = _plan("pro", "2990")
        self.sub = TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=self.start,
            status=TeacherSubscription.Status.ACTIVE,
        )

    def test_first_purchase_activates(self):
        result = PaymentProviderService.create_payment(
            self.teacher, self.pro, billing_period="month"
        )
        PaymentProviderService.handle_webhook(
            {
                "payment_id": result["payment_id"],
                "status": "paid",
                "event_id": "audit-first",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "pro")
        self.assertIsNotNone(self.sub.expires_at)
        self.assertGreater(self.sub.expires_at, timezone.now())

    def test_failed_payment_does_not_activate(self):
        result = PaymentProviderService.create_payment(
            self.teacher, self.pro, billing_period="month"
        )
        PaymentProviderService.handle_webhook(
            {
                "payment_id": result["payment_id"],
                "status": "failed",
                "event_id": "audit-fail",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "start")
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.status, Payment.Status.FAILED)

    def test_pending_does_not_activate(self):
        result = PaymentProviderService.create_payment(
            self.teacher, self.pro, billing_period="month"
        )
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.status, Payment.Status.PENDING)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "start")

    def test_repurchase_same_plan_stacks_period(self):
        result = PaymentProviderService.create_payment(
            self.teacher, self.pro, billing_period="month"
        )
        PaymentProviderService.handle_webhook(
            {
                "payment_id": result["payment_id"],
                "status": "paid",
                "event_id": "audit-stack-1",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.sub.refresh_from_db()
        first_end = self.sub.expires_at
        result2 = PaymentProviderService.create_payment(
            self.teacher, self.pro, billing_period="month"
        )
        PaymentProviderService.handle_webhook(
            {
                "payment_id": result2["payment_id"],
                "status": "paid",
                "event_id": "audit-stack-2",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.sub.refresh_from_db()
        self.assertGreater(self.sub.expires_at, first_end)
        expected = add_months(first_end, 1)
        self.assertEqual(self.sub.expires_at, expected)

    def test_two_paid_payments_stack_not_overwrite(self):
        """Два разных payment_id подряд — +2 месяца, не +1."""
        now = timezone.now()
        self.sub.plan = self.pro
        self.sub.status = TeacherSubscription.Status.ACTIVE
        self.sub.expires_at = now + timedelta(days=10)
        self.sub.save()
        base = self.sub.expires_at
        payments = []
        for i in range(2):
            p = Payment.objects.create(
                teacher=self.teacher,
                subscription=self.sub,
                plan=self.pro,
                amount=Decimal("2990"),
                final_amount=Decimal("2990"),
                status=Payment.Status.PENDING,
                provider="mock",
                idempotency_key=f"audit-two-{i}",
                billing_period="month",
                metadata={"plan_slug": "pro"},
            )
            payments.append(p)
        for i, p in enumerate(payments):
            PaymentProviderService.handle_webhook(
                {
                    "payment_id": p.pk,
                    "status": "paid",
                    "event_id": f"audit-two-evt-{i}",
                },
                provider_name="mock",
                skip_provider_parse=True,
            )
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.expires_at, add_months(add_months(base, 1), 1))

    def test_same_idempotency_key_reuses_payment(self):
        first = PaymentProviderService.create_payment(
            self.teacher,
            self.pro,
            billing_period="month",
            idempotency_key="audit-idem-same",
        )
        second = PaymentProviderService.create_payment(
            self.teacher,
            self.pro,
            billing_period="month",
            idempotency_key="audit-idem-same",
        )
        self.assertTrue(second.get("idempotent"))
        self.assertEqual(first["payment_id"], second["payment_id"])
        self.assertEqual(Payment.objects.filter(teacher=self.teacher).count(), 1)

    def test_create_payment_ignores_client_amount(self):
        result = PaymentProviderService.create_payment(
            self.teacher,
            self.pro,
            billing_period="month",
            discount_info={"amount": 1, "final_amount": 1},
        )
        self.assertEqual(Decimal(result["amount"]), Decimal("2990.00"))

    def test_expires_at_boundary_is_invalid(self):
        self.sub.plan = self.pro
        self.sub.status = TeacherSubscription.Status.ACTIVE
        self.sub.source = TeacherSubscription.Source.PAYMENT
        self.sub.expires_at = timezone.now()
        self.sub.save()
        self.sub.refresh_from_db()
        self.assertFalse(self.sub.is_valid())

    def test_unknown_payment_webhook(self):
        result = PaymentProviderService.handle_webhook(
            {
                "payment_id": 999999,
                "status": "paid",
                "event_id": "unknown-pay",
            },
            provider_name="mock",
            skip_provider_parse=True,
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "payment_not_found")


@override_settings(PAYMENT_PROVIDER="mock", DEBUG=True, PAYMENTS_ENABLED=True)
class RecurrentResumeTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("audit_renew")
        self.start = _plan("start", "0")
        self.pro = _plan("pro", "2990")
        self.sub = TeacherSubscription.objects.create(
            teacher=self.teacher,
            plan=self.pro,
            status=TeacherSubscription.Status.ACTIVE,
            expires_at=timezone.now() + timedelta(hours=2),
            auto_renew=True,
            tbank_rebill_id="rebill-resume",
            billing_period="month",
            source=TeacherSubscription.Source.PAYMENT,
        )

    def test_pending_same_cycle_does_not_create_second_payment(self):
        key = (
            f"renew_{self.sub.pk}_"
            f"{self.sub.expires_at.date().isoformat()}_pro"
        )
        Payment.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            status=Payment.Status.PENDING,
            provider="tbank",
            is_recurrent=True,
            idempotency_key=key,
            billing_period="month",
            metadata={"plan_slug": "pro", "auto_renew": True},
        )
        result = PaymentProviderService.create_recurrent_payment(self.sub)
        self.assertTrue(result["ok"])
        self.assertTrue(result.get("pending"))
        self.assertEqual(
            Payment.objects.filter(subscription=self.sub, is_recurrent=True).count(),
            1,
        )

    def test_two_cron_runs_one_payment(self):
        r1 = PaymentProviderService.create_recurrent_payment(self.sub)
        self.assertTrue(r1["ok"])
        payment = r1["payment"]
        r2 = PaymentProviderService._resume_recurrent_payment(
            Payment.objects.get(pk=payment.pk), self.sub
        )
        self.assertTrue(r2.get("duplicate"))
        self.assertEqual(
            Payment.objects.filter(subscription=self.sub, is_recurrent=True).count(),
            1,
        )

    def test_pending_recurrent_syncs_via_getstate(self):
        key = (
            f"renew_{self.sub.pk}_"
            f"{self.sub.expires_at.date().isoformat()}_pro"
        )
        payment = Payment.objects.create(
            teacher=self.teacher,
            subscription=self.sub,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            status=Payment.Status.PENDING,
            provider="tbank",
            provider_payment_id="prov-1",
            is_recurrent=True,
            idempotency_key=key,
            billing_period="month",
            metadata={"plan_slug": "pro", "auto_renew": True},
        )
        with patch.object(
            PaymentProviderService,
            "sync_payment_from_provider",
            return_value={"ok": True, "status": "paid", "synced": True},
        ) as sync:
            def _mark_paid(p):
                Payment.objects.filter(pk=p.pk).update(
                    status=Payment.Status.PAID,
                    paid_at=timezone.now(),
                )
                return {"ok": True, "status": "paid", "synced": True}

            sync.side_effect = _mark_paid
            result = PaymentProviderService.create_recurrent_payment(self.sub)
        self.assertTrue(result["ok"])
        self.assertTrue(result.get("synced"))
        sync.assert_called_once()
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PAID)

    def test_timeout_keeps_pending_and_auto_renew(self):
        class FakeProvider:
            def charge_recurrent(self, payment, plan, *, rebill_id):
                raise ValueError("Charge failed: timed out")

        with patch("Cabinet.payment_service.get_payment_provider", return_value=FakeProvider()):
            with patch("Cabinet.payment_service.settings") as mock_settings:
                mock_settings.DEBUG = False
                mock_settings.PAYMENT_PROVIDER = "tbank"
                self.sub.refresh_from_db()
                result = PaymentProviderService.create_recurrent_payment(self.sub)
        self.assertTrue(result["ok"])
        self.assertTrue(result.get("awaiting"))
        payment = result["payment"]
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PENDING)
        self.sub.refresh_from_db()
        self.assertTrue(self.sub.auto_renew)

    def test_process_auto_renewals_twice_one_charge(self):
        first = process_auto_renewals()
        self.assertGreaterEqual(first["ok"], 1)
        self.assertEqual(
            Payment.objects.filter(subscription=self.sub, is_recurrent=True).count(),
            1,
        )
        second = process_auto_renewals()
        # После успеха expires сдвинулся за окно 6ч — второй прогон пустой.
        self.assertEqual(second["ok"], 0)
        self.assertEqual(
            Payment.objects.filter(subscription=self.sub, is_recurrent=True).count(),
            1,
        )

    def test_cancel_auto_renew_skips_charge(self):
        self.sub.auto_renew = False
        self.sub.save(update_fields=["auto_renew"])
        result = PaymentProviderService.create_recurrent_payment(self.sub)
        self.assertTrue(result.get("skipped"))
        self.assertEqual(result.get("reason"), "auto_renew_off")
        self.assertFalse(Payment.objects.filter(subscription=self.sub, is_recurrent=True).exists())
