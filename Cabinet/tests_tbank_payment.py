"""Тесты провайдера Т-Банка: сумма, Token, webhook → тариф."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone

from Cabinet.models import Payment, Profile, TariffPlan, TeacherSubscription
from Cabinet.payment_service import PaymentProviderService
from Cabinet.tbank_payment import (
    _notification_url,
    _return_url,
    _ssl_verify,
    amount_to_kopecks,
    build_tbank_token,
    map_tbank_status,
    verify_tbank_token,
)


def _plan(slug: str, month: str, year: str) -> TariffPlan:
    plan, _ = TariffPlan.objects.update_or_create(
        slug=slug,
        defaults={
            "name": slug.title(),
            "price_month": Decimal(month),
            "price_year": Decimal(year),
            "currency": "RUB",
            "is_active": True,
            "is_public": True,
            "cta_type": TariffPlan.CtaType.CHECKOUT,
            "sort_order": 10,
        },
    )
    return plan


class TBankHelpersTests(TestCase):
    def test_amount_to_kopecks(self):
        self.assertEqual(amount_to_kopecks("1990.00"), 199000)
        self.assertEqual(amount_to_kopecks(Decimal("2990.5")), 299050)

    def test_token_stable_and_ignores_nested(self):
        payload = {
            "TerminalKey": "Demo",
            "Amount": 1000,
            "OrderId": "42",
            "DATA": {"Email": "a@b.c"},
        }
        token = build_tbank_token(payload, password="secret")
        again = build_tbank_token(payload, password="secret")
        self.assertEqual(token, again)
        self.assertTrue(verify_tbank_token({**payload, "Token": token}, password="secret"))
        self.assertFalse(verify_tbank_token({**payload, "Token": "bad"}, password="secret"))

    def test_map_statuses(self):
        self.assertEqual(map_tbank_status("CONFIRMED"), "paid")
        self.assertEqual(map_tbank_status("AUTHORIZED"), "pending")
        self.assertEqual(map_tbank_status("REJECTED"), "failed")
        self.assertEqual(map_tbank_status("CANCELED"), "cancelled")
        self.assertEqual(map_tbank_status("NEW"), "pending")

    @override_settings(DEBUG=True, LK_PUBLIC_URL="https://itflux-academy.ru")
    def test_debug_allows_local_success_url(self):
        payment = type("P", (), {"pk": 42})()
        url = _return_url(
            payment,
            status="success",
            custom="http://127.0.0.1:5173/cabinet/upgrade",
        )
        self.assertTrue(url.startswith("http://127.0.0.1:5173/cabinet/upgrade?"))
        self.assertIn("payment_id=42", url)
        self.assertIn("status=success", url)

    @override_settings(
        DEBUG=True,
        LK_PUBLIC_URL="https://itflux-academy.ru",
        TBANK_NOTIFICATION_URL="https://itflux-academy.ru/payments/webhook/tbank/",
    )
    def test_debug_skips_prod_notification_url(self):
        self.assertIsNone(_notification_url())

    @override_settings(DEBUG=True, LK_PUBLIC_URL="https://itflux-academy.ru", TBANK_NOTIFICATION_URL="")
    def test_debug_skips_default_prod_notification_when_unset(self):
        self.assertIsNone(_notification_url())

    @override_settings(
        DEBUG=True,
        TBANK_NOTIFICATION_URL="https://abc123.ngrok-free.app/payments/webhook/tbank/",
    )
    def test_debug_keeps_ngrok_notification_url(self):
        self.assertIn("ngrok", _notification_url())

    @override_settings(DEBUG=True, TBANK_VERIFY_SSL=False)
    def test_debug_can_disable_tbank_ssl_verify(self):
        self.assertFalse(_ssl_verify())

    @override_settings(DEBUG=False, TBANK_VERIFY_SSL=False)
    def test_production_never_disables_tbank_ssl_verify(self):
        verify = _ssl_verify()
        self.assertTrue(bool(verify))
        self.assertNotEqual(verify, False)


@override_settings(
    PAYMENT_PROVIDER="tbank",
    TBANK_TERMINAL_KEY="TestKey",
    TBANK_PASSWORD="TestPass",
    LK_PUBLIC_URL="https://example.com",
    DEBUG=True,
)
class TBankCheckoutFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("tb_teacher", "t@example.com", "pass")
        Profile.objects.get_or_create(
            user=self.user,
            defaults={"role": Profile.Role.TEACHER},
        )
        self.start = _plan("start", "0", "0")
        self.start.cta_type = TariffPlan.CtaType.REGISTER
        self.start.is_free = True
        self.start.save()
        self.pro = _plan("pro", "2990", "29900")
        TeacherSubscription.objects.create(
            teacher=self.user,
            plan=self.start,
            status=TeacherSubscription.Status.ACTIVE,
        )

    @patch("Cabinet.tbank_payment.requests.post")
    def test_create_payment_month_amount_and_redirect(self, mock_post):
        mock_post.return_value.json.return_value = {
            "Success": True,
            "PaymentId": "9001",
            "PaymentURL": "https://securepay.tinkoff.ru/html/payForm/?id=9001",
            "Status": "NEW",
        }
        result = PaymentProviderService.create_payment(
            teacher=self.user,
            plan=self.pro,
            billing_period="month",
        )
        self.assertEqual(result["amount"], "2990.00")
        self.assertEqual(result["billing_period"], "month")
        self.assertTrue(str(result["payment_url"]).startswith("https://securepay.tinkoff.ru/"))
        payment = Payment.objects.get(pk=result["payment_id"])
        self.assertEqual(payment.provider_payment_id, "9001")
        self.assertEqual(payment.final_amount, Decimal("2990"))

        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        self.assertEqual(body["Amount"], 299000)
        self.assertTrue(str(body["OrderId"]).startswith(f"{payment.pk}-"))
        self.assertIn("Token", body)
        self.assertIn("Receipt", body)
        self.assertEqual(body["Receipt"]["Items"][0]["Amount"], 299000)
        self.assertEqual(body["Receipt"]["Items"][0]["Tax"], "none")
        self.assertIn("Taxation", body["Receipt"])

    @patch("Cabinet.tbank_payment.requests.post")
    def test_create_payment_year_amount(self, mock_post):
        mock_post.return_value.json.return_value = {
            "Success": True,
            "PaymentId": "9002",
            "PaymentURL": "https://securepay.tinkoff.ru/html/payForm/?id=9002",
            "Status": "NEW",
        }
        result = PaymentProviderService.create_payment(
            teacher=self.user,
            plan=self.pro,
            billing_period="year",
        )
        self.assertEqual(result["amount"], "29900.00")
        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        self.assertEqual(body["Amount"], 2990000)

    def test_webhook_activates_plan_for_month(self):
        payment = Payment.objects.create(
            teacher=self.user,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            currency="RUB",
            status=Payment.Status.PENDING,
            provider="tbank",
            provider_payment_id="777",
            idempotency_key="tb-1",
            billing_period="month",
            metadata={"plan_slug": "pro", "billing_period": "month"},
        )
        payload = {
            "TerminalKey": "TestKey",
            "OrderId": f"{payment.pk}-abc12def",
            "Success": True,
            "Status": "CONFIRMED",
            "PaymentId": 777,
            "Amount": 299000,
        }
        payload["Token"] = build_tbank_token(payload, password="TestPass")

        result = PaymentProviderService.handle_webhook(payload, provider_name="tbank")
        self.assertTrue(result.get("ok"))

        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PAID)
        sub = TeacherSubscription.objects.get(teacher=self.user)
        self.assertEqual(sub.plan.slug, "pro")
        self.assertEqual(sub.billing_period, "month")
        self.assertEqual(sub.status, TeacherSubscription.Status.ACTIVE)
        self.assertIsNotNone(sub.expires_at)
        # ~1 месяц
        delta = sub.expires_at - timezone.now()
        self.assertGreater(delta, timedelta(days=25))
        self.assertLess(delta, timedelta(days=40))

    def test_webhook_activates_plan_for_year(self):
        payment = Payment.objects.create(
            teacher=self.user,
            plan=self.pro,
            amount=Decimal("29900"),
            final_amount=Decimal("29900"),
            currency="RUB",
            status=Payment.Status.PENDING,
            provider="tbank",
            provider_payment_id="778",
            idempotency_key="tb-2",
            billing_period="year",
            metadata={"plan_slug": "pro", "billing_period": "year"},
        )
        payload = {
            "TerminalKey": "TestKey",
            "OrderId": f"{payment.pk}-year0001",
            "Success": True,
            "Status": "CONFIRMED",
            "PaymentId": 778,
            "Amount": 2990000,
        }
        payload["Token"] = build_tbank_token(payload, password="TestPass")

        PaymentProviderService.handle_webhook(payload, provider_name="tbank")
        sub = TeacherSubscription.objects.get(teacher=self.user)
        self.assertEqual(sub.billing_period, "year")
        delta = sub.expires_at - timezone.now()
        self.assertGreater(delta, timedelta(days=350))
        self.assertLess(delta, timedelta(days=380))

    @patch("Cabinet.tbank_payment.requests.post")
    def test_sync_from_getstate_activates_plan(self, mock_post):
        """Webhook мог уйти на другой хост — sync через GetState меняет тариф."""
        payment = Payment.objects.create(
            teacher=self.user,
            plan=self.pro,
            amount=Decimal("2990"),
            final_amount=Decimal("2990"),
            currency="RUB",
            status=Payment.Status.PENDING,
            provider="tbank",
            provider_payment_id="779",
            idempotency_key="tb-sync-1",
            billing_period="month",
            metadata={"plan_slug": "pro", "billing_period": "month"},
        )
        mock_post.return_value.json.return_value = {
            "Success": True,
            "Status": "CONFIRMED",
            "PaymentId": "779",
            "OrderId": f"{payment.pk}-sync01",
        }
        result = PaymentProviderService.sync_payment_from_provider(payment)
        self.assertTrue(result.get("ok"))
        self.assertTrue(result.get("synced"))
        payment.refresh_from_db()
        self.assertEqual(payment.status, Payment.Status.PAID)
        sub = TeacherSubscription.objects.get(teacher=self.user)
        self.assertEqual(sub.plan.slug, "pro")
