"""r61: автопродление с привязкой карты. Т-Банк полностью замокан (requests.post), реальных списаний нет."""

from __future__ import annotations

import hashlib
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.models import Payment, Profile, TariffPlan, TeacherSubscription
from Cabinet.payment_service import PaymentProviderService
from Cabinet.tbank_payment import build_tbank_token, verify_tbank_token

PWD = "TestPass"


def _plan(slug, month, year, **extra):
    plan, _ = TariffPlan.objects.update_or_create(
        slug=slug,
        defaults={"name": {"pro": "Профи", "start": "Старт"}.get(slug, slug), "price_month": Decimal(month),
                  "price_year": Decimal(year), "currency": "RUB", "is_active": True, "is_public": True,
                  "cta_type": TariffPlan.CtaType.CHECKOUT, "sort_order": 10, **extra},
    )
    return plan


def _signed(payload):
    payload = dict(payload)
    payload["Token"] = build_tbank_token(payload, password=PWD)
    return payload


class _Resp:
    def __init__(self, data):
        self._d = data

    def json(self):
        return self._d


class FakeTBank:
    """Мок API Т-Банка: запоминает запросы, отвечает по методу."""

    def __init__(self, charge_status="CONFIRMED", charge_success=True):
        self.calls = []
        self.charge_status = charge_status
        self.charge_success = charge_success
        self.n = 0

    def __call__(self, url, json=None, **kw):
        method = url.rstrip("/").rsplit("/", 1)[-1]
        self.calls.append((method, json))
        if method == "Init":
            self.n += 1
            return _Resp({"Success": True, "PaymentId": f"PID{self.n}", "Status": "NEW",
                          "PaymentURL": f"https://securepay.tinkoff.ru/new/PID{self.n}"})
        if method == "Charge":
            if not self.charge_success:
                return _Resp({"Success": False, "ErrorCode": "10", "Message": "Отказ банка", "Status": "REJECTED"})
            return _Resp({"Success": True, "Status": self.charge_status, "PaymentId": json["PaymentId"]})
        if method == "GetCardList":
            return _Resp([{"CardId": "555", "Pan": "220070******1234", "Status": "A", "RebillId": "RB-1"}])
        if method == "RemoveCard":
            return _Resp({"Success": True, "Status": "D"})
        if method == "GetState":
            return _Resp({"Success": True, "Status": "CONFIRMED", "PaymentId": json["PaymentId"]})
        return _Resp({"Success": False, "ErrorCode": "999"})

    def bodies(self, method):
        return [b for m, b in self.calls if m == method]


class TokenTests(TestCase):
    def test_bool_signed_lowercase_like_tbank(self):
        payload = {"TerminalKey": "T", "OrderId": "5-a", "Success": True, "Status": "CONFIRMED",
                   "PaymentId": 1, "ErrorCode": "0", "Amount": 199000, "RebillId": 77, "Pan": "220070******1234"}
        # Эталон по документации Т-Банка: значения по алфавиту ключей, булево — "true".
        pairs = {k: v for k, v in payload.items()}
        pairs["Password"] = PWD
        concat = "".join(("true" if v is True else "false" if v is False else str(v)) for _, v in sorted(pairs.items()))
        expected = hashlib.sha256(concat.encode()).hexdigest()
        self.assertTrue(verify_tbank_token({**payload, "Token": expected}, password=PWD))
        # Регрессия: старая подпись со str(True) == "True" больше не принимается.
        old = hashlib.sha256(concat.replace("true", "True").encode()).hexdigest()
        self.assertFalse(verify_tbank_token({**payload, "Token": old}, password=PWD))


