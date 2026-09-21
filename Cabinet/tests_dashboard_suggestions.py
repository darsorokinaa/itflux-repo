from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.models import Profile, Student, StudentSubject, TariffPlan, TeacherSubscription
from Cabinet.serializers import build_dashboard_payload
from Generator.models import InterestingItem, Lesson


def _set_teacher(user):
    profile = user.profile
    profile.role = Profile.Role.TEACHER
    profile.save(update_fields=["role"])
    return user


class DashboardSuggestedMaterialsTests(TestCase):
    def setUp(self):
        self.teacher = _set_teacher(User.objects.create_user("sug_t", "sug@example.com", "pass"))
        start, _ = TariffPlan.objects.update_or_create(
            slug="start",
            defaults={
                "name": "Старт",
                "price_month": Decimal("0"),
                "price_year": Decimal("0"),
                "content_access_rank": 0,
                "is_free": True,
                "is_active": True,
                "is_public": True,
                "sort_order": 0,
            },
        )
        TeacherSubscription.objects.update_or_create(
            teacher=self.teacher,
            defaults={"plan": start, "status": TeacherSubscription.Status.ACTIVE},
        )
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Анна",
            last_name="Иванова",
            grade=9,
            status="active",
        )
        StudentSubject.objects.create(
            student=self.student,
            subject="math",
            title="ОГЭ",
            direction="oge",
            status="active",
        )
        self.matched_lesson = Lesson.objects.create(
            title="Логика для девятого",
            slug="logic-9-math",
            subject="Математика",
            grade=9,
            exam_type=Lesson.ExamType.OGE,
            topic="Логика",
            short_description="Готовый урок по логике",
            access_level=Lesson.AccessLevel.FREE,
            status=Lesson.Status.PUBLISHED,
        )
        self.other_lesson = Lesson.objects.create(
            title="Органическая химия",
            slug="chem-11",
            subject="Химия",
            grade=11,
            topic="Углеводороды",
            short_description="Не про этого ученика",
            access_level=Lesson.AccessLevel.FREE,
            status=Lesson.Status.PUBLISHED,
        )
        self.locked_lesson = Lesson.objects.create(
            title="Продвинутая логика",
            slug="logic-premium",
            subject="Математика",
            grade=9,
            topic="Логика",
            short_description="Платный урок",
            access_level=Lesson.AccessLevel.PREMIUM,
            status=Lesson.Status.PUBLISHED,
        )
        self.trainer = InterestingItem.objects.create(
            title="Тренажёр: логические выражения",
            slug="trainer-logic",
            short_description="Интерактив по логике для ОГЭ",
            tag="Интерактив",
            access_level=InterestingItem.AccessLevel.FREE,
            status=InterestingItem.Status.PUBLISHED,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.teacher)

    def test_dashboard_includes_matching_lesson_and_trainer(self):
        payload = build_dashboard_payload(self.teacher)
        items = payload["suggested_materials"]
        self.assertEqual([row["slug"] for row in items], ["logic-9-math", "logic-premium", "trainer-logic"])

        matched = next(row for row in items if row["slug"] == "logic-9-math")
        self.assertEqual(matched["kind"], "lesson")
        self.assertTrue(matched["available"])
        self.assertEqual(matched["kind_label"], "Готовый урок")
        self.assertTrue(matched["description"])
        self.assertIn("preview", matched["preview_href"])

        trainer = next(row for row in items if row["slug"] == "trainer-logic")
        self.assertEqual(trainer["kind"], "interesting")
        self.assertTrue(trainer["available"])
        self.assertEqual(trainer["kind_label"], "Интерактив")

        locked = next(row for row in items if row["slug"] == "logic-premium")
        self.assertFalse(locked["available"])

    def test_dashboard_api_returns_suggested_materials(self):
        resp = self.client.get("/api/cabinet/dashboard/")
        self.assertEqual(resp.status_code, 200)
        items = resp.json().get("suggested_materials") or []
        self.assertTrue(any(row["slug"] == "logic-9-math" for row in items))
        self.assertTrue(any(row.get("available") for row in items))
