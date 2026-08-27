from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import RequestFactory, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import GroupStatus, LessonStatus, StudentStatus
from Cabinet.models import (
    Lesson,
    Profile,
    Student,
    StudentGroup,
    TariffPlan,
    TeacherMonthlyUsage,
    TeacherSubscription,
)
from Cabinet.subscription_access import SubscriptionAccessService
from Cabinet.subscription_service import LimitExceeded, SubscriptionLimitService
from Cabinet.tariff_usage import TariffUsageService


def _set_teacher(user):
    profile = user.profile
    profile.role = Profile.Role.TEACHER
    profile.save(update_fields=["role"])


class TariffUsageServiceTests(TestCase):
    def setUp(self):
        self.start, _ = TariffPlan.objects.update_or_create(
            slug="start",
            defaults={
                "name": "Старт",
                "price_month": Decimal("0"),
                "is_free": True,
                "is_active": True,
                "max_students": 5,
                "max_groups": 2,
                "max_lessons": 10,
                "max_interactives": 3,
                "max_variants_monthly": 20,
                "max_workbooks_monthly": 5,
                "max_storage_mb": 512,
                "ai_requests_monthly_limit": 10,
            },
        )
        self.premium, _ = TariffPlan.objects.update_or_create(
            slug="premium",
            defaults={
                "name": "Премиум",
                "price_month": Decimal("3990"),
                "is_free": False,
                "is_active": True,
                "max_students": 30,
                "max_groups": None,
                "max_lessons": 500,
                "max_interactives": None,
                "max_variants_monthly": None,
                "max_workbooks_monthly": None,
                "max_storage_mb": 10240,
            },
        )
        self.user = User.objects.create_user("usage_t", "usage@ex.com", "pass")
        _set_teacher(self.user)
        TeacherSubscription.objects.create(
            teacher=self.user,
            plan=self.start,
            status=TeacherSubscription.Status.ACTIVE,
        )

    def _monthly(self, **kwargs):
        period_start, period_end = SubscriptionLimitService.get_current_period()
        usage, _ = TeacherMonthlyUsage.objects.get_or_create(
            teacher=self.user,
            period_start=period_start,
            defaults={"period_end": period_end},
        )
        for field, value in kwargs.items():
            setattr(usage, field, value)
        usage.save()
        return usage

    def test_monthly_variant_usage_not_lifetime(self):
        self._monthly(variants_created=7, workbooks_created=2)
        payload = TariffUsageService.get_tariff_usage(self.user)
        variants = next(i for i in payload["usage"] if i["key"] == "variant_generations")
        workbooks = next(i for i in payload["usage"] if i["key"] == "workbooks")
        self.assertEqual(variants["used"], 7)
        self.assertEqual(variants["limit"], 20)
        self.assertEqual(variants["period"], "month")
        self.assertFalse(variants["unlimited"])
        self.assertEqual(variants["percent"], 35)
        self.assertEqual(workbooks["used"], 2)
        self.assertEqual(workbooks["limit"], 5)

        factory = RequestFactory()
        request = factory.get("/")
        request.user = self.user
        self.assertTrue(SubscriptionAccessService.can_create_variant(request))
        self._monthly(variants_created=20)
        self.assertFalse(SubscriptionAccessService.can_create_variant(request))
        self.assertFalse(TariffUsageService.is_within_limit(self.user, "variant_generations"))

    def test_current_student_and_group_counts(self):
        Student.objects.create(teacher=self.user, first_name="A")
        Student.objects.create(teacher=self.user, first_name="B")
        Student.objects.create(
            teacher=self.user, first_name="Arch", status=StudentStatus.ARCHIVED
        )
        StudentGroup.objects.create(teacher=self.user, title="G1")
        StudentGroup.objects.create(
            teacher=self.user, title="Old", status=GroupStatus.ARCHIVED
        )
        Lesson.objects.create(teacher=self.user, title="L1")
        Lesson.objects.create(
            teacher=self.user, title="Gone", status=LessonStatus.ARCHIVED
        )

        payload = TariffUsageService.get_tariff_usage(self.user)
        by_key = {i["key"]: i for i in payload["usage"]}
        self.assertEqual(by_key["students"]["used"], 2)
        self.assertEqual(by_key["students"]["limit"], 5)
        self.assertEqual(by_key["students"]["period"], "current")
        self.assertEqual(by_key["groups"]["used"], 1)
        self.assertEqual(by_key["groups"]["limit"], 2)
        self.assertNotIn("lessons", by_key)

        self.assertTrue(SubscriptionLimitService.can_create_student(self.user))
        for i in range(3):
            Student.objects.create(teacher=self.user, first_name=f"S{i}")
        self.assertFalse(SubscriptionLimitService.can_create_student(self.user))
        with self.assertRaises(LimitExceeded) as ctx:
            SubscriptionLimitService.raise_if_student_limit_reached(self.user)
        item = TariffUsageService.get_item(self.user, "students")
        self.assertEqual(ctx.exception.current, item["used"])
        self.assertEqual(ctx.exception.limit, item["limit"])

    def test_unlimited_metrics(self):
        sub = self.user.subscription
        sub.plan = self.premium
        sub.save(update_fields=["plan"])
        self._monthly(variants_created=12, interactives_created=4)
        StudentGroup.objects.create(teacher=self.user, title="G1")

        payload = TariffUsageService.get_tariff_usage(self.user)
        by_key = {i["key"]: i for i in payload["usage"]}
        self.assertTrue(by_key["variant_generations"]["unlimited"])
        self.assertIsNone(by_key["variant_generations"]["limit"])
        self.assertEqual(by_key["variant_generations"]["used"], 12)
        self.assertIsNone(by_key["variant_generations"]["percent"])
        self.assertTrue(by_key["groups"]["unlimited"])
        self.assertTrue(by_key["interactives"]["unlimited"])
        self.assertTrue(by_key["workbooks"]["unlimited"])
        self.assertTrue(TariffUsageService.is_within_limit(self.user, "variant_generations"))
        self.assertTrue(TariffUsageService.is_within_limit(self.user, "groups"))

    def test_near_limit_and_exhausted_flags(self):
        self._monthly(variants_created=16)
        item = TariffUsageService.get_item(self.user, "variant_generations")
        self.assertTrue(item["near_limit"])
        self.assertFalse(item["exhausted"])
        self.assertEqual(item["percent"], 80)

        self._monthly(variants_created=20)
        item = TariffUsageService.get_item(self.user, "variant_generations")
        self.assertTrue(item["exhausted"])
        self.assertFalse(item["near_limit"])
        self.assertEqual(item["percent"], 100)

    def test_usage_api_matches_service(self):
        self._monthly(variants_created=7, workbooks_created=2)
        Student.objects.create(teacher=self.user, first_name="A")
        expected = TariffUsageService.get_tariff_usage(self.user)

        client = APIClient()
        client.force_login(self.user)
        resp = client.get("/api/cabinet/subscription/usage/")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["tariff"]["code"], "start")
        self.assertEqual(data["tariff"]["name"], "Старт")
        api_by_key = {i["key"]: i for i in data["usage_items"]}
        svc_by_key = {i["key"]: i for i in expected["usage"]}
        for key, item in svc_by_key.items():
            self.assertIn(key, api_by_key)
            self.assertEqual(api_by_key[key]["used"], item["used"])
            self.assertEqual(api_by_key[key]["limit"], item["limit"])
            self.assertEqual(api_by_key[key]["unlimited"], item["unlimited"])
            self.assertEqual(api_by_key[key]["period"], item["period"])
        self.assertEqual(data["usage"]["variants"], 7)
        self.assertEqual(data["usage"]["students"], 1)
        self.assertEqual(data["limits"]["variants_monthly"], 20)
        self.assertEqual(data["limits"]["lessons"], self.start.max_lessons)
        self.assertEqual(data["assigned_plan"]["slug"], "start")

    def test_old_month_usage_is_not_counted(self):
        TeacherMonthlyUsage.objects.create(
            teacher=self.user,
            period_start=timezone.now().date().replace(year=2020, month=1, day=1),
            period_end=timezone.now().date().replace(year=2020, month=2, day=1),
            variants_created=99,
            workbooks_created=99,
            interactives_created=99,
        )
        self._monthly(variants_created=3)
        item = TariffUsageService.get_item(self.user, "variant_generations")
        self.assertEqual(item["used"], 3)


class EnsureDefaultTariffPlansTests(TestCase):
    def test_fills_catalog_when_teacher_plan_missing(self):
        from Cabinet.management.commands.seed_tariffs import ensure_default_tariff_plans
        from Cabinet.models import TariffPlan

        TariffPlan.objects.filter(slug="teacher").delete()
        written = ensure_default_tariff_plans()
        self.assertGreater(written, 0)
        slugs = set(TariffPlan.objects.filter(is_active=True).values_list("slug", flat=True))
        self.assertTrue({"start", "teacher", "pro", "premium"}.issubset(slugs))
        teacher = TariffPlan.objects.get(slug="teacher")
        self.assertEqual(teacher.max_students, 10)
        start = TariffPlan.objects.get(slug="start")
        self.assertEqual(start.max_variants_monthly, 20)
