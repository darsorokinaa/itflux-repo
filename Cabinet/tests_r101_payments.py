"""r101: reconcile pending (GetState), ошибки Init, dedupe checkout, алерты webhook, окно «Вернуться к оплате»."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

import requests
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from Cabinet import oneshot_popups as popups
from Cabinet.models import OneShotPopup, Payment, PaymentWebhookEvent, Profile, TariffPlan, TeacherSubscription
from Cabinet.payment_alerts import counters
from Cabinet.payment_reconcile import reconcile
from Cabinet.payment_service import PaymentProviderService

SETTINGS = dict(
    PAYMENT_PROVIDER="tbank", TBANK_TERMINAL_KEY="TestKey", TBANK_PASSWORD="TestPass",
    LK_PUBLIC_URL="https://example.com", DEBUG=True,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)


def _plan(slug, month):
    plan, _ = TariffPlan.objects.update_or_create(slug=slug, defaults={
        "name": slug.title(), "price_month": Decimal(month), "price_year": Decimal(month) * 10,
        "currency": "RUB", "is_active": True, "is_public": True,
        "cta_type": TariffPlan.CtaType.CHECKOUT, "sort_order": 10,
    })
    return plan


def _init_ok(pid):
    return {"Success": True, "PaymentId": str(pid), "Status": "NEW",
            "PaymentURL": f"https://securepay.tinkoff.ru/new/{pid}"}


@override_settings(**SETTINGS)
class R101Base(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("r101_teacher", "r101@example.com", "pass")
        Profile.objects.update_or_create(user=self.user, defaults={"role": Profile.Role.TEACHER})
        self.start = _plan("start", "0")
        self.start.is_free = True
        self.start.cta_type = TariffPlan.CtaType.REGISTER
        self.start.save()
        self.pro = _plan("pro", "2990")
        self.premium = _plan("premium", "3990")
        TeacherSubscription.objects.create(teacher=self.user, plan=self.start,
                                           status=TeacherSubscription.Status.ACTIVE)

    def _pending(self, pid="555", age=timedelta(hours=2), plan=None, url=True, **kw):
        plan = plan or self.pro
        p = Payment.objects.create(
            teacher=self.user, plan=plan, amount=plan.price_month, final_amount=plan.price_month,
            currency="RUB", status=Payment.Status.PENDING, provider="tbank", provider_payment_id=pid,
            idempotency_key=f"k{pid}{timezone.now().timestamp()}", billing_period="month",
            metadata={"plan_slug": plan.slug, "billing_period": "month",
                      **({"payment_url": f"https://securepay.tinkoff.ru/new/{pid}"} if url and pid else {})},
            **kw,
        )
        Payment.objects.filter(pk=p.pk).update(created_at=timezone.now() - age)
        p.refresh_from_db()
        return p


class ReconcileTests(R101Base):
    def test_dry_run_writes_nothing(self):
        p = self._pending()
        res = reconcile(dry_run=True, get_state=lambda pid: {"Success": True, "Status": "DEADLINE_EXPIRED"})
        p.refresh_from_db()
        self.assertEqual(p.status, Payment.Status.PENDING)
        self.assertEqual(res["summary"]["mark_cancelled"], 1)
        self.assertFalse(PaymentWebhookEvent.objects.exists())

    def test_expired_marked_cancelled_with_code(self):
        p = self._pending()
        reconcile(dry_run=False, get_state=lambda pid: {"Success": True, "Status": "DEADLINE_EXPIRED", "ErrorCode": "0"})
        p.refresh_from_db()
        self.assertEqual(p.status, Payment.Status.CANCELLED)
        self.assertEqual(p.error_code, "DEADLINE_EXPIRED")

    def test_rejected_marked_failed(self):
        p = self._pending()
        reconcile(dry_run=False, get_state=lambda pid: {"Success": True, "Status": "REJECTED",
                                                         "ErrorCode": "1051", "Message": "Недостаточно средств"})
        p.refresh_from_db()
        self.assertEqual(p.status, Payment.Status.FAILED)
        self.assertEqual(p.error_code, "1051")

    def test_young_and_in_progress_untouched(self):
        young = self._pending(pid="1", age=timedelta(minutes=10))
        form = self._pending(pid="2")
        res = reconcile(dry_run=False, get_state=lambda pid: {"Success": True, "Status": "FORM_SHOWED"})
        self.assertEqual(res["summary"]["checked"], 1)
        for p in (young, form):
            p.refresh_from_db()
            self.assertEqual(p.status, Payment.Status.PENDING)

    def test_no_payment_id_marked_failed(self):
        p = self._pending(pid="")
        reconcile(dry_run=False, get_state=lambda pid: self.fail("GetState не нужен"))
        p.refresh_from_db()
        self.assertEqual(p.status, Payment.Status.FAILED)
        self.assertEqual(p.error_code, "init_no_payment_id")

    @patch("Cabinet.tbank_payment.requests.post")
    def test_confirmed_activates_and_alerts_without_webhook(self, mock_post):
        mock_post.return_value.json.return_value = {"Success": True, "Status": "CONFIRMED", "PaymentId": "555"}
        p = self._pending()
        with self.assertLogs("Cabinet.payments.alerts", level="ERROR"):
            res = reconcile(dry_run=False)
        p.refresh_from_db()
        self.assertEqual(p.status, Payment.Status.PAID)
        self.assertEqual(res["summary"]["confirmed_without_webhook"], 1)
        self.assertEqual(TeacherSubscription.objects.get(teacher=self.user).plan.slug, "pro")
        self.assertIn("confirmed_without_webhook", list(counters(1).values())[0])
        # повтор — идемпотентно, платёж уже не pending
        self.assertEqual(reconcile(dry_run=False)["summary"].get("checked", 0), 0)

    def test_getstate_error_counted(self):
        self._pending()
        def boom(pid):
            raise requests.exceptions.Timeout()
        self.assertEqual(reconcile(dry_run=False, get_state=boom)["summary"]["getstate_error"], 1)

    def test_command_default_dry_run(self):
        p = self._pending()
        out = StringIO()
        with patch("Cabinet.tbank_payment.get_state_raw",
                   return_value={"Success": True, "Status": "DEADLINE_EXPIRED"}):
            call_command("reconcile_pending_payments", stdout=out)
        self.assertIn("DRY-RUN", out.getvalue())
        p.refresh_from_db()
        self.assertEqual(p.status, Payment.Status.PENDING)


class InitErrorTests(R101Base):
    @patch("Cabinet.tbank_payment.requests.post")
    def test_rejected_init_saves_code_message_details(self, mock_post):
        mock_post.return_value.json.return_value = {"Success": False, "ErrorCode": "9999",
                                                    "Message": "Ошибка", "Details": "Терминал заблокирован"}
        with self.assertRaises(ValueError), self.assertLogs("Cabinet.payments.alerts", level="ERROR"):
            PaymentProviderService.create_payment(teacher=self.user, plan=self.pro, billing_period="month")
        p = Payment.objects.get(teacher=self.user)
        self.assertEqual(p.status, Payment.Status.FAILED)
        self.assertEqual(p.error_code, "9999")
        self.assertEqual(p.error_message, "Ошибка: Терминал заблокирован")

    @patch("Cabinet.tbank_payment.requests.post", side_effect=requests.exceptions.Timeout("read timeout"))
    def test_http_timeout_saved(self, _):
        with self.assertRaises(ValueError):
            PaymentProviderService.create_payment(teacher=self.user, plan=self.pro, billing_period="month")
        p = Payment.objects.get(teacher=self.user)
        self.assertEqual(p.error_code, "http_timeout")
        self.assertIn("Timeout", p.error_message)

    @patch("Cabinet.tbank_payment.requests.post")
    def test_init_sends_redirect_due_date(self, mock_post):
        mock_post.return_value.json.return_value = _init_ok(1)
        PaymentProviderService.create_payment(teacher=self.user, plan=self.pro, billing_period="month")
        body = mock_post.call_args.kwargs["json"]
        self.assertIn("RedirectDueDate", body)


class DedupeTests(R101Base):
    @patch("Cabinet.tbank_payment.requests.post")
    def test_same_plan_reuses_url_without_init(self, mock_post):
        old = self._pending(pid="700", age=timedelta(minutes=20))
        res = PaymentProviderService.create_payment(teacher=self.user, plan=self.pro, billing_period="month")
        self.assertEqual(res["payment_id"], old.pk)
        self.assertTrue(res["reused_checkout"])
        self.assertEqual(res["payment_url"], "https://securepay.tinkoff.ru/new/700")
        mock_post.assert_not_called()
        self.assertEqual(Payment.objects.filter(teacher=self.user).count(), 1)

    @patch("Cabinet.tbank_payment.requests.post")
    def test_old_form_not_reused(self, mock_post):
        mock_post.return_value.json.return_value = _init_ok(701)
        self._pending(pid="700", age=timedelta(hours=23, minutes=45))
        res = PaymentProviderService.create_payment(teacher=self.user, plan=self.pro, billing_period="month")
        self.assertNotIn("reused_checkout", res)

    @patch("Cabinet.tbank_payment.requests.post")
    def test_other_plan_marks_superseded_without_cancel(self, mock_post):
        mock_post.return_value.json.return_value = _init_ok(702)
        old = self._pending(pid="700", age=timedelta(minutes=20), plan=self.premium)
        res = PaymentProviderService.create_payment(teacher=self.user, plan=self.pro, billing_period="month")
        old.refresh_from_db()
        self.assertEqual(old.metadata.get("superseded_by"), res["payment_id"])
        self.assertEqual(old.status, Payment.Status.PENDING)  # без TBANK_CANCEL_SUPERSEDED банк не трогаем
        self.assertEqual(mock_post.call_count, 1)  # только Init

    @override_settings(TBANK_CANCEL_SUPERSEDED="1")
    @patch("Cabinet.tbank_payment.cancel_payment", return_value=True)
    @patch("Cabinet.tbank_payment.get_state_raw", return_value={"Success": True, "Status": "FORM_SHOWED"})
    @patch("Cabinet.tbank_payment.requests.post")
    def test_other_plan_cancelled_when_enabled_and_safe(self, mock_post, _gs, mock_cancel):
        mock_post.return_value.json.return_value = _init_ok(703)
        old = self._pending(pid="700", age=timedelta(minutes=20), plan=self.premium)
        PaymentProviderService.create_payment(teacher=self.user, plan=self.pro, billing_period="month")
        old.refresh_from_db()
        mock_cancel.assert_called_once_with("700")
        self.assertEqual(old.status, Payment.Status.CANCELLED)
        self.assertEqual(old.error_code, "superseded")


class WebhookAlertTests(R101Base):
    def test_rejected_webhook_logs_error_and_counts(self):
        with self.assertLogs("Cabinet.payments.alerts", level="ERROR"):
            r = self.client.post("/payments/webhook/tbank/", {"Status": "CONFIRMED", "Token": "bad"},
                                 content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(list(counters(1).values())[0]["webhook_rejected"], 1)


class CheckoutReminderTests(R101Base):
    def test_popup_after_15_min_once_and_dismissable(self):
        self.assertIsNone(popups.next_popup(self.user))  # нет платежей
        p = self._pending(pid="800", age=timedelta(minutes=10))
        self.assertIsNone(popups.next_popup(self.user))  # ещё рано
        Payment.objects.filter(pk=p.pk).update(created_at=timezone.now() - timedelta(minutes=20))
        data = popups.next_popup(self.user)
        self.assertEqual(data["button_label"], "Вернуться к оплате")
        self.assertEqual(data["button_url"], "https://securepay.tinkoff.ru/new/800")
        self.assertTrue(popups.mark_shown(self.user, data["id"]))
        self.assertTrue(popups.mark_closed(self.user, data["id"]))
        self.assertIsNone(popups.next_popup(self.user))
        self.assertEqual(OneShotPopup.objects.filter(user=self.user).count(), 1)

    def test_no_popup_if_paid_later(self):
        self._pending(pid="801", age=timedelta(minutes=40))
        paid = self._pending(pid="802", age=timedelta(minutes=30))
        Payment.objects.filter(pk=paid.pk).update(status=Payment.Status.PAID)
        self.assertIsNone(popups.next_popup(self.user))

    def test_expired_form_offers_new_checkout(self):
        p = self._pending(pid="803", age=timedelta(minutes=20))
        data = popups.next_popup(self.user)
        Payment.objects.filter(pk=p.pk).update(created_at=timezone.now() - timedelta(hours=23, minutes=55))
        popup = OneShotPopup.objects.get(pk=data["id"])
        self.assertEqual(popups.payload(popup)["button_url"], "/pricing?plan=pro&period=month")
