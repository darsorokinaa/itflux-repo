from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.jitsi_service import (
    decode_jitsi_jwt_unsafe_for_tests,
    generate_jitsi_jwt,
    get_jitsi_display_name,
)
from Cabinet.models import (
    InteractiveBoard,
    MeetingAttendance,
    Profile,
    ScheduleEvent,
    Student,
    StudentGroup,
    VideoMeeting,
)
from Cabinet.schedule_service import cancel_event, create_single_event
from Cabinet.video_meeting_service import (
    ensure_muc_safe_room_name,
    finish_meeting,
    generate_room_name,
    get_or_create_meeting_for_event,
    record_attendance_join,
    record_attendance_leave,
    sanitize_room_name,
    start_meeting,
)


@override_settings(
    JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="jwt",
    JITSI_APP_ID="itflux-test",
    JITSI_APP_SECRET="test-secret-not-for-production-32b",
    JITSI_SUB="meet.example.test",
    JITSI_AUD="jitsi",
    JITSI_TOKEN_TTL_SECONDS=3600,
    JITSI_JOIN_BEFORE_MINUTES=15,
    JITSI_JOIN_AFTER_MINUTES=30,
)
class VideoMeetingApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="vm_teacher", password="pass", email="t@test.ru")
        Profile.objects.filter(user=self.teacher).update(
            role=Profile.Role.TEACHER, name="Анна", surname="Учитель"
        )
        self.other_teacher = User.objects.create_user(username="vm_other_teacher", password="pass")
        Profile.objects.filter(user=self.other_teacher).update(role=Profile.Role.TEACHER)

        self.student_user = User.objects.create_user(
            username="vm_student", password="pass", email="s@test.ru", first_name="Иван", last_name="Ученик"
        )
        Profile.objects.filter(user=self.student_user).update(
            role=Profile.Role.STUDENT, name="Иван", surname="Ученик"
        )
        self.outsider = User.objects.create_user(username="vm_outsider", password="pass")
        Profile.objects.filter(user=self.outsider).update(role=Profile.Role.STUDENT)

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Ученик",
            status="active",
        )
        self.group = StudentGroup.objects.create(teacher=self.teacher, title="Группа VM", status="active")
        self.group.students.add(self.student)

        now = timezone.now()
        self.starts = now + timedelta(minutes=5)
        self.ends = self.starts + timedelta(minutes=45)
        self.event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Онлайн урок Jitsi",
                "starts_at": self.starts,
                "ends_at": self.ends,
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )

    def _create_meeting(self):
        meeting, _created = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        return meeting

    def test_teacher_can_create_meeting_as_scheduled(self):
        self.client.force_login(self.teacher)
        create_res = self.client.post(f"/api/video-meetings/for-event/{self.event.pk}/")
        self.assertEqual(create_res.status_code, 200)
        self.assertTrue(create_res.data["success"])
        self.assertTrue(create_res.data["created"])
        meeting = create_res.data["meeting"]
        self.assertEqual(meeting["status"], "scheduled")
        self.assertTrue(meeting["joinUrl"].startswith("/cabinet/meetings/"))
        self.assertNotIn("jwt", str(meeting).lower())
        self.assertNotIn("meet.example.test", meeting["joinUrl"])

        db = VideoMeeting.objects.get(uuid=meeting["uuid"])
        self.assertEqual(db.status, VideoMeeting.Status.SCHEDULED)
        self.assertIsNone(db.actual_started_at)

    def test_create_does_not_start_lesson(self):
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/for-event/{self.event.pk}/")
        uuid = res.data["meeting"]["uuid"]
        join_res = self.client.post(f"/api/video-meetings/{uuid}/join-config/")
        self.assertEqual(join_res.status_code, 409)
        self.assertEqual(join_res.data.get("code"), "not_live")

    def test_repeat_create_returns_same_room(self):
        self.client.force_login(self.teacher)
        first = self.client.post(f"/api/video-meetings/for-event/{self.event.pk}/")
        second = self.client.post(f"/api/video-meetings/for-event/{self.event.pk}/")
        self.assertTrue(first.data["created"])
        self.assertFalse(second.data["created"])
        self.assertEqual(first.data["meeting"]["uuid"], second.data["meeting"]["uuid"])
        self.assertEqual(first.data["meeting"]["joinUrl"], second.data["meeting"]["joinUrl"])
        self.assertEqual(VideoMeeting.objects.filter(schedule_event=self.event).count(), 1)

    def test_get_does_not_create_room(self):
        self.client.force_login(self.teacher)
        res = self.client.get(f"/api/video-meetings/for-event/{self.event.pk}/")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["videoMeeting"])
        self.assertEqual(VideoMeeting.objects.filter(schedule_event=self.event).count(), 0)

    def test_other_teacher_cannot_create(self):
        self.client.force_login(self.other_teacher)
        res = self.client.post(f"/api/video-meetings/for-event/{self.event.pk}/")
        self.assertEqual(res.status_code, 403)

    def test_student_cannot_create(self):
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/for-event/{self.event.pk}/")
        self.assertEqual(res.status_code, 403)

    def test_join_config_blocked_until_live(self):
        meeting = self._create_meeting()
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data.get("code"), "not_live")

        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 409)

    def test_teacher_can_start_scheduled_meeting(self):
        meeting = self._create_meeting()
        room_name = meeting.room_name
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/start/")
        self.assertEqual(res.status_code, 200)
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.LIVE)
        self.assertIsNotNone(meeting.actual_started_at)
        self.assertEqual(meeting.room_name, room_name)
        self.assertEqual(res.data["meeting"]["joinUrl"], f"/cabinet/meetings/{meeting.uuid}")

    def test_repeat_start_is_idempotent(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        meeting.refresh_from_db()
        started_at = meeting.actual_started_at
        room_name = meeting.room_name
        again = start_meeting(meeting=meeting, user=self.teacher)
        self.assertEqual(again.status, VideoMeeting.Status.LIVE)
        self.assertEqual(again.actual_started_at, started_at)
        self.assertEqual(again.room_name, room_name)
        self.assertEqual(VideoMeeting.objects.filter(schedule_event=self.event).count(), 1)

    def test_student_can_join_after_start(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["meeting"]["isModerator"])
        self.assertIsNotNone(res.data["jwt"])
        self.assertEqual(res.data["userInfo"]["displayName"], "Иван Ученик")

    def test_teacher_join_after_start(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["meeting"]["isModerator"])
        self.assertIsNotNone(res.data["jwt"])
        self.assertNotIn("JITSI_APP_SECRET", str(res.data))

    def test_outsider_student_forbidden(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.outsider)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)

    def test_other_teacher_forbidden(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.other_teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)

    def test_anonymous_forbidden(self):
        meeting = self._create_meeting()
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertIn(res.status_code, (401, 403))

    def test_student_can_join_when_live_before_schedule_window(self):
        """Пока урок live — ссылка активна, даже если до слота в расписании ещё далеко."""
        self.event.starts_at = timezone.now() + timedelta(hours=2)
        self.event.ends_at = self.event.starts_at + timedelta(minutes=45)
        self.event.save(update_fields=["starts_at", "ends_at"])
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(res.data["meeting"]["isModerator"])

    def test_student_can_join_when_live_after_scheduled_end(self):
        """Пока учитель не завершил урок — вход доступен и после ends_at."""
        self.event.starts_at = timezone.now() - timedelta(hours=2)
        self.event.ends_at = timezone.now() - timedelta(hours=1)
        self.event.save(update_fields=["starts_at", "ends_at"])
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200, res.content)

    def test_teacher_can_join_before_window_when_live(self):
        self.event.starts_at = timezone.now() + timedelta(hours=2)
        self.event.ends_at = self.event.starts_at + timedelta(minutes=45)
        self.event.save(update_fields=["starts_at", "ends_at"])
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200, res.content)

    def test_status_endpoint(self):
        meeting = self._create_meeting()
        self.client.force_login(self.student_user)
        res = self.client.get(f"/api/video-meetings/{meeting.uuid}/status/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "scheduled")
        self.assertNotIn("jwt", res.data)

    def test_finish_and_block_rejoin(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.teacher)
        finish_res = self.client.post(f"/api/video-meetings/{meeting.uuid}/finish/")
        self.assertEqual(finish_res.status_code, 200)
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.FINISHED)
        self.assertIsNotNone(meeting.actual_finished_at)

        join_res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(join_res.status_code, 409)
        self.assertEqual(join_res.data.get("code"), "finished")

        start_again = self.client.post(f"/api/video-meetings/{meeting.uuid}/start/")
        self.assertEqual(start_again.status_code, 409)

    def test_finish_idempotent(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        finish_meeting(meeting=meeting, user=self.teacher)
        again = finish_meeting(meeting=meeting, user=self.teacher)
        self.assertEqual(again.status, VideoMeeting.Status.FINISHED)

    def test_cannot_finish_scheduled(self):
        meeting = self._create_meeting()
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/finish/")
        self.assertEqual(res.status_code, 409)

    def test_cancelled_cannot_start(self):
        meeting = self._create_meeting()
        cancel_event(self.event, changed_by=self.teacher, notify=False)
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.CANCELLED)
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/start/")
        self.assertEqual(res.status_code, 409)

    def test_cancelled_event_forbidden(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        cancel_event(self.event, changed_by=self.teacher, notify=False)
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertIn(res.status_code, (403, 409))

    def test_single_room_per_event(self):
        m1, _ = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        m2, created = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        self.assertFalse(created)
        self.assertEqual(m1.pk, m2.pk)
        self.assertEqual(m1.room_name, m2.room_name)
        self.assertEqual(VideoMeeting.objects.filter(schedule_event=self.event).count(), 1)

    def test_room_names_unique_and_unguessable(self):
        names = {generate_room_name() for _ in range(20)}
        self.assertEqual(len(names), 20)
        for name in names:
            self.assertTrue(name.startswith("digitalstream"))
            self.assertTrue(name.replace("digitalstream", "").isalnum())
            self.assertNotIn("-", name)
            self.assertNotIn("_", name)
            self.assertGreater(len(name), 20)

    def test_hyphenated_room_name_normalized_on_start_not_on_live_join(self):
        meeting = self._create_meeting()
        meeting.room_name = "digital-stream-Aa_Bb123"
        meeting.save(update_fields=["room_name"])
        start_meeting(meeting=meeting, user=self.teacher)
        meeting.refresh_from_db()
        self.assertEqual(meeting.room_name, "digitalstreamaabb123")
        self.assertEqual(sanitize_room_name("digital-stream-x_y"), "digitalstreamxy")
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["roomName"], "digitalstreamaabb123")
        self.assertEqual(res.data["diagnostics"]["jwtRoom"], res.data["roomName"])
        self.assertNotIn("-", res.data["roomName"])

    def test_live_room_name_is_frozen_even_if_unsafe(self):
        """Нельзя переименовать комнату, когда кто-то уже мог войти в Jitsi."""
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        meeting.room_name = "legacy-room_Name"
        meeting.save(update_fields=["room_name"])
        frozen = ensure_muc_safe_room_name(meeting, allow_mutate=False)
        self.assertEqual(frozen, "legacy-room_Name")
        self.client.force_login(self.teacher)
        teacher = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.client.force_login(self.student_user)
        student = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(teacher.status_code, 200)
        self.assertEqual(student.status_code, 200)
        self.assertEqual(teacher.data["roomName"], "legacy-room_Name")
        self.assertEqual(student.data["roomName"], teacher.data["roomName"])
        teacher_jwt = decode_jitsi_jwt_unsafe_for_tests(teacher.data["jwt"])
        student_jwt = decode_jitsi_jwt_unsafe_for_tests(student.data["jwt"])
        self.assertEqual(teacher_jwt["room"], teacher.data["roomName"])
        self.assertEqual(student_jwt["room"], student.data["roomName"])
        meeting.refresh_from_db()
        self.assertEqual(meeting.room_name, "legacy-room_Name")

    def test_join_config_is_not_cached(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("no-store", res["Cache-Control"])

    def test_join_config_jwt_covers_long_lesson(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        payload = decode_jitsi_jwt_unsafe_for_tests(res.data["jwt"])
        self.assertEqual(payload["room"], res.data["roomName"])
        self.assertGreaterEqual(payload["exp"] - payload["iat"], 4 * 3600 - 5)
        self.assertLessEqual(payload["exp"] - payload["iat"], 8 * 3600)
        self.assertNotEqual(payload["room"], "*")

    def test_teacher_and_student_share_domain_and_room(self):
        from Cabinet.video_meeting_service import build_join_config

        meeting = self._create_meeting()
        room_before = meeting.room_name
        start_meeting(meeting=meeting, user=self.teacher)
        teacher_config = build_join_config(meeting=meeting, user=self.teacher)
        student_config = build_join_config(meeting=meeting, user=self.student_user)
        self.assertEqual(teacher_config["domain"], student_config["domain"])
        self.assertEqual(teacher_config["roomName"], student_config["roomName"])
        self.assertEqual(teacher_config["roomName"], room_before)
        self.assertEqual(teacher_config["meeting"]["subject"], "Урок · Иван Ученик")
        self.assertEqual(teacher_config["meeting"]["title"], "Урок · Иван Ученик")
        self.assertEqual(teacher_config["meeting"]["audience"], "Иван Ученик")
        self.assertEqual(student_config["meeting"]["subject"], teacher_config["meeting"]["subject"])
        meeting.refresh_from_db()
        self.assertEqual(meeting.room_name, room_before)

        teacher_payload = decode_jitsi_jwt_unsafe_for_tests(teacher_config["jwt"])
        student_payload = decode_jitsi_jwt_unsafe_for_tests(student_config["jwt"])
        self.assertEqual(teacher_payload["room"], meeting.room_name)
        self.assertEqual(student_payload["room"], meeting.room_name)
        self.assertEqual(teacher_payload["aud"], student_payload["aud"])
        self.assertEqual(teacher_payload["iss"], student_payload["iss"])
        self.assertEqual(teacher_payload["sub"], student_payload["sub"])
        self.assertNotEqual(
            teacher_payload["context"]["user"]["id"],
            student_payload["context"]["user"]["id"],
        )
        self.assertTrue(teacher_payload["context"]["user"]["moderator"] in (True, "true"))
        self.assertTrue(student_payload["context"]["user"]["moderator"] in (False, "false"))
        self.assertNotIn("JITSI_APP_SECRET", str(teacher_config))
        self.assertNotIn("test-secret-not-for-production", str(teacher_config))

    def test_join_config_does_not_create_or_rotate_room(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        room = meeting.room_name
        self.client.force_login(self.teacher)
        first = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        second = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["roomName"], room)
        self.assertEqual(second.data["roomName"], room)
        self.assertEqual(VideoMeeting.objects.filter(schedule_event=self.event).count(), 1)
        meeting.refresh_from_db()
        self.assertEqual(meeting.room_name, room)

    def test_finish_does_not_change_room_name(self):
        meeting = self._create_meeting()
        room = meeting.room_name
        start_meeting(meeting=meeting, user=self.teacher)
        finish_meeting(meeting=meeting, user=self.teacher)
        meeting.refresh_from_db()
        self.assertEqual(meeting.room_name, room)
        self.assertEqual(meeting.status, VideoMeeting.Status.FINISHED)

    def test_jwt_claims(self):
        meeting = self._create_meeting()
        teacher_jwt = generate_jitsi_jwt(
            room_name=meeting.room_name,
            user=self.teacher,
            is_moderator=True,
        )
        student_jwt = generate_jitsi_jwt(
            room_name=meeting.room_name,
            user=self.student_user,
            is_moderator=False,
        )
        t_payload = decode_jitsi_jwt_unsafe_for_tests(teacher_jwt)
        s_payload = decode_jitsi_jwt_unsafe_for_tests(student_jwt)
        self.assertEqual(t_payload["room"], meeting.room_name)
        self.assertEqual(t_payload["context"]["user"]["id"], str(self.teacher.pk))
        self.assertTrue(t_payload["context"]["user"]["moderator"] in (True, "true"))
        self.assertEqual(t_payload["context"]["user"].get("affiliation"), "owner")
        self.assertEqual(s_payload["context"]["user"]["id"], str(self.student_user.pk))
        self.assertTrue(s_payload["context"]["user"]["moderator"] in (False, "false"))
        self.assertEqual(s_payload["context"]["user"].get("affiliation"), "member")
        self.assertIn("iat", t_payload)
        self.assertIn("nbf", t_payload)
        self.assertLessEqual(t_payload["nbf"], t_payload["iat"])
        self.assertGreaterEqual(t_payload["iat"] - t_payload["nbf"], 50)
        self.assertIn("exp", t_payload)
        self.assertTrue(bool(t_payload["context"]["user"]["name"]))

    def test_teacher_is_organizer_participant_on_meeting_create(self):
        from Cabinet.choices import ParticipantRole

        meeting = self._create_meeting()
        organizer = meeting.schedule_event.participants.filter(
            role=ParticipantRole.ORGANIZER,
            teacher=self.teacher,
        ).first()
        self.assertIsNotNone(organizer)
        self.assertEqual(organizer.status, "accepted")
        self.assertEqual(organizer.user_id, self.teacher.pk)

    def test_join_idempotent(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        s1 = record_attendance_join(meeting=meeting, user=self.student_user, jitsi_participant_id="p1")
        s2 = record_attendance_join(meeting=meeting, user=self.student_user, jitsi_participant_id="p1")
        self.assertEqual(s1.pk, s2.pk)
        self.assertEqual(
            MeetingAttendance.objects.filter(meeting=meeting, user=self.student_user, left_at__isnull=True).count(),
            1,
        )

    def test_leave_closes_only_own_session(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        student_session = record_attendance_join(meeting=meeting, user=self.student_user)
        teacher_session = record_attendance_join(meeting=meeting, user=self.teacher)
        closed = record_attendance_leave(meeting=meeting, user=self.student_user)
        self.assertEqual(closed.pk, student_session.pk)
        self.assertIsNotNone(closed.left_at)
        teacher_session.refresh_from_db()
        self.assertIsNone(teacher_session.left_at)

    def test_duration_server_side(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        joined = timezone.now() - timedelta(minutes=10)
        with mock.patch("Cabinet.video_meeting_service.timezone.now", return_value=joined):
            session = record_attendance_join(meeting=meeting, user=self.student_user)
        left_at = joined + timedelta(minutes=7)
        with mock.patch("Cabinet.video_meeting_service.timezone.now", return_value=left_at):
            closed = record_attendance_leave(meeting=meeting, user=self.student_user)
        self.assertEqual(closed.duration_seconds, 7 * 60)

    def test_reconnect_reopens_recent_session(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        t0 = timezone.now()
        with mock.patch("Cabinet.video_meeting_service.timezone.now", return_value=t0):
            first = record_attendance_join(meeting=meeting, user=self.student_user)
        t1 = t0 + timedelta(minutes=5)
        with mock.patch("Cabinet.video_meeting_service.timezone.now", return_value=t1):
            record_attendance_leave(meeting=meeting, user=self.student_user)
        t2 = t1 + timedelta(seconds=20)
        with mock.patch("Cabinet.video_meeting_service.timezone.now", return_value=t2):
            second = record_attendance_join(meeting=meeting, user=self.student_user)
        self.assertEqual(first.pk, second.pk)
        second.refresh_from_db()
        self.assertIsNone(second.left_at)
        self.assertEqual(
            MeetingAttendance.objects.filter(meeting=meeting, user=self.student_user).count(),
            1,
        )

    def test_attendance_list_coalesces_short_gaps(self):
        from Cabinet.video_meeting_service import list_attendance_for_teacher

        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        t0 = timezone.now().replace(microsecond=0)
        # Два фрагмента с разрывом 10 сек — должны склеиться в ~70 мин.
        MeetingAttendance.objects.create(
            meeting=meeting,
            user=self.teacher,
            joined_at=t0,
            left_at=t0 + timedelta(minutes=11),
            duration_seconds=11 * 60,
        )
        MeetingAttendance.objects.create(
            meeting=meeting,
            user=self.teacher,
            joined_at=t0 + timedelta(minutes=11, seconds=10),
            left_at=t0 + timedelta(minutes=70),
            duration_seconds=59 * 60,
        )
        MeetingAttendance.objects.create(
            meeting=meeting,
            user=self.student_user,
            joined_at=t0 + timedelta(minutes=1),
            left_at=t0 + timedelta(minutes=70),
            duration_seconds=69 * 60,
        )
        rows = list_attendance_for_teacher(meeting=meeting, user=self.teacher)
        teacher_rows = [r for r in rows if r["userId"] == self.teacher.pk]
        self.assertEqual(len(teacher_rows), 1)
        self.assertEqual(teacher_rows[0]["durationSeconds"], 70 * 60)
        self.assertEqual(teacher_rows[0]["sessionCount"], 2)

    def test_repeat_leave_is_idempotent(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        record_attendance_join(
            meeting=meeting, user=self.student_user, jitsi_participant_id="p1"
        )
        first = record_attendance_leave(
            meeting=meeting, user=self.student_user, jitsi_participant_id="p1"
        )
        second = record_attendance_leave(
            meeting=meeting, user=self.student_user, jitsi_participant_id="p1"
        )
        self.assertIsNotNone(first.left_at)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(
            MeetingAttendance.objects.filter(meeting=meeting, user=self.student_user).count(),
            1,
        )

    def test_teacher_and_student_attendance_are_independent(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        teacher_row = record_attendance_join(
            meeting=meeting, user=self.teacher, jitsi_participant_id="teacher-jitsi"
        )
        student_row = record_attendance_join(
            meeting=meeting, user=self.student_user, jitsi_participant_id="student-jitsi"
        )
        self.assertNotEqual(teacher_row.pk, student_row.pk)
        self.assertEqual(teacher_row.jitsi_participant_id, "teacher-jitsi")
        self.assertEqual(student_row.jitsi_participant_id, "student-jitsi")
        record_attendance_leave(meeting=meeting, user=self.student_user)
        teacher_row.refresh_from_db()
        self.assertIsNone(teacher_row.left_at)

    def test_finish_closes_open_attendance(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        record_attendance_join(meeting=meeting, user=self.student_user)
        record_attendance_join(meeting=meeting, user=self.teacher)
        finish_meeting(meeting=meeting, user=self.teacher)
        self.assertFalse(
            MeetingAttendance.objects.filter(meeting=meeting, left_at__isnull=True).exists()
        )
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.FINISHED)

    def test_not_found(self):
        self.client.force_login(self.teacher)
        res = self.client.get("/api/video-meetings/00000000-0000-0000-0000-000000000099/")
        self.assertEqual(res.status_code, 404)

    def test_parent_no_access(self):
        parent = User.objects.create_user(username="vm_parent", password="pass")
        Profile.objects.filter(user=parent).update(role=Profile.Role.PARENT)
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(parent)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)

    @override_settings(
        JITSI_DOMAIN="meet.jit.si",
        JITSI_AUTH_MODE="none",
        JITSI_APP_ID="",
        JITSI_APP_SECRET="",
    )
    def test_auth_mode_none_returns_null_jwt(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["jwt"])
        self.assertTrue(res.data["requiresModeratorLogin"])
        self.assertTrue(str(res.data["userInfo"]["displayName"]).strip())

    @override_settings(JITSI_AUTH_MODE="none")
    def test_custom_domain_auto_enables_jwt_when_secrets_set(self):
        """Свой домен + секреты при AUTH_MODE=none всё равно выдаёт JWT (иначе «Я организатор»)."""
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["authMode"], "jwt")
        self.assertTrue(res.data["jwt"])
        self.assertFalse(res.data["requiresModeratorLogin"])
        payload = decode_jitsi_jwt_unsafe_for_tests(res.data["jwt"])
        self.assertEqual(payload["context"]["user"]["moderator"], "true")
        self.assertEqual(payload["context"]["user"]["affiliation"], "owner")

    def test_join_config_display_name_never_empty(self):
        blank = User.objects.create_user(username="vm_blank_name", password="pass")
        Profile.objects.filter(user=blank).update(role=Profile.Role.TEACHER, name="", surname="")
        name = get_jitsi_display_name(blank)
        self.assertTrue(name.strip())
        self.assertNotEqual(name.strip(), "")

        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(str(res.data["userInfo"]["displayName"]).strip())
        self.assertIsNotNone(res.data["userInfo"]["displayName"])

    def test_schedule_create_with_jitsi_auto_create(self):
        starts = timezone.now() + timedelta(days=2, hours=1)
        ends = starts + timedelta(minutes=45)
        self.client.force_login(self.teacher)
        res = self.client.post(
            "/api/cabinet/schedule/events/create/",
            {
                "title": "Авто Jitsi урок",
                "type": "individual_lesson",
                "format": "online",
                "starts_at": starts.strftime("%Y-%m-%dT%H:%M:%S"),
                "ends_at": ends.strftime("%Y-%m-%dT%H:%M:%S"),
                "timezone": "Europe/Moscow",
                "student_ids": [self.student.pk],
                "jitsi_auto_create": True,
                "notify_participants": False,
                "force": True,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertTrue(body.get("ok"))
        event_payload = body["event"]
        self.assertEqual(event_payload.get("meetingProvider"), "jitsi")
        self.assertIsNotNone(event_payload.get("videoMeeting"))
        self.assertTrue(event_payload["videoMeeting"]["pageUrl"].startswith("/cabinet/meetings/"))
        self.assertEqual(event_payload.get("link"), event_payload["videoMeeting"]["pageUrl"])
        self.assertEqual(event_payload["videoMeeting"]["status"], "scheduled")

        event_id = int(str(event_payload["id"]).replace("local-", ""))
        meeting = VideoMeeting.objects.get(schedule_event_id=event_id)
        self.assertEqual(meeting.status, VideoMeeting.Status.SCHEDULED)
        self.assertIsNone(meeting.actual_started_at)
        event = ScheduleEvent.objects.get(pk=event_id)
        self.assertEqual(event.meeting_provider, "jitsi")

    def test_student_detail_hides_plan_materials(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.student_user)
        res = self.client.get(f"/api/video-meetings/{meeting.uuid}/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data.get("canManage"), False)
        self.assertEqual(res.data["event"].get("materials"), "")
        plan = res.data["event"].get("planItem")
        if plan:
            self.assertEqual(plan.get("materials") or [], [])
            self.assertEqual(plan.get("homework_materials") or [], [])

    @override_settings(LESSON_SECRET="test-lesson-secret-for-present")
    def test_present_board_and_variant_to_student(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        board = InteractiveBoard.objects.create(
            owner=self.teacher,
            title="Доска урока",
            schedule_event=self.event,
            student=self.student,
        )

        self.client.force_login(self.teacher)
        board_res = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/present/",
            {"kind": "board", "boardId": str(board.id)},
            format="json",
        )
        self.assertEqual(board_res.status_code, 200, board_res.content)
        self.assertEqual(board_res.data["presented"]["kind"], "board")
        self.assertIn(str(board.id), board_res.data["presented"]["openUrl"])
        self.assertIn(f"meeting={meeting.uuid}", board_res.data["presented"]["openUrl"])

        self.client.force_login(self.student_user)
        status_res = self.client.get(f"/api/video-meetings/{meeting.uuid}/status/")
        self.assertEqual(status_res.status_code, 200)
        self.assertEqual(status_res.data["presented"]["kind"], "board")
        self.assertTrue(status_res.data["presented"]["openUrl"])
        self.assertIn(f"meeting={meeting.uuid}", status_res.data["presented"]["openUrl"])

        self.client.force_login(self.teacher)
        variant_res = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/present/",
            {
                "kind": "variant",
                "title": "Вариант 1",
                "url": "/oge/inf/variant/42",
            },
            format="json",
        )
        self.assertEqual(variant_res.status_code, 200, variant_res.content)
        self.assertEqual(variant_res.data["presented"]["kind"], "variant")
        self.assertTrue(variant_res.data["presented"]["homeworkId"])
        teacher_open = variant_res.data["presented"]["openUrl"]
        self.assertIn("live_meeting=1", teacher_open)
        self.assertIn("cabinet_assignment=", teacher_open)
        self.assertIn(f"meeting={meeting.uuid}", teacher_open)

        self.client.force_login(self.student_user)
        status_res = self.client.get(f"/api/video-meetings/{meeting.uuid}/status/")
        self.assertEqual(status_res.data["presented"]["kind"], "variant")
        open_url = status_res.data["presented"]["openUrl"]
        self.assertIn("cabinet_assignment=", open_url)
        self.assertIn("lesson_token=", open_url)
        self.assertIn("live_meeting=1", open_url)
        self.assertIn(f"meeting={meeting.uuid}", open_url)

        homework_id = status_res.data["presented"]["homeworkId"]
        draft = self.client.post(
            f"/api/homework/assignment/{homework_id}/save-draft/",
            {
                "result": {
                    "by_number": {"1": "15"},
                    "by_task_id": {"1": "15"},
                    "checked": {"1": True},
                }
            },
            format="json",
        )
        self.assertEqual(draft.status_code, 200, draft.content)
        self.assertEqual(draft.data.get("status"), "sent")

        self.client.force_login(self.teacher)
        answers = self.client.get(f"/api/video-meetings/{meeting.uuid}/live-answers/")
        self.assertEqual(answers.status_code, 200)
        self.assertTrue(answers.data.get("presented"))
        self.assertEqual(len(answers.data.get("students") or []), 1)
        student_row = answers.data["students"][0]
        self.assertEqual(student_row.get("status"), "sent")
        self.assertEqual((student_row.get("result") or {}).get("by_number", {}).get("1"), "15")
        self.assertTrue((student_row.get("result") or {}).get("checked", {}).get("1"))

        # Черновик без «Проверить» тоже виден учителю на live-уроке.
        self.client.force_login(self.student_user)
        draft2 = self.client.post(
            f"/api/homework/assignment/{homework_id}/save-draft/",
            {
                "result": {
                    "by_number": {"1": "15", "2": "99"},
                    "by_task_id": {"1": "15", "2": "99"},
                    "checked": {"1": True},
                }
            },
            format="json",
        )
        self.assertEqual(draft2.status_code, 200, draft2.content)
        self.client.force_login(self.teacher)
        answers2 = self.client.get(f"/api/video-meetings/{meeting.uuid}/live-answers/")
        result2 = (answers2.data["students"][0].get("result") or {})
        self.assertEqual(result2.get("by_number", {}).get("1"), "15")
        self.assertEqual(result2.get("by_number", {}).get("2"), "99")
        self.assertEqual(result2.get("by_task_id", {}).get("2"), "99")

        clear_res = self.client.delete(f"/api/video-meetings/{meeting.uuid}/present/")
        self.assertEqual(clear_res.status_code, 200)
        meeting.refresh_from_db()
        self.assertEqual(meeting.presented_kind, "")

        # Live-вариант с урока не должен попадать в очередь «Проверка».
        from Cabinet.models import Homework, HomeworkSubmission, ReviewItem
        from Cabinet.homework_api import exclude_live_meeting_review_items

        self.client.force_login(self.student_user)
        submit = self.client.post(
            f"/api/homework/assignment/{homework_id}/submit/",
            {"result": {"by_number": {"1": "15"}, "checked": {"1": True}}},
            format="json",
        )
        self.assertEqual(submit.status_code, 200, submit.content)
        homework = Homework.objects.get(pk=homework_id)
        self.assertIn("live-meeting:", homework.description or "")
        submission = HomeworkSubmission.objects.get(homework=homework, student=self.student)
        self.assertFalse(
            ReviewItem.objects.filter(source_type="homework", source_id=submission.pk).exists()
        )
        # Даже если ReviewItem создали вручную — список проверки его скрывает.
        orphan = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=submission.pk,
            title=f"{homework.title} — {self.student.full_name}",
            status="pending",
        )
        filtered = exclude_live_meeting_review_items(
            ReviewItem.objects.filter(teacher=self.teacher)
        )
        self.assertFalse(filtered.filter(pk=orphan.pk).exists())

    def test_domain_with_https_normalized_for_jwt_sub(self):
        from Cabinet.jitsi_service import get_jitsi_domain, get_jitsi_sub, normalize_jitsi_host

        self.assertEqual(normalize_jitsi_host("https://Lesson.Example.test/path"), "lesson.example.test")
        self.assertEqual(normalize_jitsi_host("lesson.example.test:443"), "lesson.example.test")
        with self.settings(
            JITSI_DOMAIN="https://meet.example.test/",
            JITSI_SUB="https://meet.example.test",
            JITSI_AUTH_MODE="jwt",
        ):
            self.assertEqual(get_jitsi_domain(), "meet.example.test")
            self.assertEqual(get_jitsi_sub(), "meet.example.test")
            meeting = self._create_meeting()
            start_meeting(meeting=meeting, user=self.teacher)
            self.client.force_login(self.teacher)
            res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
            self.assertEqual(res.status_code, 200, res.content)
            self.assertEqual(res.data["domain"], "meet.example.test")
            payload = decode_jitsi_jwt_unsafe_for_tests(res.data["jwt"])
            self.assertEqual(payload["sub"], "meet.example.test")
            self.assertEqual(payload["room"], res.data["roomName"])

    def test_auto_jwt_mode_requires_token_even_if_auth_mode_none(self):
        """Свой домен + APP_ID/SECRET → JWT обязателен, даже при AUTH_MODE=none."""
        with self.settings(
            JITSI_DOMAIN="meet.example.test",
            JITSI_AUTH_MODE="none",
            JITSI_APP_ID="itflux-test",
            JITSI_APP_SECRET="test-secret-not-for-production-32b",
            JITSI_SUB="meet.example.test",
        ):
            meeting = self._create_meeting()
            start_meeting(meeting=meeting, user=self.teacher)
            self.client.force_login(self.student_user)
            res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
            self.assertEqual(res.status_code, 200, res.content)
            self.assertEqual(res.data["authMode"], "jwt")
            self.assertTrue(res.data["jwt"])
            self.assertEqual(res.data["passwordRequired"], False)
            self.assertIsNone(res.data["conferencePassword"])
            self.assertEqual(res.data["diagnostics"]["roomName"], res.data["roomName"])
            self.assertEqual(res.data["diagnostics"]["jwtRoom"], res.data["roomName"])

    def test_invite_reuses_existing_conference_room(self):
        meeting, created = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        self.assertTrue(created)
        room = meeting.room_name
        again, created_again = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        self.assertFalse(created_again)
        self.assertEqual(again.pk, meeting.pk)
        self.assertEqual(again.room_name, room)
        start_meeting(meeting=meeting, user=self.teacher)
        from Cabinet.video_meeting_service import build_join_config

        teacher_cfg = build_join_config(meeting=meeting, user=self.teacher)
        student_cfg = build_join_config(meeting=meeting, user=self.student_user)
        self.assertEqual(teacher_cfg["roomName"], student_cfg["roomName"])
        self.assertEqual(teacher_cfg["roomName"], room)
        self.assertEqual(teacher_cfg["diagnostics"]["jwtRoom"], student_cfg["diagnostics"]["jwtRoom"])
        self.assertEqual(teacher_cfg["diagnostics"]["jwtRoom"], room)

    def test_connection_probe_does_not_create_meeting(self):
        self.client.force_login(self.teacher)
        before = VideoMeeting.objects.count()
        res = self.client.get("/api/video-meetings/connection-probe/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(VideoMeeting.objects.count(), before)
        self.assertTrue(str(res.data["roomName"]).startswith("diag"))
        self.assertEqual(res.data["domain"], "meet.example.test")
        self.assertEqual(res.data["authMode"], "jwt")
        self.assertTrue(res.data["jwt"])
        self.assertTrue(res.data["probe"])
        claims = decode_jitsi_jwt_unsafe_for_tests(res.data["jwt"])
        self.assertEqual(claims["room"], res.data["roomName"])
        self.assertEqual(claims["context"]["user"]["moderator"], "true")
        self.assertNotIn("schedule_event", res.data)
        self.assertNotIn("meetingUuid", res.data)

    def test_connection_probe_does_not_start_existing_meeting(self):
        meeting = self._create_meeting()
        self.client.force_login(self.teacher)
        res = self.client.get("/api/video-meetings/connection-probe/")
        self.assertEqual(res.status_code, 200, res.content)
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.SCHEDULED)
        self.assertIsNone(meeting.actual_started_at)
        self.assertEqual(MeetingAttendance.objects.count(), 0)

    def test_connection_probe_requires_auth(self):
        res = self.client.get("/api/video-meetings/connection-probe/")
        self.assertIn(res.status_code, (401, 403))

    def test_connection_probe_allows_student(self):
        self.client.force_login(self.student_user)
        res = self.client.get("/api/video-meetings/connection-probe/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["roomName"].startswith("diag"))
        self.assertNotEqual(res.data["roomName"], "")

    def test_connection_probe_log_does_not_create_meeting(self):
        self.client.force_login(self.teacher)
        before = VideoMeeting.objects.count()
        res = self.client.post(
            "/api/video-meetings/connection-probe/",
            {"stage": "join_timeout", "errorType": "join_timeout", "durationMs": 15000, "online": True},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data.get("ok"))
        self.assertEqual(VideoMeeting.objects.count(), before)

    def test_different_lessons_get_different_rooms(self):
        m1, _ = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        other = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Другой урок",
                "starts_at": self.starts + timedelta(days=1),
                "ends_at": self.ends + timedelta(days=1),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        m2, _ = get_or_create_meeting_for_event(event=other, created_by=self.teacher)
        self.assertNotEqual(m1.room_name, m2.room_name)
        self.assertNotEqual(m1.uuid, m2.uuid)

    def test_finish_does_not_complete_schedule_event(self):
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, ScheduleEvent.Status.PLANNED)
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/finish/")
        self.assertEqual(res.status_code, 200, res.content)
        self.event.refresh_from_db()
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.FINISHED)
        self.assertEqual(self.event.status, ScheduleEvent.Status.PLANNED)
        self.assertEqual(res.data["eventStatus"], ScheduleEvent.Status.PLANNED)
        next_step = res.data["nextStep"]
        self.assertEqual(next_step["action"], "complete_lesson_journal")
        self.assertFalse(next_step["autoCompletesLesson"])
        self.assertIn(f"/cabinet/journal/lesson/{self.event.pk}", next_step["path"])

    def test_stale_watchdog_dry_run_does_not_close_room(self):
        from Cabinet.video_meeting_service import expire_stale_live_meetings

        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        now = timezone.now()
        ScheduleEvent.objects.filter(pk=self.event.pk).update(
            starts_at=now - timedelta(hours=20),
            ends_at=now - timedelta(hours=19),
        )
        VideoMeeting.objects.filter(pk=meeting.pk).update(
            updated_at=now - timedelta(hours=10),
            actual_started_at=now - timedelta(hours=20),
        )
        report = expire_stale_live_meetings(now=now, dry_run=True)
        self.assertEqual(len(report["expired"]), 1)
        meeting.refresh_from_db()
        self.event.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.LIVE)
        self.assertEqual(self.event.status, ScheduleEvent.Status.PLANNED)

    def test_stale_watchdog_expires_abandoned_live_without_completing_lesson(self):
        from Cabinet.video_meeting_service import expire_stale_live_meetings

        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        now = timezone.now()
        ScheduleEvent.objects.filter(pk=self.event.pk).update(
            starts_at=now - timedelta(hours=20),
            ends_at=now - timedelta(hours=19),
        )
        VideoMeeting.objects.filter(pk=meeting.pk).update(
            updated_at=now - timedelta(hours=10),
            actual_started_at=now - timedelta(hours=20),
        )
        report = expire_stale_live_meetings(now=now, dry_run=False)
        self.assertEqual(len(report["expired"]), 1)
        meeting.refresh_from_db()
        self.event.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.FINISHED)
        self.assertIsNotNone(meeting.actual_finished_at)
        self.assertEqual(self.event.status, ScheduleEvent.Status.PLANNED)

    def test_stale_watchdog_keeps_live_room_before_end_grace(self):
        from Cabinet.video_meeting_service import expire_stale_live_meetings

        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        now = timezone.now()
        ScheduleEvent.objects.filter(pk=self.event.pk).update(
            starts_at=now - timedelta(hours=3),
            ends_at=now - timedelta(hours=2),
        )
        VideoMeeting.objects.filter(pk=meeting.pk).update(
            updated_at=now - timedelta(hours=10),
            actual_started_at=now - timedelta(hours=3),
        )
        report = expire_stale_live_meetings(now=now, dry_run=False)
        self.assertEqual(report["checked"], 0)
        self.assertEqual(report["expired"], [])
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.LIVE)

    def test_stale_watchdog_keeps_recently_active_live_room(self):
        from Cabinet.video_meeting_service import expire_stale_live_meetings

        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        now = timezone.now()
        ScheduleEvent.objects.filter(pk=self.event.pk).update(
            starts_at=now - timedelta(hours=20),
            ends_at=now - timedelta(hours=19),
        )
        VideoMeeting.objects.filter(pk=meeting.pk).update(
            updated_at=now - timedelta(minutes=20),
            actual_started_at=now - timedelta(hours=20),
        )
        report = expire_stale_live_meetings(now=now, dry_run=False)
        self.assertEqual(report["expired"], [])
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.LIVE)

    def test_stale_watchdog_keeps_room_with_recent_open_attendance(self):
        from Cabinet.video_meeting_service import expire_stale_live_meetings

        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        record_attendance_join(
            meeting=meeting,
            user=self.teacher,
            jitsi_participant_id="moderator-1",
        )
        now = timezone.now()
        ScheduleEvent.objects.filter(pk=self.event.pk).update(
            starts_at=now - timedelta(hours=20),
            ends_at=now - timedelta(hours=19),
        )
        VideoMeeting.objects.filter(pk=meeting.pk).update(
            updated_at=now - timedelta(hours=10),
            actual_started_at=now - timedelta(hours=20),
        )
        report = expire_stale_live_meetings(now=now, dry_run=False)
        self.assertEqual(report["expired"], [])
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.LIVE)

    def test_live_status_poll_touches_activity(self):
        from Cabinet.video_meeting_service import LIVE_ACTIVITY_TOUCH_INTERVAL

        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        stale = timezone.now() - LIVE_ACTIVITY_TOUCH_INTERVAL - timedelta(minutes=1)
        VideoMeeting.objects.filter(pk=meeting.pk).update(updated_at=stale)
        self.client.force_login(self.teacher)
        res = self.client.get(f"/api/video-meetings/{meeting.uuid}/status/")
        self.assertEqual(res.status_code, 200, res.content)
        meeting.refresh_from_db()
        self.assertGreater(meeting.updated_at, stale)