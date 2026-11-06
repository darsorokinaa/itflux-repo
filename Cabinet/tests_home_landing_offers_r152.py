"""r152: лендинг на главной — офферы только без платной подписки учителя."""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.utils import timezone

from Cabinet.models import Profile, TariffPlan, TeacherSubscription
from Cabinet.subscription_access import (
    plan_counts_as_paid_platform_tier,
    teacher_has_active_paid_platform_subscription,
)


def _ensure_plans():
    plans = {}
    specs = [
        ("start", "Старт", 0, True, "register"),
        ("teacher", "Репетитор", 990, False, "checkout"),
        ("pro", "Профи", 1990, False, "checkout"),
        ("school", "Школа", 0, False, "contact"),
    ]
    for i, (slug, name, price, is_free, cta) in enumerate(specs):
        plans[slug], _ = TariffPlan.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "price_month": Decimal(price),
                "price_year": Decimal(price * 10 if price else 0),
                "is_free": is_free,
                "cta_type": cta,
                "is_active": True,
                "is_public": True,
                "sort_order": i,
                "content_access_rank": i,
            },
        )
    return plans


def _teacher(username):
    user = User.objects.create_user(username, f"{username}@example.com", "pass")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


class PaidPlatformSubscriptionHelperTests(TestCase):
    def setUp(self):
        self.plans = _ensure_plans()
        promo = mock.patch(
            "Cabinet.registration_promo.ensure_registration_promo",
            return_value=None,
        )
        promo.start()
        self.addCleanup(promo.stop)

    def test_anon_and_non_teacher_false(self):
        self.assertFalse(teacher_has_active_paid_platform_subscription(None))
        student = User.objects.create_user("stu152", "s152@example.com", "pass")
        student.profile.role = Profile.Role.STUDENT
        student.profile.save(update_fields=["role"])
        self.assertFalse(teacher_has_active_paid_platform_subscription(student))
        parent = User.objects.create_user("par152", "p152@example.com", "pass")
        parent.profile.role = Profile.Role.PARENT
        parent.profile.save(update_fields=["role"])
        self.assertFalse(teacher_has_active_paid_platform_subscription(parent))

    def test_start_and_trial_and_launch_promo_not_paid(self):
        start_u = _teacher("t_start152")
        TeacherSubscription.objects.update_or_create(
            teacher=start_u,
            defaults={"plan": self.plans["start"], "status": TeacherSubscription.Status.ACTIVE},
        )
        self.assertFalse(teacher_has_active_paid_platform_subscription(start_u))

        trial_u = _teacher("t_trial152")
        TeacherSubscription.objects.update_or_create(
            teacher=trial_u,
            defaults={
                "plan": self.plans["pro"],
                "status": TeacherSubscription.Status.TRIAL,
                "expires_at": timezone.now() + timedelta(days=7),
            },
        )
        self.assertFalse(teacher_has_active_paid_platform_subscription(trial_u))

        promo_u = _teacher("t_promo152")
        TeacherSubscription.objects.update_or_create(
            teacher=promo_u,
            defaults={
                "plan": self.plans["teacher"],
                "status": TeacherSubscription.Status.ACTIVE,
                "source": TeacherSubscription.Source.LAUNCH_PROMO,
                "expires_at": timezone.now() + timedelta(days=14),
            },
        )
        self.assertFalse(teacher_has_active_paid_platform_subscription(promo_u))

    def test_active_paid_teacher_true(self):
        u = _teacher("t_paid152")
        TeacherSubscription.objects.update_or_create(
            teacher=u,
            defaults={
                "plan": self.plans["teacher"],
                "status": TeacherSubscription.Status.ACTIVE,
                "source": TeacherSubscription.Source.PAYMENT,
                "expires_at": timezone.now() + timedelta(days=30),
            },
        )
        self.assertTrue(teacher_has_active_paid_platform_subscription(u))

    def test_school_counts_as_paid_tier(self):
        self.assertTrue(plan_counts_as_paid_platform_tier(self.plans["school"]))
        self.assertFalse(plan_counts_as_paid_platform_tier(self.plans["start"]))


class MePayloadPaidFlagTests(TestCase):
    def setUp(self):
        self.plans = _ensure_plans()
        promo = mock.patch(
            "Cabinet.registration_promo.ensure_registration_promo",
            return_value=None,
        )
        promo.start()
        self.addCleanup(promo.stop)
        self.client = Client()

    def test_anon_me(self):
        r = self.client.get("/api/cabinet/me/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json().get("authenticated"))

    def test_start_teacher_flag_false(self):
        u = _teacher("me_start152")
        TeacherSubscription.objects.update_or_create(
            teacher=u,
            defaults={"plan": self.plans["start"], "status": TeacherSubscription.Status.ACTIVE},
        )
        self.client.force_login(u)
        data = self.client.get("/api/cabinet/me/").json()
        self.assertTrue(data["authenticated"])
        self.assertFalse(data["user"]["has_active_paid_subscription"])

    def test_paid_teacher_flag_true(self):
        u = _teacher("me_paid152")
        TeacherSubscription.objects.update_or_create(
            teacher=u,
            defaults={
                "plan": self.plans["pro"],
                "status": TeacherSubscription.Status.ACTIVE,
                "source": TeacherSubscription.Source.PAYMENT,
                "expires_at": timezone.now() + timedelta(days=20),
            },
        )
        self.client.force_login(u)
        data = self.client.get("/api/cabinet/me/").json()
        self.assertTrue(data["user"]["has_active_paid_subscription"])

    def test_student_flag_false(self):
        u = User.objects.create_user("me_stu152", "mestu@example.com", "pass")
        u.profile.role = Profile.Role.STUDENT
        u.profile.save(update_fields=["role"])
        self.client.force_login(u)
        data = self.client.get("/api/cabinet/me/").json()
        self.assertFalse(data["user"]["has_active_paid_subscription"])
