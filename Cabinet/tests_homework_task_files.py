from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from Cabinet.choices import (
    HomeworkAttachmentOwnerRole,
    HomeworkNotebookRevisionReason,
    HomeworkNotebookStatus,
)
from Cabinet.homework_notebooks import save_notebook_document, serialize_notebook
from Cabinet.models import (
    Homework,
    HomeworkAttachment,
    HomeworkNotebook,
    HomeworkNotebookPage,
    HomeworkSubmission,
    HomeworkTask,
    Profile,
    ReviewItem,
    Student,
)

User = get_user_model()
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPG_A = PNG + b"A"
JPG_B = PNG + b"B"


class HomeworkNormalizedAttachmentTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="tf_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="tf_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.other_user = User.objects.create_user(username="tf_other", password="pass")
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
            title="ДЗ файлы",
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
        self.other_client = APIClient()
        self.other_client.force_login(self.other_user)

    def _upload(self, filename, content, *, task_id, task_number, client=None):
        client = client or self.student_client
        return client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "task_id": task_id,
                "task_number": task_number,
                "file": SimpleUploadedFile(filename, content, content_type="image/jpeg"),
            },
            format="multipart",
        )

    def _rows(self):
        return list(
            HomeworkAttachment.objects.filter(is_deleted=False).order_by("created_at", "id")
        )

    def test_task_a_and_task_b_keep_distinct_files(self):
        a = self._upload("a.jpg", JPG_A, task_id="A", task_number="1")
        b = self._upload("b.jpg", JPG_B, task_id="B", task_number="2")
        self.assertEqual(a.status_code, 200, a.content)
        self.assertEqual(b.status_code, 200, b.content)
        grouped = self.student_client.get(
            f"/api/homework/submissions/{HomeworkSubmission.objects.get().pk}/attachments/"
        )
        self.assertEqual(grouped.status_code, 200)
        tasks = grouped.json()["tasks"]
        self.assertEqual(tasks["A"]["student"][0]["filename"], "a.jpg")
        self.assertEqual(tasks["B"]["student"][0]["filename"], "b.jpg")
        self.assertEqual(len(tasks["A"]["student"]), 1)
        self.assertEqual(len(tasks["B"]["student"]), 1)
        self.assertNotEqual(tasks["A"]["student"][0]["id"], tasks["B"]["student"][0]["id"])

    def test_same_filename_does_not_confuse_rows(self):
        first = self._upload("photo.jpg", JPG_A, task_id="A", task_number="1")
        second = self._upload("photo.jpg", JPG_B, task_id="B", task_number="2")
        self.assertEqual(first.json()["id"], HomeworkAttachment.objects.get(task_key="A").id.__str__())
        self.assertNotEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(HomeworkAttachment.objects.filter(is_deleted=False).count(), 2)

    def test_two_uploads_same_task_keep_both(self):
        self._upload("a.jpg", JPG_A, task_id="A", task_number="1")
        self._upload("b.jpg", JPG_B, task_id="A", task_number="1")
        rows = HomeworkAttachment.objects.filter(task_key="A", is_deleted=False)
        self.assertEqual(rows.count(), 2)

    def test_save_draft_does_not_drop_upload(self):
        self._upload("a.jpg", JPG_A, task_id="A", task_number="1")
        resp = self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/save-draft/",
            {"result": {"by_task_id": {"A": "answer"}, "attachments_by_task_id": {"A": []}}},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(HomeworkAttachment.objects.filter(task_key="A", is_deleted=False).count(), 1)
        self.assertTrue(resp.json()["result"]["attachments_by_task_id"].get("A"))

    def test_teacher_file_not_in_student_list(self):
        self._upload("a.jpg", JPG_A, task_id="20", task_number="20")
        submission = HomeworkSubmission.objects.get()
        ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=submission.pk,
            title="review",
            status="pending",
        )
        review = ReviewItem.objects.get()
        upload = self.teacher_client.post(
            f"/api/cabinet/review/{review.pk}/upload-feedback/",
            {
                "task_id": "20",
                "task_number": "20",
                "file": SimpleUploadedFile("note.jpg", JPG_B, content_type="image/jpeg"),
            },
            format="multipart",
        )
        self.assertEqual(upload.status_code, 200, upload.content)
        grouped = self.student_client.get(
            f"/api/homework/submissions/{submission.pk}/attachments/"
        ).json()
        self.assertEqual(grouped["tasks"]["20"]["student"][0]["filename"], "a.jpg")
        self.assertEqual(grouped["tasks"]["20"]["teacher"][0]["filename"], "note.jpg")
        student_roles = {
            (row.owner_role, row.original_filename)
            for row in HomeworkAttachment.objects.filter(is_deleted=False)
        }
        self.assertIn((HomeworkAttachmentOwnerRole.STUDENT, "a.jpg"), student_roles)
        self.assertIn((HomeworkAttachmentOwnerRole.TEACHER, "note.jpg"), student_roles)

    def test_refresh_restores_from_db(self):
        self._upload("a.jpg", JPG_A, task_id="A", task_number="1")
        self._upload("b.jpg", JPG_B, task_id="B", task_number="2")
        detail = self.student_client.get(f"/api/homework/assignment/{self.homework.pk}/")
        tasks = (detail.json().get("task_attachments") or {}).get("tasks") or {}
        self.assertEqual(tasks["A"]["student"][0]["filename"], "a.jpg")
        self.assertEqual(tasks["B"]["student"][0]["filename"], "b.jpg")
        row_a = HomeworkAttachment.objects.get(task_key="A")
        self.assertEqual(str(row_a.id), tasks["A"]["student"][0]["id"])

    def test_student_cannot_read_other_submission(self):
        self._upload("secret.jpg", JPG_A, task_id="A", task_number="1")
        submission = HomeworkSubmission.objects.get()
        resp = self.other_client.get(f"/api/homework/submissions/{submission.pk}/attachments/")
        self.assertIn(resp.status_code, (403, 404))

    def test_delete_by_id_not_url_index(self):
        first = self._upload("a.jpg", JPG_A, task_id="A", task_number="1").json()
        second = self._upload("b.jpg", JPG_B, task_id="A", task_number="1").json()
        resp = self.student_client.delete(f"/api/homework/attachments/{first['id']}/")
        self.assertEqual(resp.status_code, 200, resp.content)
        remaining = HomeworkAttachment.objects.filter(task_key="A", is_deleted=False)
        self.assertEqual(remaining.count(), 1)
        self.assertEqual(str(remaining.get().id), second["id"])

    def test_delete_does_not_affect_other_task(self):
        a = self._upload("a.jpg", JPG_A, task_id="A", task_number="1").json()
        self._upload("b.jpg", JPG_B, task_id="B", task_number="2")
        self.student_client.delete(f"/api/homework/attachments/{a['id']}/")
        self.assertEqual(HomeworkAttachment.objects.filter(task_key="B", is_deleted=False).count(), 1)
        self.assertEqual(HomeworkAttachment.objects.filter(task_key="A", is_deleted=False).count(), 0)


class HomeworkAttachmentConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="tf_conc_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="tf_conc_s", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Петя",
            last_name="Ученик",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ гонки",
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=self.homework,
            task_type="generated_task",
            title="Вариант",
            description="http://127.0.0.1:8000/oge/inf/variant/1",
            order=0,
        )

    def _client(self):
        client = APIClient()
        client.force_login(self.student_user)
        return client

    def test_parallel_uploads_different_tasks(self):
        def upload(task_id, name, payload):
            client = self._client()
            return client.post(
                f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
                {
                    "task_id": task_id,
                    "task_number": task_id,
                    "file": SimpleUploadedFile(name, payload, content_type="image/jpeg"),
                },
                format="multipart",
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = list(pool.map(
                lambda args: upload(*args),
                [("A", "a.jpg", JPG_A), ("B", "b.jpg", JPG_B)],
            ))
        self.assertEqual(codes, [200, 200])
        self.assertEqual(HomeworkAttachment.objects.filter(is_deleted=False).count(), 2)
        keys = set(HomeworkAttachment.objects.values_list("task_key", flat=True))
        self.assertEqual(keys, {"A", "B"})

    def test_parallel_uploads_same_task(self):
        def upload(name, payload):
            client = self._client()
            return client.post(
                f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
                {
                    "task_id": "A",
                    "task_number": "1",
                    "file": SimpleUploadedFile(name, payload, content_type="image/jpeg"),
                },
                format="multipart",
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = list(pool.map(lambda args: upload(*args), [("a.jpg", JPG_A), ("b.jpg", JPG_B)]))
        self.assertEqual(codes, [200, 200])
        self.assertEqual(HomeworkAttachment.objects.filter(task_key="A", is_deleted=False).count(), 2)

    def test_upload_and_delete_stay_consistent(self):
        client = self._client()
        first = client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "task_id": "A",
                "task_number": "1",
                "file": SimpleUploadedFile("a.jpg", JPG_A, content_type="image/jpeg"),
            },
            format="multipart",
        ).json()

        def do_upload():
            c = self._client()
            return c.post(
                f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
                {
                    "task_id": "A",
                    "task_number": "1",
                    "file": SimpleUploadedFile("b.jpg", JPG_B, content_type="image/jpeg"),
                },
                format="multipart",
            ).status_code

        def do_delete():
            c = self._client()
            return c.delete(f"/api/homework/attachments/{first['id']}/").status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda fn: fn(), [do_upload, do_delete]))
        remaining = list(HomeworkAttachment.objects.filter(is_deleted=False))
        self.assertGreaterEqual(len(remaining), 1)
        names = {row.original_filename for row in remaining}
        self.assertTrue("b.jpg" in names or "a.jpg" in names)


class HomeworkNotebookTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="nb_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="nb_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Петя",
            last_name="Ученик",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ тетрадь",
            status="assigned",
        )
        self.student_client = APIClient()
        self.student_client.force_login(self.student_user)
        self.teacher_client = APIClient()
        self.teacher_client.force_login(self.teacher)
        self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "task_id": "A",
                "task_number": "1",
                "file": SimpleUploadedFile("a.jpg", JPG_A, content_type="image/jpeg"),
            },
            format="multipart",
        )
        self.submission = HomeworkSubmission.objects.get()

    def test_autosave_roundtrip(self):
        created = self.student_client.post(
            f"/api/homework/submissions/{self.submission.pk}/notebooks/",
            {"task_id": "A", "owner_role": "student"},
            format="json",
        )
        self.assertIn(created.status_code, (200, 201), created.content)
        doc = created.json()
        page = doc["pages"][0]
        page["state"] = {
            "version": 1,
            "objects": [
                {"id": "line-1", "type": "pen", "color": "#000", "width": 3, "points": [{"x": 10, "y": 10}, {"x": 40, "y": 50}]},
                {"id": "txt-1", "type": "text", "text": "решение", "x": 20, "y": 80, "fontSize": 24, "color": "#d32f2f"},
            ],
        }
        saved = self.student_client.put(
            f"/api/homework/notebooks/{doc['id']}/",
            {"version": doc["version"], "pages": [page]},
            format="json",
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        reopened = self.student_client.get(f"/api/homework/notebooks/{doc['id']}/")
        self.assertEqual(reopened.status_code, 200)
        objects = reopened.json()["pages"][0]["state"]["objects"]
        self.assertEqual(len(objects), 2)
        self.assertEqual(objects[0]["id"], "line-1")
        self.assertEqual(objects[1]["text"], "решение")

    def test_version_conflict(self):
        created = self.student_client.post(
            f"/api/homework/submissions/{self.submission.pk}/notebooks/",
            {"task_id": "A", "owner_role": "student"},
            format="json",
        ).json()
        page = created["pages"][0]
        first = self.student_client.put(
            f"/api/homework/notebooks/{created['id']}/",
            {"version": created["version"], "pages": [page]},
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        stale = self.student_client.put(
            f"/api/homework/notebooks/{created['id']}/",
            {"version": created["version"], "pages": [page]},
            format="json",
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["code"], "version_conflict")

    def test_teacher_return_snapshot_immutable(self):
        teacher_nb = self.teacher_client.post(
            f"/api/homework/submissions/{self.submission.pk}/notebooks/",
            {"task_id": "A", "owner_role": "teacher", "seed_from_attachments": True},
            format="json",
        )
        self.assertIn(teacher_nb.status_code, (200, 201), teacher_nb.content)
        doc = teacher_nb.json()
        page = doc["pages"][0]
        page["state"] = {
            "version": 1,
            "objects": [{"id": "mark-1", "type": "pen", "points": [{"x": 1, "y": 1}, {"x": 2, "y": 2}]}],
        }
        saved = self.teacher_client.put(
            f"/api/homework/notebooks/{doc['id']}/",
            {"version": doc["version"], "pages": doc["pages"][:1] and [page] or [page]},
            format="json",
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        sent = self.teacher_client.post(f"/api/homework/notebooks/{doc['id']}/submit/")
        self.assertEqual(sent.status_code, 200, sent.content)
        published = sent.json()["revision"]["id"]
        latest = self.teacher_client.get(f"/api/homework/notebooks/{doc['id']}/").json()
        page = latest["pages"][0]
        page["state"] = {
            "version": 1,
            "objects": [{"id": "mark-2", "type": "text", "text": "новый черновик", "x": 10, "y": 10}],
        }
        again = self.teacher_client.put(
            f"/api/homework/notebooks/{doc['id']}/",
            {"version": latest["version"], "pages": [page]},
            format="json",
        )
        self.assertEqual(again.status_code, 200, again.content)
        student_view = self.student_client.get(
            f"/api/homework/submissions/{self.submission.pk}/tasks/A/published-notebook/"
        )
        self.assertEqual(student_view.status_code, 200, student_view.content)
        snap_objects = student_view.json()["document"]["pages"][0]["state"]["objects"]
        self.assertEqual(snap_objects[0]["id"], "mark-1")
        self.assertEqual(student_view.json()["revision"]["id"], published)
        notebook = HomeworkNotebook.objects.get(pk=doc["id"])
        self.assertEqual(notebook.status, HomeworkNotebookStatus.RETURNED)
        self.assertEqual(str(notebook.published_revision_id), published)

    def test_student_cannot_edit_teacher_notebook(self):
        teacher_nb = self.teacher_client.post(
            f"/api/homework/submissions/{self.submission.pk}/notebooks/",
            {"task_id": "A", "owner_role": "teacher"},
            format="json",
        ).json()
        resp = self.student_client.put(
            f"/api/homework/notebooks/{teacher_nb['id']}/",
            {"version": teacher_nb["version"], "pages": teacher_nb["pages"]},
            format="json",
        )
        self.assertIn(resp.status_code, (403, 404))


class HomeworkAttachmentMigrationAndEndpointTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="mig_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="mig_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Петя",
            last_name="Ученик",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ миграция",
            status="assigned",
        )
        self.student_client = APIClient()
        self.student_client.force_login(self.student_user)

    def test_migrate_keeps_number_only_files(self):
        from Cabinet.homework_task_files import migrate_submission_payload_attachments

        submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            result_payload={
                "attachments_by_number": {
                    "1": [{"url": "/media/cabinet/homework/x.jpg", "filename": "x.jpg"}],
                }
            },
        )
        report = migrate_submission_payload_attachments(submission)
        self.assertEqual(report["created"], 1)
        self.assertEqual(report["ambiguous"], [])
        row = HomeworkAttachment.objects.get(submission=submission)
        self.assertEqual(row.original_filename, "x.jpg")
        self.assertEqual(row.task_key, "1")
        self.assertEqual(row.legacy_url, "/media/cabinet/homework/x.jpg")
        grouped = self.student_client.get(
            f"/api/homework/submissions/{submission.pk}/attachments/"
        ).json()
        self.assertEqual(grouped["tasks"]["1"]["student"][0]["filename"], "x.jpg")

    def test_migrate_keeps_long_filename_and_path(self):
        from Cabinet.homework_task_files import migrate_submission_payload_attachments

        long_name = ("решение_ученика_" * 6) + ".jpg"
        long_path = "/media/cabinet/homework/attachments/" + ("subdir/" * 8) + long_name
        submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            result_payload={
                "attachments_by_task_id": {
                    "101": [{"url": long_path, "filename": long_name, "content_type": "image/jpeg"}],
                }
            },
        )
        report = migrate_submission_payload_attachments(submission)
        self.assertEqual(report["created"], 1)
        row = HomeworkAttachment.objects.get(submission=submission)
        self.assertTrue(row.original_filename.endswith(".jpg"))
        self.assertLessEqual(len(row.original_filename), 512)
        self.assertLessEqual(len(row.legacy_url), 1024)
        self.assertEqual(row.task_key, "101")

    def test_migrate_dual_map_without_id_keeps_one_row(self):
        from Cabinet.homework_task_files import migrate_submission_payload_attachments

        entry = {"url": "/media/cabinet/homework/cat.jpg", "filename": "cat.jpg"}
        submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            result_payload={
                "attachments_by_task_id": {"101": [entry]},
                "attachments_by_number": {"1": [entry]},
            },
        )
        report = migrate_submission_payload_attachments(submission)
        self.assertEqual(report["created"], 1)
        row = HomeworkAttachment.objects.get(submission=submission)
        self.assertEqual(row.task_key, "101")
        self.assertEqual(row.original_filename, "cat.jpg")

    def test_migrate_remaining_json_after_partial_rows(self):
        from Cabinet.homework_task_files import ensure_payload_migrated

        submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            result_payload={
                "attachments_by_task_id": {
                    "A": [{"url": "/media/cabinet/homework/a.jpg", "filename": "a.jpg"}],
                },
                "attachments_by_number": {
                    "2": [{"url": "/media/cabinet/homework/b.jpg", "filename": "b.jpg"}],
                },
            },
        )
        HomeworkAttachment.objects.create(
            submission=submission,
            homework=self.homework,
            task_key="A",
            owner_role="student",
            original_filename="a.jpg",
            legacy_url="/media/cabinet/homework/a.jpg",
        )
        ensure_payload_migrated(submission)
        names = set(
            HomeworkAttachment.objects.filter(submission=submission, is_deleted=False)
            .values_list("original_filename", flat=True)
        )
        self.assertEqual(names, {"a.jpg", "b.jpg"})

    def test_normalized_upload_endpoint_binds_task(self):
        seed = self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "task_id": "A",
                "task_number": "1",
                "file": SimpleUploadedFile("cat.jpg", JPG_A, content_type="image/jpeg"),
            },
            format="multipart",
        )
        self.assertEqual(seed.status_code, 200, seed.content)
        submission = HomeworkSubmission.objects.get()
        self.assertEqual(seed.json()["submission_id"], submission.pk)
        resp = self.student_client.post(
            f"/api/homework/submissions/{submission.pk}/tasks/B/attachments/",
            {"file": SimpleUploadedFile("math.png", JPG_B, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["task_id"], "B")
        self.assertEqual(resp.json()["filename"], "math.png")
        grouped = self.student_client.get(
            f"/api/homework/submissions/{submission.pk}/attachments/"
        ).json()
        self.assertEqual(grouped["tasks"]["A"]["student"][0]["filename"], "cat.jpg")
        self.assertEqual(grouped["tasks"]["B"]["student"][0]["filename"], "math.png")

    def test_db_rows_match_api_after_reload(self):
        self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "task_id": "A",
                "task_number": "1",
                "file": SimpleUploadedFile("cat.jpg", JPG_A, content_type="image/jpeg"),
            },
            format="multipart",
        )
        self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "task_id": "B",
                "task_number": "2",
                "file": SimpleUploadedFile("math.png", JPG_B, content_type="image/png"),
            },
            format="multipart",
        )
        rows = list(
            HomeworkAttachment.objects.filter(is_deleted=False).order_by("task_key", "id")
        )
        table = [
            (str(row.id), row.submission_id, row.task_key, row.owner_role, row.original_filename)
            for row in rows
        ]
        self.assertEqual(
            [(item[2], item[3], item[4]) for item in table],
            [("A", "student", "cat.jpg"), ("B", "student", "math.png")],
        )
        submission = HomeworkSubmission.objects.get()
        detail = self.student_client.get(f"/api/homework/assignment/{self.homework.pk}/")
        tasks = (detail.json().get("task_attachments") or {}).get("tasks") or {}
        self.assertEqual(tasks["A"]["student"][0]["id"], table[0][0])
        self.assertEqual(tasks["B"]["student"][0]["id"], table[1][0])
        self.assertEqual(tasks["A"]["student"][0]["filename"], "cat.jpg")
        self.assertEqual(tasks["B"]["student"][0]["filename"], "math.png")
        grouped = self.student_client.get(
            f"/api/homework/submissions/{submission.pk}/attachments/"
        ).json()["tasks"]
        self.assertEqual(grouped["A"]["student"][0]["id"], table[0][0])
        self.assertEqual(grouped["B"]["student"][0]["id"], table[1][0])

    def test_delete_clears_stale_json_maps(self):
        created = self.student_client.post(
            f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
            {
                "task_id": "A",
                "task_number": "1",
                "file": SimpleUploadedFile("cat.jpg", JPG_A, content_type="image/jpeg"),
            },
            format="multipart",
        ).json()
        self.student_client.delete(f"/api/homework/attachments/{created['id']}/")
        detail = self.student_client.get(f"/api/homework/assignment/{self.homework.pk}/")
        tasks = (detail.json().get("task_attachments") or {}).get("tasks") or {}
        self.assertEqual(tasks.get("A", {}).get("student") or [], [])


class HomeworkSaveDraftConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="sv_conc_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="sv_conc_s", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Петя",
            last_name="Ученик",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ save+upload",
            status="assigned",
        )

    def test_parallel_save_draft_and_upload(self):
        def do_upload():
            client = APIClient()
            client.force_login(self.student_user)
            return client.post(
                f"/api/homework/assignment/{self.homework.pk}/upload-answer/",
                {
                    "task_id": "A",
                    "task_number": "1",
                    "file": SimpleUploadedFile("a.jpg", JPG_A, content_type="image/jpeg"),
                },
                format="multipart",
            ).status_code

        def do_save():
            client = APIClient()
            client.force_login(self.student_user)
            return client.post(
                f"/api/homework/assignment/{self.homework.pk}/save-draft/",
                {"result": {"by_task_id": {"A": "answer"}, "attachments_by_task_id": {"A": []}}},
                format="json",
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = list(pool.map(lambda fn: fn(), [do_upload, do_save]))
        self.assertEqual(sorted(codes), [200, 200])
        self.assertEqual(HomeworkAttachment.objects.filter(task_key="A", is_deleted=False).count(), 1)
        detail = APIClient()
        detail.force_login(self.student_user)
        tasks = (
            detail.get(f"/api/homework/assignment/{self.homework.pk}/").json().get("task_attachments") or {}
        ).get("tasks") or {}
        self.assertEqual(tasks["A"]["student"][0]["filename"], "a.jpg")

