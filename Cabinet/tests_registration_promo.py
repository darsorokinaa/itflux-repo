from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
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
    ensure_registration_promo,
    is_promo_window_open,
    promo_deadline,
    registration_qualifies_for_promo,
)
from Cabinet.subscription_lifecycle import process_expired_subscriptions
from Cabinet.subscription_service import SubscriptionLimitService


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
        self.start, _ = TariffPlan.objects.get_or_create(
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

    def _activate_promo(self):
        self.promo.is_active = True
        self.promo.save(update_fields=["is_active"])

    def _teacher(self, username="promo_teacher"):
        user = User.objects.create_user(
            username=username,
            email=f"{username}@ex.com",
            password="Pass12345!",
        )
        user.profile.role = Profile.Role.TEACHER
        user.profile.save(update_fields=["role"])
        return user

    def _register(self, email, *, role="teacher", extra=None):
        payload = {
            "email": email,
            "password": "Pass12345!",
            "password_confirm": "Pass12345!",
            "name": "Анна",
            "surname": "Петрова",
            "role": role,
        }
        if extra:
            payload.update(extra)
        with patch("Cabinet.views.rate_limit_check", return_value=True):
            return self.client.post(
                "/api/cabinet/register/",
                data=payload,
                content_type="application/json",
            )

    def test_deadline_and_window(self):
        self._activate_promo()
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

    def test_inactive_by_default_new_teacher_gets_start(self):
        self.assertFalse(self.promo.is_active)
        user = self._teacher("new_start")
        self.assertIsNone(apply_registration_promo(user))
        sub = SubscriptionLimitService.get_or_create_subscription(user)
        self.assertEqual(sub.plan.slug, "start")
        self.assertIsNone(sub.expires_at)
        self.assertFalse(sub.is_legacy_promo)
        self.assertNotEqual(sub.source, TeacherSubscription.Source.LAUNCH_PROMO)

    def test_register_endpoint_does_not_grant_premium_when_inactive(self):
        resp = self._register("new_start@ex.com")
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        self.assertNotIn("registration_promo", data)
        user = User.objects.get(email="new_start@ex.com")
        sub = SubscriptionLimitService.get_or_create_subscription(user)
        self.assertEqual(sub.plan.slug, "start")
        self.assertIsNone(sub.expires_at)

    def test_register_endpoint_grants_promo_when_admin_enables(self):
        self._activate_promo()
        self.assertTrue(is_promo_window_open())
        resp = self._register("promo_reg@ex.com")
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertTrue(data.get("ok"))
        self.assertIn("registration_promo", data)
        user = User.objects.get(email="promo_reg@ex.com")
        self.assertEqual(user.subscription.plan.slug, "premium")

    def test_grant_premium_three_months_from_registration(self):
        self._activate_promo()
        user = self._teacher()
        started = ReferralService.registration_started_at(user)
        result = apply_registration_promo(user)
        self.assertIsNotNone(result)
        self.assertEqual(result["plan_slug"], "premium")
        sub = TeacherSubscription.objects.select_related("plan").get(teacher=user)
        self.assertEqual(sub.plan.slug, "premium")
        self.assertEqual(sub.status, TeacherSubscription.Status.TRIAL)
        self.assertEqual(sub.expires_at, add_months(started, PROMO_MONTHS))

    def test_legacy_profi_remapped_to_premium(self):
        self._activate_promo()
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
        self._activate_promo()
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
        self._activate_promo()
        user = self._teacher("start_teacher")
        SubscriptionLimitService.get_or_create_subscription(user, apply_promo=False)
        self.assertEqual(user.subscription.plan.slug, "start")
        result = ensure_registration_promo(user)
        self.assertIsNotNone(result)
        user.subscription.refresh_from_db()
        self.assertEqual(user.subscription.plan.slug, "premium")

    def test_get_or_create_does_not_grant_promo_by_default(self):
        self._activate_promo()
        user = self._teacher("no_auto")
        sub = SubscriptionLimitService.get_or_create_subscription(user)
        self.assertEqual(sub.plan.slug, "start")

    def test_inactive_promotion_stops_grant(self):
        user = self._teacher("after_end")
        self.assertIsNone(apply_registration_promo(user))

    def test_launch_promo_row_exists_inactive(self):
        row = Promotion.objects.get(code=LAUNCH_PROMO_CODE)
        self.assertEqual(row.plan.slug, "premium")
        self.assertEqual(row.free_months, 3)
        self.assertFalse(row.is_active)

    def test_existing_promo_premium_kept(self):
        user = self._teacher("legacy_promo")
        started = ReferralService.registration_started_at(user)
        expires = add_months(started, PROMO_MONTHS)
        TeacherSubscription.objects.create(
            teacher=user,
            plan=self.premium,
            status=TeacherSubscription.Status.TRIAL,
            source=TeacherSubscription.Source.LAUNCH_PROMO,
            is_legacy_promo=True,
            expires_at=expires,
            promo_started_at=started,
            promo_ends_at=expires,
        )
        self.assertIsNone(apply_registration_promo(user))
        sub = SubscriptionLimitService.get_or_create_subscription(user)
        sub.refresh_from_db()
        self.assertEqual(sub.plan.slug, "premium")
        self.assertEqual(sub.source, TeacherSubscription.Source.LAUNCH_PROMO)
        self.assertTrue(sub.is_legacy_promo)
        self.assertEqual(sub.expires_at, expires)

    def test_paid_subscription_unchanged(self):
        user = self._teacher("paid_user")
        expires = timezone.now() + timedelta(days=40)
        TeacherSubscription.objects.create(
            teacher=user,
            plan=self.pro,
            status=TeacherSubscription.Status.ACTIVE,
            source=TeacherSubscription.Source.PAYMENT,
            expires_at=expires,
            auto_renew=True,
        )
        self.assertIsNone(apply_registration_promo(user))
        sub = SubscriptionLimitService.get_or_create_subscription(user)
        sub.refresh_from_db()
        self.assertEqual(sub.plan.slug, "pro")
        self.assertEqual(sub.source, TeacherSubscription.Source.PAYMENT)
        self.assertEqual(sub.expires_at, expires)
        self.assertTrue(sub.auto_renew)

    def test_premium_without_end_date_untouched(self):
        user = self._teacher("open_premium")
        TeacherSubscription.objects.create(
            teacher=user,
            plan=self.premium,
            status=TeacherSubscription.Status.ACTIVE,
            source=TeacherSubscription.Source.ADMIN,
            expires_at=None,
        )
        self.assertIsNone(apply_registration_promo(user))
        sub = user.subscription
        sub.refresh_from_db()
        self.assertEqual(sub.plan.slug, "premium")
        self.assertIsNone(sub.expires_at)
        self.assertEqual(sub.source, TeacherSubscription.Source.ADMIN)

    def test_expired_promo_premium_downgrades_to_start(self):
        user = self._teacher("expired_promo")
        TeacherSubscription.objects.create(
            teacher=user,
            plan=self.premium,
            status=TeacherSubscription.Status.TRIAL,
            source=TeacherSubscription.Source.LAUNCH_PROMO,
            is_legacy_promo=True,
            expires_at=timezone.now() - timedelta(days=1),
            auto_renew=False,
        )
        result = process_expired_subscriptions()
        self.assertGreaterEqual(result["moved_to_start"], 1)
        sub = TeacherSubscription.objects.get(teacher=user)
        self.assertEqual(sub.plan.slug, "start")
        self.assertEqual(sub.status, TeacherSubscription.Status.EXPIRED)

    def test_invite_registration_is_student_without_promo(self):
        from Cabinet.invitations import create_student_invitation

        teacher = self._teacher("host_teacher")
        invitation = create_student_invitation(
            teacher,
            email="invitee@ex.com",
            direction="ege",
        )
        resp = self._register(
            "invitee@ex.com",
            role="teacher",
            extra={"invite_token": invitation.token},
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertEqual(data["user"]["role"], "student")
        self.assertNotIn("registration_promo", data)
        user = User.objects.get(email="invitee@ex.com")
        self.assertFalse(TeacherSubscription.objects.filter(teacher=user).exists())

    def test_referral_registration_gets_start_not_premium(self):
        from Cabinet.models import ReferralLink

        host = self._teacher("ref_host")
        ReferralLink.objects.create(code="STARTREF", owner=host, is_active=True)
        resp = self._register(
            "referred@ex.com",
            role="teacher",
            extra={"referral_code": "STARTREF"},
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertTrue(data.get("referral_applied"))
        self.assertNotIn("registration_promo", data)
        user = User.objects.get(email="referred@ex.com")
        sub = SubscriptionLimitService.get_or_create_subscription(user)
        self.assertEqual(sub.plan.slug, "start")
        self.assertIsNone(sub.expires_at)
