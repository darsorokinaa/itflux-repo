"""Аннотации поверх демонстрации экрана: права, snapshot, идемпотентность."""

from __future__ import annotations

from datetime import timedelta

from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from Cabinet.meeting_consumers import VideoMeetingConsumer
from Cabinet.meeting_screenshare import (
    apply_screenshare_operation,
    get_active_screenshare_session,
    report_screenshare_state,
    set_screenshare_permission,
)
from Cabinet.meeting_material_session import sync_state_payload
from Cabinet.models import Profile, Student
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import (
    VideoMeetingError,
    get_or_create_meeting_for_event,
    start_meeting,
)


def _setup_lesson(prefix="ss"):
    teacher = User.objects.create_user(username=f"{prefix}_teacher", password="pass")
    Profile.objects.filter(user=teacher).update(role=Profile.Role.TEACHER, name="Анна")
    student_user = User.objects.create_user(
        username=f"{prefix}_student", password="pass", first_name="Иван", last_name="Ученик"
    )
    Profile.objects.filter(user=student_user).update(role=Profile.Role.STUDENT)
    outsider = User.objects.create_user(username=f"{prefix}_outsider", password="pass")
    Profile.objects.filter(user=outsider).update(role=Profile.Role.STUDENT)
    student = Student.objects.create(
        teacher=teacher,
        user=student_user,
        first_name="Иван",
        last_name="Ученик",
        status="active",
    )
    now = timezone.now()
    event = create_single_event(
        teacher=teacher,
        data={
            "title": "Урок с демонстрацией",
            "starts_at": now + timedelta(minutes=5),
            "ends_at": now + timedelta(minutes=50),
            "event_type": "individual_lesson",
            "format": "online",
            "notify_participants": False,
        },
        student_ids=[student.pk],
        notify=False,
    )
    meeting, _ = get_or_create_meeting_for_event(event=event, created_by=teacher)
    start_meeting(meeting=meeting, user=teacher)
    return teacher, student_user, outsider, meeting


