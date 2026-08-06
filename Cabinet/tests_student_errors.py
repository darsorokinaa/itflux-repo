"""Тесты банка ошибок ученика и выдачи работы над ошибками из журнала."""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import HomeworkStatus
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkTask,
    Profile,
    Student,
)


class StudentErrorsJournalTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="err_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.student_user = User.objects.create_user(username="err_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Ира",
            last_name="Ученица",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: Исходное",
            status=HomeworkStatus.ASSIGNED,
        )
        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="generated_task",
            title="Вариант",
            description="/oge/inf/variant/99",
            order=0,
        )
        self.submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            status="submitted",
            submitted_at=timezone.now(),
            teacher_comment="Повтори тему 8",
            result_payload={
                "checked": {"101": False, "102": True},
                "scores": {"103": 0.5},
                "by_task_id": {"101": "42", "103": "черновик решения"},
                "comments_by_task_id": {"101": "Неверно посчитала"},
                "attachments_by_task_id": {
                    "103": [{"url": "/media/hw/scan.pdf", "filename": "scan.pdf"}]
                },
                "teacher_attachments_by_task_id": {
                    "101": [{"url": "/media/fb/hint.png", "filename": "hint.png"}]
                },
            },
            score=40,
        )
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def test_errors_endpoint_groups_by_subject(self):
        resp = self.client.get(f"/api/cabinet/journal/students/{self.student.id}/errors/")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["student"]["id"], self.student.id)
        self.assertGreaterEqual(data["total_errors"], 1)
        subjects = data["subjects"]
        self.assertTrue(subjects)
        self.assertEqual(subjects[0]["subject"], "inf")
        self.assertEqual(subjects[0]["level"], "oge")
        task_ids = {str(t["task_id"]) for t in subjects[0]["tasks"]}
        self.assertIn("101", task_ids)
        self.assertNotIn("102", task_ids)
        self.assertIn("103", task_ids)
        by_id = {str(t["task_id"]): t for t in subjects[0]["tasks"]}
        self.assertEqual(by_id["101"]["student_answer"], "42")
        self.assertEqual(by_id["101"]["task_comment"], "Неверно посчитала")
        self.assertEqual(by_id["101"]["teacher_comment"], "Повтори тему 8")
        self.assertEqual(by_id["101"]["teacher_attachments"][0]["filename"], "hint.png")
        self.assertEqual(by_id["103"]["student_answer"], "черновик решения")
        self.assertEqual(by_id["103"]["attachments"][0]["filename"], "scan.pdf")
        self.assertIn("condition_html", by_id["101"])
        self.assertIn("correct_answer_html", by_id["101"])
        self.assertIn("subtopic_id", by_id["101"])
        self.assertIn("subtopic_title", by_id["101"])

    def test_summary_only_skips_task_details(self):
        resp = self.client.get(
            f"/api/cabinet/journal/students/{self.student.id}/errors/?summary=1"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertGreaterEqual(data["total_errors"], 1)
        self.assertTrue(data["subjects"])
        self.assertNotIn("tasks", data["subjects"][0])
        self.assertIn("tasks_count", data["subjects"][0])
        self.assertNotIn("suggested_due_at", data)

    def test_create_homework_from_selected_errors(self):
        with patch(
            "Cabinet.student_errors._create_variant_from_task_ids",
            return_value=555,
        ), patch(
            "Cabinet.student_errors.notify_students_homework_assigned",
            return_value=1,
        ), patch(
            "Cabinet.student_errors.ensure_homework_in_review_queue",
        ), patch(
            "Cabinet.student_errors._record_variant_tasks_for_homework",
        ):
            resp = self.client.post(
                f"/api/cabinet/journal/students/{self.student.id}/errors/create-homework/",
                {
                    "title": "Работа над ошибками",
                    "mode": "assign",
                    "selected_tasks": [
                        {"task_id": "101", "subject": "inf", "level": "oge"},
                    ],
                },
                format="json",
            )
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        self.assertTrue(data["created"])
        hw = Homework.objects.get(pk=data["id"])
        self.assertEqual(hw.student_id, self.student.id)
        self.assertTrue(hw.created_from_review)
        task = hw.tasks.filter(is_active=True).first()
        self.assertIn("/oge/inf/variant/555", task.description)

    def test_student_forbidden(self):
        self.client.force_login(self.student_user)
        resp = self.client.get(f"/api/cabinet/journal/students/{self.student.id}/errors/")
        self.assertIn(resp.status_code, (403, 404))
