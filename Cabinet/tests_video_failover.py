"""Резервный LiveKit не меняет JaaS, пока флаг выключен, и не выдаёт чужую комнату."""

from datetime import timedelta
from unittest import mock

import jwt
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.livekit_service import (
    decode_livekit_jwt,
    livekit_api_secret,
    livekit_is_configured,
    token_matches_room,
)
from Cabinet.models import Profile, Student, StudentGroup, VideoMeeting
from Cabinet.schedule_service import create_single_event
from Cabinet.video_failover import _auto_switch_allowed
from Cabinet.video_failover_models import MeetingCallRoute
from Cabinet.video_meeting_service import get_or_create_meeting_for_event, start_meeting

LIVEKIT = dict(
    VIDEO_FAILOVER_ENABLED=True,
    VIDEO_FAILOVER_MODE="auto",
    VIDEO_FAILOVER_REQUIRE_HEALTH=False,
    VIDEO_PROVIDER="meet",
    LIVEKIT_URL="wss://video.example.test",
    LIVEKIT_HTTP_URL="https://video.example.test",
    LIVEKIT_API_KEY="itflux-test-key",
    LIVEKIT_API_SECRET="test-livekit-secret-not-for-production",
    LIVEKIT_TOKEN_TTL_SECONDS=900,
    JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="jwt",
    JITSI_APP_ID="itflux-test",
    JITSI_APP_SECRET="test-secret-not-for-production-32b",
    JITSI_SUB="meet.example.test",
    JITSI_AUD="jitsi",
    JITSI_TOKEN_TTL_SECONDS=3600,
)


