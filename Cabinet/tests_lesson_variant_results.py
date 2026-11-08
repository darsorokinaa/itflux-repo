"""Несколько вариантов одного урока в журнале: раздельно по ученику и уроку."""

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from Cabinet.choices import CommentVisibility, SubmissionStatus
from Cabinet.homework_api import LIVE_MEETING_HOMEWORK_MARKER
from Cabinet.journal_models import AttendanceStatus, RecordPublishStatus
from Cabinet.journal_service import apply_live_variant_results_to_journal, get_or_create_journal
from Cabinet.lesson_variant_results import lesson_variant_marker, lesson_variant_results_for_record
from Cabinet.models import Homework, HomeworkSubmission, HomeworkSubmissionAttempt, HomeworkTask
from Cabinet.tests_journal import JournalTestBase

TASKS = [{"id": 11, "number": 1, "answer": "10"}, {"id": 12, "number": 2, "answer": "20"}]


def _checked_payload(*, percent, pending=0, review="final", answer="10", earned=4, maximum=5):
    return {
        "scoring": {
            "review_status": review,
            "percentage": percent,
            "earned_points": earned,
            "max_points": maximum,
            "pending_review_count": pending,
            "checked_count": 2,
            "correct_count": 1,
        },
        "checked": {"11": True, "12": False},
        "by_task_id": {"11": answer, "12": "нет"},
    }


