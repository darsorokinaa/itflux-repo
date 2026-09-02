"""Тесты API интерактивных досок."""

import base64
import io

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.models import (
    InteractiveBoard,
    InteractiveBoardAccess,
    InteractiveBoardAsset,
    Lesson,
    Profile,
    ScheduleEvent,
    Student,
    StudentGroup,
    empty_board_scene,
)

# Минимальные валидные сигнатуры растров
MINI_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)
class InteractiveBoardApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="board_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other_teacher = User.objects.create_user(username="board_other", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()

        self.student_user = User.objects.create_user(
            username="board_student", password="pass", email="bs@test.ru"
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Ученица",
            status="active",
        )
        self.group = StudentGroup.objects.create(
            teacher=self.teacher,
            title="Группа досок",
            status="active",
        )
        self.group.students.add(self.student)
        self.lesson = Lesson.objects.create(
            teacher=self.teacher,
            title="Урок по алгоритмам",
        )

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    def test_teacher_can_create_board(self):
        self._auth(self.teacher)
        res = self.client.post(
            "/api/cabinet/interactive-boards/",
            {
                "title": "Моя доска",
                "description": "Описание",
                "group_id": self.group.pk,
                "student_id": self.student.pk,
                "lesson_id": self.lesson.pk,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual(data["title"], "Моя доска")
        self.assertEqual(data["group"], self.group.pk)
        self.assertEqual(data["student"], self.student.pk)
        self.assertEqual(data["lesson"], self.lesson.pk)
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["scene_data"]["elements"], [])
        board = InteractiveBoard.objects.get(pk=data["id"])
        self.assertEqual(board.owner_id, self.teacher.id)
        self.assertTrue(data.get("collaborative_edit"))
        self.assertTrue(
            InteractiveBoardAccess.objects.filter(
                board=board, user=self.student_user, permission="edit"
            ).exists()
        )

        self._auth(self.student_user)
        res_student = self.client.get(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(res_student.status_code, 200, res_student.content)
        self.assertTrue(res_student.json()["can_edit"])
        self.assertTrue(res_student.json().get("collaborative_edit"))

    def test_default_title(self):
        self._auth(self.teacher)
        res = self.client.post("/api/cabinet/interactive-boards/", {}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["title"], "Новая доска")

    def test_create_board_uses_lesson_title(self):
        self._auth(self.teacher)
        res = self.client.post(
            "/api/cabinet/interactive-boards/",
            {"lesson_id": self.lesson.pk},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["title"], "Урок по алгоритмам")
        self.assertEqual(res.json()["lesson"], self.lesson.pk)

    def test_create_board_keeps_custom_title_with_lesson(self):
        self._auth(self.teacher)
        res = self.client.post(
            "/api/cabinet/interactive-boards/",
            {"title": "Черновик схем", "lesson_id": self.lesson.pk},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.json()["title"], "Черновик схем")

    def test_create_board_uses_schedule_event_topic(self):
        starts = timezone.now()
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Анна Ученица",
            topic="Бинарный поиск",
            starts_at=starts,
            ends_at=starts + timedelta(hours=1),
            student=self.student,
            lesson=self.lesson,
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            status=ScheduleEvent.Status.PLANNED,
        )
        self._auth(self.teacher)
        res = self.client.post(
            "/api/cabinet/interactive-boards/",
            {"schedule_event_id": event.pk},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual(data["title"], "Бинарный поиск")
        self.assertEqual(data["schedule_event"], event.pk)
        self.assertEqual(data["lesson"], self.lesson.pk)

    def test_owner_can_retrieve_board(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="T")
        self._auth(self.teacher)
        res = self.client.get(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["id"], str(board.id))
        self.assertTrue(res.json()["can_edit"])

    def test_other_teacher_cannot_access_board(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Secret")
        self._auth(self.other_teacher)
        res = self.client.get(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(res.status_code, 404)

    def test_save_scene_and_version_bump(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Scene")
        self._auth(self.teacher)
        scene = {
            "elements": [{"id": "e1", "type": "rectangle", "x": 0, "y": 0}],
            "appState": {"viewBackgroundColor": "#fff", "selectedElementIds": {"e1": True}},
            "files": {},
        }
        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {"scene_data": scene, "version": 1},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertEqual(data["version"], 2)
        self.assertNotIn("scene_data", data)
        board.refresh_from_db()
        self.assertEqual(len(board.scene_data["elements"]), 1)
        self.assertNotIn("selectedElementIds", board.scene_data.get("appState") or {})

    def test_scene_patch_returns_lightweight_response(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="LitePatch")
        old_version = board.version
        self._auth(self.teacher)
        scene = {
            "elements": [{"id": "e1", "type": "rectangle", "x": 1, "y": 2}],
            "appState": {"viewBackgroundColor": "#fff"},
            "files": {},
        }
        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {"scene_data": scene, "version": old_version},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        data = res.json()
        self.assertNotIn("scene_data", data)
        self.assertEqual(data["version"], old_version + 1)
        self.assertEqual(data["id"], str(board.id))
        self.assertIn("updated_at", data)
        self.assertIn("permission", data)
        self.assertTrue(data["can_edit"])
        self.assertTrue(data["can_manage"])

        board.refresh_from_db()
        self.assertEqual(board.version, old_version + 1)
        self.assertEqual(len(board.scene_data["elements"]), 1)

        detail = self.client.get(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(detail.status_code, 200)
        self.assertIn("scene_data", detail.json())
        self.assertEqual(len(detail.json()["scene_data"]["elements"]), 1)

    def test_version_conflict(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Conflict", version=3)
        self._auth(self.teacher)
        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {
                "scene_data": empty_board_scene(),
                "version": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["code"], "VERSION_CONFLICT")

    def test_view_permission_readonly(self):
        # Явный view без привязки student FK — только просмотр.
        board = InteractiveBoard.objects.create(owner=self.teacher, title="View")
        InteractiveBoardAccess.objects.create(
            board=board, user=self.student_user, permission=InteractiveBoardAccess.VIEW
        )
        self._auth(self.student_user)
        res = self.client.get(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["can_edit"])

        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {"scene_data": empty_board_scene(), "version": 1},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_linked_student_can_collaboratively_edit(self):
        board = InteractiveBoard.objects.create(
            owner=self.teacher,
            title="Collab",
            student=self.student,
        )
        InteractiveBoardAccess.objects.create(
            board=board, user=self.student_user, permission=InteractiveBoardAccess.VIEW
        )
        self._auth(self.student_user)
        res = self.client.get(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["can_edit"])
        self.assertTrue(res.json()["collaborative_edit"])

        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {
                "scene_data": {
                    "elements": [{"id": "c1", "type": "rectangle"}],
                    "appState": {},
                    "files": {},
                },
                "version": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["version"], 2)

    def test_edit_permission_can_save_scene(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Edit")
        InteractiveBoardAccess.objects.create(
            board=board, user=self.student_user, permission=InteractiveBoardAccess.EDIT
        )
        self._auth(self.student_user)
        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {
                "scene_data": {
                    "elements": [{"id": "a", "type": "ellipse"}],
                    "appState": {},
                    "files": {},
                },
                "version": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["version"], 2)

    def test_editor_cannot_delete(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="NoDel")
        InteractiveBoardAccess.objects.create(
            board=board, user=self.student_user, permission=InteractiveBoardAccess.EDIT
        )
        self._auth(self.student_user)
        res = self.client.delete(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(res.status_code, 403)
        self.assertTrue(InteractiveBoard.objects.filter(pk=board.id).exists())

    def test_duplicate(self):
        board = InteractiveBoard.objects.create(
            owner=self.teacher,
            title="Оригинал",
            scene_data={
                "elements": [{"id": "1", "type": "text"}],
                "appState": {},
                "files": {},
            },
        )
        self._auth(self.teacher)
        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/duplicate/",
            {"student_id": self.student.pk},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertNotEqual(data["id"], str(board.id))
        self.assertIn("копия", data["title"])
        self.assertEqual(data["student"], self.student.pk)
        self.assertEqual(data["version"], 1)

    def test_delete_owner(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Del")
        self._auth(self.teacher)
        res = self.client.delete(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(InteractiveBoard.objects.filter(pk=board.id).exists())

    def test_scene_size_limit(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Big")
        self._auth(self.teacher)
        huge = "x" * (16 * 1024 * 1024)
        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {
                "scene_data": {
                    "elements": [],
                    "appState": {"note": huge},
                    "files": {},
                },
                "version": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get("code"), "SCENE_TOO_LARGE")

    def test_compact_scene_strips_deleted_geometry_keeps_live(self):
        from Cabinet.boards_api import compact_scene_data

        live = {
            "id": "live-1",
            "type": "freedraw",
            "isDeleted": False,
            "version": 2,
            "points": [[0, 0], [1, 1], [2, 2]],
        }
        deleted = {
            "id": "del-1",
            "type": "freedraw",
            "isDeleted": True,
            "version": 5,
            "versionNonce": 9,
            "updated": 11,
            "customData": {"itfluxOwnerId": 1, "itfluxOwnership": "teacher"},
            "points": [[i, i] for i in range(400)],
            "pressures": [0.5] * 400,
        }
        scene = {
            "elements": [live, deleted],
            "appState": {"viewBackgroundColor": "#fff"},
            "files": {
                "used": {"dataURL": "/api/cabinet/interactive-boards/x/assets/a/"},
                "orphan": {"dataURL": "data:image/png;base64," + ("A" * 1000)},
            },
        }
        scene["elements"].append(
            {"id": "img-1", "type": "image", "fileId": "used", "isDeleted": False, "version": 1}
        )
        compacted, changed = compact_scene_data(scene)
        self.assertTrue(changed)
        live_out = next(el for el in compacted["elements"] if el["id"] == "live-1")
        del_out = next(el for el in compacted["elements"] if el["id"] == "del-1")
        self.assertEqual(live_out["points"], [[0, 0], [1, 1], [2, 2]])
        self.assertEqual(del_out["points"], [[0, 0]])
        self.assertEqual(del_out["pressures"], [0.5])
        self.assertEqual(del_out["version"], 5)
        self.assertEqual(del_out["customData"]["itfluxOwnerId"], 1)
        self.assertIn("used", compacted["files"])
        self.assertNotIn("orphan", compacted["files"])

        again, changed_again = compact_scene_data(compacted)
        self.assertFalse(changed_again)
        self.assertEqual(again["elements"][1]["points"], [[0, 0]])

    def test_patch_compacts_deleted_geometry(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Compact")
        self._auth(self.teacher)
        live_points = [[0, 0], [4, 5], [8, 1]]
        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {
                "scene_data": {
                    "elements": [
                        {
                            "id": "keep",
                            "type": "freedraw",
                            "isDeleted": False,
                            "version": 1,
                            "points": live_points,
                        },
                        {
                            "id": "gone",
                            "type": "freedraw",
                            "isDeleted": True,
                            "version": 3,
                            "points": [[i, i] for i in range(80)],
                        },
                    ],
                    "appState": {},
                    "files": {},
                },
                "version": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        board.refresh_from_db()
        els = {el["id"]: el for el in board.scene_data["elements"]}
        self.assertEqual(els["keep"]["points"], live_points)
        self.assertTrue(els["gone"]["isDeleted"])
        self.assertEqual(els["gone"]["points"], [[0, 0]])
        self.assertEqual(els["gone"]["version"], 3)

    def test_unauthenticated_rejected(self):
        res = self.client.get("/api/cabinet/interactive-boards/")
        self.assertIn(res.status_code, (401, 403))

    def test_clear_requires_version(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Clear")
        self._auth(self.teacher)
        res = self.client.post(f"/api/cabinet/interactive-boards/{board.id}/clear/", {}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get("code"), "VERSION_REQUIRED")

        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/clear/",
            {"version": 1},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["version"], 2)

    def test_clear_version_conflict(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="ClearC", version=2)
        self._auth(self.teacher)
        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/clear/",
            {"version": 1},
            format="json",
        )
        self.assertEqual(res.status_code, 409)

    def test_svg_upload_rejected(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Img")
        self._auth(self.teacher)
        svg = SimpleUploadedFile(
            "evil.svg",
            b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            content_type="image/svg+xml",
        )
        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/upload-image/",
            {"file": svg},
            format="multipart",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get("code"), "FILE_TYPE_NOT_ALLOWED")

    def test_png_upload_and_protected_asset(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="ImgOk")
        self._auth(self.teacher)
        png = SimpleUploadedFile("dot.png", MINI_PNG, content_type="image/png")
        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/upload-image/",
            {"file": png},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertTrue(data["dataURL"].startswith("/api/cabinet/interactive-boards/"))
        self.assertIn("/assets/", data["dataURL"])

        asset = InteractiveBoardAsset.objects.get(board=board)
        # Публичный media закрыт
        if asset.file:
            media_res = self.client.get(f"/media/{asset.file.name}")
            self.assertEqual(media_res.status_code, 403)

        # Авторизованное скачивание
        dl = self.client.get(
            f"/api/cabinet/interactive-boards/{board.id}/assets/{asset.id}/"
        )
        self.assertEqual(dl.status_code, 200)
        self.assertEqual(dl["Content-Type"], "image/png")

        # Чужой учитель — 404
        self._auth(self.other_teacher)
        denied = self.client.get(
            f"/api/cabinet/interactive-boards/{board.id}/assets/{asset.id}/"
        )
        self.assertEqual(denied.status_code, 404)

    def test_pdf_upload_and_protected_asset(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="PdfOk")
        self._auth(self.teacher)
        pdf = SimpleUploadedFile(
            "konspekt.pdf",
            b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
            content_type="application/pdf",
        )
        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/upload-file/",
            {"file": pdf},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.content)
        data = res.json()
        self.assertEqual(data["mimeType"], "application/pdf")
        self.assertTrue(data["dataURL"].startswith("/api/cabinet/interactive-boards/"))
        self.assertEqual(data["originalName"], "konspekt.pdf")

        asset = InteractiveBoardAsset.objects.get(pk=data["asset_id"])
        self.assertEqual(asset.mime_type, "application/pdf")
        dl = self.client.get(
            f"/api/cabinet/interactive-boards/{board.id}/assets/{asset.id}/"
        )
        self.assertEqual(dl.status_code, 200)
        self.assertEqual(dl["Content-Type"], "application/pdf")

    def test_pdf_upload_accepts_pdf_with_generic_content_type(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="PdfOctet")
        self._auth(self.teacher)
        pdf = SimpleUploadedFile(
            "konspekt.bin",
            b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
            content_type="image/png",
        )
        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/upload-file/",
            {"file": pdf},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.content)

    def test_pdf_upload_rejects_non_pdf(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="PdfBad")
        self._auth(self.teacher)
        png = SimpleUploadedFile("dot.png", MINI_PNG, content_type="image/png")
        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/upload-file/",
            {"file": png},
            format="multipart",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json().get("code"), "FILE_TYPE_NOT_ALLOWED")

    def test_pdf_upload_requires_edit(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="PdfDeny")
        self._auth(self.other_teacher)
        pdf = SimpleUploadedFile("x.pdf", b"%PDF-1.4\n%%EOF\n", content_type="application/pdf")
        res = self.client.post(
            f"/api/cabinet/interactive-boards/{board.id}/upload-file/",
            {"file": pdf},
            format="multipart",
        )
        self.assertIn(res.status_code, (403, 404))

    def test_svg_dataurl_in_scene_rejected(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="SvgScene")
        self._auth(self.teacher)
        svg_b64 = base64.b64encode(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").decode()
        res = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            {
                "scene_data": {
                    "elements": [
                        {"id": "img1", "type": "image", "fileId": "f1", "isDeleted": False, "version": 1}
                    ],
                    "appState": {},
                    "files": {
                        "f1": {
                            "mimeType": "image/svg+xml",
                            "dataURL": f"data:image/svg+xml;base64,{svg_b64}",
                        }
                    },
                },
                "version": 1,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_access_replace_default(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Access")
        InteractiveBoardAccess.objects.create(
            board=board, user=self.student_user, permission=InteractiveBoardAccess.VIEW
        )
        other_user = User.objects.create_user(username="board_s2", password="pass", email="s2@t.ru")
        other_user.profile.role = Profile.Role.STUDENT
        other_user.profile.save()
        other_student = Student.objects.create(
            teacher=self.teacher,
            user=other_user,
            first_name="Борис",
            last_name="Второй",
            status="active",
        )
        self._auth(self.teacher)
        res = self.client.put(
            f"/api/cabinet/interactive-boards/{board.id}/access/",
            {
                "access": [
                    {"student_id": other_student.pk, "permission": "view"},
                ],
                "allow_export": False,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(
            InteractiveBoardAccess.objects.filter(board=board, user=self.student_user).exists()
        )
        self.assertTrue(
            InteractiveBoardAccess.objects.filter(board=board, user=other_user).exists()
        )
        board.refresh_from_db()
        self.assertFalse(board.allow_export)

    def test_archived_hidden_from_list(self):
        active = InteractiveBoard.objects.create(owner=self.teacher, title="Active")
        archived = InteractiveBoard.objects.create(
            owner=self.teacher, title="Archived", is_archived=True
        )
        self._auth(self.teacher)
        res = self.client.get("/api/cabinet/interactive-boards/")
        self.assertEqual(res.status_code, 200)
        payload = res.json()
        items = payload.get("results", payload) if isinstance(payload, dict) else payload
        ids = {item["id"] for item in items}
        self.assertIn(str(active.id), ids)
        self.assertNotIn(str(archived.id), ids)
        # Detail архивной доски доступен
        detail = self.client.get(f"/api/cabinet/interactive-boards/{archived.id}/")
        self.assertEqual(detail.status_code, 200)

    def test_student_boards_list(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="ForStudent")
        InteractiveBoardAccess.objects.create(
            board=board, user=self.student_user, permission=InteractiveBoardAccess.VIEW
        )
        self._auth(self.student_user)
        res = self.client.get("/api/cabinet/student/interactive-boards/")
        self.assertEqual(res.status_code, 200, res.content)
        ids = {item["id"] for item in res.json().get("results", [])}
        self.assertIn(str(board.id), ids)

    def test_linked_board_appears_in_student_materials(self):
        board = InteractiveBoard.objects.create(
            owner=self.teacher,
            title="Доска к уроку",
            student=self.student,
            lesson=self.lesson,
        )
        self._auth(self.student_user)
        res = self.client.get("/api/cabinet/student/materials/")
        self.assertEqual(res.status_code, 200, res.content)
        items = res.json().get("items") or []
        board_rows = [it for it in items if it.get("type") == "board"]
        self.assertTrue(board_rows)
        row = next(it for it in board_rows if it.get("board_id") == str(board.id))
        self.assertEqual(row["title"], "Доска к уроку")
        self.assertEqual(row["type_label"], "Интерактивная доска")
        self.assertEqual(row["board_url"], f"/cabinet/boards/{board.id}")
        self.assertEqual(row["lesson_topic"], "Урок по алгоритмам")

    def test_duplicate_copies_assets(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="WithAsset")
        asset = InteractiveBoardAsset(
            board=board,
            mime_type="image/png",
            original_name="dot.png",
            size_bytes=len(MINI_PNG),
            created_by=self.teacher,
        )
        asset.file.save("dot.png", io.BytesIO(MINI_PNG), save=True)
        path = f"/api/cabinet/interactive-boards/{board.id}/assets/{asset.id}/"
        board.scene_data = {
            "elements": [],
            "appState": {},
            "files": {"f1": {"mimeType": "image/png", "dataURL": path, "url": path}},
        }
        board.save(update_fields=["scene_data"])

        self._auth(self.teacher)
        res = self.client.post(f"/api/cabinet/interactive-boards/{board.id}/duplicate/", {}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        clone_id = res.json()["id"]
        clone = InteractiveBoard.objects.get(pk=clone_id)
        self.assertEqual(clone.assets.count(), 1)
        clone_asset = clone.assets.first()
        clone_files = clone.scene_data.get("files") or {}
        self.assertIn(str(clone_asset.id), clone_files.get("f1", {}).get("dataURL", ""))

    def test_list_filter_accepts_local_schedule_event_id(self):
        starts = timezone.now()
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок с доской",
            starts_at=starts,
            ends_at=starts + timedelta(hours=1),
            student=self.student,
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            status=ScheduleEvent.Status.PLANNED,
        )
        board = InteractiveBoard.objects.create(
            owner=self.teacher,
            title="Доска занятия",
            schedule_event=event,
        )
        self._auth(self.teacher)
        res = self.client.get(
            f"/api/cabinet/interactive-boards/?schedule_event=local-{event.pk}"
        )
        self.assertEqual(res.status_code, 200, res.content)
        ids = [row["id"] for row in res.json()]
        self.assertIn(str(board.id), [str(i) for i in ids])

        bad = self.client.get("/api/cabinet/interactive-boards/?schedule_event=local-abc")
        self.assertEqual(bad.status_code, 200, bad.content)
        self.assertEqual(bad.json(), [])

    def test_scene_persist_reuses_asset_for_same_dataurl(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Dedup")
        self._auth(self.teacher)
        data_url = "data:image/png;base64," + base64.b64encode(MINI_PNG).decode()
        payload = {
            "scene_data": {
                "elements": [
                    {"id": "img1", "type": "image", "fileId": "f1", "isDeleted": False, "version": 1}
                ],
                "appState": {},
                "files": {"f1": {"mimeType": "image/png", "dataURL": data_url}},
            },
            "version": 1,
        }
        first = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            payload,
            format="json",
        )
        self.assertEqual(first.status_code, 200, first.content)
        payload["version"] = first.json()["version"]
        second = self.client.patch(
            f"/api/cabinet/interactive-boards/{board.id}/",
            payload,
            format="json",
        )
        self.assertEqual(second.status_code, 200, second.content)
        self.assertNotIn("scene_data", second.json())
        self.assertEqual(InteractiveBoardAsset.objects.filter(board=board).count(), 1)
        detail = self.client.get(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        scene_url = (detail.json()["scene_data"]["files"]["f1"].get("dataURL") or "")
        self.assertIn("/assets/", scene_url)

    def test_scene_get_does_not_require_orphan_assets(self):
        board = InteractiveBoard.objects.create(owner=self.teacher, title="Orphans")
        used = InteractiveBoardAsset(
            board=board,
            mime_type="image/png",
            original_name="used.png",
            size_bytes=len(MINI_PNG),
            created_by=self.teacher,
        )
        used.file.save("used.png", io.BytesIO(MINI_PNG), save=True)
        for i in range(5):
            orphan = InteractiveBoardAsset(
                board=board,
                mime_type="image/png",
                original_name=f"orphan-{i}.png",
                size_bytes=len(MINI_PNG),
                created_by=self.teacher,
            )
            orphan.file.save(f"orphan-{i}.png", io.BytesIO(MINI_PNG), save=True)
        path = f"/api/cabinet/interactive-boards/{board.id}/assets/{used.id}/"
        board.scene_data = {
            "elements": [],
            "appState": {},
            "files": {"f1": {"mimeType": "image/png", "dataURL": path, "url": path}},
        }
        board.save(update_fields=["scene_data"])
        self._auth(self.teacher)
        res = self.client.get(f"/api/cabinet/interactive-boards/{board.id}/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(InteractiveBoardAsset.objects.filter(board=board).count(), 6)
        self.assertIn(str(used.id), res.json()["scene_data"]["files"]["f1"]["dataURL"])
