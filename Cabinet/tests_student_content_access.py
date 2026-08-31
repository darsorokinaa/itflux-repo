"""Real linked students: full catalog content access independent of teacher tariff."""

from decimal import Decimal
from unittest import mock

from django.contrib.auth.models import User
from django.test import Client, TestCase

from Cabinet.choices import ContentAccessLevel, MaterialStatus
from Cabinet.lesson_access import (
    ACCESS_LOCKED,
    ACCESS_STUDENT,
    LessonAccessService,
)
from Cabinet.models import Material, Profile, Student, TariffPlan, TeacherSubscription
from Cabinet.student_content_access import is_real_linked_student
from Cabinet.subscription_access import AccessDenied, SubscriptionAccessService
from Generator.models import InterestingItem, Lesson


def _teacher(username="tchr", email="t@example.com"):
    user = User.objects.create_user(username, email, "pass")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


def _student_user(username="stu", email="s@example.com"):
    user = User.objects.create_user(username, email, "pass")
    user.profile.role = Profile.Role.STUDENT
    user.profile.save(update_fields=["role"])
    return user


def _ensure_start_plan():
    plan, _ = TariffPlan.objects.update_or_create(
        slug="start",
        defaults={
            "name": "Старт",
            "price_month": Decimal("0"),
            "content_access_rank": 0,
            "is_free": True,
            "is_active": True,
            "is_public": True,
            "sort_order": 0,
        },
    )
    return plan