@override_settings(
    JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="jwt",
    JITSI_APP_ID="itflux-test",
    JITSI_APP_SECRET="test-secret-not-for-production-32b",
    JITSI_SUB="meet.example.test",
    JITSI_AUD="jitsi",
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
)
class ScreenShareAnnotationServiceTests(TestCase):
    def setUp(self):
        self.teacher, self.student_user, self.outsider, self.meeting = _setup_lesson("svc")

    def test_new_share_creates_session_and_second_share_gets_new_id(self):
        first = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
            content_width=1920,
            content_height=1080,
        )
        self.assertTrue(first.is_active)
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.teacher,
            action="object_upsert",
            payload={"annotation": {
                "id": "a1",
                "tool": "rect",
                "color": "#ef4444",
                "width": 3,
                "points": [{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}],
            }},
            operation_id="op-1",
            session_id=str(first.uuid),
        )
        ended = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=False,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        self.assertFalse(ended.is_active)
        second = report_screenshare_state(
            meeting=self.meeting,
            user=self.student_user,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="def",
        )
        self.assertNotEqual(first.uuid, second.uuid)
        self.assertEqual(second.annotations, [])

    def test_same_share_keeps_session_id(self):
        first = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        again = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
            content_width=1280,
            content_height=720,
        )
        self.assertEqual(first.uuid, again.uuid)
        self.assertEqual(again.content_width, 1280)

    def test_student_cannot_draw_when_permission_off(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        set_screenshare_permission(
            meeting=self.meeting,
            user=self.teacher,
            participants_can_annotate=False,
            session_id=str(session.uuid),
        )
        with self.assertRaises(VideoMeetingError) as ctx:
            apply_screenshare_operation(
                meeting=self.meeting,
                user=self.student_user,
                action="stroke_start",
                payload={"annotation": {
                    "id": "s1",
                    "tool": "pen",
                    "points": [{"x": 0.4, "y": 0.4}],
                }},
                operation_id="op-student",
                session_id=str(session.uuid),
            )
        self.assertEqual(ctx.exception.code, "forbidden")
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.teacher,
            action="stroke_start",
            payload={"annotation": {
                "id": "t1",
                "tool": "pen",
                "points": [{"x": 0.5, "y": 0.5}],
            }},
            operation_id="op-teacher",
            session_id=str(session.uuid),
        )
        session.refresh_from_db()
        self.assertEqual(len(session.annotations), 1)
        self.assertEqual(session.annotations[0]["authorId"], self.teacher.pk)

    def test_student_cannot_toggle_permission(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        with self.assertRaises(VideoMeetingError):
            set_screenshare_permission(
                meeting=self.meeting,
                user=self.student_user,
                participants_can_annotate=False,
                session_id=str(session.uuid),
            )

    def test_client_cannot_spoof_author(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.student_user,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="stu",
        )
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.student_user,
            action="object_upsert",
            payload={"annotation": {
                "id": "fake",
                "tool": "line",
                "authorId": self.teacher.pk,
                "authorRole": "teacher",
                "points": [{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9}],
            }},
            operation_id="op-spoof",
            session_id=str(session.uuid),
        )
        session.refresh_from_db()
        self.assertEqual(session.annotations[0]["authorId"], self.student_user.pk)
        self.assertEqual(session.annotations[0]["authorRole"], "student")

    def test_undo_only_own_and_clear_all_is_teacher_only(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.teacher,
            action="object_upsert",
            payload={"annotation": {
                "id": "t-line",
                "tool": "line",
                "points": [{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}],
            }},
            operation_id="t1",
            session_id=str(session.uuid),
        )
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.student_user,
            action="object_upsert",
            payload={"annotation": {
                "id": "s-line",
                "tool": "line",
                "points": [{"x": 0.3, "y": 0.3}, {"x": 0.4, "y": 0.4}],
            }},
            operation_id="s1",
            session_id=str(session.uuid),
        )
        with self.assertRaises(VideoMeetingError):
            apply_screenshare_operation(
                meeting=self.meeting,
                user=self.student_user,
                action="annotation_deleted",
                payload={"id": "t-line"},
                operation_id="s-undo-teacher",
                session_id=str(session.uuid),
            )
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.student_user,
            action="annotation_deleted",
            payload={"id": "s-line"},
            operation_id="s-undo",
            session_id=str(session.uuid),
        )
        session.refresh_from_db()
        self.assertEqual([a["id"] for a in session.annotations], ["t-line"])
        with self.assertRaises(VideoMeetingError):
            apply_screenshare_operation(
                meeting=self.meeting,
                user=self.student_user,
                action="clear_all",
                payload={},
                operation_id="s-clear",
                session_id=str(session.uuid),
            )
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.teacher,
            action="clear_all",
            payload={},
            operation_id="t-clear",
            session_id=str(session.uuid),
        )
        session.refresh_from_db()
        self.assertEqual(session.annotations, [])

    def test_coordinates_clamped_and_duplicate_ops_ignored(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.teacher,
            action="stroke_start",
            payload={"annotation": {
                "id": "pen1",
                "tool": "pen",
                "points": [{"x": -1, "y": 2}],
            }},
            operation_id="dup",
            session_id=str(session.uuid),
        )
        dup = apply_screenshare_operation(
            meeting=self.meeting,
            user=self.teacher,
            action="stroke_start",
            payload={"annotation": {
                "id": "pen1",
                "tool": "pen",
                "points": [{"x": 0.5, "y": 0.5}],
            }},
            operation_id="dup",
            session_id=str(session.uuid),
        )
        self.assertTrue(dup["duplicate"])
        session.refresh_from_db()
        self.assertEqual(session.annotations[0]["points"][0]["x"], 0)
        self.assertEqual(session.annotations[0]["points"][0]["y"], 1)

    def test_wrong_session_id_rejected_and_outsider_blocked(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        with self.assertRaises(VideoMeetingError) as ctx:
            apply_screenshare_operation(
                meeting=self.meeting,
                user=self.teacher,
                action="object_upsert",
                payload={
                    "screenShareSessionId": "00000000-0000-0000-0000-000000000099",
                    "annotation": {
                        "id": "x",
                        "tool": "rect",
                        "points": [{"x": 0.1, "y": 0.1}, {"x": 0.2, "y": 0.2}],
                    },
                },
                operation_id="bad-sid",
                session_id=str(session.uuid),
            )
        self.assertEqual(ctx.exception.code, "session_mismatch")
        with self.assertRaises(VideoMeetingError):
            report_screenshare_state(
                meeting=self.meeting,
                user=self.outsider,
                active=True,
                local_sharing=True,
                presenter_jitsi_id="out",
            )

    def test_get_active_screenshare_session_none_without_share(self):
        self.assertIsNone(get_active_screenshare_session(self.meeting))
        payload = sync_state_payload(self.meeting, self.student_user)
        self.assertIsNone(payload["screenshareSession"])

    def test_get_active_screenshare_session_ignores_ended(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=False,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        self.assertIsNone(get_active_screenshare_session(self.meeting))
        session.refresh_from_db()
        self.assertFalse(session.is_active)

    def test_snapshot_contains_existing_annotations(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.teacher,
            action="object_upsert",
            payload={"annotation": {
                "id": "keep",
                "tool": "ellipse",
                "points": [{"x": 0.2, "y": 0.2}, {"x": 0.4, "y": 0.5}],
            }},
            operation_id="keep-1",
            session_id=str(session.uuid),
        )
        self.assertEqual(get_active_screenshare_session(self.meeting).uuid, session.uuid)
        payload = sync_state_payload(self.meeting, self.student_user)
        snap = payload["screenshareSession"]
        self.assertEqual(snap["sessionId"], str(session.uuid))
        self.assertEqual(len(snap["annotations"]), 1)
        self.assertEqual(snap["annotations"][0]["id"], "keep")

    def test_text_is_escaped_as_plain_text_and_limited(self):
        session = report_screenshare_state(
            meeting=self.meeting,
            user=self.teacher,
            active=True,
            local_sharing=True,
            presenter_jitsi_id="abc",
        )
        apply_screenshare_operation(
            meeting=self.meeting,
            user=self.teacher,
            action="object_upsert",
            payload={"annotation": {
                "id": "txt",
                "tool": "text",
                "text": "<script>alert(1)</script>" + ("x" * 400),
                "points": [{"x": 0.5, "y": 0.5}],
            }},
            operation_id="txt-1",
            session_id=str(session.uuid),
        )
        session.refresh_from_db()
        text = session.annotations[0]["text"]
        self.assertTrue(text.startswith("<script>alert(1)</script>"))
        self.assertLessEqual(len(text), 280)


@override_settings(
    JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="jwt",
    JITSI_APP_ID="itflux-test",
    JITSI_APP_SECRET="test-secret-not-for-production-32b",
    JITSI_SUB="meet.example.test",
    JITSI_AUD="jitsi",
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
)
class ScreenShareAnnotationWsTests(TransactionTestCase):
    def setUp(self):
        self.teacher, self.student_user, self.outsider, self.meeting = _setup_lesson("ws")

    async def _connect(self, user):
        communicator = WebsocketCommunicator(
            VideoMeetingConsumer.as_asgi(),
            f"/ws/video-meetings/{self.meeting.uuid}/",
        )
        communicator.scope["user"] = user
        communicator.scope["url_route"] = {"kwargs": {"meeting_uuid": str(self.meeting.uuid)}}
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        return communicator

    async def _drain_until(self, ws, msg_type, timeout=2):
        for _ in range(12):
            msg = await ws.receive_json_from(timeout=timeout)
            if msg.get("type") == msg_type:
                return msg
        self.fail(f"не дождались {msg_type}")

    async def test_connect_without_screenshare_sends_null_session(self):
        ws = await self._connect(self.student_user)
        try:
            snap = await ws.receive_json_from(timeout=2)
            self.assertEqual(snap["type"], "material.sync_state")
            self.assertIsNone(snap["screenshareSession"])
        finally:
            await ws.disconnect()

    async def test_student_stroke_reaches_teacher_and_late_join_gets_snapshot(self):
        teacher_ws = await self._connect(self.teacher)
        student_ws = await self._connect(self.student_user)
        try:
            await teacher_ws.receive_json_from(timeout=2)
            await student_ws.receive_json_from(timeout=2)
            await teacher_ws.send_json_to({
                "type": "screenshare.report",
                "active": True,
                "localSharing": True,
                "presenterJitsiId": "teacher-jitsi",
                "contentWidth": 1920,
                "contentHeight": 1080,
            })
            started = await self._drain_until(student_ws, "screenshare.started")
            session_id = started["screenshareSession"]["sessionId"]
            await student_ws.send_json_to({
                "type": "screenshare.operation",
                "action": "object_upsert",
                "operation_id": "ell-1",
                "session_id": session_id,
                "payload": {
                    "screenShareSessionId": session_id,
                    "annotation": {
                        "id": "circle-1",
                        "tool": "ellipse",
                        "color": "#2563eb",
                        "width": 3,
                        "points": [{"x": 0.41, "y": 0.32}, {"x": 0.52, "y": 0.48}],
                    },
                },
            })
            op = await self._drain_until(teacher_ws, "screenshare.operation")
            self.assertEqual(op["payload"]["annotation"]["id"], "circle-1")
            self.assertEqual(op["author_id"], self.student_user.pk)

            late = await self._connect(self.teacher)
            snap = await late.receive_json_from(timeout=2)
            self.assertEqual(snap["type"], "material.sync_state")
            self.assertEqual(snap["screenshareSession"]["sessionId"], session_id)
            self.assertEqual(snap["screenshareSession"]["annotations"][0]["id"], "circle-1")
            await late.disconnect()
        finally:
            for ws in (teacher_ws, student_ws):
                try:
                    await ws.disconnect()
                except BaseException:
                    pass

    async def test_permission_off_rejects_student_ws_operation(self):
        teacher_ws = await self._connect(self.teacher)
        student_ws = await self._connect(self.student_user)
        try:
            await teacher_ws.receive_json_from(timeout=2)
            await student_ws.receive_json_from(timeout=2)
            await teacher_ws.send_json_to({
                "type": "screenshare.report",
                "active": True,
                "localSharing": True,
                "presenterJitsiId": "teacher-jitsi",
            })
            started = await self._drain_until(student_ws, "screenshare.started")
            session_id = started["screenshareSession"]["sessionId"]
            await teacher_ws.send_json_to({
                "type": "screenshare.set_permission",
                "participantsCanAnnotate": False,
                "sessionId": session_id,
            })
            await self._drain_until(student_ws, "screenshare.permission")
            await student_ws.send_json_to({
                "type": "screenshare.operation",
                "action": "stroke_start",
                "operation_id": "denied-1",
                "session_id": session_id,
                "payload": {
                    "annotation": {
                        "id": "nope",
                        "tool": "pen",
                        "points": [{"x": 0.2, "y": 0.2}],
                    },
                },
            })
            err = await self._drain_until(student_ws, "material.error")
            self.assertEqual(err["code"], "forbidden")
        finally:
            for ws in (teacher_ws, student_ws):
                try:
                    await ws.disconnect()
                except BaseException:
                    pass
