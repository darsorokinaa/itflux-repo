"""Тесты редактирования уже выданного домашнего задания."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.models import (
    Homework,
    HomeworkEditHistory,
    HomeworkSubmission,
    HomeworkTask,
    Notification,
    Profile,
    ReviewItem,
    Student,
)


class HomeworkEditApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="edit_hw_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other_teacher = User.objects.create_user(username="edit_hw_other", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()

        self.student_user = User.objects.create_user(username="edit_hw_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )

        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Исходное ДЗ",
            description="Сделайте задания",
            status="assigned",
            due_at=timezone.now() + timedelta(days=2),
        )
        self.task1 = HomeworkTask.objects.create(
            homework=self.homework,
            task_type="text",
            title="Задание 1",
            description="Решите задачу 1",
            order=0,
        )
        self.task2 = HomeworkTask.objects.create(
            homework=self.homework,
            task_type="text",
            title="Задание 2",
            description="Решите задачу 2",
            order=1,
        )
        self.submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            status="submitted",
        )
        self.review = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=self.submission.pk,
            title=self.homework.title,
            status="pending",
        )

        self.client = APIClient()
        self.client.force_login(self.teacher)
        self.url = f"/api/cabinet/homework/{self.homework.pk}/"

    def _payload(self, **overrides):
        self.homework.refresh_from_db()
        base = {
            "title": self.homework.title,
            "description": self.homework.description,
            "due_at": self.homework.due_at.isoformat() if self.homework.due_at else None,
            "updated_at": self.homework.updated_at.isoformat(),
            "tasks": [
                {"id": self.task1.pk, "order": 0},
                {"id": self.task2.pk, "order": 1},
            ],
        }
        base.update(overrides)
        return base

    def test_teacher_edits_title_and_description(self):
        response = self.client.patch(
            self.url,
            self._payload(title="Новое название", description="Новая инструкция"),
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.homework.refresh_from_db()
        self.assertEqual(self.homework.title, "Новое название")
        self.assertEqual(self.homework.description, "Новая инструкция")
        self.assertTrue(
            HomeworkEditHistory.objects.filter(homework=self.homework, actor=self.teacher).exists()
        )

    def test_teacher_changes_due_at(self):
        new_due = timezone.now() + timedelta(days=5)
        response = self.client.patch(
            self.url,
            self._payload(due_at=new_due.isoformat()),
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.homework.refresh_from_db()
        self.assertIsNotNone(self.homework.due_at)
        self.assertAlmostEqual(
            self.homework.due_at.timestamp(),
            new_due.timestamp(),
            delta=2,
        )
        history = HomeworkEditHistory.objects.filter(homework=self.homework).latest("created_at")
        self.assertIsNotNone(history.old_due_at)
        self.assertIsNotNone(history.new_due_at)

    def test_teacher_adds_task(self):
        payload = self._payload(
            tasks=[
                {"id": self.task1.pk, "order": 0},
                {"id": self.task2.pk, "order": 1},
                {"title": "Новое", "description": "Текст нового задания", "order": 2},
            ]
        )
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.homework.tasks.filter(is_active=True).count(), 3)
        self.assertTrue(
            self.homework.tasks.filter(is_active=True, title="Новое").exists()
        )

    def test_teacher_removes_task_without_student_answer(self):
        payload = self._payload(tasks=[{"id": self.task1.pk, "order": 0}])
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.task2.refresh_from_db()
        self.assertFalse(self.task2.is_active)
        self.assertEqual(self.homework.tasks.filter(is_active=True).count(), 1)
        # Физически задание остаётся
        self.assertTrue(HomeworkTask.objects.filter(pk=self.task2.pk).exists())

    def test_teacher_removes_task_with_student_answer_keeps_answers(self):
        self.submission.result_payload = {
            "checked": {"1": True, "2": False},
            "answers": {"1": "A", "2": "B"},
        }
        self.submission.score = Decimal("50.00")
        self.submission.submitted_at = timezone.now()
        self.submission.answer_text = "Мой ответ"
        self.submission.save()

        payload = self._payload(
            tasks=[{"id": self.task1.pk, "order": 0}],
            confirm_student_started=True,
        )
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 200, response.content)

        self.submission.refresh_from_db()
        self.assertEqual(self.submission.answer_text, "Мой ответ")
        self.assertIn("1", self.submission.result_payload.get("checked", {}))
        excluded = self.submission.result_payload.get("excluded_homework_task_ids") or []
        self.assertIn(self.task2.pk, excluded)
        self.task2.refresh_from_db()
        self.assertFalse(self.task2.is_active)

    def test_remaining_task_answers_preserved(self):
        self.submission.result_payload = {
            "checked": {"42": True},
            "answers": {"42": "ok"},
        }
        self.submission.submitted_at = timezone.now()
        self.submission.save()

        payload = self._payload(
            title="Обновлено",
            tasks=[{"id": self.task1.pk, "order": 0}],
            confirm_student_started=True,
        )
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.result_payload.get("answers", {}).get("42"), "ok")
        self.assertTrue(self.submission.result_payload.get("checked", {}).get("42"))

    def test_score_recomputed_when_tasks_change(self):
        self.submission.result_payload = {"checked": {"1": True, "2": True, "3": False}}
        self.submission.score = Decimal("66.67")
        self.submission.submitted_at = timezone.now()
        self.submission.save()

        payload = self._payload(
            tasks=[
                {"id": self.task1.pk, "order": 0},
                {"id": self.task2.pk, "order": 1},
                {"title": "Ещё", "description": "x", "order": 2},
            ],
            confirm_student_started=True,
        )
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.submission.refresh_from_db()
        # compute_score_percent from checked: 2/3
        self.assertIsNotNone(self.submission.score)
        self.assertAlmostEqual(float(self.submission.score), 66.67, places=1)

    def test_student_cannot_open_edit_page(self):
        student_client = APIClient()
        student_client.force_login(self.student_user)
        response = student_client.get(self.url)
        self.assertIn(response.status_code, (403, 401))

    def test_other_teacher_cannot_edit(self):
        other_client = APIClient()
        other_client.force_login(self.other_teacher)
        response = other_client.patch(
            self.url,
            self._payload(title="Хак"),
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.homework.refresh_from_db()
        self.assertEqual(self.homework.title, "Исходное ДЗ")

    def test_id_spoofing_via_post_ignored(self):
        other_hw = Homework.objects.create(
            teacher=self.other_teacher,
            student=self.student,
            title="Чужое",
            status="assigned",
        )
        payload = self._payload(
            title="Своё обновление",
            teacher_id=self.other_teacher.pk,
            student_id=99999,
            homework_id=other_hw.pk,
            assignment_id=other_hw.pk,
        )
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.homework.refresh_from_db()
        self.assertEqual(self.homework.title, "Своё обновление")
        self.assertEqual(self.homework.teacher_id, self.teacher.pk)
        self.assertEqual(self.homework.student_id, self.student.pk)
        other_hw.refresh_from_db()
        self.assertEqual(other_hw.title, "Чужое")

    def test_student_receives_one_notification(self):
        before = Notification.objects.filter(
            recipient_user=self.student_user,
            payload__type="homework_edited",
        ).count()
        response = self.client.patch(
            self.url,
            self._payload(title="Изменённое ДЗ"),
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        after = Notification.objects.filter(
            recipient_user=self.student_user,
            payload__type="homework_edited",
            payload__homework_id=self.homework.pk,
        ).count()
        self.assertEqual(after - before, 1)
        self.assertEqual(response.json().get("notified_students"), 1)

        # Повторная отправка с тем же history не дублирует
        history_id = response.json().get("history_id")
        from Cabinet.homework_edit import notify_students_homework_edited
        from Cabinet.models import HomeworkEditHistory

        history = HomeworkEditHistory.objects.get(pk=history_id)
        sent = notify_students_homework_edited(self.homework, history=history)
        self.assertEqual(sent, 0)

    def test_transaction_rollback_on_error(self):
        payload = self._payload(title="Должно откатиться")
        with patch(
            "Cabinet.homework_edit.HomeworkEditHistory.objects.create",
            side_effect=RuntimeError("boom"),
        ):
            with self.assertRaises(RuntimeError):
                from Cabinet.homework_edit import update_issued_homework

                update_issued_homework(
                    homework=self.homework,
                    teacher=self.teacher,
                    data=payload,
                )
        self.homework.refresh_from_db()
        self.assertEqual(self.homework.title, "Исходное ДЗ")
        self.assertFalse(
            HomeworkEditHistory.objects.filter(homework=self.homework).exists()
        )

    def test_checked_homework_keeps_answers_and_comments(self):
        self.submission.status = "checked"
        self.submission.submitted_at = timezone.now()
        self.submission.teacher_comment = "Отличная работа"
        self.submission.result_payload = {"checked": {"1": True}, "answers": {"1": "A"}}
        self.submission.score = Decimal("100.00")
        self.submission.save()
        self.review.status = "checked"
        self.review.teacher_comment = "OK"
        self.review.save()

        payload = self._payload(
            title="Правка после проверки",
            confirm_checked_edit=True,
        )
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 200, response.content)

        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, "checked")
        self.assertEqual(self.submission.teacher_comment, "Отличная работа")
        self.assertEqual(self.submission.result_payload.get("answers", {}).get("1"), "A")
        self.assertEqual(float(self.submission.score), 100.0)
        history = HomeworkEditHistory.objects.filter(homework=self.homework).latest("created_at")
        self.assertEqual(history.previous_result_meta.get("teacher_comment"), "Отличная работа")

    def test_concurrent_edit_conflict(self):
        stale = self._payload(title="Из вкладки A")
        # Имитируем изменение в другой вкладке
        Homework.objects.filter(pk=self.homework.pk).update(
            description="Изменено в другой вкладке",
            updated_at=timezone.now() + timedelta(seconds=5),
        )
        response = self.client.patch(self.url, stale, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json().get("code"), "conflict")
        self.homework.refresh_from_db()
        self.assertNotEqual(self.homework.title, "Из вкладки A")

    def test_needs_confirm_when_student_started(self):
        self.submission.result_payload = {"answers": {"1": "x"}}
        self.submission.save()
        payload = self._payload(tasks=[{"id": self.task1.pk, "order": 0}])
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json().get("code"), "needs_confirm_student_started")

    def test_get_edit_payload(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], self.homework.pk)
        self.assertEqual(len(data["tasks"]), 2)
        self.assertIn("updated_at", data)
        self.assertIn("warnings", data)
