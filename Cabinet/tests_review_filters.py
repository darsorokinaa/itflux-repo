"""Фильтры раздела проверки, summary результата и permissions."""

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import HomeworkStatus, ReviewStatus, SubmissionStatus
from Cabinet.homework_result import build_submission_result_summary
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    Profile,
    ReviewItem,
    Student,
    StudentSubject,
)


def _rows(response):
    payload = response.json()
    if isinstance(payload, list):
        return payload
    return payload.get("results", [])


class ReviewFiltersAndSummaryTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="rf_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other_teacher = User.objects.create_user(username="rf_other", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()

        self.student_user = User.objects.create_user(username="rf_maria", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.maria = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Мария",
            last_name="Сорокина",
            status="active",
        )
        self.alex = Student.objects.create(
            teacher=self.teacher,
            first_name="Алексей",
            last_name="Иванов",
            status="active",
        )
        self.foreign_student = Student.objects.create(
            teacher=self.other_teacher,
            first_name="Чужая",
            last_name="Работа",
            status="active",
        )
        self.math = StudentSubject.objects.create(
            student=self.maria,
            subject="math",
            title="Тригонометрия",
            direction="ege",
        )
        self.inf = StudentSubject.objects.create(
            student=self.alex,
            subject="inf",
            title="ОГЭ",
            direction="oge",
        )

        self.maria_hw = self._make_homework(self.maria, "Тригонометрические уравнения", self.math)
        self.alex_hw = self._make_homework(self.alex, "Системы счисления", self.inf)
        self.maria_pending = self._make_review(
            self.maria,
            self.maria_hw,
            status=ReviewStatus.PENDING,
            submission_status=SubmissionStatus.SUBMITTED,
            submitted=True,
            payload={"checked": {"1": True, "2": False}},
            score=None,
        )
        self.maria_checked = self._make_review(
            self.maria,
            self._make_homework(self.maria, "Производная", self.math),
            status=ReviewStatus.CHECKED,
            submission_status=SubmissionStatus.CHECKED,
            submitted=True,
            payload={"manual_stats": {"correct": 8, "incorrect": 2, "total": 10, "unsolved": 0}},
            score=80,
            comment="Хорошо решены первые задания. Обрати внимание на №7.",
        )
        self.alex_pending = self._make_review(
            self.alex,
            self.alex_hw,
            status=ReviewStatus.PENDING,
            submission_status=SubmissionStatus.SUBMITTED,
            submitted=True,
        )

        self.foreign_hw = Homework.objects.create(
            teacher=self.other_teacher,
            student=self.foreign_student,
            title="Чужое ДЗ",
            status=HomeworkStatus.ASSIGNED,
        )
        foreign_sub = HomeworkSubmission.objects.create(
            homework=self.foreign_hw,
            student=self.foreign_student,
            status=SubmissionStatus.CHECKED,
            submitted_at=timezone.now(),
            score=99,
        )
        self.foreign_review = ReviewItem.objects.create(
            teacher=self.other_teacher,
            student=self.foreign_student,
            source_type="homework",
            source_id=foreign_sub.pk,
            title=self.foreign_hw.title,
            status=ReviewStatus.CHECKED,
        )

        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _make_homework(self, student, title, subject=None):
        return Homework.objects.create(
            teacher=self.teacher,
            student=student,
            student_subject=subject,
            title=title,
            status=HomeworkStatus.ASSIGNED,
        )

    def _make_review(
        self,
        student,
        homework,
        *,
        status,
        submission_status,
        submitted=False,
        payload=None,
        score=None,
        comment="",
    ):
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=student,
            status=submission_status,
            submitted_at=timezone.now() if submitted else None,
            result_payload=payload or {},
            score=score,
            teacher_comment=comment,
        )
        if submission_status == SubmissionStatus.CHECKED:
            homework.status = HomeworkStatus.CHECKED
            homework.save(update_fields=["status", "updated_at"])
        return ReviewItem.objects.create(
            teacher=self.teacher,
            student=student,
            source_type="homework",
            source_id=submission.pk,
            title=f"{homework.title} — {student.full_name}",
            status=status,
            checked_at=timezone.now() if status == ReviewStatus.CHECKED else None,
        )

    def test_teacher_sees_own_students_in_filter_options(self):
        response = self.client.get("/api/cabinet/review/")
        self.assertEqual(response.status_code, 200, response.content)
        labels = [row["label"] for row in response.json()["students"]]
        self.assertIn("Мария Сорокина", labels)
        self.assertIn("Алексей Иванов", labels)
        self.assertNotIn("Чужая Работа", labels)

    def test_filter_by_student(self):
        response = self.client.get(f"/api/cabinet/review/?student={self.maria.pk}")
        ids = [row["id"] for row in _rows(response)]
        self.assertIn(self.maria_pending.pk, ids)
        self.assertIn(self.maria_checked.pk, ids)
        self.assertNotIn(self.alex_pending.pk, ids)
        self.assertGreaterEqual(response.json()["counts"]["all"], 2)
        self.assertGreaterEqual(response.json()["counts"]["pending"], 1)
        self.assertGreaterEqual(response.json()["counts"]["checked"], 1)

    def test_foreign_student_id_returns_empty(self):
        response = self.client.get(f"/api/cabinet/review/?student={self.foreign_student.pk}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(_rows(response), [])
        self.assertEqual(response.json()["counts"]["all"], 0)

    def test_student_and_status_filter(self):
        response = self.client.get(
            f"/api/cabinet/review/?student={self.maria.pk}&status=pending"
        )
        ids = [row["id"] for row in _rows(response)]
        self.assertIn(self.maria_pending.pk, ids)
        self.assertNotIn(self.maria_checked.pk, ids)
        self.assertNotIn(self.alex_pending.pk, ids)

    def test_student_and_subject_filter(self):
        response = self.client.get(
            f"/api/cabinet/review/?student={self.maria.pk}&subject={self.math.pk}"
        )
        ids = [row["id"] for row in _rows(response)]
        self.assertTrue(ids)
        self.assertNotIn(self.alex_pending.pk, ids)
        for row in _rows(response):
            self.assertEqual(row["student"], self.maria.pk)

    def test_foreign_subject_id_returns_empty(self):
        other_subject = StudentSubject.objects.create(
            student=self.foreign_student,
            subject="math",
            title="Чужой",
        )
        response = self.client.get(f"/api/cabinet/review/?subject={other_subject.pk}")
        self.assertEqual(_rows(response), [])

    def test_empty_result_for_unknown_student(self):
        response = self.client.get("/api/cabinet/review/?student=999999")
        self.assertEqual(_rows(response), [])

    def test_checked_submission_returns_summary(self):
        response = self.client.get("/api/cabinet/review/?status=checked")
        row = next(r for r in _rows(response) if r["id"] == self.maria_checked.pk)
        summary = row["result_summary"]
        self.assertTrue(summary["is_final"])
        self.assertEqual(summary["correct_count"], 8)
        self.assertEqual(summary["total_count"], 10)
        self.assertEqual(summary["percentage"], 80.0)
        self.assertIn("Хорошо решены", summary["teacher_comment_preview"])

    def test_unchecked_submission_has_no_fake_percent(self):
        response = self.client.get("/api/cabinet/review/?status=pending")
        row = next(r for r in _rows(response) if r["id"] == self.maria_pending.pk)
        summary = row["result_summary"]
        self.assertFalse(summary["is_final"])
        self.assertIsNone(summary["percentage"])
        self.assertIsNone(summary["correct_count"])
        self.assertEqual(summary["auto_correct_count"], 1)
        self.assertEqual(summary["auto_total_count"], 2)

    def test_old_checked_submission_without_new_fields(self):
        hw = self._make_homework(self.maria, "Старое ДЗ")
        review = self._make_review(
            self.maria,
            hw,
            status=ReviewStatus.CHECKED,
            submission_status=SubmissionStatus.CHECKED,
            submitted=True,
            payload={},
            score=85,
        )
        summary = build_submission_result_summary(
            HomeworkSubmission.objects.get(pk=review.source_id)
        )
        self.assertTrue(summary["is_final"])
        self.assertEqual(summary["percentage"], 85.0)
        self.assertIsNone(summary["correct_count"])
        self.assertNotEqual(summary["status"], "not_submitted")

    def test_teacher_cannot_open_foreign_review(self):
        response = self.client.get(f"/api/cabinet/review/{self.foreign_review.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_student_cannot_open_foreign_homework_result(self):
        other_user = User.objects.create_user(username="rf_alex_user", password="pass")
        other_user.profile.role = Profile.Role.STUDENT
        other_user.profile.save()
        self.alex.user = other_user
        self.alex.save(update_fields=["user"])

        student_client = APIClient()
        student_client.force_login(other_user)
        response = student_client.get(f"/api/cabinet/student/assignments/{self.maria_hw.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_student_card_has_summary_only_when_checked(self):
        student_client = APIClient()
        student_client.force_login(self.student_user)
        response = student_client.get("/api/cabinet/student/assignments/")
        self.assertEqual(response.status_code, 200)
        items = {item["id"]: item for item in response.json()["items"]}
        pending = items[self.maria_hw.id]
        self.assertEqual(pending["status"], "submitted")
        self.assertIsNone(pending["result_percent"])
        self.assertFalse(pending["result_summary"]["is_final"])
        self.assertNotIn("needs_manual_review", pending["result_summary"])

        checked_hw_id = HomeworkSubmission.objects.get(pk=self.maria_checked.source_id).homework_id
        checked = items[checked_hw_id]
        self.assertEqual(checked["status"], "checked")
        self.assertEqual(checked["result_percent"], 80.0)
        self.assertEqual(checked["result_summary"]["correct_count"], 8)
        self.assertNotIn("needs_manual_review", checked["result_summary"])
        self.assertNotIn("teacher_comment", checked["result_summary"])

    def test_student_detail_hides_result_until_checked(self):
        student_client = APIClient()
        student_client.force_login(self.student_user)
        pending = student_client.get(f"/api/cabinet/student/assignments/{self.maria_hw.pk}/")
        self.assertEqual(pending.status_code, 200)
        self.assertIsNone(pending.json()["result"])

        checked_hw_id = HomeworkSubmission.objects.get(pk=self.maria_checked.source_id).homework_id
        checked = student_client.get(f"/api/cabinet/student/assignments/{checked_hw_id}/")
        self.assertEqual(checked.status_code, 200)
        data = checked.json()
        self.assertEqual(data["status"], "checked")
        self.assertEqual(data["result_percent"], 80.0)
        self.assertIsNotNone(data["result"])


class SubmissionResultSummaryUnitTests(TestCase):
    def test_checked_manual_stats(self):
        sub = HomeworkSubmission(
            status=SubmissionStatus.CHECKED,
            submitted_at=timezone.now(),
            score=70,
            result_payload={"manual_stats": {"correct": 7, "total": 10}},
            teacher_comment="Ок",
        )
        summary = build_submission_result_summary(sub)
        self.assertTrue(summary["is_final"])
        self.assertEqual(summary["correct_count"], 7)
        self.assertEqual(summary["total_count"], 10)
        self.assertEqual(summary["percentage"], 70.0)

    def test_submitted_does_not_expose_zero_percent(self):
        sub = HomeworkSubmission(
            status=SubmissionStatus.SUBMITTED,
            submitted_at=timezone.now(),
            score=0,
            result_payload={"checked": {"1": False}},
        )
        summary = build_submission_result_summary(sub, for_student=True)
        self.assertFalse(summary["is_final"])
        self.assertIsNone(summary["percentage"])
        self.assertIsNone(summary["score"])