@override_settings(**LIVEKIT)
class VideoFailoverTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="lk_teacher", password="pass", email="t@test.ru")
        Profile.objects.filter(user=self.teacher).update(role=Profile.Role.TEACHER, name="Анна", surname="Учитель")
        self.other = User.objects.create_user(username="lk_other", password="pass")
        Profile.objects.filter(user=self.other).update(role=Profile.Role.TEACHER)
        self.student_user = User.objects.create_user(
            username="lk_student", password="pass", email="s@test.ru", first_name="Иван", last_name="Ученик"
        )
        Profile.objects.filter(user=self.student_user).update(role=Profile.Role.STUDENT, name="Иван", surname="Ученик")
        self.outsider = User.objects.create_user(username="lk_out", password="pass")
        Profile.objects.filter(user=self.outsider).update(role=Profile.Role.STUDENT)
        self.staff = User.objects.create_user(username="lk_staff", password="pass", is_staff=True)
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Ученик",
            status="active",
        )
        self.group = StudentGroup.objects.create(teacher=self.teacher, title="Группа LK", status="active")
        self.group.students.add(self.student)
        now = timezone.now()
        self.event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Урок LiveKit",
                "starts_at": now + timedelta(minutes=5),
                "ends_at": now + timedelta(minutes=50),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )

    def _live(self):
        meeting, _created = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        start_meeting(meeting=meeting, user=self.teacher)
        meeting.refresh_from_db()
        return meeting

    def _join(self, user, meeting):
        self.client.force_login(user)
        return self.client.post(
            f"/api/video-meetings/{meeting.uuid}/join-config/",
            {"role": "teacher", "isModerator": True},
            format="json",
        )

    def test_flag_off_keeps_current_provider(self):
        meeting = self._live()
        with override_settings(VIDEO_FAILOVER_ENABLED=False):
            res = self._join(self.teacher, meeting)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["provider"], "meet")
        self.assertNotIn("mediaGeneration", res.data)
        self.assertNotIn("livekitUrl", res.data)
        self.assertFalse(MeetingCallRoute.objects.filter(meeting=meeting).exists())

    def test_auto_starts_on_primary_for_both_participants(self):
        meeting = self._live()
        teacher = self._join(self.teacher, meeting)
        student = self._join(self.student_user, meeting)
        self.assertEqual(teacher.status_code, 200)
        self.assertEqual(student.status_code, 200)
        self.assertEqual(teacher.data["provider"], "meet")
        self.assertEqual(student.data["provider"], "meet")
        self.assertEqual(teacher.data["roomName"], student.data["roomName"])
        self.assertEqual(teacher.data["mediaGeneration"], student.data["mediaGeneration"])

    def test_outsider_and_anonymous_cannot_get_token(self):
        meeting = self._live()
        denied = self._join(self.outsider, meeting)
        self.assertEqual(denied.status_code, 403)
        self.assertNotIn("jwt", denied.data)
        self.client.logout()
        anon = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/", {}, format="json")
        self.assertIn(anon.status_code, (401, 403))

    def test_other_teacher_cannot_switch_or_enter(self):
        meeting = self._live()
        self.client.force_login(self.other)
        res = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/switch/",
            {"provider": "livekit"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)
        join = self._join(self.other, meeting)
        self.assertEqual(join.status_code, 403)

    @override_settings(VIDEO_FAILOVER_MODE="livekit_only")
    def test_livekit_token_is_room_bound_and_has_no_personal_data(self):
        meeting = self._live()
        other_event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Другой урок",
                "starts_at": timezone.now() + timedelta(minutes=5),
                "ends_at": timezone.now() + timedelta(minutes=50),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        other, _created = get_or_create_meeting_for_event(event=other_event, created_by=self.teacher)
        with self.assertLogs("Cabinet.livekit_service", level="INFO") as captured:
            teacher = self._join(self.teacher, meeting)
            student = self._join(self.student_user, meeting)
        self.assertEqual(teacher.data["provider"], "livekit")
        self.assertEqual(student.data["provider"], "livekit")
        self.assertEqual(teacher.data["roomName"], student.data["roomName"])
        self.assertEqual(teacher.data["livekitUrl"], "wss://video.example.test")
        secret = livekit_api_secret()
        logs = "\n".join(captured.output)
        self.assertNotIn(secret, logs)
        self.assertNotIn(teacher.data["jwt"], logs)
        teacher_claims = decode_livekit_jwt(teacher.data["jwt"])
        student_claims = decode_livekit_jwt(student.data["jwt"])
        self.assertEqual(teacher_claims["video"]["room"], meeting.room_name)
        self.assertEqual(student_claims["video"]["room"], meeting.room_name)
        self.assertTrue(teacher_claims["video"]["roomAdmin"])
        self.assertFalse(student_claims["video"]["roomAdmin"])
        self.assertTrue(teacher_claims["video"]["canPublishData"])
        self.assertTrue(student_claims["video"]["canPublishData"])
        self.assertEqual(student_claims["sub"], f"p{self.student_user.pk}")
        self.assertNotIn("name", student_claims)
        self.assertNotIn("email", student_claims)
        self.assertNotIn("Иван", student.data["jwt"])
        self.assertNotIn("s@test.ru", student.data["jwt"])
        self.assertFalse(token_matches_room(student.data["jwt"], other.room_name))
        self.assertLessEqual(student_claims["exp"] - student_claims["iat"], 900)
        expired = jwt.encode(
            {"iss": "itflux-test-key", "sub": "p1", "exp": 1, "video": {"room": meeting.room_name}},
            secret,
            algorithm="HS256",
        )
        with self.assertRaises(jwt.PyJWTError):
            decode_livekit_jwt(expired)

    def test_leaving_livekit_only_returns_the_lesson_to_primary(self):
        meeting = self._live()
        with override_settings(VIDEO_FAILOVER_MODE="livekit_only"):
            forced = self._join(self.teacher, meeting)
        self.assertEqual(forced.data["provider"], "livekit")
        restored = self._join(self.teacher, meeting)
        self.assertEqual(restored.data["provider"], "meet")
        self.assertNotIn("livekitUrl", restored.data)
        route = MeetingCallRoute.objects.get(meeting=meeting)
        self.assertEqual(route.active_provider, "meet")
        self.assertEqual(route.switch_reason, "primary_restored")

    def test_device_and_local_faults_do_not_switch_the_room(self):
        meeting = self._live()
        self._join(self.teacher, meeting)
        self.client.force_login(self.teacher)
        for fault in ("device_permission", "intentional_mute", "platform_offline", "auth_denied", "local_network"):
            res = self.client.post(
                f"/api/video-meetings/{meeting.uuid}/media-route/fault/",
                {"fault": fault, "confirmed": True, "attemptsExhausted": True, "code": "mic"},
                format="json",
            )
            self.assertEqual(res.status_code, 200, fault)
            self.assertFalse(res.data["switched"], fault)
        route = MeetingCallRoute.objects.get(meeting=meeting)
        self.assertEqual(route.active_provider, "meet")
        self.assertEqual(route.generation, 1)
        blob = str(route.failure_reports)
        self.assertNotIn("Иван", blob)
        self.assertNotIn("s@test.ru", blob)
        local = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/fault/",
            {"fault": "local_network", "confirmed": True, "attemptsExhausted": True},
            format="json",
        )
        self.assertEqual(local.data["roomAction"], "local_only")

    def test_one_short_report_does_not_switch_but_exhausted_teacher_does(self):
        meeting = self._live()
        self.client.force_login(self.student_user)
        student = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/fault/",
            {"fault": "provider_outage", "confirmed": True, "attemptsExhausted": True, "code": "jitsi_script"},
            format="json",
        )
        self.assertFalse(student.data["switched"])
        self.assertEqual(MeetingCallRoute.objects.get(meeting=meeting).active_provider, "meet")
        self.client.force_login(self.teacher)
        early = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/fault/",
            {"fault": "provider_outage", "confirmed": True, "attemptsExhausted": False, "code": "jitsi_script"},
            format="json",
        )
        self.assertFalse(early.data["switched"])
        switched = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/fault/",
            {"fault": "provider_outage", "confirmed": True, "attemptsExhausted": True, "code": "jitsi_script"},
            format="json",
        )
        self.assertTrue(switched.data["switched"])
        self.assertEqual(switched.data["provider"], "livekit")
        self.assertGreater(switched.data["generation"], 1)
        again = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/fault/",
            {"fault": "provider_outage", "confirmed": True, "attemptsExhausted": True, "code": "jitsi_script"},
            format="json",
        )
        self.assertFalse(again.data["switched"])
        self.assertEqual(again.data["provider"], "livekit")
        self.assertEqual(again.data["generation"], switched.data["generation"])
        teacher = self._join(self.teacher, meeting)
        pupil = self._join(self.student_user, meeting)
        self.assertEqual(teacher.data["provider"], "livekit")
        self.assertEqual(pupil.data["provider"], "livekit")
        self.assertEqual(teacher.data["roomName"], pupil.data["roomName"])
        self.assertEqual(teacher.data["mediaGeneration"], pupil.data["mediaGeneration"])

    def test_teacher_switches_the_room_between_call_kinds(self):
        meeting = self._live()
        self.client.force_login(self.teacher)
        to_livekit = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/switch/",
            {"provider": "livekit", "expectedGeneration": 1},
            format="json",
        )
        self.assertEqual(to_livekit.status_code, 200)
        self.assertTrue(to_livekit.data["switched"])
        self.assertEqual(to_livekit.data["provider"], "livekit")
        generation = to_livekit.data["generation"]
        back = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/switch/",
            {"provider": "primary", "expectedGeneration": generation},
            format="json",
        )
        self.assertEqual(back.status_code, 200)
        self.assertEqual(back.data["provider"], "meet")
        teacher = self._join(self.teacher, meeting)
        pupil = self._join(self.student_user, meeting)
        self.assertEqual(teacher.data["provider"], "meet")
        self.assertEqual(pupil.data["provider"], "meet")
        self.assertEqual(teacher.data["mediaGeneration"], pupil.data["mediaGeneration"])

    def test_student_cannot_switch_or_disconnect_teacher(self):
        meeting = self._live()
        self.client.force_login(self.student_user)
        switch = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/switch/",
            {"provider": "livekit"},
            format="json",
        )
        self.assertEqual(switch.status_code, 403)
        kick = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/disconnect/",
            {"userId": self.teacher.pk, "blockRejoin": True},
            format="json",
        )
        self.assertEqual(kick.status_code, 403)
        route = MeetingCallRoute.objects.filter(meeting=meeting).first()
        self.assertNotIn(self.teacher.pk, (route.revoked_user_ids if route else []))

    def test_admin_switch_is_idempotent_and_rejects_stale_generation(self):
        meeting = self._live()
        self.client.force_login(self.staff)
        first = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/switch/",
            {"provider": "livekit", "expectedGeneration": 1},
            format="json",
        )
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.data["switched"])
        second = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/switch/",
            {"provider": "livekit", "expectedGeneration": 1},
            format="json",
        )
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.data["switched"])
        self.assertEqual(second.data["generation"], first.data["generation"])
        stale = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/switch/",
            {"provider": "primary", "expectedGeneration": 1},
            format="json",
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.data["code"], "generation_conflict")
        self.assertEqual(MeetingCallRoute.objects.get(meeting=meeting).active_provider, "livekit")

    def test_revoked_student_cannot_refresh_token(self):
        meeting = self._live()
        self.client.force_login(self.staff)
        switched = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/media-route/switch/",
            {"provider": "livekit"},
            format="json",
        )
        self.assertTrue(switched.data["switched"])
        with mock.patch("Cabinet.video_failover.livekit_room_api", return_value=True) as remove:
            self.client.force_login(self.teacher)
            kicked = self.client.post(
                f"/api/video-meetings/{meeting.uuid}/media-route/disconnect/",
                {"userId": self.student_user.pk, "blockRejoin": True},
                format="json",
            )
        self.assertEqual(kicked.status_code, 200)
        self.assertTrue(kicked.data["rejoinBlocked"])
        self.assertTrue(remove.called)
        blocked = self._join(self.student_user, meeting)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.data["code"], "access_revoked")
        self.assertNotIn("jwt", blocked.data)

    def test_two_exhausted_participants_can_move_the_room(self):
        meeting = self._live()
        route = MeetingCallRoute.objects.create(
            meeting=meeting,
            active_provider="meet",
            generation=1,
            livekit_room=meeting.room_name,
            failure_reports=[
                {
                    "userId": 11,
                    "fault": "provider_outage",
                    "confirmed": True,
                    "attemptsExhausted": True,
                    "moderator": False,
                    "at": timezone.now().isoformat(),
                    "code": "jitsi_script",
                },
                {
                    "userId": 12,
                    "fault": "provider_outage",
                    "confirmed": True,
                    "attemptsExhausted": True,
                    "moderator": False,
                    "at": timezone.now().isoformat(),
                    "code": "jitsi_script",
                },
            ],
        )
        from types import SimpleNamespace

        self.assertTrue(_auto_switch_allowed(
            route,
            self.student_user,
            SimpleNamespace(is_moderator=False),
            timezone.now(),
        ))

    def test_jaas_only_does_not_auto_switch(self):
        meeting = self._live()
        with override_settings(VIDEO_FAILOVER_MODE="jaas_only"):
            self.client.force_login(self.teacher)
            res = self.client.post(
                f"/api/video-meetings/{meeting.uuid}/media-route/fault/",
                {"fault": "provider_outage", "confirmed": True, "attemptsExhausted": True},
                format="json",
            )
        self.assertFalse(res.data["switched"])
        self.assertEqual(MeetingCallRoute.objects.get(meeting=meeting).active_provider, "meet")

    def test_livekit_requires_wss_and_a_long_secret(self):
        self.assertTrue(livekit_is_configured())
        with override_settings(LIVEKIT_URL="ws://video.example.test"):
            self.assertFalse(livekit_is_configured())
        with override_settings(LIVEKIT_API_SECRET="short-secret"):
            self.assertFalse(livekit_is_configured())
