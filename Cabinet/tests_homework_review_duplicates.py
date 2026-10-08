"""Одна карточка проверки на сдачу: гонки, повторная синхронизация и старые дубли."""

from concurrent.futures import ThreadPoolExecutor, as_completed

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.homework_api import (
    _ensure_review_item,
    sync_assigned_homework_into_review_queue,
)
from Cabinet.models import Homework, HomeworkSubmission, Profile, ReviewItem, Student


def _teacher(username):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save()
    return user


def _student(username, teacher):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.STUDENT
    user.profile.save()
    student = Student.objects.create(
        teacher=teacher,
        user=user,
        first_name="Аня",
        last_name="Ученица",
        status="active",
    )
    return user, student


class HomeworkReviewDuplicateTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("dup_teacher")
        self.other = _teacher("dup_other")
        self.student_user, self.student = _student("dup_student", self.teacher)
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: дубли",
            status="assigned",
        )
        self.submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            status="submitted",
            answer_text="Ответ ученика",
            result_payload={"by_task_id": {"1": "42"}},
        )
        self.teacher_client = APIClient()
        self.teacher_client.force_login(self.teacher)
        self.student_client = APIClient()
        self.student_client.force_login(self.student_user)

    def _counts(self):
        review = self.teacher_client.get("/api/cabinet/review/")
        nav = self.teacher_client.get("/api/cabinet/nav-counts/")
        dash = self.teacher_client.get("/api/cabinet/dashboard/")
        self.assertEqual(review.status_code, 200, review.content)
        pending = review.json()["counts"]["pending"]
        self.assertEqual(nav.json()["reviews_count"], pending)
        self.assertEqual(dash.json()["pending_reviews_count"], pending)
        return pending, review.json()

    def test_repeated_signal_sync_and_submit_keep_one_card(self):
        self.submission.submitted_at = timezone.now()
        self.submission.save(update_fields=["submitted_at"])
        self.submission.save(update_fields=["updated_at"])
        _ensure_review_item(self.submission)
        self.assertEqual(sync_assigned_homework_into_review_queue(self.teacher), 0)
        self.assertEqual(sync_assigned_homework_into_review_queue(self.teacher), 0)
        self.assertEqual(
            ReviewItem.objects.filter(source_type="homework", source_id=self.submission.pk).count(),
            1,
        )

        again = self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/submit/",
            {"result": {"by_task_id": {"1": "42"}}},
            format="json",
        )
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(
            ReviewItem.objects.filter(source_type="homework", source_id=self.submission.pk).count(),
            1,
        )
        pending, payload = self._counts()
        self.assertEqual(pending, 1)
        self.assertEqual(len(payload["results"]), 1)

    def test_existing_duplicates_are_kept_and_lifecycle_uses_one_card(self):
        first = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=self.submission.pk,
            title="Первая",
            status="pending",
            teacher_comment="Комментарий первой",
        )
        second = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=self.submission.pk,
            title="Вторая",
            status="pending",
            teacher_comment="Комментарий второй",
        )
        HomeworkSubmission.objects.filter(pk=self.submission.pk).update(submitted_at=timezone.now())
        self.submission.refresh_from_db()

        self.assertEqual(sync_assigned_homework_into_review_queue(self.teacher), 0)
        self.assertEqual(
            ReviewItem.objects.filter(source_type="homework", source_id=self.submission.pk).count(),
            2,
        )
        pending, payload = self._counts()
        self.assertEqual(pending, 1)
        self.assertEqual([row["id"] for row in payload["results"]], [first.pk])

        other = APIClient()
        other.force_login(self.other)
        foreign = other.post(
            f"/api/cabinet/review/{second.pk}/check/",
            {"teacher_comment": "Чужая"},
            format="json",
        )
        self.assertIn(foreign.status_code, (403, 404))
        student_check = self.student_client.post(
            f"/api/cabinet/review/{first.pk}/check/",
            {"teacher_comment": "Сам"},
            format="json",
        )
        self.assertEqual(student_check.status_code, 403)

        returned = self.teacher_client.post(
            f"/api/cabinet/review/{second.pk}/return/",
            {"teacher_comment": "Нужна доработка"},
            format="json",
        )
        self.assertEqual(returned.status_code, 200, returned.content)
        self.assertEqual(returned.json()["id"], first.pk)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.status, "returned")
        self.assertEqual(first.teacher_comment, "Нужна доработка")
        self.assertEqual(second.status, "pending")
        self.assertEqual(second.teacher_comment, "Комментарий второй")
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.status, "returned")
        self.assertEqual(self.submission.teacher_comment, "Нужна доработка")
        self.assertEqual(self.submission.answer_text, "Ответ ученика")

        resubmit = self.student_client.post(
            f"/api/cabinet/student/assignments/{self.homework.pk}/",
            {"answer_text": "Исправленный ответ"},
            format="multipart",
        )
        self.assertEqual(resubmit.status_code, 200, resubmit.content)
        first.refresh_from_db()
        second.refresh_from_db()
        self.submission.refresh_from_db()
        self.assertEqual(first.status, "pending")
        self.assertIsNone(first.checked_at)
        self.assertEqual(second.teacher_comment, "Комментарий второй")
        self.assertEqual(self.submission.answer_text, "Исправленный ответ")
        self.assertEqual(self.submission.result_payload["by_task_id"]["1"], "42")
        self.assertEqual(self._counts()[0], 1)
        self.assertEqual(
            ReviewItem.objects.filter(source_type="homework", source_id=self.submission.pk).count(),
            2,
        )

        checked = self.teacher_client.post(
            f"/api/cabinet/review/{second.pk}/check/",
            {
                "teacher_comment": "Зачтено",
                "manual_stats": {"total": 1, "correct": 1, "incorrect": 0, "unsolved": 0},
            },
            format="json",
        )
        self.assertEqual(checked.status_code, 200, checked.content)
        self.assertEqual(checked.json()["id"], first.pk)
        first.refresh_from_db()
        second.refresh_from_db()
        self.submission.refresh_from_db()
        self.assertEqual(first.status, "checked")
        self.assertEqual(first.teacher_comment, "Зачтено")
        self.assertEqual(second.status, "pending")
        self.assertEqual(second.teacher_comment, "Комментарий второй")
        self.assertEqual(self.submission.status, "checked")
        self.assertEqual(self.submission.answer_text, "Исправленный ответ")
        self.assertEqual(self._counts()[0], 0)
        history = self.teacher_client.get("/api/cabinet/review/?status=checked")
        self.assertEqual([row["id"] for row in history.json()["results"]], [first.pk])


class HomeworkReviewCreateRaceTests(TransactionTestCase):
    def test_parallel_ensure_creates_one_card(self):
        teacher = _teacher("race_teacher")
        _user, student = _student("race_student", teacher)
        homework = Homework.objects.create(
            teacher=teacher,
            student=student,
            title="ДЗ: гонка карточки",
            status="assigned",
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=student,
            status="submitted",
            answer_text="Ответ",
            submitted_at=timezone.now(),
        )
        ReviewItem.objects.filter(source_type="homework", source_id=submission.pk).delete()
        submission_id = submission.pk

        def worker():
            close_old_connections()
            row = HomeworkSubmission.objects.get(pk=submission_id)
            _ensure_review_item(row)
            close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(worker), pool.submit(worker)]
            for future in as_completed(futures):
                future.result()

        self.assertEqual(
            ReviewItem.objects.filter(source_type="homework", source_id=submission.pk).count(),
            1,
        )
