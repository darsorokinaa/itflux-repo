"""Student materials library: lesson + homework attachments without duplicates."""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.choices import AssignmentStatus, HomeworkStatus, HomeworkTaskType, MaterialStatus
from Cabinet.models import (
    Homework,
    HomeworkTask,
    Lesson,
    LessonAssignment,
    LessonPlan,
    LessonPlanItem,
    Material,
    Profile,
    Student,
)
from Cabinet.student_release import assign_custom_homework


class StudentMaterialsLibraryTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="mat_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])

        self.student_user = User.objects.create_user(username="mat_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )

        self.lesson_material = Material.objects.create(
            teacher=self.teacher,
            title="Конспект урока",
            material_type="methodic",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/lesson-notes",
        )
        self.hw_material = Material.objects.create(
            teacher=self.teacher,
            title="Файл к ДЗ",
            material_type="file",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/hw-file",
        )
        self.duplicate_material = Material.objects.create(
            teacher=self.teacher,
            title="Общий материал",
            material_type="link",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/shared",
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.student_user)

    def test_homework_and_lesson_materials_appear_without_duplicates(self):
        lesson = Lesson.objects.create(
            teacher=self.teacher,
            title="Урок 1",
            topic="Алгоритмы",
            status="published",
        )
        lesson.materials.add(self.lesson_material, self.duplicate_material)
        LessonAssignment.objects.create(
            teacher=self.teacher,
            student=self.student,
            lesson=lesson,
            status=AssignmentStatus.ASSIGNED,
        )

        plan = LessonPlan.objects.create(teacher=self.teacher, title="План")
        plan_item = LessonPlanItem.objects.create(plan=plan, title="Занятие 1", order=1)
        plan_item.homework_materials.add(self.hw_material, self.duplicate_material)

        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ после урока",
            status=HomeworkStatus.ASSIGNED,
            lesson=lesson,
            lesson_plan_item=plan_item,
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.EXTERNAL_LINK,
            title=self.hw_material.title,
            description=self.hw_material.external_url,
            order=0,
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type=HomeworkTaskType.EXTERNAL_LINK,
            title=self.duplicate_material.title,
            description=self.duplicate_material.external_url,
            order=1,
        )

        materials_resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(materials_resp.status_code, 200, materials_resp.content)
        items = materials_resp.json()["items"]
        ids = [row["id"] for row in items]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn(self.lesson_material.id, ids)
        self.assertIn(self.hw_material.id, ids)
        self.assertIn(self.duplicate_material.id, ids)
        self.assertEqual(ids.count(self.duplicate_material.id), 1)

        hw_row = next(row for row in items if row["id"] == self.hw_material.id)
        self.assertEqual(hw_row["source"], "homework")
        self.assertEqual(hw_row["homework_id"], homework.id)

        dash = self.client.get("/api/cabinet/student/dashboard/")
        self.assertEqual(dash.status_code, 200, dash.content)
        recent_ids = {row["id"] for row in dash.json().get("recent_materials", [])}
        self.assertTrue(recent_ids & {self.lesson_material.id, self.hw_material.id, self.duplicate_material.id})

    def test_custom_homework_materials_appear_in_library(self):
        homework = assign_custom_homework(
            teacher=self.teacher,
            student=self.student,
            title="Доп. ДЗ",
            material_ids=[self.hw_material.id],
        )
        self.assertIsNotNone(homework)

        resp = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [row["id"] for row in resp.json()["items"]]
        self.assertIn(self.hw_material.id, ids)
