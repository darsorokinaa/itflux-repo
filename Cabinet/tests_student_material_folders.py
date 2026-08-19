"""Nested student material folders: create, move, cycle protection, ACL."""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.choices import MaterialStatus, StudentStatus
from Cabinet.models import DirectMaterialAssignment, Material, Profile, Student


class StudentMaterialFolderNestedTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="fold_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])

        self.other_teacher = User.objects.create_user(username="fold_teacher2", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save(update_fields=["role"])

        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Аня",
            last_name="Ученица",
            status=StudentStatus.ACTIVE,
        )
        self.material = Material.objects.create(
            teacher=self.teacher,
            title="Конспект",
            material_type="link",
            status=MaterialStatus.PUBLISHED,
            external_url="https://example.com/notes",
        )
        DirectMaterialAssignment.objects.create(
            teacher=self.teacher,
            material=self.material,
            student=self.student,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.teacher)
        self.base = f"/api/cabinet/students/{self.student.id}/material-folders"

    def _create_folder(self, name, *, parent_id=None):
        payload = {"name": name}
        if parent_id is not None:
            payload["parent_id"] = parent_id
        resp = self.client.post(self.base + "/", payload, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()["id"]

    def test_create_root_and_nested_folder(self):
        root_id = self._create_folder("ОГЭ")
        nested_id = self._create_folder("Информатика", parent_id=root_id)
        listed = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        self.assertEqual(listed.status_code, 200)
        folders = listed.json()["folders"]
        by_id = {f["id"]: f for f in folders}
        self.assertIsNone(by_id[root_id]["parent_id"])
        self.assertEqual(by_id[nested_id]["parent_id"], root_id)

    def test_deep_nesting_five_levels(self):
        parent = None
        ids = []
        for i in range(5):
            parent = self._create_folder(f"Уровень {i + 1}", parent_id=parent)
            ids.append(parent)
        listed = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        folders = listed.json()["folders"]
        by_id = {f["id"]: f for f in folders}
        self.assertEqual(by_id[ids[-1]]["parent_id"], ids[-2])

    def test_same_name_in_different_parents_allowed(self):
        a = self._create_folder("Теория")
        b = self._create_folder("ЕГЭ")
        self._create_folder("Теория", parent_id=a)
        resp = self.client.post(self.base + "/", {"name": "Теория", "parent_id": b}, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_duplicate_name_in_same_parent_rejected(self):
        root = self._create_folder("ОГЭ")
        clash = self.client.post(
            self.base + "/",
            {"name": "ОГЭ", "parent_id": None},
            format="json",
        )
        self.assertEqual(clash.status_code, 400)
        nested_clash = self.client.post(
            self.base + "/",
            {"name": "Пробники", "parent_id": root},
            format="json",
        )
        self.assertEqual(nested_clash.status_code, 201)
        nested_clash2 = self.client.post(
            self.base + "/",
            {"name": "Пробники", "parent_id": root},
            format="json",
        )
        self.assertEqual(nested_clash2.status_code, 400)

    def test_move_file_into_nested_folder(self):
        root = self._create_folder("ОГЭ")
        nested = self._create_folder("Пробники", parent_id=root)
        moved = self.client.post(
            f"/api/cabinet/students/{self.student.id}/material-placements/",
            {"keys": [str(self.material.id)], "folder_id": nested},
            format="json",
        )
        self.assertEqual(moved.status_code, 200)
        listed = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        row = next(it for it in listed.json()["items"] if it["id"] == self.material.id)
        self.assertEqual(row["folder_id"], nested)

    def test_move_folder_into_subfolder(self):
        a = self._create_folder("A")
        b = self._create_folder("B", parent_id=a)
        resp = self.client.patch(
            f"{self.base}/{a}/",
            {"parent_id": b},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get("code"), "FOLDER_CYCLE")

    def test_move_folder_into_self_rejected(self):
        a = self._create_folder("A")
        resp = self.client.patch(
            f"{self.base}/{a}/",
            {"parent_id": a},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get("code"), "FOLDER_CYCLE")

    def test_other_teacher_cannot_use_foreign_folder_as_parent(self):
        other_student = Student.objects.create(
            teacher=self.other_teacher,
            first_name="Петя",
            last_name="Чужой",
            status=StudentStatus.ACTIVE,
        )
        self.client.force_authenticate(user=self.other_teacher)
        foreign_resp = self.client.post(
            f"/api/cabinet/students/{other_student.id}/material-folders/",
            {"name": "Чужая"},
            format="json",
        )
        self.assertEqual(foreign_resp.status_code, 201, foreign_resp.content)
        foreign_folder = foreign_resp.json()["id"]
        self.client.force_authenticate(user=self.teacher)
        resp = self.client.post(
            self.base + "/",
            {"name": "Взлом", "parent_id": foreign_folder},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)

    def test_delete_parent_cascades_subfolders_materials_remain(self):
        root = self._create_folder("ОГЭ")
        nested = self._create_folder("Пробники", parent_id=root)
        self.client.post(
            f"/api/cabinet/students/{self.student.id}/material-placements/",
            {"keys": [str(self.material.id)], "folder_id": nested},
            format="json",
        )
        deleted = self.client.delete(f"{self.base}/{root}/")
        self.assertEqual(deleted.status_code, 204)
        listed = self.client.get(f"/api/cabinet/students/{self.student.id}/materials/")
        items = listed.json()["items"]
        row = next(it for it in items if it["id"] == self.material.id)
        self.assertIsNone(row["folder_id"])
        self.assertIn(self.material.id, [it["id"] for it in items])
