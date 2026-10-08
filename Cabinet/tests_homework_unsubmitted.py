"""Вкладка «Не сдано»: выданные работы без фактической сдачи."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkSubmissionAttachment,
    Profile,
    ReviewItem,
    Student,
    StudentGroup,
)


def _teacher(username):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save()
    return user


def _student(username, teacher, first_name):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.STUDENT
    user.profile.save()
    return Student.objects.create(
        teacher=teacher,
        user=user,
        first_name=first_name,
        last_name="Ученица",
        status="active",
    )


class UnsubmittedHomeworkTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("miss_teacher")
        self.other = _teacher("miss_other")
        self.ira = _student("miss_ira", self.teacher, "Ира")
        self.olya = _student("miss_olya", self.teacher, "Оля")
        self.masha = _student("miss_masha", self.teacher, "Маша")
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _counts(self):
        return (
            Homework.objects.count(),
            HomeworkSubmission.objects.count(),
            ReviewItem.objects.count(),
        )

    def _list(self):
        before = self._counts()
        response = self.client.get("/api/cabinet/review/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._counts(), before)
        return response.json()

    def _names(self, payload, homework):
        return [
            row["student_name"]
            for row in payload["unsubmitted"]
            if row["homework_id"] == homework.id
        ]

    def test_issued_work_is_visible_without_submission_or_review_card(self):
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.ira,
            title="Дроби",
            status="assigned",
            due_at=timezone.now() + timedelta(days=3),
        )
        payload = self._list()
        row = next(item for item in payload["unsubmitted"] if item["homework_id"] == homework.id)
        self.assertEqual(row["student_id"], self.ira.id)
        self.assertIn("Ира", row["student_name"])
        self.assertEqual(row["title"], "Дроби")
        self.assertEqual(row["status"], "not_submitted")
        self.assertFalse(row["is_overdue"])
        self.assertTrue(row["issued_at"])
        self.assertTrue(row["due_at"])
        self.assertEqual(row["open_path"], f"/cabinet/homework/{homework.id}/edit")
        self.assertEqual(payload["counts"]["pending"], 0)
        self.assertEqual(payload["counts"]["unsubmitted"], 1)
        nav = self.client.get("/api/cabinet/nav-counts/")
        self.assertEqual(nav.json()["reviews_count"], 0)
        self.assertFalse(HomeworkSubmission.objects.filter(homework=homework).exists())
        self.assertFalse(ReviewItem.objects.filter(teacher=self.teacher).exists())

    def test_draft_and_files_stay_unsubmitted_until_hand_in(self):
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.ira,
            title="Черновик",
            status="assigned",
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.ira,
            status="submitted",
            answer_text="черновик ответа",
            result_payload={},
        )
        HomeworkSubmissionAttachment.objects.create(
            submission=submission,
            file=SimpleUploadedFile("scan.png", b"png", content_type="image/png"),
            original_name="scan.png",
        )
        payload = self._list()
        row = next(item for item in payload["unsubmitted"] if item["homework_id"] == homework.id)
        self.assertEqual(row["status"], "draft")
        self.assertEqual(row["status_label"], "Черновик")
        self.assertEqual(payload["counts"]["pending"], 0)
        submission.refresh_from_db()
        self.assertEqual(submission.answer_text, "черновик ответа")
        self.assertIsNone(submission.submitted_at)

    def test_overdue_unsubmitted_is_not_a_review(self):
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.ira,
            title="Просрочено",
            status="assigned",
            due_at=timezone.now() - timedelta(days=1),
        )
        payload = self._list()
        row = next(item for item in payload["unsubmitted"] if item["homework_id"] == homework.id)
        self.assertTrue(row["is_overdue"])
        self.assertEqual(row["status"], "not_submitted")
        self.assertEqual(payload["counts"]["pending"], 0)

    def test_submitted_returned_and_checked_are_not_unsubmitted(self):
        submitted = Homework.objects.create(
            teacher=self.teacher,
            student=self.ira,
            title="Сдано",
            status="assigned",
        )
        HomeworkSubmission.objects.create(
            homework=submitted,
            student=self.ira,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="готовый ответ",
        )
        returned = Homework.objects.create(
            teacher=self.teacher,
            student=self.olya,
            title="На доработке",
            status="assigned",
        )
        returned_submission = HomeworkSubmission.objects.create(
            homework=returned,
            student=self.olya,
            status="returned",
            submitted_at=timezone.now(),
            teacher_comment="Исправь",
            answer_text="первая попытка",
        )
        ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.olya,
            source_type="homework",
            source_id=returned_submission.id,
            title="На доработке",
            status="returned",
            teacher_comment="Исправь",
        )
        checked = Homework.objects.create(
            teacher=self.teacher,
            student=self.masha,
            title="Проверено",
            status="checked",
        )
        HomeworkSubmission.objects.create(
            homework=checked,
            student=self.masha,
            status="checked",
            submitted_at=timezone.now(),
            teacher_comment="Зачтено",
            score=90,
        )
        hidden = Homework.objects.create(
            teacher=self.teacher,
            student=self.ira,
            title="Черновик выдачи",
            status="draft",
        )
        archived = Homework.objects.create(
            teacher=self.teacher,
            student=self.ira,
            title="Отменено",
            status="archived",
        )
        payload = self._list()
        titles = {row["title"] for row in payload["unsubmitted"]}
        self.assertNotIn("Сдано", titles)
        self.assertNotIn("На доработке", titles)
        self.assertNotIn("Проверено", titles)
        self.assertNotIn("Черновик выдачи", titles)
        self.assertNotIn("Отменено", titles)
        self.assertEqual(payload["counts"]["pending"], 1)
        self.assertEqual(payload["counts"]["returned"], 1)
        self.assertEqual(payload["counts"]["unsubmitted"], 0)
        returned_submission.refresh_from_db()
        self.assertEqual(returned_submission.teacher_comment, "Исправь")
        self.assertEqual(returned_submission.answer_text, "первая попытка")
        self.assertFalse(HomeworkSubmission.objects.filter(homework=hidden).exists())
        self.assertFalse(HomeworkSubmission.objects.filter(homework=archived).exists())

    def test_group_homework_lists_each_student_who_has_not_submitted(self):
        group = StudentGroup.objects.create(teacher=self.teacher, title="Группа А", status="active")
        group.students.add(self.ira, self.olya, self.masha)
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=None,
            group=group,
            title="Общая работа",
            status="assigned",
            due_at=timezone.now() + timedelta(days=2),
        )
        HomeworkSubmission.objects.create(
            homework=homework,
            student=self.ira,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="сдала",
        )
        before = Homework.objects.filter(group=group).count()
        payload = self._list()
        self.assertEqual(sorted(self._names(payload, homework)), ["Маша Ученица", "Оля Ученица"])
        self.assertEqual(Homework.objects.filter(group=group).count(), before)
        self.assertEqual(HomeworkSubmission.objects.filter(homework=homework).count(), 1)
        self.assertEqual(payload["counts"]["pending"], 1)
        self.assertEqual(payload["counts"]["unsubmitted"], 2)
        filtered = self.client.get(f"/api/cabinet/review/?student={self.olya.id}")
        self.assertEqual(
            [row["student_id"] for row in filtered.json()["unsubmitted"]],
            [self.olya.id],
        )

    def test_archived_student_and_other_teacher_are_hidden(self):
        archived = _student("miss_archived", self.teacher, "Ася")
        archived.status = "archived"
        archived.save(update_fields=["status"])
        Homework.objects.create(
            teacher=self.teacher,
            student=archived,
            title="Архив",
            status="assigned",
        )
        group = StudentGroup.objects.create(teacher=self.teacher, title="Группа Б", status="active")
        group.students.add(archived, self.ira)
        Homework.objects.create(
            teacher=self.teacher,
            group=group,
            title="Группа с архивом",
            status="assigned",
        )
        foreign = Homework.objects.create(
            teacher=self.other,
            student=Student.objects.create(
                teacher=self.other,
                first_name="Чужая",
                last_name="Ученица",
                status="active",
            ),
            title="Чужое",
            status="assigned",
        )
        payload = self._list()
        titles = {row["title"] for row in payload["unsubmitted"]}
        self.assertNotIn("Архив", titles)
        self.assertNotIn("Чужое", titles)
        group_names = [
            row["student_name"]
            for row in payload["unsubmitted"]
            if row["title"] == "Группа с архивом"
        ]
        self.assertEqual(group_names, ["Ира Ученица"])
        other_client = APIClient()
        other_client.force_login(self.other)
        foreign_payload = other_client.get("/api/cabinet/review/").json()
        self.assertEqual(
            [row["homework_id"] for row in foreign_payload["unsubmitted"]],
            [foreign.id],
        )
        self.assertNotIn(self.teacher.id, {row.get("teacher_id") for row in foreign_payload["unsubmitted"]})
