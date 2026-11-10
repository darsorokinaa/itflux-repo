"""Публичная сумма рождественского сбора: подписки T-Bank + ручная поправка, без персональных данных."""
from __future__ import annotations

import json
import tempfile
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from Cabinet.fundraiser_api import CACHE_KEY
from Cabinet.models import Fundraiser, Payment

MSK = ZoneInfo("Europe/Moscow")
CUTOFF = datetime(2026, 11, 6, 0, 0, tzinfo=MSK)

INDEX = (
    '<!doctype html><html><head><meta name="description" content="x" /><title>x</title></head>'
    '<body><div id="root"></div></body></html>'
)
_TMP = tempfile.mkdtemp()
(Path(_TMP) / "index.html").write_text(INDEX, encoding="utf-8")

LOC_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "fundraiser-tests"}}


def _pay(teacher, *, final_amount, status, purpose, provider, paid_at, **extra):
    return Payment.objects.create(
        teacher=teacher,
        amount=final_amount if final_amount is not None else Decimal("1.00"),
        final_amount=final_amount,
        currency="RUB",
        status=status,
        purpose=purpose,
        provider=provider,
        paid_at=paid_at,
        **extra,
    )


@override_settings(CACHES=LOC_CACHE)
class FundraiserCurrentApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.fundraiser = Fundraiser.objects.get(slug="rozhdestvenskiy-sbor")
        self.teacher = User.objects.create_user(
            username="secret_payer_login",
            email="secret-payer@example.com",
            password="StrongPass123!",
            first_name="Секрет",
            last_name="Плательщик",
        )

    def _get(self):
        return self.client.get("/api/fundraiser/current/")

    def test_seeded_window_and_manual_adjustment(self):
        self.assertEqual(self.fundraiser.manual_adjustment_rub, Decimal("3220.00"))
        self.assertEqual(self.fundraiser.include_subscriptions_since, CUTOFF)
        self.assertTrue(self.fundraiser.is_active)
        self.assertIsNone(self.fundraiser.goal_rub)

        _pay(
            self.teacher,
            final_amount=Decimal("495.00"),
            status=Payment.Status.PAID,
            purpose=Payment.Purpose.SUBSCRIPTION,
            provider="tbank",
            paid_at=CUTOFF,
            provider_payment_id="pay_secret_495",
            metadata={"card": "4111111111111111", "email": "secret-payer@example.com"},
        )
        response = self._get()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["amount_rub"], 3715)
        self.assertNotIn("goal_rub", body)
        self.assertIn("updated_at", body)
        parsed = datetime.fromisoformat(body["updated_at"])
        self.assertLess(abs((timezone.now() - parsed).total_seconds()), 120)

    def test_sum_filters_status_purpose_provider_and_date(self):
        included = [
            (Decimal("495.00"), CUTOFF),
            (Decimal("1000.00"), datetime(2026, 11, 10, 12, 0, tzinfo=MSK)),
        ]
        for amount, paid_at in included:
            _pay(
                self.teacher,
                final_amount=amount,
                status=Payment.Status.PAID,
                purpose=Payment.Purpose.SUBSCRIPTION,
                provider="tbank",
                paid_at=paid_at,
            )
        excluded = [
            dict(final_amount=Decimal("9999.00"), status=Payment.Status.PENDING, purpose=Payment.Purpose.SUBSCRIPTION, provider="tbank", paid_at=CUTOFF),
            dict(final_amount=Decimal("8888.00"), status=Payment.Status.FAILED, purpose=Payment.Purpose.SUBSCRIPTION, provider="tbank", paid_at=CUTOFF),
            dict(final_amount=Decimal("7777.00"), status=Payment.Status.REFUNDED, purpose=Payment.Purpose.SUBSCRIPTION, provider="tbank", paid_at=CUTOFF),
            dict(final_amount=Decimal("6666.00"), status=Payment.Status.CANCELLED, purpose=Payment.Purpose.SUBSCRIPTION, provider="tbank", paid_at=CUTOFF),
            dict(final_amount=Decimal("5555.00"), status=Payment.Status.PAID, purpose=Payment.Purpose.MATERIAL, provider="tbank", paid_at=CUTOFF),
            dict(final_amount=Decimal("4444.00"), status=Payment.Status.PAID, purpose=Payment.Purpose.LESSON, provider="tbank", paid_at=CUTOFF),
            dict(final_amount=Decimal("3333.00"), status=Payment.Status.PAID, purpose=Payment.Purpose.SUBSCRIPTION, provider="mock", paid_at=CUTOFF),
            dict(final_amount=Decimal("2222.00"), status=Payment.Status.PAID, purpose=Payment.Purpose.SUBSCRIPTION, provider="tinkoff", paid_at=CUTOFF),
            dict(final_amount=Decimal("1111.00"), status=Payment.Status.PAID, purpose=Payment.Purpose.SUBSCRIPTION, provider="tbank", paid_at=CUTOFF - timedelta(seconds=1)),
            dict(final_amount=None, status=Payment.Status.PAID, purpose=Payment.Purpose.SUBSCRIPTION, provider="tbank", paid_at=CUTOFF),
            dict(final_amount=Decimal("1234.00"), status=Payment.Status.PAID, purpose=Payment.Purpose.SUBSCRIPTION, provider="tbank", paid_at=None),
        ]
        for spec in excluded:
            _pay(self.teacher, **spec)

        body = self._get().json()
        self.assertEqual(body["amount_rub"], 3220 + 495 + 1000)

    def test_response_has_no_personal_data(self):
        _pay(
            self.teacher,
            final_amount=Decimal("495.00"),
            status=Payment.Status.PAID,
            purpose=Payment.Purpose.SUBSCRIPTION,
            provider="tbank",
            paid_at=CUTOFF,
            provider_payment_id="pay_secret_123",
            order_id="order_secret_456",
            customer_key="customer_secret_789",
            metadata={"email": "secret-payer@example.com", "name": "Секрет Плательщик"},
        )
        response = self._get()
        raw = response.content.decode()
        self.assertEqual(set(response.json()), {"amount_rub", "updated_at"})
        for secret in (
            "secret_payer_login",
            "secret-payer@example.com",
            "Секрет",
            "Плательщик",
            "pay_secret_123",
            "order_secret_456",
            "customer_secret_789",
        ):
            self.assertNotIn(secret, raw)

    def test_goal_is_optional(self):
        self.fundraiser.goal_rub = Decimal("50000.00")
        self.fundraiser.save()
        body = self._get().json()
        self.assertEqual(body["goal_rub"], 50000)
        self.assertEqual(set(body), {"amount_rub", "updated_at", "goal_rub"})

    def test_inactive_fundraiser_is_not_public(self):
        self.fundraiser.is_active = False
        self.fundraiser.save()
        response = self._get()
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("amount_rub", response.json())
        self.assertNotIn("secret_payer_login", response.content.decode())

    def test_result_is_cached_until_the_record_changes(self):
        first = self._get().json()
        second = self._get().json()
        self.assertEqual(first, second)
        self.assertIsNotNone(cache.get(CACHE_KEY))

        self.fundraiser.manual_adjustment_rub = Decimal("4000.00")
        self.fundraiser.save()
        self.assertIsNone(cache.get(CACHE_KEY))
        third = self._get().json()
        self.assertEqual(third["amount_rub"], 4000)
        self.assertNotEqual(third["updated_at"], first["updated_at"])

    def test_kopecks_stay_numeric(self):
        _pay(
            self.teacher,
            final_amount=Decimal("10.50"),
            status=Payment.Status.PAID,
            purpose=Payment.Purpose.SUBSCRIPTION,
            provider="tbank",
            paid_at=CUTOFF,
        )
        body = self._get().json()
        self.assertEqual(body["amount_rub"], 3230.5)
        self.assertIsInstance(body["amount_rub"], float)
        encoded = json.dumps(body)
        self.assertNotIn('"3230.50"', encoded)


@override_settings(FRONTEND_DIR=Path(_TMP), DEBUG=False, CACHES=LOC_CACHE)
class FundraiserRouteTests(TestCase):
    def test_page_renders_with_seo_and_sitemap(self):
        response = self.client.get("/rozhdestvenskiy-sbor")
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn("<div id=\"root\">", html)
        self.assertIn("🎄 Рождественский сбор — Цифровой поток", html)
        self.assertIn("детских домов", html)
        self.assertIn('rel="canonical" href="https://itflux-academy.ru/rozhdestvenskiy-sbor"', html)

        trailing = self.client.get("/rozhdestvenskiy-sbor/")
        self.assertEqual(trailing.status_code, 200)

        sitemap = self.client.get("/sitemap.xml")
        self.assertEqual(sitemap.status_code, 200)
        self.assertIn("<loc>https://itflux-academy.ru/rozhdestvenskiy-sbor</loc>", sitemap.content.decode())
