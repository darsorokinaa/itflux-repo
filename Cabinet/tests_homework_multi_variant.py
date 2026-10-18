"""r75: ДЗ с несколькими вариантами — результаты каждого варианта видны и учитываются.

До r75 везде брался только первый вариант ДЗ: итог, разбор учителя, журнал,
ученическая карточка. Ответы второго варианта терялись в итоге и в разборе,
а by_number одного варианта подставлялся в задания другого.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import SubmissionStatus
from Cabinet.homework_api import (
    homework_variant_ids,
    recompute_variant_checked,
    store_variant_scoring,
)
from Cabinet.homework_result import build_submission_result_summary
from Cabinet.journal_service import build_homework_result_payload
from Cabinet.models import Homework, HomeworkSubmission, HomeworkTask, Profile, Student
from Generator.models import Level, Part, Subject, Task, TaskList, Variant, VariantContent

try:
    from Generator.variant_scoring import apply_bank_answer_to_attempt
except Exception:  # pragma: no cover
    from Generator.Generator.variant_scoring import apply_bank_answer_to_attempt


class MultiVariantHomeworkTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="mv_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student_user = User.objects.create_user(username="mv_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Ира",
            last_name="Два",
            status="active",
        )
        self.subject = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.ege = Level.objects.create(level="ege", level_rus="ЕГЭ")
        self.oge = Level.objects.create(level="oge", level_rus="ОГЭ")
        self.part = Part.objects.create(part_title="Часть 1")
        self.v1 = Variant.objects.create(var_subject=self.subject, level=self.ege, created_by="t")
        self.v2 = Variant.objects.create(var_subject=self.subject, level=self.oge, created_by="t")
        # Одинаковые номера 1 и 2 в обоих вариантах — как в реальных ДЗ.
        self.a1 = self._task(self.v1, self.ege, 1, 1, "10")
        self.a2 = self._task(self.v1, self.ege, 2, 1, "20")
        self.b1 = self._task(self.v2, self.oge, 1, 1, "30")
        self.b2 = self._task(self.v2, self.oge, 2, 2, "40")
        self.homework = Homework.objects.create(
            teacher=self.teacher, student=self.student, title="Два варианта", status="assigned"
        )
        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="generated_task",
            title="Вариант 1",
            description=f"https://itflux-academy.ru/ege/math/variant/{self.v1.id}",
            order=0,
        )
        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="generated_task",
            title="Вариант 2",
            description=f"https://itflux-academy.ru/oge/math/variant/{self.v2.id}",
            order=1,
        )
        self.student_api = APIClient()
        self.student_api.force_authenticate(user=self.student_user)
        self.teacher_api = APIClient()
        self.teacher_api.force_authenticate(user=self.teacher)

    def _task(self, variant, level, number, max_score, answer):
        task_list = TaskList.objects.create(
            subject=self.subject,
            level=level,
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
            exam_part=1,
            is_active=True,
        )
        VariantContent.objects.create(variant=variant, task=task, order=number)
        return task

    def _post(self, suffix, result):
        response = self.student_api.post(
            f"/api/homework/assignment/{self.homework.id}/{suffix}",
            {"result": result},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_variant_ids_in_task_order(self):
        self.assertEqual(homework_variant_ids(self.homework), [self.v1.id, self.v2.id])

    def test_both_variants_scored_and_visible_everywhere(self):
        # Ученик решает вариант 1 (черновик), затем вариант 2 и отправляет.
        self._post(
            "save-draft/",
            {"by_task_id": {str(self.a1.id): "10", str(self.a2.id): "0"}, "by_number": {"1": "10", "2": "0"}},
        )
        draft = self._post(
            "save-draft/",
            {"by_task_id": {str(self.b1.id): "30", str(self.b2.id): "40"}, "by_number": {"1": "30", "2": "40"}},
        )
        # Ответы обоих вариантов сохранены, by_number не отдаём — он неоднозначен.
        self.assertEqual(
            set(draft["result"]["by_task_id"]),
            {str(self.a1.id), str(self.a2.id), str(self.b1.id), str(self.b2.id)},
        )
        self.assertNotIn("by_number", draft["result"])
        assignment = self.student_api.get(f"/api/homework/assignment/{self.homework.id}/")
        self.assertEqual(assignment.status_code, 200, assignment.content)
        assignment = assignment.json()
        self.assertEqual(assignment["variant_ids"], [self.v1.id, self.v2.id])
        self.assertEqual(assignment["variant_id"], self.v1.id)
        self.assertNotIn("by_number", assignment["result"])
        progress = {row["variant_id"]: row for row in assignment["variants"]}
        self.assertEqual(progress[self.v1.id]["answered_count"], 2)
        self.assertEqual(progress[self.v2.id]["answered_count"], 2)

        submitted = self.student_api.post(
            f"/api/homework/assignment/{self.homework.id}/submit/",
            {"result": {"by_task_id": {str(self.b1.id): "30", str(self.b2.id): "40"}}},
            format="json",
        )
        self.assertEqual(submitted.status_code, 200, submitted.content)
        review_id = submitted.json()["review_id"]

        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        scoring = submission.result_payload["scoring"]
        self.assertEqual(scoring["total_tasks"], 4)
        self.assertEqual(scoring["max_points"], 5)
        self.assertEqual(scoring["earned_points"], 4)  # a1 + b1 + b2(2)
        self.assertEqual(scoring["correct_count"], 3)
        self.assertEqual(scoring["incorrect_count"], 1)
        self.assertEqual(scoring["review_status"], "final")
        self.assertEqual(scoring["percentage"], 80.0)
        self.assertEqual(float(submission.score), 80.0)
        per_variant = {row["variant_id"]: row for row in scoring["variants"]}
        self.assertEqual(per_variant[self.v1.id]["earned_points"], 1)
        self.assertEqual(per_variant[self.v1.id]["level"], "ege")
        self.assertEqual(per_variant[self.v2.id]["earned_points"], 3)
        self.assertEqual(per_variant[self.v2.id]["level"], "oge")
        self.assertEqual(
            {(row["variant_id"], row["id"]) for row in submission.result_payload["tasks_snapshot"]},
            {
                (self.v1.id, self.a1.id),
                (self.v1.id, self.a2.id),
                (self.v2.id, self.b1.id),
                (self.v2.id, self.b2.id),
            },
        )

        # Учитель: контекст разбора знает оба варианта, в ответе нет by_number.
        review = self.teacher_api.get(f"/api/cabinet/review/{review_id}/")
        self.assertEqual(review.status_code, 200, review.content)
        body = review.json()
        self.assertEqual(body["homework_review"]["variant_ids"], [self.v1.id, self.v2.id])
        self.assertEqual(
            [row["level"] for row in body["homework_review"]["variants"]], ["ege", "oge"]
        )
        self.assertNotIn("by_number", body["homework_submission"]["result_payload"])
        self.assertEqual(
            len(body["homework_submission"]["result_payload"]["by_task_id"]), 4
        )

        check = self.teacher_api.post(
            f"/api/cabinet/review/{review_id}/check/",
            {"teacher_comment": "Ок", "scores": {}},
            format="json",
        )
        self.assertEqual(check.status_code, 200, check.content)
        submission.refresh_from_db()
        self.assertEqual(submission.status, SubmissionStatus.CHECKED)

        summary = build_submission_result_summary(submission)
        self.assertEqual(summary["total_count"], 4)
        self.assertEqual(summary["earned_points"], 4)
        self.assertEqual(summary["max_points"], 5)
        self.assertEqual(summary["percentage"], 80.0)

        student_card = self.student_api.get(f"/api/cabinet/student/assignments/{self.homework.id}/")
        self.assertEqual(student_card.status_code, 200, student_card.content)
        card = student_card.json()
        self.assertEqual([row["variant_id"] for row in card["variants"]], [self.v1.id, self.v2.id])
        self.assertEqual(card["result"]["scoring"]["total_tasks"], 4)
        self.assertNotIn("by_number", card["result"])
        self.assertNotIn("grading_snapshot", card["result"])

        journal = build_homework_result_payload(
            homework=self.homework, student=self.student, submission=submission, for_student=False
        )
        self.assertEqual(journal["max_points"], 5)
        self.assertEqual(journal["score_percent"], 80.0)
        self.assertEqual(
            {row.get("variant_id") for row in journal["tasks"]}, {self.v1.id, self.v2.id}
        )

    def test_legacy_attempt_without_scoring_shows_second_variant_answers_in_journal(self):
        # Как ДЗ 91: ответы только во втором варианте, scoring нет.
        submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            status=SubmissionStatus.CHECKED,
            submitted_at=timezone.now(),
            result_payload={
                "by_task_id": {str(self.b1.id): "30"},
                "by_number": {"1": "30"},
                "checked": {},
            },
        )
        journal = build_homework_result_payload(
            homework=self.homework, student=self.student, submission=submission, for_student=False
        )
        rows = {(row.get("variant_id"), row["id"]): row for row in journal["tasks"]}
        self.assertEqual(rows[(self.v2.id, self.b1.id)]["student_answer"], "30")
        # Ответ второго варианта не «переезжает» в задание №1 первого варианта.
        self.assertEqual(rows[(self.v1.id, self.a1.id)]["student_answer"], "")
        self.assertEqual(journal["variant_ids"], [self.v1.id, self.v2.id])

    def test_old_single_variant_snapshot_keeps_first_variant_and_adds_second(self):
        # Попытка до r75: снимок только первого варианта, без меток variant_id.
        old_grading = [
            {"id": self.a1.id, "number": 1, "max_score": 1, "exam_part": 1, "answer": "10"},
            {"id": self.a2.id, "number": 2, "max_score": 1, "exam_part": 1, "answer": "20"},
        ]
        payload = {
            "by_task_id": {str(self.a1.id): "10", str(self.b1.id): "30"},
            "by_number": {"1": "30"},
        }
        out = store_variant_scoring(
            payload,
            self.homework,
            previous_snapshot=[dict(row) for row in old_grading],
            previous_grading=old_grading,
        )
        scoring = out["scoring"]
        self.assertEqual(scoring["total_tasks"], 4)
        rows = {(row["variant_id"], row["id"]): row for row in scoring["tasks"]}
        self.assertEqual(rows[(self.v1.id, self.a1.id)]["status"], "correct")
        self.assertEqual(rows[(self.v1.id, self.a2.id)]["status"], "unanswered")
        self.assertEqual(rows[(self.v2.id, self.b1.id)]["status"], "correct")
        self.assertEqual(rows[(self.v2.id, self.b2.id)]["status"], "unanswered")
        # by_number во входных данных не трогаем (хранимые данные не меняем).
        self.assertEqual(out["by_number"], {"1": "30"})

    def test_bank_answer_change_rescores_only_its_variant(self):
        out = store_variant_scoring(
            {"by_task_id": {str(self.a1.id): "10", str(self.b1.id): "31"}},
            self.homework,
        )
        self.assertEqual(out["scoring"]["correct_count"], 1)
        updated = apply_bank_answer_to_attempt(out, self.b1.id, "31")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["scoring"]["correct_count"], 2)
        self.assertEqual(updated["scoring"]["total_tasks"], 4)
        self.assertEqual(len(updated["scoring"]["variants"]), 2)
        self.assertTrue(updated["checked"][str(self.b1.id)])

    def test_recompute_checked_uses_each_variant_by_task_id(self):
        result = {
            "by_task_id": {str(self.a1.id): "10", str(self.b1.id): "30"},
            "checked": {str(self.a1.id): False, str(self.b1.id): False},
        }
        out = recompute_variant_checked(result, [self.v1.id, self.v2.id])
        self.assertTrue(out["checked"][str(self.a1.id)])
        self.assertTrue(out["checked"][str(self.b1.id)])

    def test_single_variant_homework_unchanged(self):
        HomeworkTask.objects.filter(homework=self.homework, order=1).update(is_active=False)
        out = store_variant_scoring({"by_task_id": {str(self.a1.id): "10"}, "by_number": {"2": "20"}}, self.homework)
        self.assertNotIn("variants", out["scoring"])
        self.assertEqual(out["scoring"]["total_tasks"], 2)
        self.assertNotIn("variant_id", out["tasks_snapshot"][0])
        # by_number для одного варианта по-прежнему работает.
        self.assertEqual(out["scoring"]["correct_count"], 2)
        draft = self._post("save-draft/", {"by_task_id": {str(self.a1.id): "10"}, "by_number": {"1": "10"}})
        self.assertIn("by_number", draft["result"])
        assignment = self.student_api.get(f"/api/homework/assignment/{self.homework.id}/").json()
        self.assertEqual(assignment["variant_ids"], [self.v1.id])
        self.assertIn("by_number", assignment["result"])
        self.assertNotIn("answered_count", assignment["variants"][0])
