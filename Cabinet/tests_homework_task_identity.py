"""Самостоятельные задания с одинаковым текстом остаются разными для ученика."""

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkTask,
    LessonPlan,
    LessonPlanItem,
    Profile,
    Student,
    StudentGroup,
)
from Cabinet.student_release import assign_homework_manually, copy_homework_to_students


def _user(username, role):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = role
    user.profile.save()
    return user


def _student(username, teacher, first_name):
    user = _user(username, Profile.Role.STUDENT)
    student = Student.objects.create(
        teacher=teacher,
        user=user,
        first_name=first_name,
        last_name="Ученица",
        status="active",
    )
    return user, student


class HomeworkTaskIdentityTests(TestCase):
    def setUp(self):
        self.teacher = _user("task_id_teacher", Profile.Role.TEACHER)
        self.student_user, self.student = _student("task_id_student", self.teacher, "Ира")
        self.other_user, self.other = _student("task_id_other", self.teacher, "Оля")
        self.teacher_client = APIClient()
        self.teacher_client.force_login(self.teacher)
        self.student_client = APIClient()
        self.student_client.force_login(self.student_user)
        self.other_client = APIClient()
        self.other_client.force_login(self.other_user)

    def _pair(self, homework):
        first = HomeworkTask.objects.create(
            homework=homework,
            task_type="text",
            title="Тренажёр",
            description="Одинаковое условие",
            order=0,
        )
        second = HomeworkTask.objects.create(
            homework=homework,
            task_type="text",
            title="Тренажёр",
            description="Одинаковое условие",
            order=1,
        )
        return first, second

    def _homework(self, student, title="ДЗ: Тренажёр"):
        return Homework.objects.create(
            teacher=self.teacher,
            student=student,
            title=title,
            description="Инструкция к работе",
            status="assigned",
        )

    def _task_ids(self, client, homework):
        response = client.get(f"/api/cabinet/student/assignments/{homework.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()["tasks"]], response.json()

    def test_same_title_and_text_stay_separate_tasks(self):
        homework = self._homework(self.student)
        first, second = self._pair(homework)
        before = HomeworkTask.objects.filter(homework=homework).count()

        ids, payload = self._task_ids(self.student_client, homework)
        self.assertEqual(ids, [first.id, second.id])
        self.assertEqual(payload["tasks"][0]["description"], "Одинаковое условие")
        self.assertEqual(payload["tasks"][1]["description"], "Одинаковое условие")
        self.assertEqual(HomeworkTask.objects.filter(homework=homework).count(), before)
        self.assertTrue(HomeworkTask.objects.filter(pk=first.pk, is_active=True).exists())
        self.assertTrue(HomeworkTask.objects.filter(pk=second.pk, is_active=True).exists())

    def test_answer_file_and_grade_stay_on_their_own_task(self):
        left = self._homework(self.student)
        right = self._homework(self.student)
        left_a, left_b = self._pair(left)
        right_a, right_b = self._pair(right)

        draft = self.student_client.post(
            f"/api/homework/assignment/{left.pk}/save-draft/",
            {"result": {"by_task_id": {str(left_a.pk): "черновик А"}}},
            format="json",
        )
        self.assertEqual(draft.status_code, 200, draft.content)

        upload = SimpleUploadedFile("a.png", b"png-a", content_type="image/png")
        uploaded = self.student_client.post(
            f"/api/homework/assignment/{left.pk}/upload-answer/",
            {"file": upload, "task_id": str(left_a.pk)},
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.content)

        submitted = self.student_client.post(
            f"/api/cabinet/student/assignments/{left.pk}/",
            {"answer_text": "Ответ на первую работу"},
            format="multipart",
        )
        self.assertEqual(submitted.status_code, 200, submitted.content)

        left_sub = HomeworkSubmission.objects.get(homework=left, student=self.student)
        self.assertEqual(left_sub.answer_text, "Ответ на первую работу")
        self.assertEqual(left_sub.result_payload["by_task_id"][str(left_a.pk)], "черновик А")
        self.assertNotIn(str(left_b.pk), left_sub.result_payload.get("by_task_id") or {})
        self.assertIn(str(left_a.pk), left_sub.result_payload["attachments_by_task_id"])
        self.assertNotIn(str(left_b.pk), left_sub.result_payload.get("attachments_by_task_id") or {})
        self.assertFalse(HomeworkSubmission.objects.filter(homework=right, student=self.student).exists())

        from Cabinet.models import ReviewItem

        review = ReviewItem.objects.get(
            teacher=self.teacher,
            source_type="homework",
            source_id=left_sub.pk,
        )
        review_id = review.pk
        returned = self.teacher_client.post(
            f"/api/cabinet/review/{review_id}/return/",
            {"teacher_comment": "Поправь первую"},
            format="json",
        )
        self.assertEqual(returned.status_code, 200, returned.content)
        left_sub.refresh_from_db()
        self.assertEqual(left_sub.status, "returned")
        self.assertEqual(left_sub.teacher_comment, "Поправь первую")

        again = self.student_client.post(
            f"/api/cabinet/student/assignments/{left.pk}/",
            {"answer_text": "Исправленный ответ"},
            format="multipart",
        )
        self.assertEqual(again.status_code, 200, again.content)
        checked = self.teacher_client.post(
            f"/api/cabinet/review/{review_id}/check/",
            {
                "teacher_comment": "Зачтено",
                "score": 80,
                "manual_stats": {"total": 1, "correct": 1, "incorrect": 0, "unsolved": 0},
            },
            format="json",
        )
        self.assertEqual(checked.status_code, 200, checked.content)

        left_sub.refresh_from_db()
        right_a.refresh_from_db()
        right_b.refresh_from_db()
        detail = self.student_client.get(f"/api/cabinet/student/assignments/{left.pk}/")
        other = self.student_client.get(f"/api/cabinet/student/assignments/{right.pk}/")
        self.assertEqual(detail.json()["teacher_comment"], "Зачтено")
        self.assertEqual(detail.json()["answer_text"], "Исправленный ответ")
        self.assertEqual(other.json()["teacher_comment"], "")
        self.assertEqual(other.json()["answer_text"], "")
        self.assertEqual([row["id"] for row in other.json()["tasks"]], [right_a.id, right_b.id])
        self.assertEqual(right_a.title, "Тренажёр")
        self.assertEqual(right_b.description, "Одинаковое условие")
        self.assertFalse(HomeworkSubmission.objects.filter(homework=right).exists())

    def test_group_homework_shows_each_task_and_keeps_answers_apart(self):
        group = StudentGroup.objects.create(teacher=self.teacher, title="Группа", status="active")
        group.students.add(self.student, self.other)
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=None,
            group=group,
            title="ДЗ: Группа",
            description="Общая инструкция",
            status="assigned",
        )
        first, second = self._pair(homework)
        before = Homework.objects.filter(teacher=self.teacher, group=group).count()

        left_ids, _left = self._task_ids(self.student_client, homework)
        right_ids, _right = self._task_ids(self.other_client, homework)
        self.assertEqual(left_ids, [first.id, second.id])
        self.assertEqual(right_ids, [first.id, second.id])

        submitted = self.student_client.post(
            f"/api/cabinet/student/assignments/{homework.pk}/",
            {"answer_text": "Ответ Иры"},
            format="multipart",
        )
        self.assertEqual(submitted.status_code, 200, submitted.content)
        self.assertEqual(
            HomeworkSubmission.objects.get(homework=homework, student=self.student).answer_text,
            "Ответ Иры",
        )
        self.assertFalse(
            HomeworkSubmission.objects.filter(homework=homework, student=self.other).exists()
        )
        self.assertEqual(Homework.objects.filter(teacher=self.teacher, group=group).count(), before)
        self.assertEqual(HomeworkTask.objects.filter(homework=homework, is_active=True).count(), 2)

    def test_repeat_assignment_does_not_hide_or_duplicate_tasks(self):
        plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="План",
            direction="oge",
            status="active",
        )
        item = LessonPlanItem.objects.create(
            plan=plan,
            order=1,
            title="Тема",
            topic="Тема",
            homework_description="Инструкция к работе",
        )
        homework = assign_homework_manually(
            teacher=self.teacher,
            student=self.student,
            plan_item=item,
        )
        first, second = self._pair(homework)
        again = assign_homework_manually(
            teacher=self.teacher,
            student=self.student,
            plan_item=item,
        )
        self.assertEqual(again.pk, homework.pk)
        self.assertEqual(
            Homework.objects.filter(student=self.student, lesson_plan_item=item).count(),
            1,
        )
        ids, _payload = self._task_ids(self.student_client, homework)
        self.assertEqual(ids, [first.id, second.id])
        self.assertEqual(HomeworkTask.objects.filter(homework=homework, is_active=True).count(), 2)

        copied = copy_homework_to_students(
            teacher=self.teacher,
            source_homework=homework,
            students=[self.other.pk],
        )
        clone = copied["homeworks"][0]
        self.assertNotEqual(clone.pk, homework.pk)
        source_ids = list(
            homework.tasks.filter(is_active=True).order_by("order", "id").values_list("id", flat=True)
        )
        self.assertEqual(source_ids, [first.id, second.id])
        clone_ids, _clone_payload = self._task_ids(self.other_client, clone)
        self.assertEqual(len(clone_ids), 2)
        self.assertNotEqual(set(clone_ids), {first.id, second.id})
        self.assertEqual(
            list(HomeworkTask.objects.filter(pk__in=clone_ids).values_list("title", "description")),
            [("Тренажёр", "Одинаковое условие"), ("Тренажёр", "Одинаковое условие")],
        )
