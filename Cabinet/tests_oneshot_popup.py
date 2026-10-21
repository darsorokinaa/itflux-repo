"""Разовые окна (А/Б/В): тексты, приоритет, показ один раз, письмо Б один раз, r62 N1."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet import oneshot_popups as op
from Cabinet import r62_notifications as r62
from Cabinet.models import (
    Notification, OneShotPopup, Payment, Profile, SubscriptionReminderLog, TariffPlan, TeacherSubscription,
)
from messaging.models import UserConsent

MSK = ZoneInfo("Europe/Moscow")


def _teacher(name, **kw):
    u = User.objects.create_user(username=name, email=f"{name}@mail.ru", password="x", **kw)
    Profile.objects.update_or_create(user=u, defaults={"role": Profile.Role.TEACHER})
    return u


def _plan(slug, price="0"):
    p, _ = TariffPlan.objects.update_or_create(slug=slug, defaults={
        "name": slug.title(), "price_month": Decimal(price), "price_year": Decimal(price) * 10,
        "is_active": True, "is_free": slug == "start"})
    return p


def _sub(user, slug, expires_at, status="trial", **kw):
    s, _ = TeacherSubscription.objects.update_or_create(teacher=user, defaults=dict(
        plan=_plan(slug), status=status, expires_at=expires_at, source="launch_promo", **kw))
    return s


def _consent(user, channel="email_marketing"):
    UserConsent.objects.update_or_create(user=user, channel=channel, defaults={
        "granted": True, "consented_at": timezone.now(), "consent_text_version": "marketing_consent_v1",
        "source": "cabinet_banner"})


def _pending(user, slug="pro"):
    return Payment.objects.create(teacher=user, plan=_plan(slug, "1990"), amount=Decimal("1990"),
                                  final_amount=Decimal("1990"), status=Payment.Status.PENDING, provider="tbank")


def _n2_log(user):
    SubscriptionReminderLog.objects.create(teacher=user, kind="r62_n2", channel="in_app",
                                           period_end=date(2026, 10, 21), status="sent", plan_slug="pro")


class TextsTests(TestCase):
    def test_premium_when(self):
        now = datetime(2026, 10, 21, 10, 0, tzinfo=MSK)
        self.assertEqual(op.premium_when(now + timedelta(days=3), now), "Через 3 дня")
        self.assertEqual(op.premium_when(now + timedelta(days=5), now), "Через 5 дней")
        self.assertEqual(op.premium_when(now + timedelta(days=21), now), "Через 21 день")
        self.assertEqual(op.premium_when(now + timedelta(days=1), now), "Завтра")
        self.assertEqual(op.premium_when(now + timedelta(hours=5), now), "Сегодня")
        self.assertIsNone(op.premium_when(now - timedelta(minutes=1), now))
        r = op.render("premium_end", {"expires_at": (now + timedelta(days=1)).isoformat()}, now)
        self.assertEqual(r["title"], "Завтра заканчивается бесплатный «Премиум»")
        self.assertTrue(r["message"].startswith("Здравствуйте! Завтра закончится бесплатный доступ"))
        self.assertNotIn("potok", r["message"])

    def test_pro_thanks_today_and_after(self):
        ctx = {"period_end": "2026-10-21"}
        today = op.render("pro_thanks", ctx, datetime(2026, 10, 21, 20, 0, tzinfo=MSK))["message"]
        after = op.render("pro_thanks", ctx, datetime(2026, 10, 22, 9, 0, tzinfo=MSK))["message"]
        self.assertIn("Сегодня заканчивается Ваша подписка «Профи»", today)
        self.assertIn("Закончилась Ваша подписка «Профи»", after)

    def test_service_accounts(self):
        self.assertTrue(op.is_service_account(_teacher("boss", is_staff=True)))
        self.assertTrue(op.is_service_account(_teacher("qa_user")))
        self.assertFalse(op.is_service_account(_teacher("ivanova")))


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class RunTests(TestCase):
    def setUp(self):
        _plan("start"); _plan("pro", "1990"); _plan("premium", "3990")

    def test_b_and_c_priority_and_idempotent(self):
        c_only, b_only, both = _teacher("c_only"), _teacher("b_only"), _teacher("both")
        _n2_log(c_only); _n2_log(both)
        _pending(b_only); _pending(both)
        staff = _teacher("staffer", is_staff=True); _pending(staff)
        paid_later = _teacher("paid_later"); _pending(paid_later)
        Payment.objects.create(teacher=paid_later, amount=1, status=Payment.Status.PAID, provider="tbank")

        res = op.run()
        self.assertEqual(res["stats"]["C_people"], 2)
        self.assertEqual(res["stats"]["B_people"], 2)
        self.assertEqual(OneShotPopup.objects.filter(user=both).count(), 1)
        self.assertEqual(OneShotPopup.objects.get(user=both).kind, "pro_thanks")
        self.assertTrue(Notification.objects.filter(recipient_user=both, event_type="oneshot_payment_unfinished").exists())
        self.assertEqual(OneShotPopup.objects.get(user=b_only).kind, "payment_unfinished")
        self.assertFalse(OneShotPopup.objects.filter(user__in=[staff, paid_later]).exists())
        n = OneShotPopup.objects.count()
        op.run()
        self.assertEqual(OneShotPopup.objects.count(), n)
        self.assertEqual(Notification.objects.filter(event_type__startswith="oneshot_").count(), 1)

    def test_dry_run_writes_nothing(self):
        u = _teacher("b_dry"); _pending(u)
        v = _teacher("b_mail"); _pending(v); _consent(v)
        res = op.run(dry_run=True)
        self.assertEqual(res["stats"]["B:popup"], 1)
        self.assertEqual(res["stats"]["B:email_would_send"], 1)
        self.assertFalse(OneShotPopup.objects.exists())
        self.assertEqual(len(mail.outbox), 0)
        self.assertFalse(SubscriptionReminderLog.objects.filter(kind=op.B_EMAIL_KIND).exists())

    def test_b_email_once_instead_of_popup(self):
        v = _teacher("b_mail"); _pending(v); _consent(v)
        _consent(_teacher("no_pending"))
        op.run(); op.run()
        self.assertEqual(len(mail.outbox), 1)
        m = mail.outbox[0]
        self.assertEqual(m.subject, "Оплата не завершилась")
        self.assertIn("potok1110", m.body)
        self.assertIn("https://itflux-academy.ru/pricing", m.body)
        self.assertIn("/api/cabinet/r52/marketing/unsubscribe/", m.body)
        self.assertIn("List-Unsubscribe", m.extra_headers)
        self.assertFalse(OneShotPopup.objects.filter(user=v).exists())

    def test_inapp_consent_alone_does_not_send_email(self):
        v = _teacher("b_inapp"); _pending(v); _consent(v, "inapp_marketing")
        op.run()
        self.assertEqual(len(mail.outbox), 0)
        self.assertTrue(OneShotPopup.objects.filter(user=v, kind="payment_unfinished").exists())


class ApiTests(TestCase):
    def setUp(self):
        self.u = _teacher("api_t"); _pending(self.u); op.run()

    def test_shown_once_across_devices(self):
        a, b = APIClient(), APIClient()
        a.force_authenticate(self.u); b.force_authenticate(self.u)
        p = a.get("/api/cabinet/oneshot-popup/").json()["popup"]
        self.assertEqual(p["title"], "Оплата не завершилась")
        self.assertEqual(p["button_url"], "/pricing")
        self.assertEqual(p["signature"], "Дарья, «Цифровой поток»")
        self.assertTrue(a.post(f"/api/cabinet/oneshot-popup/{p['id']}/seen/").json()["ok"])
        self.assertIsNone(b.get("/api/cabinet/oneshot-popup/").json()["popup"])
        a.post(f"/api/cabinet/oneshot-popup/{p['id']}/close/", {"action": "button"}, format="json")
        row = OneShotPopup.objects.get(pk=p["id"])
        self.assertEqual((row.status, row.close_action), ("closed", "button"))
        self.assertIsNotNone(row.shown_at)

    def test_other_user_cannot_touch(self):
        p = OneShotPopup.objects.get(user=self.u)
        c = APIClient(); c.force_authenticate(_teacher("intruder"))
        self.assertFalse(c.post(f"/api/cabinet/oneshot-popup/{p.pk}/seen/").json()["ok"])
        self.assertFalse(c.post(f"/api/cabinet/oneshot-popup/{p.pk}/close/").json()["ok"])

    def test_paid_after_pending_hides_popup(self):
        Payment.objects.create(teacher=self.u, amount=1, status=Payment.Status.PAID, provider="tbank")
        self.assertIsNone(op.next_popup(self.u))
        self.assertEqual(OneShotPopup.objects.get(user=self.u).status, "expired")


class R62Tests(TestCase):
    def setUp(self):
        _plan("start"); _plan("pro", "1990")
        self.now = timezone.now()

    def test_n1_new_text_and_popup(self):
        u = _teacher("prem")
        s = _sub(u, "premium", self.now + timedelta(days=3, hours=1))
        self.assertEqual(r62.send_one("n1", s, self.now, promo=True), "sent")
        n = Notification.objects.get(recipient_user=u, event_type="subscription_r62_n1")
        self.assertIn("Через 3 дня заканчивается бесплатный «Премиум»", n.title)
        self.assertNotIn("potok", n.message)
        self.assertNotIn("995", n.message)
        p = OneShotPopup.objects.get(user=u)
        self.assertEqual(p.kind, "premium_end")
        self.assertEqual(op.next_popup(u, self.now)["title"], "Через 3 дня заканчивается бесплатный «Премиум»")
        self.assertEqual(op.next_popup(u, self.now + timedelta(days=2, hours=12))["title"][:6], "Завтра")

    def test_old_format_n1_backfill_once_and_not_after_end(self):
        u = _teacher("prem_old")
        s = _sub(u, "premium", self.now + timedelta(days=2))
        SubscriptionReminderLog.objects.create(teacher=u, kind="r62_n1", channel="in_app", plan_slug="premium",
                                               period_end=s.expires_at.date(), status="sent", detail="r62 sub old service")
        r62.run(self.now); r62.run(self.now)
        self.assertEqual(OneShotPopup.objects.filter(user=u).count(), 1)
        self.assertIsNone(op.next_popup(u, s.expires_at + timedelta(minutes=1)))

    def test_scheduled_pro_and_higher_priority(self):
        a = _teacher("prem_pro")
        sa = _sub(a, "premium", self.now + timedelta(days=3), scheduled_plan=_plan("pro", "1990"))
        r62.send_one("n1", sa, self.now, promo=False)
        self.assertFalse(OneShotPopup.objects.filter(user=a).exists())
        b = _teacher("prem_b"); _pending(b); op.run()
        sb = _sub(b, "premium", self.now + timedelta(days=3))
        r62.send_one("n1", sb, self.now, promo=False)
        self.assertEqual(list(OneShotPopup.objects.filter(user=b).values_list("kind", flat=True)), ["payment_unfinished"])
        self.assertTrue(Notification.objects.filter(recipient_user=b, event_type="subscription_r62_n1").exists())


class R62ScheduledPaidTests(TestCase):
    def test_n1_skips_scheduled_paid_plan(self):
        now = timezone.now()
        a = _teacher("prem_to_pro"); _sub(a, "premium", now + timedelta(days=3), scheduled_plan=_plan("pro", "1990"))
        b = _teacher("prem_to_start"); _sub(b, "premium", now + timedelta(days=3), scheduled_plan=_plan("start"))
        c = _teacher("prem_plain"); _sub(c, "premium", now + timedelta(days=3))
        ids = {s.teacher_id for s in r62.n1_subscriptions(now)}
        self.assertNotIn(a.pk, ids)
        self.assertIn(b.pk, ids)
        self.assertIn(c.pk, ids)
