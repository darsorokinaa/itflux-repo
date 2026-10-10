"""Правка ответа или текста задачи в банке обновляет уже выданные места."""

from django.test import SimpleTestCase, TestCase

from Cabinet.task_answer_sync import refresh_stored_variant_result
from Generator.models import (
    LessonStudentResult,
    LessonStudentsAnswer,
    Level,
    Part,
    Subject,
    Task,
    TaskList,
    Variant,
    VariantContent,
)


class StoredVariantResultTests(SimpleTestCase):
    def test_answer_change_recalculates_auto_verdict(self):
        updated = refresh_stored_variant_result(
            {
                "score_percent": 100,
                "tasks": [
                    {"id": 7, "student_answer": "10", "correct_answer": "10", "ok": True},
                ],
            },
            7,
            "11",
            subject="math",
        )
        self.assertEqual(updated["tasks"][0]["correct_answer"], "11")
        self.assertFalse(updated["tasks"][0]["ok"])
        self.assertEqual(updated["score_percent"], 0)

    def test_teacher_override_keeps_verdict_but_shows_new_answer(self):
        updated = refresh_stored_variant_result(
            {
                "score_percent": 100,
                "tasks": [
                    {"id": 7, "student_answer": "сочинение", "correct_answer": "10", "ok": True},
                ],
            },
            7,
            "11",
            subject="math",
        )
        self.assertEqual(updated["tasks"][0]["correct_answer"], "11")
        self.assertTrue(updated["tasks"][0]["ok"])
        self.assertEqual(updated["score_percent"], 100)


class TaskContentPropagationTests(TestCase):
    def setUp(self):
        self.subject = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.level = Level.objects.create(level="ege", level_rus="ЕГЭ")
        self.part = Part.objects.create(part_title="Часть 1")
        self.variant = Variant.objects.create(var_subject=self.subject, level=self.level, created_by="test")
        task_list = TaskList.objects.create(
            subject=self.subject,
            level=self.level,
            part=self.part,
            task_number=1,
            task_title="Задание 1",
            max_score=1,
        )
        self.task = Task.objects.create(
            task=task_list,
            task_template="<p>было</p>",
            answer="10",
            max_score=1,
            exam_part=1,
            is_active=True,
        )
        VariantContent.objects.create(variant=self.variant, task=self.task, order=1)

    def test_lesson_result_follows_bank_answer(self):
        answer = LessonStudentsAnswer.objects.create(
            room_id="room-1",
            variant_id=self.variant.id,
            task_number="1",
            student="Аня",
            answer="10",
            is_correct=True,
            is_empty=False,
        )
        result = LessonStudentResult.objects.create(
            room_id="room-1",
            variant_id=self.variant.id,
            student="Аня",
            total_tasks=1,
            correct_count=1,
            wrong_count=0,
            empty_count=0,
        )
        self.task.answer = "11"
        self.task.save(update_fields=["answer"])
        answer.refresh_from_db()
        result.refresh_from_db()
        self.assertFalse(answer.is_correct)
        self.assertEqual(result.correct_count, 0)
        self.assertEqual(result.wrong_count, 1)

    def test_text_edit_refreshes_stale_answer_in_attempt(self):
        from django.contrib.auth.models import User

        from Cabinet.models import Homework, HomeworkSubmission, HomeworkTask, Profile, Student

        teacher = User.objects.create_user(username="sync_teacher", password="pass")
        teacher.profile.role = Profile.Role.TEACHER
        teacher.profile.save(update_fields=["role"])
        student_user = User.objects.create_user(username="sync_student", password="pass")
        student_user.profile.role = Profile.Role.STUDENT
        student_user.profile.save(update_fields=["role"])
        student = Student.objects.create(
            teacher=teacher,
            user=student_user,
            first_name="Аня",
            last_name="Синх",
            status="active",
        )
        homework = Homework.objects.create(teacher=teacher, student=student, title="ДЗ", status="assigned")
        HomeworkTask.objects.create(
            homework=homework,
            task_type="external_link",
            title="Вариант",
            description=f"/ege/math/variant/{self.variant.id}/",
            order=0,
            is_active=True,
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=student,
            result_payload={
                "by_task_id": {str(self.task.id): "10"},
                "grading_snapshot": [
                    {
                        "id": self.task.id,
                        "number": 1,
                        "max_score": 1,
                        "exam_part": 1,
                        "answer": "СТАРЫЙ",
                    }
                ],
                "tasks_snapshot": [
                    {"id": self.task.id, "number": 1, "max_score": 1, "exam_part": 1}
                ],
            },
        )
        self.task.task_template = "<p>новое условие</p>"
        self.task.save(update_fields=["task_template"])
        submission.refresh_from_db()
        self.assertEqual(submission.result_payload["grading_snapshot"][0]["answer"], "10")
        self.assertEqual(submission.result_payload["scoring"]["earned_points"], 1)
        self.assertEqual(submission.result_payload["tasks_snapshot"][0]["id"], self.task.id)
        self.task.refresh_from_db()
        self.assertIn("новое условие", self.task.task_template)
