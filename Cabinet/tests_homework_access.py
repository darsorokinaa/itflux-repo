"""Права на ответы домашнего задания: пишет только ученик."""

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.homework_api import issue_homework_token
from Cabinet.models import Homework, HomeworkSubmission, HomeworkSubmissionAttempt, Profile, ReviewItem, Student
from Cabinet.parent_invitations import accept_parent_invitation, create_parent_invitation


@override_settings(LESSON_SECRET="test-lesson-secret")
class HomeworkAnswerAccessTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="access_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other_teacher = User.objects.create_user(username="access_other_teacher", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()

        self.staff = User.objects.create_user(username="access_staff", password="pass")
        self.staff.is_staff = True
        self.staff.save(update_fields=["is_staff"])
        self.staff.profile.role = Profile.Role.TEACHER
        self.staff.profile.save()

        self.student_user = User.objects.create_user(username="access_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Ника",
            last_name="Ученица",
            status="active",
        )

        self.other_student_user = User.objects.create_user(username="access_other_student", password="pass")
        self.other_student_user.profile.role = Profile.Role.STUDENT
        self.other_student_user.profile.save()
        self.other_student = Student.objects.create(
            teacher=self.teacher,
            user=self.other_student_user,
            first_name="Лев",
            last_name="Другой",
            status="active",
        )

        self.parent = User.objects.create_user(username="access_parent", password="pass")
        self.parent.profile.role = Profile.Role.PARENT
        self.parent.profile.save()
        invitation, _token = create_parent_invitation(self.teacher, self.student, invited_name="Мама")
        accept_parent_invitation(self.parent, invitation)

        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: доступ",
            description="Решите №1",
            status="assigned",
        )
        self.other_homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.other_student,
            title="Чужое ДЗ",
            description="Не трогать",
            status="assigned",
        )
        self.submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            status="submitted",
            answer_text="Ответ ученика",
            result_payload={"by_task_id": {"1": "42"}},
            teacher_comment="Пока без проверки",
        )
        self.teacher_client = APIClient()
        self.teacher_client.force_login(self.teacher)
        self.student_client = APIClient()
        self.student_client.force_login(self.student_user)

    def _draft(self, client, homework=None, result=None):
        homework = homework or self.homework
        return client.post(
            f"/api/homework/assignment/{homework.pk}/save-draft/",
            {"result": result or {"by_task_id": {"1": "чужой"}}},
            format="json",
        )

    def _submit(self, client, homework=None, result=None):
        homework = homework or self.homework
        return client.post(
            f"/api/homework/assignment/{homework.pk}/submit/",
            {"result": result or {"by_task_id": {"1": "чужой"}}},
            format="json",
        )

    def _assert_student_answer_unchanged(self):
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.answer_text, "Ответ ученика")
        self.assertEqual(self.submission.result_payload["by_task_id"]["1"], "42")
        self.assertEqual(self.submission.teacher_comment, "Пока без проверки")
        self.assertIsNone(self.submission.submitted_at)
        self.assertEqual(HomeworkSubmissionAttempt.objects.filter(submission=self.submission).count(), 0)
        self.assertFalse(
            ReviewItem.objects.filter(source_type="homework", source_id=self.submission.pk, status="checked").exists()
        )

    def test_teacher_cannot_save_or_submit_as_student(self):
        draft = self._draft(self.teacher_client)
        self.assertEqual(draft.status_code, 403, draft.content)
        self.assertEqual(draft.json()["code"], "student_only")
        submit = self._submit(self.teacher_client)
        self.assertEqual(submit.status_code, 403, submit.content)
        self.assertEqual(submit.json()["code"], "student_only")
        cabinet = self.teacher_client.post(
            f"/api/cabinet/student/assignments/{self.homework.pk}/",
            {"answer_text": "От учителя"},
            format="multipart",
        )
        self.assertEqual(cabinet.status_code, 403, cabinet.content)
        self._assert_student_answer_unchanged()

        viewed = self.teacher_client.get(f"/api/homework/assignment/{self.homework.pk}/")
        self.assertEqual(viewed.status_code, 200, viewed.content)
        self.assertEqual(viewed.json()["answer_text"], "Ответ ученика")

    def test_teacher_token_and_webhook_cannot_submit_for_student(self):
        token = issue_homework_token(homework_id=self.homework.pk, student_user_id=self.student_user.pk)
        self.teacher_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        stolen = self._submit(self.teacher_client, result={"by_task_id": {"1": "подмена"}})
        self.assertEqual(stolen.status_code, 403, stolen.content)
        self.assertEqual(stolen.json()["code"], "student_only")

        webhook = APIClient()
        webhook.credentials(HTTP_X_LESSON_WEBHOOK_SECRET="test-lesson-secret")
        secret_only = self._submit(webhook, result={"by_task_id": {"1": "секрет"}})
        self.assertEqual(secret_only.status_code, 403, secret_only.content)
        self._assert_student_answer_unchanged()

        preview = webhook.get(f"/api/homework/assignment/{self.homework.pk}/")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["result"]["by_task_id"]["1"], "42")

    def test_teacher_cannot_upload_or_delete_student_answer_file(self):
        upload = SimpleUploadedFile("solution.png", b"png-bytes", content_type="image/png")
        saved = self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {"file": upload, "task_id": "1", "task_number": "1"},
            format="multipart",
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        attachment_id = saved.json()["id"]

        teacher_upload = self.teacher_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "file": SimpleUploadedFile("teacher.png", b"png-bytes", content_type="image/png"),
                "task_id": "1",
                "task_number": "1",
            },
            format="multipart",
        )
        self.assertEqual(teacher_upload.status_code, 403, teacher_upload.content)
        removed = self.teacher_client.delete(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/?id={attachment_id}"
        )
        self.assertEqual(removed.status_code, 403, removed.content)

        from Cabinet.models import HomeworkAttachment

        row = HomeworkAttachment.objects.get(pk=attachment_id)
        self.assertFalse(row.is_deleted)
        self._assert_student_answer_unchanged()

    def test_other_teacher_and_other_student_cannot_replace_answers(self):
        other = APIClient()
        other.force_login(self.other_teacher)
        self.assertEqual(self._draft(other).status_code, 403)
        self.assertEqual(self._submit(other).status_code, 403)
        review_denied = other.post(
            "/api/cabinet/review/1/check/",
            {"teacher_comment": "Чужая"},
            format="json",
        )
        self.assertIn(review_denied.status_code, (403, 404))
        edit = other.patch(
            f"/api/cabinet/homework/{self.homework.pk}/",
            {"title": "Подмена"},
            format="json",
        )
        self.assertIn(edit.status_code, (403, 404))

        stranger = APIClient()
        stranger.force_login(self.other_student_user)
        swapped = self._draft(stranger)
        self.assertEqual(swapped.status_code, 403, swapped.content)
        swapped_submit = self._submit(stranger, result={"by_task_id": {"1": "99"}})
        self.assertEqual(swapped_submit.status_code, 403, swapped_submit.content)
        cabinet = stranger.post(
            f"/api/cabinet/student/assignments/{self.homework.pk}/",
            {"answer_text": "Чужой ответ"},
            format="multipart",
        )
        self.assertEqual(cabinet.status_code, 404, cabinet.content)

        self.homework.refresh_from_db()
        self.assertEqual(self.homework.title, "ДЗ: доступ")
        self._assert_student_answer_unchanged()
        self.assertFalse(HomeworkSubmission.objects.filter(homework=self.other_homework).exists())

    def test_student_cannot_check_or_edit_teacher_homework(self):
        checked = self.student_client.post(
            "/api/cabinet/review/1/check/",
            {"teacher_comment": "Сам себе", "scores": {"1": 100}},
            format="json",
        )
        self.assertEqual(checked.status_code, 403, checked.content)
        edit = self.student_client.patch(
            f"/api/cabinet/homework/{self.homework.pk}/",
            {"title": "Новое условие", "description": "Свои правила"},
            format="json",
        )
        self.assertEqual(edit.status_code, 403, edit.content)
        self.homework.refresh_from_db()
        self.assertEqual(self.homework.title, "ДЗ: доступ")
        self.assertEqual(self.homework.description, "Решите №1")
        self._assert_student_answer_unchanged()

    def test_parent_can_view_homework_but_cannot_submit(self):
        parent = APIClient()
        parent.force_login(self.parent)
        denied = self._submit(parent, result={"by_task_id": {"1": "родитель"}})
        self.assertEqual(denied.status_code, 403, denied.content)
        draft = self._draft(parent)
        self.assertEqual(draft.status_code, 403, draft.content)
        viewed = parent.get(f"/api/cabinet/parent/homework/?student_id={self.student.pk}")
        self.assertEqual(viewed.status_code, 200, viewed.content)
        titles = [item["title"] for item in viewed.json()["items"]]
        self.assertIn("ДЗ: доступ", titles)
        self._assert_student_answer_unchanged()

    def test_staff_can_open_assignment_but_cannot_answer_for_student(self):
        staff = APIClient()
        staff.force_login(self.staff)
        denied = self._submit(staff)
        self.assertEqual(denied.status_code, 403, denied.content)
        opened = staff.get(f"/api/cabinet/homework/{self.homework.pk}/")
        self.assertEqual(opened.status_code, 200, opened.content)
        self.assertEqual(opened.json()["title"], "ДЗ: доступ")
        self._assert_student_answer_unchanged()

    def test_student_draft_submit_return_and_resubmit(self):
        draft = self._draft(self.student_client, result={"by_task_id": {"1": "42"}, "status": "checked"})
        self.assertEqual(draft.status_code, 200, draft.content)
        self.submission.refresh_from_db()
        self.assertIsNone(self.submission.submitted_at)
        self.assertNotEqual(self.submission.status, "checked")
        self.assertEqual(self.submission.teacher_comment, "Пока без проверки")

        token_client = APIClient()
        token = issue_homework_token(homework_id=self.homework.pk, student_user_id=self.student_user.pk)
        token_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        submitted = self._submit(token_client, result={"by_task_id": {"1": "42"}})
        self.assertEqual(submitted.status_code, 200, submitted.content)
        self.submission.refresh_from_db()
        self.assertIsNotNone(self.submission.submitted_at)
        review = ReviewItem.objects.get(source_type="homework", source_id=self.submission.pk)
        self.assertEqual(review.status, "pending")

        returned = self.teacher_client.post(
            f"/api/cabinet/review/{review.pk}/return/",
            {"teacher_comment": "Доработайте"},
            format="json",
        )
        self.assertEqual(returned.status_code, 200, returned.content)
        attempts_after_return = HomeworkSubmissionAttempt.objects.filter(submission=self.submission).count()

        again = self.student_client.post(
            f"/api/cabinet/student/assignments/{self.homework.pk}/",
            {"answer_text": "Исправленный ответ"},
            format="multipart",
        )
        self.assertEqual(again.status_code, 200, again.content)
        self.submission.refresh_from_db()
        review.refresh_from_db()
        self.assertEqual(self.submission.answer_text, "Исправленный ответ")
        self.assertEqual(self.submission.status, "submitted")
        self.assertEqual(review.status, "pending")
        self.assertGreaterEqual(
            HomeworkSubmissionAttempt.objects.filter(submission=self.submission).count(),
            attempts_after_return,
        )

        overwrite = self._submit(self.teacher_client, result={"by_task_id": {"1": "оценка учителя"}})
        self.assertEqual(overwrite.status_code, 403, overwrite.content)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.answer_text, "Исправленный ответ")
        self.assertEqual(self.submission.result_payload["by_task_id"]["1"], "42")
        self.assertEqual(review.status, "pending")
