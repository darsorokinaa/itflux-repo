"""Единый расчёт занятого хранилища пользователя."""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.files_models import CabinetFile, CabinetFileStatus
from Cabinet.files_services import FileServiceError, assert_quota_allows, calc_usage_bytes, get_quota_info, upload_file
from Cabinet.models import Material, MaterialType, Profile
from Cabinet.storage_usage import format_storage_bytes, format_used_of_limit, sync_recorded_sizes


class StorageUsageTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="storage_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

    def _auth(self):
        self.client.force_authenticate(user=self.teacher)

    def _upload(self, name, content, content_type="application/pdf"):
        self._auth()
        data = {"file": SimpleUploadedFile(name, content, content_type=content_type)}
        return self.client.post("/api/cabinet/files/upload/", data, format="multipart")

    def test_my_files_count_toward_quota(self):
        payload = b"%PDF-1.4 " + (b"a" * 2048)
        res = self._upload("notes.pdf", payload)
        self.assertEqual(res.status_code, 201, res.content)
        used = calc_usage_bytes(self.teacher)
        self.assertEqual(used, len(payload))
        quota = self.client.get("/api/cabinet/files/quota/")
        self.assertEqual(quota.status_code, 200)
        body = quota.json()
        self.assertEqual(body["storage_used_bytes"], len(payload))
        self.assertGreater(body["storage_limit_bytes"], 0)
        self.assertTrue(any(row["key"] == "documents" for row in body["breakdown"]))

    def test_same_physical_file_counted_once_when_attached_as_material(self):
        payload = b"%PDF-1.4 shared"
        res = self._upload("shared.pdf", payload)
        self.assertEqual(res.status_code, 201, res.content)
        file_id = res.json()["id"]
        attached = self.client.post(
            f"/api/cabinet/files/{file_id}/attach/",
            {"target_type": "material"},
            format="json",
        )
        self.assertEqual(attached.status_code, 201, attached.content)
        material = Material.objects.get(pk=attached.json()["material_id"])
        self.assertEqual(material.material_type, MaterialType.FILE)
        self.assertEqual(calc_usage_bytes(self.teacher), len(payload))
        self.assertEqual(CabinetFile.objects.filter(owner=self.teacher).count(), 1)

    def test_copy_creates_second_physical_file(self):
        payload = b"copy-me-please"
        res = self._upload("note.txt", payload, content_type="text/plain")
        self.assertEqual(res.status_code, 201, res.content)
        file_id = res.json()["id"]
        copied = self.client.post(f"/api/cabinet/files/{file_id}/copy/", {}, format="json")
        self.assertEqual(copied.status_code, 201, copied.content)
        self.assertEqual(calc_usage_bytes(self.teacher), len(payload) * 2)

    def test_trash_keeps_quota_purge_frees(self):
        payload = b"trash-and-purge"
        res = self._upload("tmp.txt", payload, content_type="text/plain")
        self.assertEqual(res.status_code, 201, res.content)
        file_id = res.json()["id"]
        self.client.post(f"/api/cabinet/files/{file_id}/trash/", {}, format="json")
        self.assertEqual(calc_usage_bytes(self.teacher), len(payload))
        self.client.delete(f"/api/cabinet/files/{file_id}/?force=1")
        self.assertEqual(calc_usage_bytes(self.teacher), 0)

    def test_zero_recorded_size_is_synced_from_storage(self):
        payload = b"needs-recalc-size"
        file_obj = upload_file(self.teacher, SimpleUploadedFile("old.txt", payload, content_type="text/plain"))
        CabinetFile.objects.filter(pk=file_obj.pk).update(size=0)
        file_obj.refresh_from_db()
        self.assertEqual(file_obj.size, 0)
        # Пока size=0, считаем фактический размер из storage.
        self.assertEqual(calc_usage_bytes(self.teacher), len(payload))
        stats = sync_recorded_sizes(user=self.teacher)
        self.assertGreaterEqual(stats["files"], 1)
        file_obj.refresh_from_db()
        self.assertEqual(file_obj.size, len(payload))

    @patch("Cabinet.storage_usage.storage_limit_bytes", return_value=50)
    def test_quota_blocks_before_upload_and_keeps_existing(self, _limit):
        first = b"ok"
        res = self._upload("a.txt", first, content_type="text/plain")
        self.assertEqual(res.status_code, 201, res.content)
        blocked = self._upload("b.txt", b"x" * 80, content_type="text/plain")
        self.assertEqual(blocked.status_code, 400)
        body = blocked.json()
        self.assertEqual(body.get("code"), "QUOTA_EXCEEDED")
        self.assertIn("Недостаточно места в хранилище", body.get("detail") or body.get("error") or "")
        self.assertEqual(body.get("storage_used_bytes"), len(first))
        self.assertEqual(body.get("storage_limit_bytes"), 50)
        self.assertEqual(CabinetFile.objects.filter(owner=self.teacher).count(), 1)

    @patch("Cabinet.storage_usage.storage_limit_bytes", return_value=100)
    def test_batch_second_file_blocked(self, _limit):
        first = self._upload("one.txt", b"a" * 60, content_type="text/plain")
        self.assertEqual(first.status_code, 201, first.content)
        second = self._upload("two.txt", b"b" * 60, content_type="text/plain")
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json().get("code"), "QUOTA_EXCEEDED")
        self.assertEqual(CabinetFile.objects.filter(owner=self.teacher).count(), 1)

    @patch("Cabinet.storage_usage.storage_limit_bytes", return_value=20)
    def test_downgrade_keeps_files_and_blocks_new_uploads(self, _limit):
        with patch("Cabinet.storage_usage.storage_limit_bytes", return_value=5 * 1024 * 1024):
            res = self._upload("keep.txt", b"x" * 40, content_type="text/plain")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(CabinetFile.objects.filter(owner=self.teacher, status=CabinetFileStatus.ACTIVE).count(), 1)
        blocked = self._upload("new.txt", b"nope", content_type="text/plain")
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.json().get("code"), "QUOTA_EXCEEDED")
        self.assertTrue(CabinetFile.objects.filter(owner=self.teacher).exists())

    def test_assert_quota_allows_uses_backend_check(self):
        with patch("Cabinet.storage_usage.storage_limit_bytes", return_value=10):
            with self.assertRaises(FileServiceError) as ctx:
                assert_quota_allows(self.teacher, 50)
        self.assertEqual(ctx.exception.code, "QUOTA_EXCEEDED")

    def test_format_storage_bytes(self):
        self.assertEqual(format_storage_bytes(284 * 1024 * 1024), "284 МБ")
        self.assertEqual(format_used_of_limit(int(4.8 * 1024 * 1024 * 1024), 5 * 1024 * 1024 * 1024), "4,8 из 5 ГБ")

    def test_quota_info_over_limit_flag(self):
        upload_file(self.teacher, SimpleUploadedFile("big.txt", b"hello-world", content_type="text/plain"))
        with patch("Cabinet.storage_usage.storage_limit_bytes", return_value=1):
            info = get_quota_info(self.teacher)
        self.assertTrue(info["over_limit"])
        self.assertGreater(info["storage_used_bytes"], info["storage_limit_bytes"])
        self.assertIn("storage_used_bytes", info)
        self.assertIn("storage_limit_bytes", info)

    def test_failed_upload_does_not_leave_usage(self):
        with patch("Cabinet.storage_usage.storage_limit_bytes", return_value=10):
            res = self._upload("too-big.txt", b"0123456789abcdef", content_type="text/plain")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(calc_usage_bytes(self.teacher), 0)
        self.assertFalse(CabinetFile.objects.filter(owner=self.teacher).exists())
