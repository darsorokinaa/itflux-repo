from datetime import timedelta
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.jitsi_service import decode_jitsi_jwt_unsafe_for_tests, generate_jitsi_jwt
from Cabinet.models import (
    MeetingAttendance,
    Profile,
    ScheduleEvent,
    Student,
    StudentGroup,
    VideoMeeting,
)
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import (
    finish_meeting,
    generate_room_name,
    get_or_create_meeting_for_event,
    record_attendance_join,
    record_attendance_leave,
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
        return get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)

    def test_teacher_can_create_and_join(self):
        self.client.force_login(self.teacher)
        create_res = self.client.post(f"/api/video-meetings/for-event/{self.event.pk}/")
        self.assertEqual(create_res.status_code, 200)
        uuid = create_res.data["videoMeeting"]["uuid"]

        join_res = self.client.post(f"/api/video-meetings/{uuid}/join-config/")
        self.assertEqual(join_res.status_code, 200)
        self.assertEqual(join_res.data["domain"], "meet.example.test")
        self.assertTrue(join_res.data["meeting"]["isModerator"])
        self.assertIsNotNone(join_res.data["jwt"])
        self.assertNotIn("JITSI_APP_SECRET", str(join_res.data))
        self.assertNotIn("test-secret-not-for-production", str(join_res.data))

    def test_other_teacher_forbidden(self):
        meeting = self._create_meeting()
        self.client.force_login(self.other_teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)

    def test_student_of_group_can_join(self):
        meeting = self._create_meeting()
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["meeting"]["isModerator"])
        self.assertEqual(res.data["userInfo"]["displayName"], "Иван Ученик")

    def test_outsider_student_forbidden(self):
        meeting = self._create_meeting()
        self.client.force_login(self.outsider)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)

    def test_anonymous_forbidden(self):
        meeting = self._create_meeting()
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertIn(res.status_code, (401, 403))

    def test_too_early_forbidden(self):
        self.event.starts_at = timezone.now() + timedelta(hours=2)
        self.event.ends_at = self.event.starts_at + timedelta(minutes=45)
        self.event.save(update_fields=["starts_at", "ends_at"])
        meeting = self._create_meeting()
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data.get("code"), "too_early")

    def test_teacher_can_join_before_window(self):
        self.event.starts_at = timezone.now() + timedelta(hours=2)
        self.event.ends_at = self.event.starts_at + timedelta(minutes=45)
        self.event.save(update_fields=["starts_at", "ends_at"])
        meeting = self._create_meeting()
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200, res.content)

    def test_join_inside_window(self):
        meeting = self._create_meeting()
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)

    def test_finished_forbidden(self):
        meeting = self._create_meeting()
        finish_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data.get("code"), "finished")

    def test_cancelled_event_forbidden(self):
        meeting = self._create_meeting()
        self.event.status = ScheduleEvent.Status.CANCELLED
        self.event.save(update_fields=["status"])
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)

    def test_single_room_per_event(self):
        m1 = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        m2 = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        self.assertEqual(m1.pk, m2.pk)
        self.assertEqual(m1.room_name, m2.room_name)
        self.assertEqual(VideoMeeting.objects.filter(schedule_event=self.event).count(), 1)

    def test_room_names_unique_and_unguessable(self):
        names = {generate_room_name() for _ in range(20)}
        self.assertEqual(len(names), 20)
        for name in names:
            self.assertTrue(name.startswith("digital-stream-"))
            self.assertGreater(len(name), 20)

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
        self.assertEqual(t_payload["context"]["user"]["moderator"], "true")
        self.assertEqual(t_payload["context"]["user"]["affiliation"], "owner")
        self.assertEqual(s_payload["context"]["user"]["id"], str(self.student_user.pk))
        self.assertEqual(s_payload["context"]["user"]["moderator"], "false")
        self.assertEqual(s_payload["context"]["user"]["affiliation"], "member")
        self.assertIn("iat", t_payload)
        self.assertIn("nbf", t_payload)
        self.assertIn("exp", t_payload)

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
        s1 = record_attendance_join(meeting=meeting, user=self.student_user, jitsi_participant_id="p1")
        s2 = record_attendance_join(meeting=meeting, user=self.student_user, jitsi_participant_id="p1")
        self.assertEqual(s1.pk, s2.pk)
        self.assertEqual(
            MeetingAttendance.objects.filter(meeting=meeting, user=self.student_user, left_at__isnull=True).count(),
            1,
        )

    def test_leave_closes_only_own_session(self):
        meeting = self._create_meeting()
        student_session = record_attendance_join(meeting=meeting, user=self.student_user)
        teacher_session = record_attendance_join(meeting=meeting, user=self.teacher)
        closed = record_attendance_leave(meeting=meeting, user=self.student_user)
        self.assertEqual(closed.pk, student_session.pk)
        self.assertIsNotNone(closed.left_at)
        teacher_session.refresh_from_db()
        self.assertIsNone(teacher_session.left_at)

    def test_duration_server_side(self):
        meeting = self._create_meeting()
        joined = timezone.now() - timedelta(minutes=10)
        with mock.patch("Cabinet.video_meeting_service.timezone.now", return_value=joined):
            session = record_attendance_join(meeting=meeting, user=self.student_user)
        left_at = joined + timedelta(minutes=7)
        with mock.patch("Cabinet.video_meeting_service.timezone.now", return_value=left_at):
            closed = record_attendance_leave(meeting=meeting, user=self.student_user)
        self.assertEqual(closed.duration_seconds, 7 * 60)

    def test_finish_closes_open_attendance(self):
        meeting = self._create_meeting()
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
        self.client.force_login(parent)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 403)

    @override_settings(JITSI_AUTH_MODE="none")
    def test_auth_mode_none_returns_null_jwt(self):
        meeting = self._create_meeting()
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["jwt"])

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

        event_id = int(str(event_payload["id"]).replace("local-", ""))
        self.assertTrue(VideoMeeting.objects.filter(schedule_event_id=event_id).exists())
        event = ScheduleEvent.objects.get(pk=event_id)
        self.assertEqual(event.meeting_provider, "jitsi")
