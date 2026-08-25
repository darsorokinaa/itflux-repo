from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import PlanItemStatus, PlanStatus
from Cabinet.models import (
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Profile,
    Student,
)
from Cabinet.plan_sync import PlanSyncService
from Cabinet.schedule_service import create_single_event


class PublicLessonPlanTests(TestCase):
    def setUp(self):
        cache.clear()
        self.teacher_a = User.objects.create_user(
            username="pub_teacher_a", password="pass", email="a@example.com",
        )
        self.teacher_a.profile.role = Profile.Role.TEACHER
        self.teacher_a.profile.save(update_fields=["role"])

        self.teacher_b = User.objects.create_user(
            username="pub_teacher_b", password="pass", email="b@example.com",
        )
        self.teacher_b.profile.role = Profile.Role.TEACHER
        self.teacher_b.profile.save(update_fields=["role"])

        self.publisher = User.objects.create_user(
            username="pub_publisher",
            password="pass",
            email="dv_sorokina@mail.ru",
        )
        self.publisher.profile.role = Profile.Role.TEACHER
        self.publisher.profile.save(update_fields=["role"])

        self.private_a = LessonPlan.objects.create(
            teacher=self.teacher_a,
            title="Личный план А",
            direction="oge",
            subject="informatics",
            status=PlanStatus.PUBLISHED,
        )
        LessonPlanItem.objects.create(
            plan=self.private_a, order=1, title="Тема А", topic="Тема А",
        )

        self.public_plan = LessonPlan.objects.create(
            teacher=self.publisher,
            is_public=True,
            title="Алгебра — 8 класс",
            description="Готовый маршрут",
            direction="school",
            subject="math",
            grade="8",
            status=PlanStatus.PUBLISHED,
        )
        self.public_item = LessonPlanItem.objects.create(
            plan=self.public_plan,
            order=1,
            title="Линейные уравнения",
            topic="Линейные уравнения",
            goal="Научиться решать уравнения",
            planned_results="Ученик решает уравнения",
            description="Разбор примеров",
            lesson_materials_notes="Карточки",
            homework_description="№1–5",
            status=PlanItemStatus.COMPLETED,
            teacher_comment="Персональный комментарий автора",
        )

        self.student_a = Student.objects.create(
            teacher=self.teacher_a,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )
        self.client_a = APIClient()
        self.client_a.force_login(self.teacher_a)
        self.client_b = APIClient()
        self.client_b.force_login(self.teacher_b)

    def test_private_plan_is_not_visible_to_other_teachers(self):
        mine = self.client_b.get("/api/cabinet/lesson-plans/?mine=true")
        catalog = self.client_b.get("/api/cabinet/lesson-plans/?catalog=true")
        mine_ids = {item["id"] for item in mine.data}
        catalog_ids = {item["id"] for item in catalog.data}
        self.assertNotIn(self.private_a.pk, mine_ids)
        self.assertNotIn(self.private_a.pk, catalog_ids)
        detail = self.client_b.get(f"/api/cabinet/lesson-plans/{self.private_a.pk}/")
        self.assertEqual(detail.status_code, 404)

    def test_public_plan_is_visible_in_catalog_not_in_mine(self):
        catalog = self.client_a.get("/api/cabinet/lesson-plans/?catalog=true")
        mine = self.client_a.get("/api/cabinet/lesson-plans/?mine=true")
        catalog_ids = {item["id"] for item in catalog.data}
        mine_ids = {item["id"] for item in mine.data}
        self.assertIn(self.public_plan.pk, catalog_ids)
        self.assertNotIn(self.public_plan.pk, mine_ids)
        public_row = next(item for item in catalog.data if item["id"] == self.public_plan.pk)
        self.assertTrue(public_row["is_public"])
        self.assertNotIn(self.private_a.pk, catalog_ids)

    def test_use_public_plan_creates_personal_copy(self):
        response = self.client_a.post(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/copy/")
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["is_public"])
        self.assertEqual(response.data["status"], "draft")
        copied = LessonPlan.objects.get(pk=response.data["id"])
        self.assertEqual(copied.teacher_id, self.teacher_a.id)
        self.assertFalse(copied.is_public)
        self.assertNotEqual(copied.pk, self.public_plan.pk)
        self.assertEqual(copied.items.count(), 1)
        new_item = copied.items.get()
        self.assertEqual(new_item.title, "Линейные уравнения")
        self.assertEqual(new_item.order, 1)
        self.assertEqual(new_item.goal, "Научиться решать уравнения")
        self.assertEqual(new_item.status, PlanItemStatus.NOT_STARTED)
        self.assertEqual(new_item.teacher_comment, "")
        self.assertIsNone(new_item.scheduled_event_id)
        self.assertIsNone(new_item.linked_lesson_id)

    def test_copy_does_not_change_public_original(self):
        response = self.client_a.post(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/copy/")
        copied = LessonPlan.objects.get(pk=response.data["id"])
        item = copied.items.get()
        item.topic = "Изменённая тема копии"
        item.save(update_fields=["topic", "updated_at"])
        copied.title = "Моя копия"
        copied.save(update_fields=["title", "updated_at"])

        self.public_plan.refresh_from_db()
        self.public_item.refresh_from_db()
        self.assertEqual(self.public_plan.title, "Алгебра — 8 класс")
        self.assertEqual(self.public_item.topic, "Линейные уравнения")
        self.assertTrue(self.public_plan.is_public)

    def test_two_teachers_get_independent_copies(self):
        copy_a = self.client_a.post(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/copy/")
        copy_b = self.client_b.post(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/copy/")
        self.assertEqual(copy_a.status_code, 201)
        self.assertEqual(copy_b.status_code, 201)
        plan_a = LessonPlan.objects.get(pk=copy_a.data["id"])
        plan_b = LessonPlan.objects.get(pk=copy_b.data["id"])
        ids = {self.public_plan.pk, plan_a.pk, plan_b.pk}
        self.assertEqual(len(ids), 3)
        self.assertEqual(plan_a.teacher_id, self.teacher_a.id)
        self.assertEqual(plan_b.teacher_id, self.teacher_b.id)
        self.assertFalse(plan_a.is_public)
        self.assertFalse(plan_b.is_public)

        item_a = plan_a.items.get()
        item_a.topic = "Копия А"
        item_a.save(update_fields=["topic"])
        self.public_item.refresh_from_db()
        self.assertEqual(self.public_item.topic, "Линейные уравнения")
        self.assertEqual(plan_b.items.get().topic, "Линейные уравнения")

    def test_repeat_copy_does_not_duplicate(self):
        first = self.client_a.post(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/copy/")
        second = self.client_a.post(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/copy/")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(
            LessonPlan.objects.filter(
                teacher=self.teacher_a,
                title=self.public_plan.title,
                is_public=False,
            ).count(),
            1,
        )

    def test_cannot_enroll_public_plan_directly(self):
        response = self.client_a.post(
            f"/api/cabinet/lesson-plans/{self.public_plan.pk}/enroll/",
            {"student": self.student_a.pk, "format": "individual"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            LessonPlanEnrollment.objects.filter(plan=self.public_plan).count(),
            0,
        )

    def test_cannot_edit_or_delete_public_plan_as_regular_teacher(self):
        patch = self.client_a.patch(
            f"/api/cabinet/lesson-plans/{self.public_plan.pk}/",
            {"title": "Взлом шаблона"},
            format="json",
        )
        delete = self.client_a.delete(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/")
        item_patch = self.client_a.patch(
            f"/api/cabinet/lesson-plan-items/{self.public_item.pk}/",
            {"topic": "Чужая тема"},
            format="json",
        )
        self.assertEqual(patch.status_code, 403)
        self.assertEqual(delete.status_code, 403)
        self.assertEqual(item_patch.status_code, 403)
        self.public_plan.refresh_from_db()
        self.assertEqual(self.public_plan.title, "Алгебра — 8 класс")

    def test_copy_then_enroll_syncs_calendar_to_personal_plan(self):
        copy_resp = self.client_a.post(f"/api/cabinet/lesson-plans/{self.public_plan.pk}/copy/")
        copied = LessonPlan.objects.get(pk=copy_resp.data["id"])
        copied.status = PlanStatus.PUBLISHED
        copied.save(update_fields=["status", "updated_at"])
        copy_item = copied.items.get()

        enroll = self.client_a.post(
            f"/api/cabinet/lesson-plans/{copied.pk}/enroll/",
            {"student": self.student_a.pk, "format": "individual"},
            format="json",
        )
        self.assertEqual(enroll.status_code, 201)

        starts = timezone.now().replace(hour=15, minute=0, second=0, microsecond=0) + timedelta(days=1)
        event = create_single_event(
            teacher=self.teacher_a,
            data={
                "title": self.student_a.full_name,
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student_a.pk],
            notify=False,
        )
        self.assertEqual(event.lesson_plan_item_id, copy_item.id)
        self.assertEqual(event.lesson_plan_item.plan_id, copied.pk)
        self.assertNotEqual(event.lesson_plan_item_id, self.public_item.pk)

        copy_item.topic = "Уравнения: практика"
        copy_item.save(update_fields=["topic", "updated_at"])
        from Cabinet.lesson_plan_content_sync import LessonLearningPlanSyncService
        LessonLearningPlanSyncService.sync_plan_item_to_lessons(
            copy_item, teacher=self.teacher_a, update_source="plan",
        )
        event.refresh_from_db()
        self.public_item.refresh_from_db()
        self.assertEqual(event.topic, "Уравнения: практика")
        self.assertEqual(self.public_item.topic, "Линейные уравнения")

        enrollment = LessonPlanEnrollment.objects.get(pk=enroll.data["id"])
        progress = PlanSyncService.get_enrollment_progress(enrollment)
        self.assertEqual(progress["total"], 1)
        self.assertEqual(enrollment.plan_id, copied.pk)

    def test_regular_teacher_cannot_publish_to_catalog(self):
        response = self.client_a.post(
            "/api/cabinet/lesson-plans/",
            {
                "title": "Чужой шаблон",
                "direction": "oge",
                "subject": "informatics",
                "is_public": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(LessonPlan.objects.filter(title="Чужой шаблон").exists())
