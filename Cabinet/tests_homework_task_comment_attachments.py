from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from urllib.parse import quote

from Cabinet.homework_api import (
    _pop_attachment_from_payload,
    _remove_from_attachment_maps,
    new_attachment_entry,
    public_attachment,
)
from Cabinet.models import Homework, HomeworkSubmission, HomeworkTask, Profile, ReviewItem, Student

User = get_user_model()

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
PDF = b"%PDF-1.4 test"


class HomeworkTaskCommentAttachmentTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="att_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="att_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.other_user = User.objects.create_user(username="att_other", password="pass")
        self.other_user.profile.role = Profile.Role.STUDENT
        self.other_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Петя",
            last_name="Ученик",
            status="active",
        )
        self.other_student = Student.objects.create(
            teacher=self.teacher,
            user=self.other_user,
            first_name="Оля",
            last_name="Другая",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ вложения",
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="generated_task",
            title="Вариант",
            description="http://127.0.0.1:8000/oge/inf/variant/1",
            order=0,
        )
        self.student_client = APIClient()
        self.student_client.force_login(self.student_user)
        self.teacher_client = APIClient()
        self.teacher_client.force_login(self.teacher)

    def _upload_student(self, files, *, task_id="42", task_number="16"):
        payload = {"task_number": task_number, "task_id": task_id}
        if len(files) == 1:
            payload["file"] = files[0]
        else:
            payload["file"] = files
        return self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            payload,
            format="multipart",
        )

    def _delete_student(self, attachment, *, task_id="42", task_number="16"):
        qs = []
        if attachment.get("id"):
            qs.append(f"id={quote(str(attachment['id']))}")
        if attachment.get("url"):
            qs.append(f"url={quote(attachment['url'], safe='')}")
        qs.append(f"task_id={task_id}")
        qs.append(f"task_number={task_number}")
        return self.student_client.delete(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/?{'&'.join(qs)}"
        )

    def _ids(self, task_id="42"):
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        items = (submission.result_payload.get("attachments_by_task_id") or {}).get(task_id) or []
        return [item["id"] for item in items]

    def _entries(self, task_id="42"):
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        return list((submission.result_payload.get("attachments_by_task_id") or {}).get(task_id) or [])

    def test_upload_returns_stable_backend_id(self):
        resp = self._upload_student([SimpleUploadedFile("photo.jpg", PNG, content_type="image/jpeg")])
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertTrue(data["id"])
        self.assertEqual(data["attachments"][0]["id"], data["id"])
        self.assertEqual(data["content_type"], "image/jpeg")
        stored = self._entries()[0]
        self.assertEqual(stored["id"], data["id"])
        self.assertEqual(stored["content_type"], "image/jpeg")

    def test_upload_three_attachments_keeps_distinct_ids(self):
        resp = self._upload_student([
            SimpleUploadedFile("a.jpg", PNG, content_type="image/jpeg"),
            SimpleUploadedFile("b.png", PNG, content_type="image/png"),
            SimpleUploadedFile("c.pdf", PDF, content_type="application/pdf"),
        ])
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [item["id"] for item in resp.json()["attachments"]]
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(self._ids(), ids)

    def test_delete_first_middle_last_by_id(self):
        created = self._upload_student([
            SimpleUploadedFile("a.jpg", PNG, content_type="image/jpeg"),
            SimpleUploadedFile("b.png", PNG, content_type="image/png"),
            SimpleUploadedFile("c.pdf", PDF, content_type="application/pdf"),
            SimpleUploadedFile("d.docx", b"PK\x03\x04", content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ]).json()["attachments"]
        a, b, c, d = created

        self.assertEqual(self._delete_student(a).status_code, 200)
        self.assertEqual(self._ids(), [b["id"], c["id"], d["id"]])

        self.assertEqual(self._delete_student(c).status_code, 200)
        self.assertEqual(self._ids(), [b["id"], d["id"]])

        self.assertEqual(self._delete_student(d).status_code, 200)
        self.assertEqual(self._ids(), [b["id"]])

    def test_delete_only_attachment_then_upload_again(self):
        only = self._upload_student([SimpleUploadedFile("only.png", PNG, content_type="image/png")]).json()
        self.assertEqual(self._delete_student(only).status_code, 200)
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        self.assertNotIn("42", submission.result_payload.get("attachments_by_task_id") or {})

        again = self._upload_student([SimpleUploadedFile("next.pdf", PDF, content_type="application/pdf")])
        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(len(self._ids()), 1)
        self.assertNotEqual(self._ids()[0], only["id"])

    def test_sequential_uploads_do_not_lose_previous(self):
        first = self._upload_student([SimpleUploadedFile("one.jpg", PNG, content_type="image/jpeg")])
        second = self._upload_student([SimpleUploadedFile("two.pdf", PDF, content_type="application/pdf")])
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        ids = self._ids()
        self.assertEqual(ids, [first.json()["id"], second.json()["id"]])

    def test_delete_while_other_task_keeps_its_files(self):
        task_a = self._upload_student(
            [
                SimpleUploadedFile("a1.jpg", PNG, content_type="image/jpeg"),
                SimpleUploadedFile("a2.pdf", PDF, content_type="application/pdf"),
            ],
            task_id="10",
            task_number="10",
        ).json()["attachments"]
        task_b = self._upload_student(
            [SimpleUploadedFile("b1.png", PNG, content_type="image/png")],
            task_id="20",
            task_number="20",
        ).json()["attachments"]
        self.assertEqual(self._delete_student(task_a[0], task_id="10", task_number="10").status_code, 200)
        self.assertEqual(self._ids("10"), [task_a[1]["id"]])
        self.assertEqual(self._ids("20"), [task_b[0]["id"]])

    def test_reload_preserves_list(self):
        created = self._upload_student([
            SimpleUploadedFile("a.jpg", PNG, content_type="image/jpeg"),
            SimpleUploadedFile("b.pdf", PDF, content_type="application/pdf"),
        ]).json()["attachments"]
        self._delete_student(created[0])
        detail = self.student_client.get(f"/api/homework/assignment/{self.homework.pk}/")
        self.assertEqual(detail.status_code, 200)
        remaining = (detail.json().get("result") or {}).get("attachments_by_task_id", {}).get("42") or []
        self.assertEqual([item["id"] for item in remaining], [created[1]["id"]])

    def test_unauthorized_delete_rejected(self):
        created = self._upload_student([SimpleUploadedFile("secret.jpg", PNG, content_type="image/jpeg")]).json()
        other = APIClient()
        other.force_login(self.other_user)
        resp = other.delete(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/?id={created['id']}"
        )
        self.assertIn(resp.status_code, (403, 404))
        self.assertEqual(self._ids(), [created["id"]])

    def test_legacy_url_delete_still_works(self):
        created = self._upload_student([SimpleUploadedFile("legacy.png", PNG, content_type="image/png")]).json()
        resp = self.student_client.delete(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/"
            f"?url={quote(created['url'], safe='')}&task_id=42&task_number=16"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._ids(), [])

    def test_payload_helpers_delete_by_id_not_by_index(self):
        a = new_attachment_entry(file_url="/media/a.jpg", filename="a.jpg", content_type="image/jpeg")
        b = new_attachment_entry(file_url="/media/b.jpg", filename="b.jpg", content_type="image/jpeg")
        c = new_attachment_entry(file_url="/media/c.pdf", filename="c.pdf", content_type="application/pdf")
        by_id = {"42": [dict(a), dict(b), dict(c)]}
        by_num = {"16": [dict(a), dict(b), dict(c)]}
        removed = _remove_from_attachment_maps(by_id, by_num, attachment_id=b["id"])
        self.assertEqual(removed["id"], b["id"])
        self.assertEqual([item["id"] for item in by_id["42"]], [a["id"], c["id"]])
        self.assertEqual([item["id"] for item in by_num["16"]], [a["id"], c["id"]])

    def test_public_attachment_shape(self):
        entry = new_attachment_entry(file_url="/media/x.png", filename="x.png", content_type="image/png")
        pub = public_attachment(entry)
        self.assertEqual(set(pub), {"id", "url", "filename", "name", "content_type"})
        self.assertEqual(pub["id"], entry["id"])


class TeacherTaskCommentAttachmentTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="rev_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="rev_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Маша",
            last_name="Ученик",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ проверка",
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="generated_task",
            title="Вариант",
            description="http://127.0.0.1:8000/oge/inf/variant/1",
            order=0,
        )
        self.submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            status="submitted",
            submitted_at=timezone.now(),
            result_payload={"by_task_id": {"20": "ответ"}},
        )
        self.review_item = (
            ReviewItem.objects.filter(
                teacher=self.teacher,
                source_type="homework",
                source_id=self.submission.pk,
            ).first()
            or ReviewItem.objects.create(
                teacher=self.teacher,
                student=self.student,
                source_type="homework",
                source_id=self.submission.pk,
                title=f"{self.homework.title} — {self.student.full_name}",
                status="pending",
            )
        )
        self.teacher_client = APIClient()
        self.teacher_client.force_login(self.teacher)
        self.student_client = APIClient()
        self.student_client.force_login(self.student_user)

    def _upload(self, files, extra=None):
        payload = dict(extra or {})
        payload["file"] = files[0] if len(files) == 1 else files
        return self.teacher_client.post(
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/",
            payload,
            format="multipart",
        )

    def test_teacher_task_upload_and_student_visibility(self):
        self.submission.status = "returned"
        self.submission.submitted_at = None
        self.submission.save(update_fields=["status", "submitted_at"])
        uploaded = self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "file": SimpleUploadedFile("student2.jpg", PNG, content_type="image/jpeg"),
                "task_number": "20",
                "task_id": "20",
            },
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 200, uploaded.content)
        student_id = uploaded.json()["id"]

        teacher = self._upload(
            [SimpleUploadedFile("hint.png", PNG, content_type="image/png")],
            {"task_number": "20", "task_id": "20"},
        )
        self.assertEqual(teacher.status_code, 200, teacher.content)
        teacher_id = teacher.json()["id"]
        self.submission.refresh_from_db()
        payload = self.submission.result_payload
        self.assertEqual(payload["attachments_by_task_id"]["20"][0]["id"], student_id)
        self.assertEqual(payload["teacher_attachments_by_task_id"]["20"][0]["id"], teacher_id)

        review = self.teacher_client.get(f"/api/cabinet/review/{self.review_item.pk}/")
        result = review.json()["homework_submission"]["result_payload"]
        self.assertEqual(result["attachments_by_task_id"]["20"][0]["id"], student_id)
        self.assertEqual(result["teacher_attachments_by_task_id"]["20"][0]["id"], teacher_id)

        assignment = self.student_client.get(f"/api/homework/assignment/{self.homework.pk}/")
        student_result = assignment.json()["result"]
        self.assertEqual(student_result["teacher_attachments_by_task_id"]["20"][0]["id"], teacher_id)

    def test_teacher_delete_middle_keeps_others(self):
        created = self._upload(
            [
                SimpleUploadedFile("a.jpg", PNG, content_type="image/jpeg"),
                SimpleUploadedFile("b.pdf", PDF, content_type="application/pdf"),
                SimpleUploadedFile("c.png", PNG, content_type="image/png"),
            ],
            {"task_number": "20", "task_id": "20"},
        ).json()["attachments"]
        middle = created[1]
        resp = self.teacher_client.delete(
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/"
            f"?id={middle['id']}&task_number=20&task_id=20"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.submission.refresh_from_db()
        remaining = self.submission.result_payload["teacher_attachments_by_task_id"]["20"]
        self.assertEqual([item["id"] for item in remaining], [created[0]["id"], created[2]["id"]])

    def test_comment_attachments_isolated_from_task_attachments(self):
        task_file = self._upload(
            [SimpleUploadedFile("task.png", PNG, content_type="image/png")],
            {"task_number": "20", "task_id": "20"},
        ).json()
        comment_files = self._upload(
            [
                SimpleUploadedFile("c1.pdf", PDF, content_type="application/pdf"),
                SimpleUploadedFile("c2.jpg", PNG, content_type="image/jpeg"),
            ]
        ).json()["attachments"]
        resp = self.teacher_client.delete(
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/?id={comment_files[0]['id']}"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.submission.refresh_from_db()
        payload = self.submission.result_payload
        self.assertEqual(payload["teacher_attachments_by_task_id"]["20"][0]["id"], task_file["id"])
        remaining = payload["teacher_comment_attachments"]
        self.assertEqual([item["id"] for item in remaining], [comment_files[1]["id"]])

    def test_student_cannot_delete_teacher_feedback(self):
        created = self._upload(
            [SimpleUploadedFile("hint.png", PNG, content_type="image/png")],
            {"task_number": "20", "task_id": "20"},
        ).json()
        resp = self.student_client.delete(
            f"/api/cabinet/review/{self.review_item.pk}/upload-feedback/?id={created['id']}&task_number=20&task_id=20"
        )
        self.assertIn(resp.status_code, (403, 404))
        self.submission.refresh_from_db()
        self.assertEqual(
            self.submission.result_payload["teacher_attachments_by_task_id"]["20"][0]["id"],
            created["id"],
        )

    def test_pop_does_not_clear_whole_list(self):
        payload = {
            "teacher_attachments_by_task_id": {
                "20": [
                    {"id": "1", "url": "/a", "filename": "a.jpg"},
                    {"id": "2", "url": "/b", "filename": "b.jpg"},
                ]
            },
            "teacher_attachments_by_number": {
                "20": [
                    {"id": "1", "url": "/a", "filename": "a.jpg"},
                    {"id": "2", "url": "/b", "filename": "b.jpg"},
                ]
            },
        }
        removed = _pop_attachment_from_payload(payload, teacher=True, attachment_id="1")
        self.assertEqual(removed["id"], "1")
        self.assertEqual(len(payload["teacher_attachments_by_task_id"]["20"]), 1)
        self.assertEqual(payload["teacher_attachments_by_task_id"]["20"][0]["id"], "2")
