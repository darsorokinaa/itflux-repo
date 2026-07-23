"""Тесты API «Мои файлы»."""

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.files_models import (
    CabinetFile,
    CabinetFileRelation,
    CabinetFileRelationType,
    CabinetFileStatus,
    CabinetFolder,
)
from Cabinet.files_services import assert_no_folder_cycle, FileServiceError
from Cabinet.models import Homework, Lesson, LessonPlan, LessonPlanItem, Material, Profile, Student


class MyFilesApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="files_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other = User.objects.create_user(username="files_other", password="pass")
        self.other.profile.role = Profile.Role.TEACHER
        self.other.profile.save()

        self.student_user = User.objects.create_user(
            username="files_student", password="pass", email="fs@test.ru"
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.other_student_user = User.objects.create_user(
            username="files_student2", password="pass", email="fs2@test.ru"
        )
        self.other_student_user.profile.role = Profile.Role.STUDENT
        self.other_student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Ученица",
            status="active",
        )
        self.other_student = Student.objects.create(
            teacher=self.teacher,
            user=self.other_student_user,
            first_name="Борис",
            last_name="Другой",
            status="active",
        )
        self.lesson = Lesson.objects.create(teacher=self.teacher, title="Урок файлов")
        self.plan = LessonPlan.objects.create(teacher=self.teacher, title="План")
        self.plan_item = LessonPlanItem.objects.create(plan=self.plan, title="Пункт 1", order=1)

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    def _upload(self, user, name="note.txt", content=b"hello files", folder_id=None):
        self._auth(user)
        data = {"file": SimpleUploadedFile(name, content, content_type="text/plain")}
        if folder_id:
            data["folder_id"] = str(folder_id)
        return self.client.post("/api/cabinet/files/upload/", data, format="multipart")

    def test_teacher_uploads_and_lists_own_file(self):
        res = self._upload(self.teacher)
        self.assertEqual(res.status_code, 201, res.content)
        file_id = res.json()["id"]
        self._auth(self.teacher)
        listing = self.client.get("/api/cabinet/files/")
        self.assertEqual(listing.status_code, 200)
        ids = [i["id"] for i in listing.json()["items"] if i["kind"] == "file"]
        self.assertIn(file_id, ids)

    def test_other_teacher_cannot_see_or_download(self):
        res = self._upload(self.teacher)
        file_id = res.json()["id"]
        self._auth(self.other)
        listing = self.client.get("/api/cabinet/files/")
        ids = [i["id"] for i in listing.json()["items"] if i["kind"] == "file"]
        self.assertNotIn(file_id, ids)
        denied = self.client.get(f"/api/cabinet/files/{file_id}/download/")
        self.assertEqual(denied.status_code, 403)

    def test_cannot_move_foreign_file(self):
        res = self._upload(self.teacher)
        file_id = res.json()["id"]
        self._auth(self.other)
        moved = self.client.post(
            "/api/cabinet/files/move/",
            {"ids": [file_id], "folder_id": None},
            format="json",
        )
        self.assertEqual(moved.status_code, 403)

    def test_folder_cycle_forbidden(self):
        self._auth(self.teacher)
        a = self.client.post("/api/cabinet/files/folders/", {"name": "A"}, format="json")
        self.assertEqual(a.status_code, 201)
        a_id = a.json()["id"]
        b = self.client.post(
            "/api/cabinet/files/folders/",
            {"name": "B", "parent_id": a_id},
            format="json",
        )
        self.assertEqual(b.status_code, 201)
        b_id = b.json()["id"]
        folder_a = CabinetFolder.objects.get(pk=a_id)
        folder_b = CabinetFolder.objects.get(pk=b_id)
        with self.assertRaises(FileServiceError):
            assert_no_folder_cycle(folder_a, folder_b)
        bad = self.client.patch(
            f"/api/cabinet/files/folders/{a_id}/",
            {"parent_id": b_id},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json().get("code"), "FOLDER_CYCLE")

    def test_trash_hides_from_list_and_restore_works(self):
        res = self._upload(self.teacher)
        file_id = res.json()["id"]
        self._auth(self.teacher)
        trash = self.client.post(f"/api/cabinet/files/{file_id}/trash/", {}, format="json")
        self.assertEqual(trash.status_code, 200)
        listing = self.client.get("/api/cabinet/files/")
        ids = [i["id"] for i in listing.json()["items"] if i["kind"] == "file"]
        self.assertNotIn(file_id, ids)
        trash_list = self.client.get("/api/cabinet/files/?section=trash")
        trash_ids = [i["id"] for i in trash_list.json()["items"] if i["kind"] == "file"]
        self.assertIn(file_id, trash_ids)
        restored = self.client.post(f"/api/cabinet/files/{file_id}/restore/", {}, format="json")
        self.assertEqual(restored.status_code, 200)
        listing2 = self.client.get("/api/cabinet/files/")
        ids2 = [i["id"] for i in listing2.json()["items"] if i["kind"] == "file"]
        self.assertIn(file_id, ids2)

    @override_settings(CABINET_FILE_STORAGE_QUOTA_BYTES=50)
    def test_quota_blocks_upload(self):
        res = self._upload(self.teacher, content=b"x" * 80)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get("code"), "QUOTA_EXCEEDED")

    def test_attach_file_as_material_without_target_id(self):
        """Добавление на урок через «Файлы»: target_type=material, target_id не нужен."""
        res = self._upload(self.teacher, name="lesson-file.png", content=b"\x89PNG\r\n")
        self.assertEqual(res.status_code, 201, res.content)
        file_id = res.json()["id"]
        self._auth(self.teacher)
        attached = self.client.post(
            f"/api/cabinet/files/{file_id}/attach/",
            {"target_type": "material"},
            format="json",
        )
        self.assertEqual(attached.status_code, 201, attached.content)
        body = attached.json()
        self.assertTrue(body.get("material_id"))
        self.assertEqual(body.get("material", {}).get("cabinet_file_id"), str(file_id))
        material = Material.objects.get(pk=body["material_id"])
        self.assertEqual(str(material.cabinet_file_id), str(file_id))

    def test_attach_same_file_to_two_plan_items_no_extra_copy(self):
        res = self._upload(self.teacher, name="shared.pdf", content=b"%PDF-1.4 test")
        self.assertEqual(res.status_code, 201, res.content)
        file_id = res.json()["id"]
        storage_key = CabinetFile.objects.get(pk=file_id).storage_key
        self._auth(self.teacher)
        item2 = LessonPlanItem.objects.create(plan=self.plan, title="Пункт 2", order=2)
        a1 = self.client.post(
            f"/api/cabinet/files/{file_id}/attach/",
            {"target_type": "plan_item", "target_id": self.plan_item.id},
            format="json",
        )
        a2 = self.client.post(
            f"/api/cabinet/files/{file_id}/attach/",
            {"target_type": "plan_item", "target_id": item2.id},
            format="json",
        )
        self.assertEqual(a1.status_code, 201, a1.content)
        self.assertEqual(a2.status_code, 201, a2.content)
        self.assertEqual(a1.json()["material_id"], a2.json()["material_id"])
        material = Material.objects.get(pk=a1.json()["material_id"])
        self.assertEqual(material.cabinet_file_id, CabinetFile.objects.get(pk=file_id).id)
        self.assertEqual(material.file.name, storage_key)
        self.assertEqual(CabinetFile.objects.filter(owner=self.teacher).count(), 1)
        self.assertEqual(
            CabinetFileRelation.objects.filter(
                file_id=file_id, relation_type=CabinetFileRelationType.PLAN_ITEM
            ).count(),
            2,
        )

    def test_purge_linked_file_warns(self):
        res = self._upload(self.teacher)
        file_id = res.json()["id"]
        self._auth(self.teacher)
        self.client.post(
            f"/api/cabinet/files/{file_id}/attach/",
            {"target_type": "lesson", "target_id": self.lesson.id},
            format="json",
        )
        purge = self.client.delete(f"/api/cabinet/files/{file_id}/")
        self.assertEqual(purge.status_code, 409)
        self.assertEqual(purge.json().get("code"), "FILE_IN_USE")
        self.assertTrue(purge.json().get("relations"))
        force = self.client.delete(f"/api/cabinet/files/{file_id}/?force=true")
        self.assertEqual(force.status_code, 200)
        self.assertFalse(CabinetFile.objects.filter(pk=file_id).exists())

    def test_student_cannot_see_other_student_files(self):
        self._auth(self.student_user)
        up = self.client.post(
            "/api/cabinet/student/files/upload/",
            {"file": SimpleUploadedFile("mine.txt", b"student-a", content_type="text/plain")},
            format="multipart",
        )
        self.assertEqual(up.status_code, 201, up.content)
        file_id = up.json()["id"]

        self._auth(self.other_student_user)
        listing = self.client.get("/api/cabinet/student/files/")
        ids = [i["id"] for i in listing.json()["items"] if i["kind"] == "file"]
        self.assertNotIn(file_id, ids)
        denied = self.client.get(f"/api/cabinet/student/files/{file_id}/download/")
        self.assertEqual(denied.status_code, 403)

    def test_teacher_sees_student_submission_file_via_relation(self):
        hw = Homework.objects.create(
            teacher=self.teacher,
            title="ДЗ файл",
            student=self.student,
        )
        self._auth(self.student_user)
        up = self.client.post(
            "/api/cabinet/student/files/upload/",
            {"file": SimpleUploadedFile("work.txt", b"answer", content_type="text/plain")},
            format="multipart",
        )
        self.assertEqual(up.status_code, 201, up.content)
        file_id = up.json()["id"]
        from Cabinet.models import HomeworkSubmission
        from Cabinet.files_services import attach_file_for_student

        submission = HomeworkSubmission.objects.create(homework=hw, student=self.student)
        attach_file_for_student(self.student_user, file_id, submission)

        self._auth(self.teacher)
        download = self.client.get(f"/api/cabinet/files/{file_id}/download/")
        self.assertEqual(download.status_code, 200)

    def test_download_uses_renamed_display_name(self):
        res = self._upload(self.teacher, name="source.txt", content=b"data")
        file_id = res.json()["id"]
        self._auth(self.teacher)
        renamed = self.client.patch(
            f"/api/cabinet/files/{file_id}/",
            {"display_name": "Домашка к уроку"},
            format="json",
        )
        self.assertEqual(renamed.status_code, 200, renamed.content)
        self.assertEqual(renamed.json()["display_name"], "Домашка к уроку.txt")
        download = self.client.get(f"/api/cabinet/files/{file_id}/download/")
        self.assertEqual(download.status_code, 200)
        cd = download["Content-Disposition"]
        self.assertIn("filename*=UTF-8''", cd)
        self.assertIn("%D0%94%D0%BE%D0%BC%D0%B0%D1%88%D0%BA%D0%B0", cd)  # Домашка
        self.assertNotIn("source.txt", cd)

    def test_assign_file_as_material_to_student(self):
        res = self._upload(self.teacher, name="give.txt", content=b"material")
        file_id = res.json()["id"]
        self._auth(self.teacher)
        assigned = self.client.post(
            f"/api/cabinet/files/{file_id}/assign/",
            {"mode": "material", "student_id": self.student.id, "message": "Вот файл"},
            format="json",
        )
        self.assertEqual(assigned.status_code, 201, assigned.content)
        self.assertEqual(assigned.json()["mode"], "material")
        self.assertTrue(assigned.json()["assignments"])
        from Cabinet.models import DirectMaterialAssignment
        self.assertTrue(
            DirectMaterialAssignment.objects.filter(
                teacher=self.teacher,
                student=self.student,
                material_id=assigned.json()["material_id"],
            ).exists()
        )

    def test_trashed_file_status(self):
        res = self._upload(self.teacher)
        file_id = res.json()["id"]
        self._auth(self.teacher)
        self.client.post(f"/api/cabinet/files/{file_id}/trash/", {}, format="json")
        obj = CabinetFile.objects.get(pk=file_id)
        self.assertEqual(obj.status, CabinetFileStatus.TRASHED)
        self.assertIsNotNone(obj.deleted_at)