class LessonVariantResultsTests(JournalTestBase):
    def setUp(self):
        super().setUp()
        self.tasks_patch = patch(
            "Cabinet.meeting_present._variant_tasks_answer_key",
            return_value=TASKS,
        )
        self.tasks_patch.start()
        self.addCleanup(self.tasks_patch.stop)

    def _lesson(self, event=None):
        event = event or self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get(student=self.student)
        record.attendance_status = AttendanceStatus.PRESENT
        record.recommendation = "Повторить системы счисления"
        record.teacher_comment = "Только ученику"
        record.private_note = "секрет учителя"
        record.comment_visibility = CommentVisibility.STUDENT_ONLY
        record.save()
        return event, journal, record

    def _variant(self, event, variant_id, *, student, payload=None, status=SubmissionStatus.CHECKED, title=""):
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=student if not event.group_id else None,
            group=event.group,
            title=title or f"Вариант №{variant_id}",
            description=f"{lesson_variant_marker(event.pk)}{variant_id}\nПоказан на уроке {event.pk}",
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type="generated_task",
            title=homework.title,
            description=f"/ege/inf/variant/{variant_id}/",
            order=0,
        )
        submission = None
        if payload is not None:
            submission = HomeworkSubmission.objects.create(
                homework=homework,
                student=student,
                status=status,
                submitted_at=timezone.now(),
                result_payload=payload,
                score=payload.get("scoring", {}).get("percentage"),
            )
        return homework, submission

    def test_one_lesson_keeps_every_variant_and_attempt(self):
        event, _journal, record = self._lesson()
        _hw1, sub1 = self._variant(
            event,
            101,
            student=self.student,
            payload=_checked_payload(percent=80, answer="10"),
        )
        HomeworkSubmissionAttempt.objects.create(
            submission=sub1,
            attempt_number=1,
            status=SubmissionStatus.CHECKED,
            score=40,
            is_final=True,
            teacher_comment="первая попытка",
            submitted_at=timezone.now() - timedelta(minutes=20),
        )
        sub1.attempt_count = 1
        sub1.save(update_fields=["attempt_count"])
        self._variant(
            event,
            202,
            student=self.student,
            payload=_checked_payload(percent=None, pending=1, review="pending", earned=1, maximum=5),
            status=SubmissionStatus.SUBMITTED,
        )

        variants = lesson_variant_results_for_record(record)
        self.assertEqual([item["variant_id"] for item in variants], [101, 202])
        checked, pending = variants
        self.assertEqual(checked["title"], "Вариант №101")
        self.assertEqual(checked["status"], "checked")
        self.assertEqual(checked["score_percent"], 80)
        self.assertEqual(len(checked["attempts"]), 1)
        self.assertEqual(checked["attempts"][0]["attempt_number"], 1)
        self.assertEqual(pending["status"], "pending_review")
        self.assertIsNone(pending["score_percent"])
        self.assertNotEqual(pending["score_percent"], 0)

        from Cabinet.lesson_variant_results import build_lesson_parent_report

        report = build_lesson_parent_report(record, variants)
        self.assertEqual(report["delivery"], "manual")
        self.assertIn("Вариант №101", report["text"])
        self.assertIn("Вариант №202", report["text"])
        self.assertIn("Анна Иванова", report["text"])
        self.assertIn("80%", report["text"])
        self.assertIn("Вариант №202 — Ждёт проверки, балл не выставлен", report["text"])
        self.assertIn("Повторить системы счисления", report["text"])
        self.assertNotIn("секрет учителя", report["text"])
        self.assertNotIn("Только ученику", report["text"])
        self.assertNotRegex(report["text"], r"(?<!\d)0%")

    def test_students_lessons_homework_and_live_solve_stay_separate(self):
        event, journal, record = self._lesson(self._group_event())
        other = journal.student_records.get(student=self.student2)
        self._variant(
            event,
            101,
            student=self.student,
            payload=_checked_payload(percent=40, earned=2, maximum=5),
        )
        shared = Homework.objects.get(description__contains=lesson_variant_marker(event.pk))
        HomeworkSubmission.objects.create(
            homework=shared,
            student=self.student2,
            status=SubmissionStatus.CHECKED,
            submitted_at=timezone.now(),
            result_payload=_checked_payload(percent=100, answer="10", earned=5, maximum=5),
            score=100,
        )
        other_event = self._individual_event()
        self._variant(
            other_event,
            303,
            student=self.student,
            payload=_checked_payload(percent=15, earned=1, maximum=5),
        )
        Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Обычное ДЗ",
            description="без метки урока",
            status="assigned",
        )
        Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Решать вариант",
            description=f"{LIVE_MEETING_HOMEWORK_MARKER}solve:abc\nвне урока",
            status="assigned",
        )

        own = lesson_variant_results_for_record(record)
        theirs = lesson_variant_results_for_record(other)
        self.assertEqual([item["variant_id"] for item in own], [101])
        self.assertEqual(own[0]["score_percent"], 40)
        self.assertEqual([item["variant_id"] for item in theirs], [101])
        self.assertEqual(theirs[0]["score_percent"], 100)
        self.assertNotIn(303, [item["variant_id"] for item in own])
        self.assertTrue(all("Обычное ДЗ" not in item["title"] for item in own))
        self.assertTrue(all(item["variant_id"] != 0 for item in own))

    def test_empty_lesson_has_no_score_and_manual_parent_report(self):
        _event, _journal, record = self._lesson()
        variants = lesson_variant_results_for_record(record)
        self.assertEqual(variants, [])
        from Cabinet.lesson_variant_results import build_lesson_parent_report

        report = build_lesson_parent_report(record, variants)
        self.assertIn("не выдавались", report["text"])
        self.assertNotIn("0%", report["text"])
        self.assertEqual(report["delivery"], "manual")

    def test_final_zero_stays_zero_and_draft_does_not(self):
        event, _journal, record = self._lesson()
        self._variant(
            event,
            7,
            student=self.student,
            payload=_checked_payload(percent=0, earned=0, maximum=5),
        )
        variants = lesson_variant_results_for_record(record)
        self.assertEqual(variants[0]["status"], "checked")
        self.assertEqual(variants[0]["score_percent"], 0)

        draft_event, _journal2, draft = self._lesson(self._group_event())
        self._variant(
            draft_event,
            8,
            student=self.student,
            payload={
                "scoring": {
                    "review_status": "draft",
                    "percentage": 0,
                    "earned_points": 0,
                    "max_points": 5,
                    "pending_review_count": 0,
                },
                "by_task_id": {"11": "черновик"},
            },
            status=SubmissionStatus.SUBMITTED,
        )
        pending = lesson_variant_results_for_record(draft)
        self.assertEqual(pending[0]["status"], "in_progress")
        self.assertIsNone(pending[0]["score_percent"])

    def test_apply_stores_all_variants_without_zeroing_pending(self):
        event, _journal, record = self._lesson()
        self._variant(
            event,
            101,
            student=self.student,
            payload=_checked_payload(percent=80),
        )
        self._variant(
            event,
            202,
            student=self.student,
            payload=_checked_payload(percent=0, pending=2, review="pending", earned=0, maximum=5),
            status=SubmissionStatus.SUBMITTED,
        )
        apply_live_variant_results_to_journal(
            event=event,
            teacher=self.teacher,
            presented_payload={"homeworkId": Homework.objects.order_by("-id").first().id, "variantId": 202, "title": "Вариант №202"},
        )
        record.refresh_from_db()
        stored = record.variant_result["lesson_variants"]
        self.assertEqual([item["variant_id"] for item in stored], [101, 202])
        self.assertEqual(record.variant_result["variant_id"], 101)
        self.assertEqual(float(record.overall_score), 80)
        pending = next(item for item in stored if item["variant_id"] == 202)
        self.assertIsNone(pending["score_percent"])

    def test_teacher_api_has_report_and_student_api_hides_answers_and_report(self):
        event, _journal, record = self._lesson()
        self._variant(
            event,
            101,
            student=self.student,
            payload=_checked_payload(percent=80, answer="10"),
        )
        record.publish_status = RecordPublishStatus.PUBLISHED
        record.visible_to_student = True
        record.save(update_fields=["publish_status", "visible_to_student", "updated_at"])

        teacher = self.client.get(f"/api/cabinet/journal/lessons/{event.id}/")
        self.assertEqual(teacher.status_code, 200)
        row = teacher.data["student_records"][0]
        self.assertEqual(len(row["variant_results"]), 1)
        self.assertIn("parent_report", row)
        self.assertEqual(row["parent_report"]["delivery"], "manual")
        self.assertNotIn("секрет учителя", row["parent_report"]["text"])
        answers = [task.get("correct_answer") for task in row["variant_results"][0]["tasks"]]
        self.assertIn("10", answers)

        self.client.force_login(self.student_user)
        student = self.client.get(f"/api/cabinet/student/results/{record.id}/")
        self.assertEqual(student.status_code, 200, student.content)
        self.assertNotIn("parent_report", student.data)
        self.assertNotIn("private_note", student.data)
        tasks = student.data["variant_results"][0]["tasks"]
        self.assertTrue(tasks)
        self.assertTrue(all("correct_answer" not in task for task in tasks))
        self.assertEqual(student.data["variant_results"][0]["score_percent"], 80)
