"""Тесты множественных вложений домашнего задания."""

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate

from Cabinet.choices import HomeworkStatus, SubmissionStatus
from Cabinet.files_models import CabinetFileRelation, CabinetFileRelationType
from Cabinet.homework_attachments import (
    HomeworkAttachmentsView,
    HomeworkAttachmentDetailView,
    add_homework_attachments,
    delete_homework_attachment,
    list_homework_attachments,
)
from Cabinet.models import Homework, HomeworkSubmission, HomeworkTask, Profile, Student


class HomeworkAttachmentsApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username="hw_att_teacher", email="hwatt@test.ru", password="StrongPass123!"
        )
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.student_user = User.objects.create_user(
            username="hw_att_student", email="hwatts@test.ru", password="StrongPass123!"
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.other_student_user = User.objects.create_user(
            username="hw_att_other", email="hwatto@test.ru", password="StrongPass123!"
        )
        self.other_student_user.profile.role = Profile.Role.STUDENT
        self.other_student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Ученица",
        )
        Student.objects.create(
            teacher=self.teacher,
            user=self.other_student_user,
            first_name="Другой",
            last_name="Ученик",
        )

        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ с файлами",
            description="Решите задания",
            status=HomeworkStatus.ASSIGNED,
        )
        self.factory = APIRequestFactory()

    def _png(self, name="photo.png"):
        return SimpleUploadedFile(
            name,
            (
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
                b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00"
                b"\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
                b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
            ),
            content_type="image/png",
        )

    def _pdf(self, name="worksheet.pdf"):
        return SimpleUploadedFile(
            name,
            b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
            content_type="application/pdf",
        )

    @override_settings(HOMEWORK_ATTACHMENT_MAX_COUNT=10)
    def test_upload_multiple_attachments(self):
        result = add_homework_attachments(
            self.homework,
            self.teacher,
            [self._png("photo1.png"), self._png("photo2.png"), self._pdf("doc1.pdf")],
        )
        self.assertEqual(len(result["attachments"]), 3)
        self.assertEqual(len(result["all_attachments"]), 3)
        for item in result["attachments"]:
            self.assertIn("id", item)
            self.assertIn("name", item)
            self.assertIn("url", item)
            self.assertFalse(str(item["url"]).startswith("/Users/"))
            self.assertIn("/api/cabinet/files/", item["url"])

        rel_count = CabinetFileRelation.objects.filter(
            homework=self.homework,
            relation_type=CabinetFileRelationType.HOMEWORK,
        ).count()
        self.assertEqual(rel_count, 3)
        self.assertEqual(
            HomeworkTask.objects.filter(
                homework=self.homework, task_type="file", is_active=True
            ).count(),
            0,
        )

    def test_delete_one_attachment_keeps_others(self):
        created = add_homework_attachments(
            self.homework,
            self.teacher,
            [self._png("a.png"), self._pdf("b.pdf")],
        )
        first_id = created["attachments"][0]["id"]
        deleted = delete_homework_attachment(self.homework, self.teacher, first_id)
        self.assertEqual(len(deleted["attachments"]), 1)
        self.assertNotEqual(deleted["attachments"][0]["id"], first_id)

    def test_student_can_list_but_not_delete_via_view(self):
        created = add_homework_attachments(
            self.homework,
            self.teacher,
            [self._png("for-student.png")],
        )
        attachment_id = created["attachments"][0]["id"]

        req = self.factory.get(f"/api/cabinet/homework/{self.homework.id}/attachments/")
        force_authenticate(req, user=self.student_user)
        resp = HomeworkAttachmentsView.as_view()(req, homework_id=self.homework.id)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["attachments"]), 1)
        self.assertIn("/student/files/shared/", resp.data["attachments"][0]["url"])

        del_req = self.factory.delete(
            f"/api/cabinet/homework/{self.homework.id}/attachments/{attachment_id}/"
        )
        force_authenticate(del_req, user=self.student_user)
        del_resp = HomeworkAttachmentDetailView.as_view()(
            del_req, homework_id=self.homework.id, attachment_id=attachment_id
        )
        self.assertEqual(del_resp.status_code, 403)

    def test_other_student_cannot_list(self):
        add_homework_attachments(self.homework, self.teacher, [self._png("secret.png")])
        req = self.factory.get(f"/api/cabinet/homework/{self.homework.id}/attachments/")
        force_authenticate(req, user=self.other_student_user)
        resp = HomeworkAttachmentsView.as_view()(req, homework_id=self.homework.id)
        self.assertEqual(resp.status_code, 403)

    def test_edit_homework_preserves_attachments_and_answers(self):
        created = add_homework_attachments(
            self.homework,
            self.teacher,
            [self._png("keep.png"), self._pdf("keep.pdf")],
        )
        before_ids = {a["id"] for a in created["all_attachments"]}

        submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            answer_text="Мой ответ",
            status=SubmissionStatus.SUBMITTED,
            score=90,
            teacher_comment="Отлично",
        )

        from Cabinet.homework_edit import update_issued_homework

        update_issued_homework(
            homework=self.homework,
            teacher=self.teacher,
            data={
                "title": "ДЗ обновлено",
                "description": "Новый текст",
                "updated_at": self.homework.updated_at.isoformat(),
                "confirm_student_started": True,
            },
        )

        after_ids = {a["id"] for a in list_homework_attachments(self.homework)}
        self.assertEqual(before_ids, after_ids)

        submission.refresh_from_db()
        self.assertEqual(submission.answer_text, "Мой ответ")
        self.assertEqual(submission.teacher_comment, "Отлично")
        self.assertEqual(float(submission.score), 90.0)

    def test_instruction_text_task_is_not_serialized_as_attachment(self):
        from Cabinet.homework_api import homework_instruction_text, serialize_homework_tasks

        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="text",
            title="Домашнее задание",
            description=self.homework.description,
            order=0,
        )
        self.assertEqual(homework_instruction_text(self.homework), "Решите задания")
        tasks = serialize_homework_tasks(self.homework, homework_id=self.homework.id)
        self.assertEqual(tasks, [])

    def test_file_task_matching_attachment_is_not_serialized_twice(self):
        from Cabinet.homework_api import serialize_homework_tasks

        add_homework_attachments(self.homework, self.teacher, [self._pdf("A4 - 8 (4).pdf")])
        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="file",
            title="A4 - 8 (4).pdf",
            description="/api/cabinet/files/unused/download/",
            order=0,
        )
        tasks = serialize_homework_tasks(self.homework, homework_id=self.homework.id)
        self.assertEqual(tasks, [])
        attachments = list_homework_attachments(self.homework)
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0]["name"], "A4 - 8 (4).pdf")
