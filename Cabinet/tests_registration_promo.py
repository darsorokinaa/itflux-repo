from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from Cabinet.models import Profile, Promotion, TariffPlan, TeacherSubscription
from Cabinet.referral_service import ReferralService, add_months
from Cabinet.registration_promo import (
    LAUNCH_PROMO_CODE,
    PROMO_MONTHS,
    apply_registration_promo,
    ensure_launch_promotion,
    is_promo_window_open,
    promo_deadline,
    registration_qualifies_for_promo,
)


class RegistrationPromoTests(TestCase):
    def setUp(self):
        self.premium, _ = TariffPlan.objects.get_or_create(
            slug="premium",
            defaults={
                "name": "Премиум",
                "price_month": Decimal("3990"),
                "sort_order": 3,
                "is_active": True,
                "content_access_rank": 3,
            },
        )
        if self.premium.content_access_rank < 3:
            self.premium.content_access_rank = 3
            self.premium.save(update_fields=["content_access_rank"])
        if not self.premium.is_active:
            self.premium.is_active = True
            self.premium.save(update_fields=["is_active"])
        TariffPlan.objects.get_or_create(
            slug="start",
            defaults={"name": "Старт", "price_month": Decimal("0"), "sort_order": 0},
        )
        self.pro, _ = TariffPlan.objects.get_or_create(
            slug="pro",
            defaults={
                "name": "Профи",
                "price_month": Decimal("2990"),
                "sort_order": 2,
                "is_active": True,
                "content_access_rank": 2,
            },
        )
        self.profi, _ = TariffPlan.objects.get_or_create(
            slug="profi",
            defaults={
                "name": "Профи",
                "price_month": Decimal("1990"),
                "sort_order": 2,
                "is_active": True,
                "content_access_rank": 0,
            },
        )
        self.promo = ensure_launch_promotion()
        if self.promo and self.promo.plan_id != self.premium.pk:
            self.promo.plan = self.premium
            self.promo.save(update_fields=["plan"])

    def _teacher(self, username="promo_teacher"):
        user = User.objects.create_user(
            username=username,
            email=f"{username}@ex.com",
            password="Pass12345!",
        )
        user.profile.role = Profile.Role.TEACHER
        user.profile.save(update_fields=["role"])
        return user

    def test_deadline_and_window(self):
        self.assertEqual(
            timezone.localtime(promo_deadline(), ZoneInfo("Europe/Moscow")).date().isoformat(),
            "2027-01-01",
        )
        before = timezone.make_aware(datetime(2026, 12, 31, 23, 0), ZoneInfo("Europe/Moscow"))
        on_day = timezone.make_aware(datetime(2027, 1, 1, 0, 0), ZoneInfo("Europe/Moscow"))
        still_open = timezone.make_aware(datetime(2026, 10, 1, 0, 0), ZoneInfo("Europe/Moscow"))
        self.assertTrue(registration_qualifies_for_promo(before))
        self.assertTrue(registration_qualifies_for_promo(still_open))
        self.assertFalse(registration_qualifies_for_promo(on_day))

    def test_grant_premium_three_months_from_registration(self):
        user = self._teacher()
        started = ReferralService.registration_started_at(user)
        result = apply_registration_promo(user)
        self.assertIsNotNone(result)
        self.assertEqual(result["plan_slug"], "premium")
        sub = TeacherSubscription.objects.select_related("plan").get(teacher=user)
        self.assertEqual(sub.plan.slug, "premium")
        self.assertEqual(sub.status, TeacherSubscription.Status.TRIAL)
        self.assertEqual(sub.expires_at, add_months(started, PROMO_MONTHS))

    def test_register_endpoint_grants_promo(self):
        if not is_promo_window_open():
            self.skipTest("promo window closed")
        resp = self.client.post(
            "/api/cabinet/register/",
            data={
                "email": "promo_reg@ex.com",
                "password": "Pass12345!",
                "password_confirm": "Pass12345!",
                "name": "Анна",
                "surname": "Петрова",
                "role": "teacher",
            },
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        self.assertIn("registration_promo", data)
        user = User.objects.get(email="promo_reg@ex.com")
        self.assertEqual(user.subscription.plan.slug, "premium")

    def test_legacy_profi_remapped_to_premium(self):
        user = self._teacher("legacy_profi")
        started = ReferralService.registration_started_at(user)
        TeacherSubscription.objects.create(
            teacher=user,
            plan=self.profi,
            status=TeacherSubscription.Status.ACTIVE,
            expires_at=add_months(started, 1),
        )
        result = apply_registration_promo(user)
        self.assertIsNotNone(result)
        sub = TeacherSubscription.objects.get(teacher=user)
        self.assertEqual(sub.plan.slug, "premium")
        self.assertEqual(sub.plan_id, self.premium.pk)
        self.assertEqual(sub.expires_at, add_months(started, PROMO_MONTHS))

    def test_pro_upgraded_to_premium(self):
        user = self._teacher("pro_teacher")
        started = ReferralService.registration_started_at(user)
        TeacherSubscription.objects.create(
            teacher=user,
            plan=self.pro,
            status=TeacherSubscription.Status.TRIAL,
            expires_at=add_months(started, PROMO_MONTHS),
        )
        result = apply_registration_promo(user)
        self.assertIsNotNone(result)
        sub = TeacherSubscription.objects.get(teacher=user)
        self.assertEqual(sub.plan.slug, "premium")

    def test_ensure_on_existing_start_subscription(self):
        from Cabinet.registration_promo import ensure_registration_promo
        from Cabinet.subscription_service import SubscriptionLimitService

        user = self._teacher("start_teacher")
        SubscriptionLimitService.get_or_create_subscription(user, apply_promo=False)
        self.assertEqual(user.subscription.plan.slug, "start")
        result = ensure_registration_promo(user)
        self.assertIsNotNone(result)
        user.subscription.refresh_from_db()
        self.assertEqual(user.subscription.plan.slug, "premium")

    def test_inactive_promotion_stops_grant(self):
        self.promo.is_active = False
        self.promo.save(update_fields=["is_active"])
        user = self._teacher("after_end")
        self.assertIsNone(apply_registration_promo(user))
        self.promo.is_active = True
        self.promo.save(update_fields=["is_active"])

    def test_launch_promo_row_exists_in_db(self):
        row = Promotion.objects.get(code=LAUNCH_PROMO_CODE)
        self.assertEqual(row.plan.slug, "premium")
        self.assertEqual(row.free_months, 3)
        self.assertTrue(row.is_active)
