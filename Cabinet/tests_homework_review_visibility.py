"""Ученик видит опубликованные комментарии, пометки и файлы проверки."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.models import (
    Homework,
    HomeworkNotebook,
    HomeworkSubmission,
    Profile,
    ReviewItem,
    Student,
)

User = get_user_model()
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


class HomeworkReviewVisibilityTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="rv_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="rv_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.other_user = User.objects.create_user(username="rv_other", password="pass")
        self.other_user.profile.role = Profile.Role.STUDENT
        self.other_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )
        Student.objects.create(
            teacher=self.teacher,
            user=self.other_user,
            first_name="Оля",
            last_name="Другая",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Дроби",
            status="assigned",
        )
        self.student_api = APIClient()
        self.student_api.force_login(self.student_user)
        self.teacher_api = APIClient()
        self.teacher_api.force_login(self.teacher)
        self.other_api = APIClient()
        self.other_api.force_login(self.other_user)

    def _submit(self):
        response = self.student_api.post(
            f"/api/cabinet/student/assignments/{self.homework.pk}/",
            {"answer_text": "Решение в тетради"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.content)
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=self.student)
        review = ReviewItem.objects.get(source_type="homework", source_id=submission.pk)
        return submission, review

    def _draw(self, submission, *, text="Ошибка", object_id="pen-1"):
        opened = self.teacher_api.post(
            f"/api/homework/submissions/{submission.pk}/notebooks/",
            {"task_id": "work", "owner_role": "teacher", "seed_from_attachments": False},
            format="json",
        )
        self.assertIn(opened.status_code, (200, 201), opened.content)
        document = opened.json()
        page = document["pages"][0]
        page["state"] = {
            "version": 1,
            "objects": [
                {
                    "id": object_id,
                    "type": "pen",
                    "stroke": "#DC2626",
                    "strokeWidth": 4,
                    "points": [{"x": 12, "y": 20}, {"x": 40, "y": 48}],
                },
                {
                    "id": f"{object_id}-text",
                    "type": "text",
                    "text": text,
                    "stroke": "#2563EB",
                    "x": 30,
                    "y": 60,
                    "fontSize": 22,
                },
            ],
        }
        saved = self.teacher_api.put(
            f"/api/homework/notebooks/{document['id']}/",
            {"version": document["version"], "pages": [page]},
            format="json",
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        return document["id"]

    def _attach(self, review):
        photo = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/upload-feedback/",
            {
                "task_id": "work",
                "task_number": "1",
                "file": SimpleUploadedFile("scan.png", PNG, content_type="image/png"),
            },
            format="multipart",
        )
        self.assertEqual(photo.status_code, 200, photo.content)
        pdf = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/upload-feedback/",
            {
                "file": SimpleUploadedFile("checked.pdf", PDF, content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(pdf.status_code, 200, pdf.content)
        return photo.json(), pdf.json()

    def _student_detail(self):
        response = self.student_api.get(f"/api/cabinet/student/assignments/{self.homework.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_published_review_reaches_the_student_and_survives_reload(self):
        submission, review = self._submit()
        notebook_id = self._draw(submission)
        photo, pdf = self._attach(review)

        hidden = self.student_api.get(
            f"/api/homework/submissions/{submission.pk}/tasks/work/published-notebook/"
        )
        self.assertEqual(hidden.status_code, 404)
        before = self._student_detail()
        self.assertIsNone(before["result"])
        self.assertEqual(before["published_notebooks"], [])

        checked = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/check/",
            {
                "teacher_comment": "Смотри чертёж",
                "comments_by_task_id": {"work": "Подпиши оси"},
            },
            format="json",
        )
        self.assertEqual(checked.status_code, 200, checked.content)

        detail = self._student_detail()
        self.assertEqual(detail["status"], "checked")
        self.assertEqual(detail["teacher_comment"], "Смотри чертёж")
        self.assertEqual(detail["result"]["comments_by_task_id"]["work"], "Подпиши оси")
        filenames = {
            item["filename"]
            for bucket in (detail["result"]["task_attachments"]["tasks"].get("work", {}).get("teacher") or [])
            for item in [bucket]
        }
        comment_names = {item["filename"] for item in detail["result"]["task_attachments"]["comment"]}
        self.assertIn("scan.png", filenames)
        self.assertIn("checked.pdf", comment_names)
        self.assertEqual(len(detail["published_notebooks"]), 1)
        self.assertTrue(detail["review_checked_at"])

        published = self.student_api.get(
            f"/api/homework/submissions/{submission.pk}/tasks/work/published-notebook/"
        )
        self.assertEqual(published.status_code, 200, published.content)
        objects = published.json()["document"]["pages"][0]["state"]["objects"]
        pen = next(item for item in objects if item["type"] == "pen")
        text = next(item for item in objects if item["type"] == "text")
        self.assertEqual(pen["stroke"], "#DC2626")
        self.assertEqual(pen["strokeWidth"], 4)
        self.assertEqual(pen["points"][0], {"x": 12, "y": 20})
        self.assertEqual(text["text"], "Ошибка")
        self.assertEqual(text["x"], 30)

        again = self._student_detail()
        self.assertEqual(again["teacher_comment"], detail["teacher_comment"])
        self.assertEqual(again["published_notebooks"][0]["revision_id"], detail["published_notebooks"][0]["revision_id"])

        file_id = photo["id"]
        own_file = self.student_api.get(f"/api/homework/attachments/{file_id}/file/")
        self.assertEqual(own_file.status_code, 200)
        foreign_detail = self.other_api.get(f"/api/cabinet/student/assignments/{self.homework.pk}/")
        self.assertEqual(foreign_detail.status_code, 404)
        foreign_notebook = self.other_api.get(
            f"/api/homework/submissions/{submission.pk}/tasks/work/published-notebook/"
        )
        self.assertEqual(foreign_notebook.status_code, 404)
        foreign_file = self.other_api.get(f"/api/homework/attachments/{file_id}/file/")
        self.assertIn(foreign_file.status_code, (403, 404))
        self.assertNotEqual(notebook_id, "")

    def test_return_and_resubmit_keep_previous_marks(self):
        submission, review = self._submit()
        self._draw(submission, text="Первая пометка", object_id="mark-1")
        self._attach(review)
        returned = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/return/",
            {"teacher_comment": "Верни чертёж", "comments_by_task_id": {"work": "Не та формула"}},
            format="json",
        )
        self.assertEqual(returned.status_code, 200, returned.content)
        detail = self._student_detail()
        self.assertEqual(detail["status"], "needs_fix")
        self.assertEqual(detail["teacher_comment"], "Верни чертёж")
        self.assertEqual(detail["result"]["comments_by_task_id"]["work"], "Не та формула")
        first_revision = detail["published_notebooks"][0]["revision_id"]

        resubmit = self.student_api.post(
            f"/api/cabinet/student/assignments/{self.homework.pk}/",
            {"answer_text": "Исправленное решение"},
            format="multipart",
        )
        self.assertEqual(resubmit.status_code, 200, resubmit.content)
        after = self._student_detail()
        self.assertEqual(after["status"], "submitted")
        self.assertEqual(after["result"]["comments_by_task_id"]["work"], "Не та формула")
        comment_names = {item["filename"] for item in after["result"]["task_attachments"]["comment"]}
        self.assertIn("checked.pdf", comment_names)
        self.assertEqual(after["teacher_comment"], "Верни чертёж")
        draft_file = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/upload-feedback/",
            {"file": SimpleUploadedFile("draft-note.png", PNG, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(draft_file.status_code, 200, draft_file.content)
        during = self._student_detail()
        during_names = {item["filename"] for item in during["result"]["task_attachments"]["comment"]}
        self.assertIn("checked.pdf", during_names)
        self.assertNotIn("draft-note.png", during_names)
        self.assertEqual(after["published_notebooks"][0]["revision_id"], first_revision)
        still = self.student_api.get(
            f"/api/homework/submissions/{submission.pk}/tasks/work/published-notebook/"
        )
        self.assertEqual(still.json()["document"]["pages"][0]["state"]["objects"][1]["text"], "Первая пометка")

        notebook = HomeworkNotebook.objects.get(submission=submission, owner_role="teacher", task_key="work")
        latest = self.teacher_api.get(f"/api/homework/notebooks/{notebook.pk}/").json()
        page = latest["pages"][0]
        page["state"] = {
            "version": 1,
            "objects": page["state"]["objects"] + [
                {"id": "mark-2", "type": "text", "text": "Новый черновик", "x": 8, "y": 8},
            ],
        }
        draft = self.teacher_api.put(
            f"/api/homework/notebooks/{notebook.pk}/",
            {"version": latest["version"], "pages": [page]},
            format="json",
        )
        self.assertEqual(draft.status_code, 200, draft.content)
        during_review = self.student_api.get(
            f"/api/homework/submissions/{submission.pk}/tasks/work/published-notebook/"
        )
        texts = [
            item.get("text")
            for item in during_review.json()["document"]["pages"][0]["state"]["objects"]
        ]
        self.assertIn("Первая пометка", texts)
        self.assertNotIn("Новый черновик", texts)

        review.refresh_from_db()
        checked = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/check/",
            {"teacher_comment": "Теперь верно"},
            format="json",
        )
        self.assertEqual(checked.status_code, 200, checked.content)
        final = self._student_detail()
        self.assertEqual(final["teacher_comment"], "Теперь верно")
        self.assertNotEqual(final["published_notebooks"][0]["revision_id"], first_revision)
        old = self.student_api.get(
            f"/api/homework/submissions/{submission.pk}/tasks/work/published-notebook/?revision={first_revision}"
        )
        self.assertEqual(old.status_code, 200, old.content)
        old_texts = [item.get("text") for item in old.json()["document"]["pages"][0]["state"]["objects"]]
        self.assertIn("Первая пометка", old_texts)
        self.assertNotIn("Новый черновик", old_texts)
        history_comments = [row["teacher_comment"] for row in final["review_history"]]
        self.assertIn("Верни чертёж", history_comments)

    def test_existing_checked_notebook_without_revision_stays_visible(self):
        submission, review = self._submit()
        self._draw(submission, text="Старая проверка", object_id="old")
        submission.status = "checked"
        submission.teacher_comment = "Уже проверено"
        submission.submitted_at = timezone.now()
        submission.save(update_fields=["status", "teacher_comment", "submitted_at"])
        review.status = "checked"
        review.teacher_comment = "Уже проверено"
        review.checked_at = timezone.now()
        review.save(update_fields=["status", "teacher_comment", "checked_at"])
        notebook = HomeworkNotebook.objects.get(pk=self.teacher_api.get(
            f"/api/homework/submissions/{submission.pk}/notebooks/"
        ).json()["notebooks"][0]["id"])
        self.assertIsNone(notebook.published_revision_id)

        detail = self._student_detail()
        self.assertEqual(detail["teacher_comment"], "Уже проверено")
        self.assertEqual(len(detail["published_notebooks"]), 1)
        published = self.student_api.get(
            f"/api/homework/submissions/{submission.pk}/tasks/work/published-notebook/"
        )
        self.assertEqual(published.status_code, 200, published.content)
        self.assertEqual(
            published.json()["document"]["pages"][0]["state"]["objects"][1]["text"],
            "Старая проверка",
        )

    def test_repeat_check_does_not_duplicate_published_revision(self):
        submission, review = self._submit()
        self._draw(submission, text="Одно замечание", object_id="once")
        body = {"teacher_comment": "Готово", "comments_by_task_id": {"work": "Подпиши оси"}}
        first = self.teacher_api.post(f"/api/cabinet/review/{review.pk}/check/", body, format="json")
        second = self.teacher_api.post(f"/api/cabinet/review/{review.pk}/check/", body, format="json")
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        notebook = HomeworkNotebook.objects.get(submission=submission, owner_role="teacher", task_key="work")
        self.assertEqual(notebook.revisions.count(), 1)
        detail = self._student_detail()
        self.assertEqual(detail["status"], "checked")
        self.assertEqual(len(detail["published_notebooks"]), 1)
        self.assertEqual(detail["teacher_comment"], "Готово")

    def test_snapshot_failure_rolls_back_publication_and_retry_keeps_history(self):
        submission, review = self._submit()
        self._draw(submission, text="История", object_id="hist")
        body = {"teacher_comment": "Готово", "comments_by_task_id": {"work": "Подпиши оси"}}
        previous_submission_status = submission.status
        previous_review_status = review.status
        with patch(
            "Cabinet.homework_attempts.snapshot_on_review",
            side_effect=RuntimeError("snapshot failed"),
        ):
            failed = self.teacher_api.post(
                f"/api/cabinet/review/{review.pk}/check/",
                body,
                format="json",
            )
        self.assertEqual(failed.status_code, 503, failed.content)
        self.assertIn("историю попытки", failed.json()["detail"])
        submission.refresh_from_db()
        review.refresh_from_db()
        self.assertEqual(submission.status, previous_submission_status)
        self.assertEqual(review.status, previous_review_status)
        self.assertEqual(submission.attempts.count(), 0)
        notebook = HomeworkNotebook.objects.get(submission=submission, owner_role="teacher", task_key="work")
        self.assertIsNone(notebook.published_revision_id)
        hidden = self._student_detail()
        self.assertIsNone(hidden["result"])
        self.assertEqual(hidden["review_history"], [])
        self.assertEqual(hidden["published_notebooks"], [])

        restored = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/check/",
            body,
            format="json",
        )
        self.assertEqual(restored.status_code, 200, restored.content)
        submission.refresh_from_db()
        attempt = submission.attempts.get()
        self.assertEqual(attempt.teacher_comment, "Готово")
        self.assertEqual(attempt.result_payload["comments_by_task_id"]["work"], "Подпиши оси")
        self.assertEqual(len(attempt.result_payload["published_notebooks"]), 1)
        visible = self._student_detail()
        self.assertEqual(visible["status"], "checked")
        self.assertEqual(visible["teacher_comment"], "Готово")
        self.assertEqual(len(visible["published_notebooks"]), 1)
        self.assertEqual(len(visible["review_history"]), 1)

    def test_failed_publish_does_not_mark_the_work_checked(self):
        submission, review = self._submit()
        self._draw(submission, text="Не должно опубликоваться", object_id="fail")
        submission.refresh_from_db()
        review.refresh_from_db()
        previous_submission_status = submission.status
        previous_review_status = review.status
        with patch(
            "Cabinet.homework_notebooks.publish_teacher_notebooks",
            side_effect=RuntimeError("publish failed"),
        ):
            try:
                response = self.teacher_api.post(
                    f"/api/cabinet/review/{review.pk}/check/",
                    {"teacher_comment": "Готово"},
                    format="json",
                )
            except RuntimeError:
                response = None
            else:
                self.assertGreaterEqual(response.status_code, 500, response.content)
        submission.refresh_from_db()
        review.refresh_from_db()
        notebook = HomeworkNotebook.objects.get(submission=submission, owner_role="teacher", task_key="work")
        self.assertEqual(submission.status, previous_submission_status)
        self.assertEqual(review.status, previous_review_status)
        self.assertEqual(notebook.revisions.count(), 0)
        detail = self._student_detail()
        self.assertNotEqual(detail["status"], "checked")
        self.assertIsNone(detail["result"])

    def test_stale_autosave_does_not_replace_newer_marks(self):
        submission, _review = self._submit()
        opened = self.teacher_api.post(
            f"/api/homework/submissions/{submission.pk}/notebooks/",
            {"task_id": "work", "owner_role": "teacher", "seed_from_attachments": False},
            format="json",
        )
        self.assertIn(opened.status_code, (200, 201), opened.content)
        document = opened.json()
        page = document["pages"][0]
        newer = {
            **page,
            "state": {
                "version": 1,
                "objects": [{
                    "id": "new-stroke",
                    "type": "pen",
                    "stroke": "#111111",
                    "points": [{"x": 1, "y": 1}, {"x": 4, "y": 4}],
                }],
            },
        }
        saved = self.teacher_api.put(
            f"/api/homework/notebooks/{document['id']}/",
            {"version": document["version"], "pages": [newer]},
            format="json",
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        stale = self.teacher_api.put(
            f"/api/homework/notebooks/{document['id']}/",
            {
                "version": document["version"],
                "pages": [{
                    **page,
                    "state": {
                        "version": 1,
                        "objects": [{"id": "old-stroke", "type": "text", "text": "старое", "x": 1, "y": 1}],
                    },
                }],
            },
            format="json",
        )
        self.assertEqual(stale.status_code, 409, stale.content)
        current = self.teacher_api.get(f"/api/homework/notebooks/{document['id']}/").json()
        ids = [item["id"] for item in current["pages"][0]["state"]["objects"]]
        self.assertIn("new-stroke", ids)
        self.assertNotIn("old-stroke", ids)

    def test_student_opens_published_revision_not_later_draft(self):
        submission, review = self._submit()
        self._draw(submission, text="Опубликовано", object_id="pub")
        checked = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/check/",
            {"teacher_comment": "Смотри чертёж", "comments_by_task_id": {"work": "Подпиши оси"}},
            format="json",
        )
        self.assertEqual(checked.status_code, 200, checked.content)
        notebook = HomeworkNotebook.objects.get(submission=submission, owner_role="teacher", task_key="work")
        latest = self.teacher_api.get(f"/api/homework/notebooks/{notebook.pk}/").json()
        page = latest["pages"][0]
        page["state"] = {
            "version": 1,
            "objects": list(page["state"]["objects"]) + [
                {"id": "after", "type": "text", "text": "Черновик после проверки", "x": 4, "y": 4},
            ],
        }
        draft = self.teacher_api.put(
            f"/api/homework/notebooks/{notebook.pk}/",
            {"version": latest["version"], "pages": [page]},
            format="json",
        )
        self.assertEqual(draft.status_code, 200, draft.content)
        detail = self._student_detail()
        self.assertEqual(detail["status"], "checked")
        self.assertEqual(detail["teacher_comment"], "Смотри чертёж")
        self.assertEqual(detail["result"]["comments_by_task_id"]["work"], "Подпиши оси")
        published = self.student_api.get(
            f"/api/homework/submissions/{submission.pk}/tasks/work/published-notebook/"
        )
        self.assertEqual(published.status_code, 200, published.content)
        texts = [item.get("text") for item in published.json()["document"]["pages"][0]["state"]["objects"]]
        self.assertIn("Опубликовано", texts)
        self.assertNotIn("Черновик после проверки", texts)
        reloaded = self._student_detail()
        self.assertEqual(
            reloaded["published_notebooks"][0]["revision_id"],
            detail["published_notebooks"][0]["revision_id"],
        )

    def test_rejected_upload_is_not_published(self):
        submission, review = self._submit()
        rejected = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/upload-feedback/",
            {"file": SimpleUploadedFile("virus.exe", b"MZ", content_type="application/octet-stream")},
            format="multipart",
        )
        self.assertEqual(rejected.status_code, 400, rejected.content)
        checked = self.teacher_api.post(
            f"/api/cabinet/review/{review.pk}/check/",
            {"teacher_comment": "Без файла"},
            format="json",
        )
        self.assertEqual(checked.status_code, 200, checked.content)
        detail = self._student_detail()
        self.assertNotIn("virus.exe", str(detail))
        self.assertEqual(detail["status"], "checked")
        self.assertEqual(detail["teacher_comment"], "Без файла")