class StudentContentAccessTests(TestCase):
    def setUp(self):
        promo = mock.patch("Cabinet.registration_promo.ensure_registration_promo", return_value=None)
        promo.start()
        self.addCleanup(promo.stop)
        self.start_plan = _ensure_start_plan()
        self.teacher = _teacher()
        TeacherSubscription.objects.update_or_create(
            teacher=self.teacher,
            defaults={"plan": self.start_plan, "status": TeacherSubscription.Status.ACTIVE},
        )
        self.student_user = _student_user()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )
        self.premium_lesson = Lesson.objects.create(
            title="Премиум урок",
            slug="premium-student-lesson",
            subject="Математика",
            access_level=Lesson.AccessLevel.PREMIUM,
            status=Lesson.Status.PUBLISHED,
            standalone_purchase_enabled=True,
            standalone_price=Decimal("990"),
            demo_enabled=True,
        )
        self.draft_lesson = Lesson.objects.create(
            title="Черновик",
            slug="draft-student-lesson",
            subject="Математика",
            access_level=Lesson.AccessLevel.FREE,
            status=Lesson.Status.DRAFT,
        )
        self.private_lesson = Lesson.objects.create(
            title="Закрытый",
            slug="private-student-lesson",
            subject="Математика",
            access_level=Lesson.AccessLevel.PRIVATE,
            status=Lesson.Status.PUBLISHED,
        )
        self.interesting = InterestingItem.objects.create(
            title="Интересное премиум",
            slug="interesting-premium",
            access_level=Lesson.AccessLevel.PREMIUM,
            status=InterestingItem.Status.PUBLISHED,
        )
        self.client = Client()

    def test_linked_student_can_access_paid_lesson(self):
        access = LessonAccessService.get_access(self.student_user, self.premium_lesson)
        self.assertEqual(access.access_type, ACCESS_STUDENT)
        self.assertTrue(access.can_view)
        self.assertFalse(access.can_download)

    def test_linked_student_can_access_premium_lesson(self):
        self.assertTrue(is_real_linked_student(self.student_user))
        access = LessonAccessService.get_access(self.student_user, self.premium_lesson)
        self.assertTrue(access.is_full)

    def test_linked_student_access_independent_of_teacher_tariff(self):
        access = LessonAccessService.get_access(self.student_user, self.premium_lesson)
        self.assertEqual(access.access_type, ACCESS_STUDENT)
        teacher_access = LessonAccessService.get_access(self.teacher, self.premium_lesson)
        self.assertEqual(teacher_access.access_type, ACCESS_LOCKED)

    def test_linked_student_does_not_need_separate_purchase(self):
        access = LessonAccessService.get_access(self.student_user, self.premium_lesson)
        self.assertTrue(access.can_view)
        self.assertFalse(access.can_purchase)

    def test_teacher_student_preview_does_not_bypass_paywall(self):
        Student.objects.create(
            teacher=self.teacher,
            user=self.teacher,
            first_name="Self",
            last_name="Teacher",
            status="active",
        )
        self.assertFalse(is_real_linked_student(self.teacher))
        access = LessonAccessService.get_access(self.teacher, self.premium_lesson)
        self.assertEqual(access.access_type, ACCESS_LOCKED)

    def test_unlinked_student_does_not_receive_full_access(self):
        orphan = _student_user("orphan", "orphan@example.com")
        access = LessonAccessService.get_access(orphan, self.premium_lesson)
        self.assertEqual(access.access_type, ACCESS_LOCKED)

    def test_student_cannot_access_teacher_only_lesson(self):
        access = LessonAccessService.get_access(self.student_user, self.private_lesson)
        self.assertFalse(access.can_view)
        draft = LessonAccessService.get_access(self.student_user, self.draft_lesson)
        self.assertFalse(draft.can_view)

    def test_anonymous_user_paywall_unchanged(self):
        access = LessonAccessService.get_access(None, self.premium_lesson)
        self.assertFalse(access.can_view)

    def test_teacher_paywall_unchanged(self):
        access = LessonAccessService.get_access(self.teacher, self.premium_lesson)
        self.assertFalse(access.can_view)

    def test_linked_student_interesting_bypasses_tariff(self):
        self.assertTrue(
            SubscriptionAccessService.can_access_content(self.student_user, self.interesting)
        )

    def test_unlinked_student_interesting_still_gated(self):
        orphan = _student_user("orphan2", "orphan2@example.com")
        self.assertFalse(SubscriptionAccessService.can_access_content(orphan, self.interesting))

    def test_student_catalog_material_gate_unchanged(self):
        material = Material.objects.create(
            title="Каталог учителя",
            teacher=self.teacher,
            access_level=ContentAccessLevel.PREMIUM,
            status=MaterialStatus.PUBLISHED,
            is_public=True,
        )
        self.assertFalse(SubscriptionAccessService.can_access_content(self.student_user, material))
        with self.assertRaises(AccessDenied):
            SubscriptionAccessService.raise_if_cannot_access_content(self.student_user, material)

    def test_archived_linked_student_does_not_receive_full_access(self):
        from Cabinet.choices import StudentStatus

        self.student.status = StudentStatus.ARCHIVED
        self.student.save(update_fields=["status"])
        self.assertFalse(is_real_linked_student(self.student_user))
        access = LessonAccessService.get_access(self.student_user, self.premium_lesson)
        self.assertEqual(access.access_type, ACCESS_LOCKED)

    def test_student_api_lesson_detail_allows_view(self):
        self.client.force_login(self.student_user)
        res = self.client.get(f"/api/lessons/{self.premium_lesson.slug}/")
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()["lesson"]
        self.assertTrue(data["access"]["can_view"])
        self.assertEqual(data["access"]["access_type"], ACCESS_STUDENT)
        self.assertFalse(data["locked"])

    def test_teacher_api_lesson_detail_still_locked(self):
        self.client.force_login(self.teacher)
        res = self.client.get(f"/api/lessons/{self.premium_lesson.slug}/")
        self.assertEqual(res.status_code, 200)
        data = res.json()["lesson"]
        self.assertFalse(data["access"]["can_view"])
        self.assertTrue(data["locked"])

    def test_teacher_browser_interesting_view_redirects_to_preview(self):
        self.client.force_login(self.teacher)
        res = self.client.get(
            f"/api/interesting/{self.interesting.slug}/view/",
            HTTP_ACCEPT="text/html,application/xhtml+xml",
            HTTP_SEC_FETCH_MODE="navigate",
            HTTP_SEC_FETCH_DEST="document",
        )
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res.url, f"/interesting?preview={self.interesting.slug}")

    def test_interesting_api_view_without_access_still_returns_json(self):
        self.client.force_login(self.teacher)
        res = self.client.get(
            f"/api/interesting/{self.interesting.slug}/view/",
            HTTP_ACCEPT="application/json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("application/json", res["Content-Type"])
