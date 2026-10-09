"""Одна попытка варианта: черновик, проверка, журнал, карточка ученика, предпросмотр."""

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from Cabinet.choices import ReviewStatus, SubmissionStatus
from Cabinet.homework_result import build_submission_result_summary
from Cabinet.journal_service import _variant_score_percent, build_homework_result_payload
from Cabinet.models import Homework, HomeworkSubmission, HomeworkTask, Profile, ReviewItem, Student
from Generator.models import Level, Part, Subject, Task, TaskList, Variant, VariantContent


class JournalStoredPercentTests(SimpleTestCase):
    def test_saved_lesson_percent_is_not_replaced_on_read(self):
        percent = _variant_score_percent({
            "score_percent": 80,
            "tasks": [{"ok": True, "student_answer": "1", "correct_answer": "1"}, {"ok": False}],
        })
        self.assertEqual(percent, 80.0)


class VariantScoringFlowTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="score_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student_user = User.objects.create_user(username="score_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Поток",
            status="active",
        )
        self.subject = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.level = Level.objects.create(level="ege", level_rus="ЕГЭ")
        self.part = Part.objects.create(part_title="Часть 1")
        self.variant = Variant.objects.create(
            var_subject=self.subject,
            level=self.level,
            created_by="test",
        )
        self.task_a = self._task(1, 1, "10", exam_part=1)
        self.task_b = self._task(2, 2, "20", exam_part=1)
        self.task_c = self._task(13, 3, "", exam_part=2)
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Вариант на баллы",
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="external_link",
            title="Вариант",
            description=f"/ege/math/variant/{self.variant.id}/",
            order=0,
            is_active=True,
        )
        self.student_api = APIClient()
        self.student_api.force_authenticate(user=self.student_user)
        self.teacher_api = APIClient()
        self.teacher_api.force_authenticate(user=self.teacher)

    def _task(self, number, max_score, answer, *, exam_part):
        task_list = TaskList.objects.create(
            subject=self.subject,
            level=self.level,
            part=self.part,
            task_number=number,
            task_title=f"Задание {number}",
            max_score=max_score,
        )
        task = Task.objects.create(
            task=task_list,
            task_template=f"<p>{number}</p>",
            answer=answer,
            max_score=max_score,
            exam_part=exam_part,
            is_active=True,
        )
        VariantContent.objects.create(variant=self.variant, task=task, order=number)
        return task

    def _answers(self, part2=None):
        payload = {
            "by_task_id": {
                str(self.task_a.id): "10",
                str(self.task_b.id): "99",
                str(self.task_c.id): "решение",
            }
        }
        if part2 is not None:
            payload["scores"] = {str(self.task_c.id): part2}
        return payload

    def _save_draft(self, result):
        response = self.student_api.post(
            f"/api/homework/assignment/{self.homework.id}/save-draft/",
            {"result": result},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def test_same_attempt_matches_across_pages_and_survives_bank_edits(self):
        visible = self._save_draft(self._answers())
        self.assertNotIn("grading_snapshot", visible)
        self.assertNotIn("НЕ-ТОТ", str(visible))
        scoring = visible["scoring"]
        self.assertEqual(scoring["total_tasks"], 3)
        self.assertEqual(scoring["max_points"], 6)
        self.assertEqual(scoring["earned_points"], 1)
        self.assertEqual(scoring["correct_count"], 1)
        self.assertEqual(scoring["incorrect_count"], 1)
        self.assertEqual(scoring["unanswered_count"], 0)
        self.assertEqual(scoring["pending_review_count"], 1)
        self.assertIsNone(scoring["percentage"])
        self.assertEqual(
            scoring["correct_count"]
            + scoring["incorrect_count"]
            + scoring["partial_count"]
            + scoring["unanswered_count"]
            + scoring["pending_review_count"],
            scoring["total_tasks"],
        )

        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        self.assertEqual(submission.result_payload["grading_snapshot"][0]["answer"], "10")
        self.assertIsNone(submission.score)

        self.task_a.answer = "НЕ-ТОТ"
        self.task_a.save(update_fields=["answer"])
        extra = self._task(4, 1, "4", exam_part=1)
        again = self._save_draft(self._answers())
        self.assertEqual(again["scoring"]["total_tasks"], 3)
        self.assertEqual(again["scoring"]["earned_points"], 1)
        self.assertEqual(again["scoring"]["max_points"], 6)
        self.assertNotIn(str(extra.id), {str(row["id"]) for row in again["tasks_snapshot"]})
        submission.refresh_from_db()
        self.assertEqual(submission.result_payload["grading_snapshot"][0]["answer"], "10")

        submitted = self.student_api.post(
            f"/api/homework/assignment/{self.homework.id}/submit/",
            {"result": self._answers()},
            format="json",
        )
        self.assertEqual(submitted.status_code, 200, submitted.content)
        review_id = submitted.json()["review_id"]

        preview = self.teacher_api.post(f"/api/cabinet/review/{review_id}/scoring-preview/", {}, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertTrue(preview.json()["changed"])
        self.assertFalse(preview.json()["applied"])
        submission.refresh_from_db()
        self.assertEqual(submission.result_payload["scoring"]["earned_points"], 1)
        self.assertEqual(submission.result_payload["grading_snapshot"][0]["answer"], "10")

        refused = self.teacher_api.post(
            f"/api/cabinet/review/{review_id}/scoring-apply/",
            {},
            format="json",
        )
        self.assertEqual(refused.status_code, 400, refused.content)
        submission.refresh_from_db()
        self.assertEqual(submission.result_payload["scoring"]["earned_points"], 1)

        zero = self.teacher_api.post(
            f"/api/cabinet/review/{review_id}/check/",
            {"teacher_comment": "Ноль за часть 2", "scores": {str(self.task_c.id): 0}},
            format="json",
        )
        self.assertEqual(zero.status_code, 200, zero.content)
        submission.refresh_from_db()
        zero_scoring = submission.result_payload["scoring"]
        self.assertEqual(zero_scoring["pending_review_count"], 0)
        self.assertEqual(zero_scoring["incorrect_count"], 2)
        self.assertEqual(zero_scoring["earned_points"], 1)
        self.assertEqual(zero_scoring["review_status"], "final")

        partial = self.teacher_api.post(
            f"/api/cabinet/review/{review_id}/check/",
            {"scores": {str(self.task_c.id): 1}},
            format="json",
        )
        self.assertEqual(partial.status_code, 200, partial.content)
        submission.refresh_from_db()
        self.assertEqual(submission.result_payload["scoring"]["partial_count"], 1)
        self.assertEqual(submission.result_payload["scoring"]["earned_points"], 2)

        full = self.teacher_api.post(
            f"/api/cabinet/review/{review_id}/check/",
            {"scores": {str(self.task_c.id): 3}},
            format="json",
        )
        self.assertEqual(full.status_code, 200, full.content)
        submission.refresh_from_db()
        final = submission.result_payload["scoring"]
        self.assertEqual(final["earned_points"], 4)
        self.assertEqual(final["max_points"], 6)
        self.assertEqual(final["correct_count"], 2)
        self.assertEqual(final["partial_count"], 0)
        self.assertEqual(final["percentage"], 66.67)

        same = self.teacher_api.post(
            f"/api/cabinet/review/{review_id}/check/",
            {"teacher_comment": "Без смены балла", "scores": {str(self.task_c.id): 3}},
            format="json",
        )
        self.assertEqual(same.status_code, 200, same.content)
        submission.refresh_from_db()
        self.assertEqual(submission.result_payload["scoring"]["earned_points"], 4)
        self.assertEqual(submission.result_payload["grading_snapshot"][0]["answer"], "10")

        summary = build_submission_result_summary(submission)
        journal = build_homework_result_payload(
            homework=self.homework,
            student=self.student,
            submission=submission,
            for_student=True,
        )
        review = self.teacher_api.get(f"/api/cabinet/review/{review_id}/")
        self.assertEqual(review.status_code, 200, review.content)
        review_summary = review.json()["result_summary"]
        student_card = self.student_api.get(f"/api/cabinet/student/assignments/{self.homework.id}/")
        self.assertEqual(student_card.status_code, 200, student_card.content)
        student_result = student_card.json()["result"]

        for surface in (summary, review_summary):
            self.assertEqual(surface["earned_points"], 4)
            self.assertEqual(surface["max_points"], 6)
            self.assertEqual(surface["percentage"], 66.67)
            self.assertEqual(surface["correct_count"], 2)
            self.assertEqual(surface["review_status"], "final")
        self.assertEqual(journal["earned_points"], 4)
        self.assertEqual(journal["max_points"], 6)
        self.assertEqual(journal["score_percent"], 66.67)
        self.assertNotIn("grading_snapshot", student_result)
        self.assertEqual(student_result["scoring"]["earned_points"], 4)
        self.assertEqual(student_result["scoring"]["max_points"], 6)
        self.assertNotIn("НЕ-ТОТ", str(student_result))
        for row in journal["tasks"]:
            self.assertNotIn("correct_answer", row)

        teacher_journal = build_homework_result_payload(
            homework=self.homework,
            student=self.student,
            submission=submission,
            for_student=False,
        )
        self.assertIn("10", [row.get("correct_answer") for row in teacher_journal["tasks"]])
        self.assertNotIn("НЕ-ТОТ", [row.get("correct_answer") for row in teacher_journal["tasks"]])

    def test_return_and_resubmit_keeps_old_attempt_and_frozen_criteria(self):
        self._save_draft(self._answers())
        submitted = self.student_api.post(
            f"/api/homework/assignment/{self.homework.id}/submit/",
            {"result": self._answers()},
            format="json",
        )
        review_id = submitted.json()["review_id"]
        self.teacher_api.post(
            f"/api/cabinet/review/{review_id}/check/",
            {"scores": {str(self.task_c.id): 3}},
            format="json",
        )
        returned = self.teacher_api.post(
            f"/api/cabinet/review/{review_id}/return/",
            {"teacher_comment": "Доработай часть 2"},
            format="json",
        )
        self.assertEqual(returned.status_code, 200, returned.content)
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        self.assertEqual(submission.status, SubmissionStatus.RETURNED)
        self.assertEqual(submission.result_payload["scoring"]["earned_points"], 4)

        self.task_a.answer = "ДРУГОЙ"
        self.task_a.save(update_fields=["answer"])
        resubmit = self.student_api.post(
            f"/api/homework/assignment/{self.homework.id}/submit/",
            {"result": self._answers()},
            format="json",
        )
        self.assertEqual(resubmit.status_code, 200, resubmit.content)
        submission.refresh_from_db()
        self.assertEqual(submission.status, SubmissionStatus.SUBMITTED)
        self.assertNotIn("scores", submission.result_payload)
        self.assertEqual(submission.result_payload["scoring"]["pending_review_count"], 1)
        self.assertEqual(submission.result_payload["scoring"]["earned_points"], 1)
        self.assertEqual(submission.result_payload["grading_snapshot"][0]["answer"], "10")
        attempt = submission.attempts.order_by("attempt_number").first()
        self.assertEqual(attempt.result_payload["scoring"]["earned_points"], 4)
        self.assertIsNone(submission.score)

    def test_legacy_checked_score_is_not_rewritten_on_comment_save(self):
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Старая работа",
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type="external_link",
            title="Старый вариант",
            description=f"/ege/math/variant/{self.variant.id}/",
            order=0,
            is_active=True,
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            status=SubmissionStatus.CHECKED,
            submitted_at=submission_now(),
            score=80,
            result_payload={"checked": {"1": True, "2": False}, "by_task_id": {"1": "10", "2": "0"}},
        )
        review = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=submission.pk,
            title="Старая",
            status=ReviewStatus.PENDING,
        )
        response = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/check/",
            {"teacher_comment": "Оставляю как было", "scores": {}},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission.refresh_from_db()
        self.assertEqual(float(submission.score), 80.0)
        self.assertNotIn("scoring", submission.result_payload)
        self.assertNotIn("grading_snapshot", submission.result_payload)

    def test_failed_review_save_does_not_commit_partial_result(self):
        from unittest.mock import patch

        self._save_draft(self._answers())
        submitted = self.student_api.post(
            f"/api/homework/assignment/{self.homework.id}/submit/",
            {"result": self._answers()},
            format="json",
        )
        review_id = submitted.json()["review_id"]
        submission = HomeworkSubmission.objects.get(pk=submitted.json()["submission_id"])
        before = submission.result_payload["scoring"]["earned_points"]
        self.teacher_api.raise_request_exception = False
        with patch("Cabinet.homework_api.store_variant_scoring", side_effect=RuntimeError("network")):
            response = self.teacher_api.post(
                f"/api/cabinet/review/{review_id}/check/",
                {"scores": {str(self.task_c.id): 2}},
                format="json",
            )
        self.assertGreaterEqual(response.status_code, 500)
        submission.refresh_from_db()
        review = ReviewItem.objects.get(pk=review_id)
        self.assertEqual(review.status, ReviewStatus.PENDING)
        self.assertEqual(submission.status, SubmissionStatus.SUBMITTED)
        self.assertEqual(submission.result_payload["scoring"]["earned_points"], before)
        self.assertNotIn("scores", submission.result_payload)


def submission_now():
    from django.utils import timezone

    return timezone.now()