@override_settings(PAYMENT_PROVIDER="tbank", TBANK_TERMINAL_KEY="TestKey", TBANK_PASSWORD=PWD,
                   TBANK_API_URL="https://tbank.invalid/v2", LK_PUBLIC_URL="https://example.com",
                   DEBUG=False, PAYMENTS_ENABLED=True, SUBSCRIPTION_REMINDERS_R50_ENABLED=True,
                   EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class AutoRenewFlowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("r61_teacher", "r61@example.com", "pass", first_name="Анна")
        Profile.objects.update_or_create(user=self.user, defaults={"role": Profile.Role.TEACHER})
        self.start = _plan("start", "0", "0", is_free=True, cta_type=TariffPlan.CtaType.REGISTER)
        self.pro = _plan("pro", "1990", "16716")
        self.sub = TeacherSubscription.objects.create(teacher=self.user, plan=self.start,
                                                      status=TeacherSubscription.Status.ACTIVE)
        self.user = User.objects.get(pk=self.user.pk)  # сбросить кэш profile после смены роли
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    # ── checkout ──
    def _checkout(self, fake, consent: bool):
        body = {"plan_slug": "pro", "billing_period": "month", "idempotency_key": f"k{consent}"}
        if consent:
            body.update(auto_renew=True, auto_renew_consent_text="Согласен на автоматическое продление подписки: «Профи» — 1 990 ₽ в месяц",
                        auto_renew_consent_version="AUTO_RENEW_V1_2026-10-17")
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake):
            r = self.client.post("/api/cabinet/subscription/create-payment/", body, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return Payment.objects.get(pk=r.json()["payment_id"])

    def _notify(self, payment, status="CONFIRMED", rebill="RB-1", **extra):
        payload = _signed({"TerminalKey": "TestKey", "OrderId": payment.order_id, "Success": True,
                           "Status": status, "PaymentId": int(payment.provider_payment_id.replace("PID", "") or 1),
                           "ErrorCode": "0", "Amount": int(payment.final_amount * 100),
                           "CardId": 555, "Pan": "220070******1234", "ExpDate": "1230",
                           **({"RebillId": rebill} if rebill else {}), **extra})
        # PaymentId в уведомлении — число; в Payment храним строку из Init
        return self.client.post("/payments/webhook/tbank/", payload, format="json")

    def test_no_consent_no_recurrent_and_no_autorenew(self):
        fake = FakeTBank()
        p = self._checkout(fake, consent=False)
        init = fake.bodies("Init")[0]
        self.assertNotIn("Recurrent", init)
        self.assertNotIn("CustomerKey", init)
        r = self._notify(p, rebill=None)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content, b"OK")
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "pro")
        self.assertFalse(self.sub.auto_renew)
        self.assertEqual(self.sub.tbank_rebill_id, "")

    def test_consent_sends_recurrent_saves_rebill_and_enables(self):
        from messaging.models import UserConsentLog

        fake = FakeTBank()
        p = self._checkout(fake, consent=True)
        init = fake.bodies("Init")[0]
        self.assertEqual(init.get("Recurrent"), "Y")
        self.assertEqual(init.get("CustomerKey"), f"teacher_{self.user.pk}")
        consent = p.metadata["auto_renew_consent"]
        self.assertEqual(consent["text_version"], "AUTO_RENEW_V1_2026-10-17")
        self.assertEqual(consent["renewal_amount"], "1990.00")
        self.assertTrue(consent["accepted_at"])
        self.assertTrue(UserConsentLog.objects.filter(user=self.user, consent_type="auto_renew", action="granted").exists())
        r = self._notify(p)
        self.assertEqual(r.content, b"OK")
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.tbank_rebill_id, "RB-1")
        self.assertEqual(self.sub.payment_method_mask, "220070******1234")
        self.assertTrue(self.sub.auto_renew)
        # кабинет: следующее списание = полная цена
        from Cabinet.subscription_api import _subscription_payload

        sub_payload = _subscription_payload(self.sub)
        self.assertEqual(Decimal(sub_payload["next_charge"]["amount"]), Decimal("1990"))
        self.assertTrue(sub_payload["has_payment_method"])

    def test_late_notification_after_getstate_enables(self):
        fake = FakeTBank()
        p = self._checkout(fake, consent=True)
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake):
            PaymentProviderService.sync_payment_from_provider(p)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "pro")
        self.assertFalse(self.sub.auto_renew)  # RebillId ещё нет
        self.assertEqual(self._notify(p).content, b"OK")
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.tbank_rebill_id, "RB-1")
        self.assertTrue(self.sub.auto_renew)

    def test_late_notification_respects_user_disable(self):
        fake = FakeTBank()
        p = self._checkout(fake, consent=True)
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake):
            PaymentProviderService.sync_payment_from_provider(p)
        r = self.client.post("/api/cabinet/subscription/manage/", {"action": "disable_auto_renew"},
                             format="json")
        self.assertEqual(r.status_code, 200)
        self._notify(p)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.tbank_rebill_id, "RB-1")
        self.assertFalse(self.sub.auto_renew)

    def test_bad_token_rejected(self):
        fake = FakeTBank()
        p = self._checkout(fake, consent=True)
        payload = {"TerminalKey": "TestKey", "OrderId": p.order_id, "Success": True, "Status": "CONFIRMED",
                   "PaymentId": 1, "Amount": 199000, "RebillId": "RB-X", "Token": "bad"}
        r = self.client.post("/payments/webhook/tbank/", payload, format="json")
        self.assertEqual(r.status_code, 400)
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.tbank_rebill_id, "")

    # ── кабинет ──
    def test_enable_requires_consent_and_rebill(self):
        self._make_paid_sub(auto_renew=False)
        r = self.client.post("/api/cabinet/subscription/manage/", {"action": "set_auto_renew", "enabled": True},
                             format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "CONSENT_REQUIRED")
        r = self.client.post("/api/cabinet/subscription/manage/",
                             {"action": "set_auto_renew", "enabled": True, "consent": True, "consent_text": "Согласен…"},
                             format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.sub.refresh_from_db()
        self.assertTrue(self.sub.auto_renew)
        from messaging.models import UserConsentLog

        self.assertTrue(UserConsentLog.objects.filter(user=self.user, consent_type="auto_renew", source="cabinet_toggle").exists())

    def test_unbind_card(self):
        self._make_paid_sub(auto_renew=True)
        fake = FakeTBank()
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake):
            r = self.client.post("/api/cabinet/subscription/manage/", {"action": "unbind_card"},
                                 format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["bank_removed"])
        self.assertEqual(fake.bodies("RemoveCard")[0]["CardId"], "555")
        self.sub.refresh_from_db()
        self.assertFalse(self.sub.auto_renew)
        self.assertEqual(self.sub.tbank_rebill_id, "")
        self.assertEqual(self.sub.plan.slug, "pro")  # доступ до конца периода сохраняется

    # ── автопродление ──
    def _make_paid_sub(self, *, auto_renew=True, hours_left=72):
        self.sub.plan = self.pro
        self.sub.status = TeacherSubscription.Status.ACTIVE
        self.sub.source = TeacherSubscription.Source.PAYMENT
        self.sub.billing_period = "month"
        self.sub.expires_at = timezone.now() + timedelta(hours=hours_left)
        self.sub.auto_renew = auto_renew
        self.sub.tbank_rebill_id = "RB-1"
        self.sub.tbank_customer_key = f"teacher_{self.user.pk}"
        self.sub.payment_method_mask = "220070******1234"
        self.sub.save()

    def _grant_consent(self):
        from Cabinet.r61_autorenew import log_consent

        log_consent(self.user, granted=True, text="Согласен…", source="test")

    def test_old_notification_retry_stores_rebill_but_never_enables_or_charges(self):
        """Повторные уведомления банка по старым платежам (до r61): RebillId сохраняем, auto_renew=False, без Charge."""
        from Cabinet.subscription_lifecycle import process_auto_renewals

        old = Payment.objects.create(
            teacher=self.user, subscription=self.sub, plan=self.pro, amount=Decimal("2990"),
            final_amount=Decimal("2990"), currency="RUB", status=Payment.Status.PENDING, provider="tbank",
            provider_payment_id="PID77", order_id="old-77", idempotency_key="old77", billing_period="month",
            customer_key=f"teacher_{self.user.pk}",
            metadata={"plan_slug": "pro", "billing_period": "month", "recurrent_parent": True},
        )
        old.order_id = f"{old.pk}-abc"
        old.save(update_fields=["order_id"])
        fake = FakeTBank()
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake):
            PaymentProviderService.sync_payment_from_provider(old)  # как было на проде: GetState
        old.refresh_from_db()
        self.assertEqual(old.status, "paid")
        for _ in range(3):  # банк повторяет ежедневно
            r = self._notify(old, rebill="RB-OLD")
            self.assertEqual(r.content, b"OK")
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.tbank_rebill_id, "RB-OLD")
        self.assertFalse(self.sub.auto_renew)
        from Cabinet.models import PaymentWebhookEvent

        self.assertEqual(PaymentWebhookEvent.objects.filter(payment=old, event_id__startswith="tbank_").count(), 1)
        # даже если кто-то включит auto_renew в обход согласия — списания нет
        TeacherSubscription.objects.filter(pk=self.sub.pk).update(
            auto_renew=True, expires_at=timezone.now() + timedelta(hours=3))
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake):
            res = process_auto_renewals()
        self.assertEqual(res["ok"], 0)
        self.assertEqual(fake.bodies("Charge"), [])
        self.assertEqual(Payment.objects.filter(is_recurrent=True).count(), 0)

    def test_renewal_full_price_success(self):
        from Cabinet.subscription_lifecycle import process_auto_renewals

        self._make_paid_sub(hours_left=3)
        self._grant_consent()
        old_exp = self.sub.expires_at
        fake = FakeTBank()
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake):
            res = process_auto_renewals()
        self.assertEqual(res["ok"], 1)
        self.assertEqual(fake.bodies("Init")[0]["Amount"], 199000)  # полная цена, без промокода
        self.assertNotIn("Recurrent", fake.bodies("Init")[0])
        self.assertEqual(fake.bodies("Charge")[0]["RebillId"], "RB-1")
        self.sub.refresh_from_db()
        self.assertGreater(self.sub.expires_at, old_exp + timedelta(days=27))
        self.assertTrue(self.sub.auto_renew)

    def test_renewal_failure_retry_then_disable_then_start(self):
        from Cabinet.subscription_lifecycle import process_auto_renewals, process_expired_subscriptions

        self._make_paid_sub(hours_left=3)
        self._grant_consent()
        fake = FakeTBank(charge_success=False)
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake):
            process_auto_renewals()
        self.sub.refresh_from_db()
        self.assertTrue(self.sub.auto_renew)  # будет повторная попытка
        self.assertEqual(Payment.objects.filter(status="failed", teacher=self.user).count(), 1)
        # через 13 часов — повтор
        later = timezone.now() + timedelta(hours=13)
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake), \
                patch("Cabinet.subscription_lifecycle.timezone.now", return_value=later):
            process_auto_renewals()
        self.assertEqual(len(fake.bodies("Charge")), 2)
        self.sub.refresh_from_db()
        self.assertFalse(self.sub.auto_renew)
        # третьей попытки нет
        with patch("Cabinet.tbank_payment.requests.post", side_effect=fake), \
                patch("Cabinet.subscription_lifecycle.timezone.now", return_value=later + timedelta(hours=13)):
            process_auto_renewals()
        self.assertEqual(len(fake.bodies("Charge")), 2)
        # после окончания периода — «Старт»
        TeacherSubscription.objects.filter(pk=self.sub.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        process_expired_subscriptions()
        self.sub.refresh_from_db()
        self.assertEqual(self.sub.plan.slug, "start")
        from Cabinet.models import Notification

        msgs = list(Notification.objects.filter(recipient_user=self.user, event_type="subscription_renew_failed")
                    .values_list("message", flat=True))
        self.assertTrue(any("повторим попытку" in m for m in msgs))
        self.assertTrue(any("Автопродление отключено" in m for m in msgs))

    # ── уведомление за 3 дня ──
    def test_renewal_notice_only_for_autorenew_with_rebill(self):
        from Cabinet.r61_autorenew import process_renewal_notices, renewal_notice_candidates

        self._make_paid_sub(auto_renew=True, hours_left=60)
        self._grant_consent()
        other = User.objects.create_user("r61_other", "o@example.com", "p")
        Profile.objects.update_or_create(user=other, defaults={"role": Profile.Role.TEACHER})
        TeacherSubscription.objects.create(teacher=other, plan=self.pro, status="active", source="payment",
                                           expires_at=timezone.now() + timedelta(hours=60), auto_renew=True,
                                           tbank_rebill_id="")
        ids = list(renewal_notice_candidates().values_list("teacher_id", flat=True))
        self.assertEqual(ids, [self.user.pk])
        # третий: auto_renew + RebillId, но без согласия (старый платёж) — уведомления нет
        third = User.objects.create_user("r61_third", "t3@example.com", "p")
        Profile.objects.update_or_create(user=third, defaults={"role": Profile.Role.TEACHER})
        TeacherSubscription.objects.create(teacher=third, plan=self.pro, status="active", source="payment",
                                           expires_at=timezone.now() + timedelta(hours=60), auto_renew=True,
                                           tbank_rebill_id="RB-3")
        mail.outbox = []
        res = process_renewal_notices(force=True)
        self.assertEqual(res["stats"].get("email:sent"), 1)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["r61@example.com"])
        self.assertIn("1\u00a0990\u00a0₽", mail.outbox[0].subject)
        self.assertIn("Отключить автопродление", mail.outbox[0].body)
        # повторно не шлём
        process_renewal_notices(force=True)
        self.assertEqual(len(mail.outbox), 1)
