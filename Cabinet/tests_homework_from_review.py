"""Тесты создания ДЗ из вкладки «Проверка»."""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import HomeworkStatus, ReviewStatus
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkTask,
    Profile,
    ReviewItem,
    Student,
)


class HomeworkFromReviewTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="hfr_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other = User.objects.create_user(username="hfr_other", password="pass")
        self.other.profile.role = Profile.Role.TEACHER
        self.other.profile.save()

        self.student_user = User.objects.create_user(username="hfr_student", password="pass")
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
            result_payload={
                "by_task_id": {"101": "wrong", "102": "ok", "103": "half"},
                "checked": {"101": False, "102": True},
                "scores": {"103": 0.5},
            },
            score=40,
            teacher_comment="Исходный комментарий",
        )
        self.review = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=self.submission.pk,
            title=f"{self.homework.title} — {self.student.full_name}",
            status=ReviewStatus.PENDING,
        )
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def test_preview_returns_student_and_failed_tasks(self):
        resp = self.client.get(f"/api/cabinet/review/{self.review.id}/create-homework-preview/")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertEqual(data["student_id"], self.student.id)
        self.assertEqual(data["source_homework_id"], self.homework.id)
        failed_ids = {str(t["task_id"]) for t in data["failed_tasks"]}
        self.assertIn("101", failed_ids)
        self.assertNotIn("102", failed_ids)

    def test_student_cannot_create_homework_from_review(self):
        self.client.force_login(self.student_user)
        resp = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            {"title": "X", "description": "Y", "mode": "assign"},
            format="json",
        )
        self.assertIn(resp.status_code, (403, 404))

    def test_other_teacher_forbidden(self):
        self.client.force_login(self.other)
        resp = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            {"title": "X", "description": "Текст", "mode": "draft"},
            format="json",
        )
        self.assertIn(resp.status_code, (403, 404))

    @patch("Cabinet.homework_from_review.notify_students_homework_assigned", return_value=1)
    def test_create_assign_notifies_and_keeps_old_submission(self, notify_mock):
        due = timezone.now() + timedelta(days=3)
        resp = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            {
                "title": "Отработка",
                "description": "Повтори тему",
                "mode": "assign",
                "due_at": due.isoformat(),
                "idempotency_key": "hfr-key-1",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        data = resp.json()
        new_hw = Homework.objects.get(pk=data["homework_id"])
        self.assertEqual(new_hw.student_id, self.student.id)
        self.assertTrue(new_hw.created_from_review)
        self.assertEqual(new_hw.source_review_item_id, self.review.id)
        self.assertEqual(new_hw.source_homework_id, self.homework.id)
        self.assertEqual(new_hw.status, HomeworkStatus.ASSIGNED)
        notify_mock.assert_called_once()

        self.submission.refresh_from_db()
        self.assertEqual(self.submission.score, 40)
        self.assertEqual(self.submission.teacher_comment, "Исходный комментарий")
        self.assertEqual(self.submission.result_payload["checked"]["101"], False)

    @patch("Cabinet.homework_from_review.notify_students_homework_assigned")
    def test_draft_does_not_notify(self, notify_mock):
        resp = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            {
                "title": "Черновик",
                "description": "Только текст",
                "mode": "draft",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        hw = Homework.objects.get(pk=resp.json()["homework_id"])
        self.assertEqual(hw.status, HomeworkStatus.DRAFT)
        notify_mock.assert_not_called()

    def test_due_in_past_rejected(self):
        past = timezone.now() - timedelta(days=1)
        resp = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            {
                "title": "Прошлое",
                "description": "Текст",
                "mode": "assign",
                "due_at": past.isoformat(),
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get("code"), "DUE_IN_PAST")

    @patch("Cabinet.homework_from_review.notify_students_homework_assigned", return_value=0)
    def test_idempotent_double_request(self, _notify):
        payload = {
            "title": "Один раз",
            "description": "Текст",
            "mode": "assign",
            "idempotency_key": "same-key-hfr",
        }
        r1 = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            payload,
            format="json",
        )
        r2 = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            payload,
            format="json",
        )
        self.assertEqual(r1.status_code, 201, r1.content)
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertTrue(r2.json().get("idempotent"))
        self.assertEqual(r1.json()["homework_id"], r2.json()["homework_id"])
        self.assertEqual(
            Homework.objects.filter(teacher=self.teacher, idempotency_key="same-key-hfr").count(),
            1,
        )

    def test_cannot_spoof_other_student_via_payload(self):
        """student_id в теле запроса игнорируется — ученик берётся из ReviewItem."""
        other_student = Student.objects.create(
            teacher=self.teacher,
            first_name="Чужой",
            last_name="Ученик",
            status="active",
        )
        resp = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            {
                "title": "Без подмены",
                "description": "Текст",
                "mode": "draft",
                "student_id": other_student.id,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        hw = Homework.objects.get(pk=resp.json()["homework_id"])
        self.assertEqual(hw.student_id, self.student.id)

    @patch("Cabinet.homework_from_review._create_variant_from_task_ids", return_value=555)
    @patch("Cabinet.homework_from_review.notify_students_homework_assigned", return_value=0)
    def test_create_with_failed_generator_tasks(self, _notify, create_variant):
        # subject/level from homework task description /oge/inf/variant/99
        resp = self.client.post(
            f"/api/cabinet/review/{self.review.id}/create-homework/",
            {
                "title": "По ошибкам",
                "mode": "assign",
                "include_incorrect": True,
                "generator_task_ids": ["101"],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        create_variant.assert_called()
        hw = Homework.objects.get(pk=resp.json()["homework_id"])
        task = hw.tasks.filter(is_active=True).first()
        self.assertIn("/oge/inf/variant/555", task.description or "")

    def test_get_failed_tasks_include_partial_flag(self):
        from Cabinet.homework_from_review import get_failed_generator_tasks

        only_incorrect = get_failed_generator_tasks(
            submission=self.submission,
            include_partial=False,
        )
        ids = {str(t["task_id"]) for t in only_incorrect}
        self.assertIn("101", ids)
        self.assertNotIn("103", ids)

        with_partial = get_failed_generator_tasks(
            submission=self.submission,
            include_partial=True,
        )
        ids2 = {str(t["task_id"]) for t in with_partial}
        self.assertIn("101", ids2)
        self.assertIn("103", ids2)

    def test_matching_answer_is_not_listed_as_error(self):
        from Cabinet.homework_from_review import get_failed_generator_tasks

        self.submission.result_payload = {
            "by_task_id": {"101": "полукресло", "102": "гуава"},
            "checked": {"101": False, "102": False},
        }
        with patch(
            "Cabinet.homework_from_review._load_task_answers",
            return_value={"101": "полукресло", "102": "дядя"},
        ):
            failed = get_failed_generator_tasks(
                submission=self.submission,
                subject="inf",
            )
        ids = {str(t["task_id"]) for t in failed}
        self.assertNotIn("101", ids)
        self.assertIn("102", ids)

    def test_matching_answer_case_and_html_not_listed_as_error(self):
        from Cabinet.homework_from_review import get_failed_generator_tasks

        self.submission.result_payload = {
            "by_task_id": {"101": "Полукресло"},
            "checked": {"101": False},
        }
        with patch(
            "Cabinet.homework_from_review._load_task_answers",
            return_value={"101": "<p>полукресло</p>"},
        ):
            failed = get_failed_generator_tasks(
                submission=self.submission,
                subject="inf",
            )
        self.assertEqual(failed, [])
