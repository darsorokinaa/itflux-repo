"""Тесты синхронного просмотра и совместного управления материалами урока."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.material_adapters import infer_resource_kind
from Cabinet.meeting_material_models import MeetingMaterialSession, MeetingMaterialWork
from Cabinet.meeting_material_session import (
    apply_material_operation,
    get_active_material_session,
)
from Cabinet.models import Material, Profile, Student, VideoMeeting
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import (
    VideoMeetingError,
    finish_meeting,
    get_or_create_meeting_for_event,
    start_meeting,
)


@override_settings(
    JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="jwt",
    JITSI_APP_ID="itflux-test",
    JITSI_APP_SECRET="test-secret-not-for-production-32b",
    JITSI_SUB="meet.example.test",
    JITSI_AUD="jitsi",
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
)
class MeetingMaterialSessionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="mm_teacher", password="pass")
        Profile.objects.filter(user=self.teacher).update(role=Profile.Role.TEACHER, name="Анна")
        self.student_user = User.objects.create_user(
            username="mm_student", password="pass", first_name="Иван", last_name="Ученик"
        )
        Profile.objects.filter(user=self.student_user).update(role=Profile.Role.STUDENT)
        self.outsider = User.objects.create_user(username="mm_outsider", password="pass")
        Profile.objects.filter(user=self.outsider).update(role=Profile.Role.STUDENT)

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Ученик",
            status="active",
        )
        now = timezone.now()
        self.event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Урок с материалами",
                "starts_at": now + timedelta(minutes=5),
                "ends_at": now + timedelta(minutes=50),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.meeting, _ = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        start_meeting(meeting=self.meeting, user=self.teacher)
        self.material = Material.objects.create(
            teacher=self.teacher,
            title="Алгоритмы и исполнители",
            material_type="presentation",
            external_url="https://example.com/slides.pdf",
            status="published",
        )

    def _open(self, **extra):
        self.client.force_login(self.teacher)
        payload = {
            "kind": "file",
            "resourceKind": "pdf",
            "title": self.material.title,
            "url": self.material.external_url,
            "materialId": self.material.pk,
            **extra,
        }
        return self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/",
            payload,
            format="json",
        )

    def test_teacher_opens_material_student_sees_session(self):
        res = self._open()
        self.assertEqual(res.status_code, 200, res.content)
        session = res.data["materialSession"]
        self.assertEqual(session["material"]["type"], "pdf")
        self.assertEqual(session["interactionMode"], "view_only")
        self.assertEqual(session["version"], 1)

        self.client.force_login(self.student_user)
        status = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/status/")
        self.assertEqual(status.status_code, 200)
        self.assertTrue(status.data["materialSession"])
        self.assertEqual(status.data["materialSession"]["sessionId"], session["sessionId"])
        self.assertIn("state", status.data["materialSession"])

    def test_student_gets_state_after_reconnect_via_get(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.teacher)
        op = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "op-page-1",
                "action": "page_changed",
                "payload": {"page": 3},
                "baseVersion": 1,
            },
            format="json",
        )
        self.assertEqual(op.status_code, 200, op.content)
        self.assertEqual(op.data["version"], 2)

        self.client.force_login(self.student_user)
        sync = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/material-session/")
        self.assertEqual(sync.data["materialSession"]["state"]["page"], 3)
        self.assertEqual(sync.data["materialSession"]["version"], 2)

    def test_student_cannot_mutate_in_view_only(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.student_user)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "op-student-1",
                "action": "annotation_added",
                "payload": {
                    "annotation": {
                        "id": "a1",
                        "tool": "pen",
                        "points": [[0.1, 0.1], [0.2, 0.2]],
                    }
                },
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data.get("code"), "forbidden")

    def test_teacher_actions_visible_in_state(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.teacher)
        self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "op-ann-1",
                "action": "annotation_added",
                "payload": {
                    "annotation": {
                        "id": "ann-teacher",
                        "tool": "pen",
                        "points": [[0.1, 0.2], [0.3, 0.4]],
                        "page": 1,
                    }
                },
            },
            format="json",
        )
        self.client.force_login(self.student_user)
        sync = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/material-session/")
        anns = sync.data["materialSession"]["state"]["annotations"]
        self.assertEqual(len(anns), 1)
        self.assertEqual(anns[0]["id"], "ann-teacher")
        self.assertEqual(anns[0]["author_id"], self.teacher.pk)
        self.assertEqual(anns[0]["author_role"], "teacher")

    def test_only_teacher_can_enable_collaborative(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.student_user)
        denied = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/permission/",
            {"sessionId": session_id, "mode": "collaborative"},
            format="json",
        )
        self.assertEqual(denied.status_code, 403)

        self.client.force_login(self.teacher)
        ok = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/permission/",
            {"sessionId": session_id, "mode": "collaborative"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.data["materialSession"]["interactionMode"], "collaborative")

    def test_student_can_operate_after_collaborative_enabled(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.teacher)
        self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/permission/",
            {"sessionId": session_id, "mode": "collaborative"},
            format="json",
        )
        self.client.force_login(self.student_user)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "op-student-draw",
                "action": "annotation_added",
                "payload": {
                    "annotation": {
                        "id": "ann-student",
                        "tool": "pen",
                        "points": [[0.5, 0.5], [0.6, 0.6]],
                    }
                },
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["operation"]["author_id"], self.student_user.pk)
        self.assertEqual(res.data["operation"]["author_role"], "student")

        self.client.force_login(self.teacher)
        sync = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/material-session/")
        ids = [a["id"] for a in sync.data["materialSession"]["state"]["annotations"]]
        self.assertIn("ann-student", ids)

    def test_student_ops_rejected_after_collaborative_disabled(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.teacher)
        self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/permission/",
            {"sessionId": session_id, "mode": "collaborative"},
            format="json",
        )
        self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/permission/",
            {"sessionId": session_id, "mode": "view_only"},
            format="json",
        )
        self.client.force_login(self.student_user)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "op-after-disable",
                "action": "annotation_added",
                "payload": {"annotation": {"id": "x", "points": [[0, 0], [1, 1]]}},
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_outsider_cannot_operate(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.outsider)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "op-out",
                "action": "page_changed",
                "payload": {"page": 2},
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_student_cannot_open_material(self):
        self.client.force_login(self.student_user)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/",
            {
                "resourceKind": "pdf",
                "title": "Hack",
                "url": "https://example.com/x.pdf",
                "materialId": self.material.pk,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_duplicate_operation_id_is_idempotent(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        body = {
            "sessionId": session_id,
            "operationId": "same-op",
            "action": "page_changed",
            "payload": {"page": 4},
        }
        self.client.force_login(self.teacher)
        first = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            body,
            format="json",
        )
        second = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            body,
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.data["duplicate"])
        self.assertEqual(second.data["version"], first.data["version"])

    def test_answer_selected_keeps_author(self):
        self.client.force_login(self.teacher)
        open_res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/",
            {
                "resourceKind": "test",
                "title": "Тест",
                "url": "/cabinet/interactives/1",
            },
            format="json",
        )
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/permission/",
            {"sessionId": session_id, "mode": "collaborative"},
            format="json",
        )
        self.client.force_login(self.student_user)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "ans-1",
                "action": "answer_selected",
                "payload": {"questionId": "q1", "value": "B"},
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        answer = res.data["materialSession"]["state"]["answers"]["q1"]
        self.assertEqual(answer["value"], "B")
        self.assertEqual(answer["author_id"], self.student_user.pk)

    def test_close_material_clears_active_session(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.teacher)
        closed = self.client.delete(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/",
            {"sessionId": session_id},
            format="json",
        )
        self.assertEqual(closed.status_code, 200)
        self.client.force_login(self.student_user)
        status = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/status/")
        self.assertIsNone(status.data["materialSession"])
        self.assertTrue(MeetingMaterialWork.objects.filter(session_id=session_id).exists())

    def test_finish_meeting_blocks_new_ops_and_saves_work(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        finish_meeting(meeting=self.meeting, user=self.teacher)
        self.meeting.refresh_from_db()
        self.assertEqual(self.meeting.status, VideoMeeting.Status.FINISHED)
        self.assertFalse(MeetingMaterialSession.objects.filter(pk=session_id, is_active=True).exists())
        self.assertTrue(MeetingMaterialWork.objects.filter(session_id=session_id).exists())

        self.client.force_login(self.teacher)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "after-finish",
                "action": "page_changed",
                "payload": {"page": 2},
            },
            format="json",
        )
        self.assertEqual(res.status_code, 409)

    def test_source_material_not_mutated(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.teacher)
        self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "field-1",
                "action": "annotation_added",
                "payload": {"annotation": {"id": "z", "points": [[0.1, 0.1], [0.2, 0.2]]}},
            },
            format="json",
        )
        self.material.refresh_from_db()
        self.assertEqual(self.material.external_url, "https://example.com/slides.pdf")
        self.assertFalse(self.material.content)

    def test_large_payload_rejected(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        huge_points = [[0.1, 0.1]] * 2000
        self.client.force_login(self.teacher)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "huge",
                "action": "annotation_added",
                "payload": {"annotation": {"id": "huge", "points": huge_points}},
            },
            format="json",
        )
        self.assertIn(res.status_code, (400, 413))

    def test_author_cannot_be_spoofed(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.client.force_login(self.teacher)
        self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/permission/",
            {"sessionId": session_id, "mode": "collaborative"},
            format="json",
        )
        self.client.force_login(self.student_user)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/operation/",
            {
                "sessionId": session_id,
                "operationId": "spoof",
                "action": "annotation_added",
                "author_id": self.teacher.pk,
                "author_role": "teacher",
                "payload": {
                    "annotation": {
                        "id": "spoof-ann",
                        "points": [[0.1, 0.1], [0.2, 0.2]],
                        "author_id": self.teacher.pk,
                    }
                },
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["operation"]["author_id"], self.student_user.pk)
        self.assertEqual(res.data["operation"]["author_role"], "student")
        self.assertEqual(
            res.data["materialSession"]["state"]["annotations"][0]["author_id"],
            self.student_user.pk,
        )

    def test_board_and_variant_kinds_excluded(self):
        self.assertIsNone(infer_resource_kind(row_kind="board"))
        self.assertIsNone(infer_resource_kind(row_kind="variant"))
        self.assertIsNone(infer_resource_kind(material_type="task_set"))

        self.client.force_login(self.teacher)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/",
            {"resourceKind": "board", "title": "Доска"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_open_blocked_media_resolves_to_api_preview(self):
        from Cabinet.files_models import CabinetFile, CabinetFileStatus

        storage_key = "cabinet/my-files/9/demo-meeting.pdf"
        cabinet_file = CabinetFile.objects.create(
            owner=self.teacher,
            original_name="demo-meeting.pdf",
            display_name="demo-meeting.pdf",
            storage_key=storage_key,
            mime_type="application/pdf",
            extension=".pdf",
            size=128,
            status=CabinetFileStatus.ACTIVE,
        )
        file_material = Material.objects.create(
            teacher=self.teacher,
            title="demo-meeting.pdf",
            material_type="file",
            status="published",
            cabinet_file=cabinet_file,
        )
        file_material.file.name = storage_key
        file_material.save(update_fields=["file"])

        self.client.force_login(self.teacher)
        # Как в UI до фикса: только media URL, без materialId.
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/",
            {
                "kind": "file",
                "resourceKind": "pdf",
                "title": file_material.title,
                "url": f"/media/{storage_key}",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        open_url = res.data["materialSession"]["material"]["openUrl"]
        self.assertTrue(
            open_url.startswith(f"/api/cabinet/files/{cabinet_file.id}/preview/"),
            open_url,
        )
        self.assertNotIn("/media/cabinet/my-files/", open_url)

        self.client.force_login(self.student_user)
        status = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/status/")
        student_url = status.data["materialSession"]["material"]["openUrl"]
        self.assertTrue(
            student_url.startswith(f"/api/cabinet/student/files/shared/{cabinet_file.id}/preview/"),
            student_url,
        )

    def test_present_board_closes_material_session(self):
        from Cabinet.models import InteractiveBoard

        self._open()
        board = InteractiveBoard.objects.create(
            owner=self.teacher,
            title="Доска",
            schedule_event=self.event,
            student=self.student,
        )
        self.client.force_login(self.teacher)
        present = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/present/",
            {"kind": "board", "boardId": str(board.id)},
            format="json",
        )
        self.assertEqual(present.status_code, 200, present.content)
        self.assertIsNone(get_active_material_session(self.meeting))

    def test_student_navigation_locked_in_collaborative(self):
        open_res = self._open()
        session_id = open_res.data["materialSession"]["sessionId"]
        self.meeting.refresh_from_db()
        self.client.force_login(self.teacher)
        perm = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/permission/",
            {"sessionId": session_id, "mode": "collaborative"},
            format="json",
        )
        self.assertEqual(perm.status_code, 200, perm.content)
        with self.assertRaises(VideoMeetingError):
            apply_material_operation(
                meeting=self.meeting,
                user=self.student_user,
                action="page_changed",
                payload={"page": 9},
                operation_id="nav-student",
                session_id=session_id,
            )
