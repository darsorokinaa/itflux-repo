"""JaaS JWT выдаётся только участникам урока и только на backend."""

from datetime import timedelta
import uuid

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.jaas_service import load_jaas_private_key, normalize_jaas_private_key
from Cabinet.jitsi_service import decode_jitsi_jwt_unsafe_for_tests
from Cabinet.models import Profile, Student, VideoMeeting
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import get_or_create_meeting_for_event, start_meeting


def _test_private_key_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")


JAAS_APP_ID = "vpaas-magic-cookie-test"
JAAS_KEY_ID = "test-key-id"
JAAS_PRIVATE_KEY = _test_private_key_pem()


def _public_pem(private_pem: str) -> str:
    private = serialization.load_pem_private_key(private_pem.encode("ascii"), password=None)
    return private.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")


JAAS_PUBLIC_KEY = _public_pem(JAAS_PRIVATE_KEY)


@override_settings(
    VIDEO_PROVIDER="jaas",
    JAAS_APP_ID=JAAS_APP_ID,
    JAAS_API_KEY_ID=JAAS_KEY_ID,
    JAAS_PRIVATE_KEY=JAAS_PRIVATE_KEY,
    JAAS_PRIVATE_KEY_PATH="",
    JAAS_TOKEN_TTL_SECONDS=7200,
)
class JaasVideoTokenTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="jaas_teacher", password="pass", email="t@test.ru")
        Profile.objects.filter(user=self.teacher).update(
            role=Profile.Role.TEACHER, name="Анна", surname="Учитель"
        )
        self.student_user = User.objects.create_user(
            username="jaas_student", password="pass", email="s@test.ru", first_name="Иван", last_name="Ученик"
        )
        Profile.objects.filter(user=self.student_user).update(
            role=Profile.Role.STUDENT, name="Иван", surname="Ученик"
        )
        self.outsider = User.objects.create_user(username="jaas_outsider", password="pass")
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
                "title": "Урок JaaS",
                "starts_at": now + timedelta(minutes=5),
                "ends_at": now + timedelta(minutes=50),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )

    def _live_meeting(self, event=None):
        meeting, _created = get_or_create_meeting_for_event(
            event=event or self.event,
            created_by=self.teacher,
        )
        return start_meeting(meeting=meeting, user=self.teacher)

    def _join(self, meeting, user=None, payload=None):
        if user is not None:
            self.client.force_login(user)
        return self.client.post(
            f"/api/video-meetings/{meeting.uuid}/join-config/",
            payload or {},
            format="json",
        )

    def _claims(self, token):
        return jwt.decode(
            token,
            JAAS_PUBLIC_KEY,
            algorithms=["RS256"],
            audience="jitsi",
            issuer="chat",
        )

    def test_teacher_receives_moderator_jwt_for_stable_room(self):
        meeting = self._live_meeting()
        with self.assertLogs("Cabinet.jaas_service", level="INFO") as logs:
            res = self._join(meeting, self.teacher)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["provider"], "jaas")
        self.assertEqual(res.data["domain"], "8x8.vc")
        self.assertEqual(res.data["appId"], JAAS_APP_ID)
        self.assertEqual(res.data["roomName"], meeting.room_name)
        self.assertEqual(res.data["externalRoomName"], f"{JAAS_APP_ID}/{meeting.room_name}")
        self.assertEqual(res.data["scriptUrl"], f"https://8x8.vc/{JAAS_APP_ID}/external_api.js")
        self.assertTrue(res.data["meeting"]["isModerator"])
        token = res.data["jwt"]
        header = jwt.get_unverified_header(token)
        self.assertEqual(header["alg"], "RS256")
        self.assertEqual(header["kid"], f"{JAAS_APP_ID}/{JAAS_KEY_ID}")
        claims = self._claims(token)
        self.assertEqual(claims["sub"], JAAS_APP_ID)
        self.assertEqual(claims["room"], meeting.room_name)
        self.assertNotEqual(claims["room"], "*")
        self.assertEqual(claims["context"]["user"]["moderator"], "true")
        self.assertEqual(claims["context"]["user"]["id"], str(self.teacher.pk))
        self.assertNotIn("PRIVATE KEY", str(res.data))
        self.assertNotIn(JAAS_PRIVATE_KEY, str(res.data))
        self.assertTrue(any("JaaS token issued" in line and f"user_id={self.teacher.pk}" in line for line in logs.output))
        self.assertFalse(any(token in line or "PRIVATE KEY" in line for line in logs.output))

    def test_student_jwt_is_not_moderator_even_if_client_asks(self):
        meeting = self._live_meeting()
        res = self._join(
            meeting,
            self.student_user,
            {"role": "moderator", "isModerator": True, "moderator": True},
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(res.data["meeting"]["isModerator"])
        claims = self._claims(res.data["jwt"])
        self.assertEqual(claims["context"]["user"]["moderator"], "false")
        self.assertEqual(claims["room"], meeting.room_name)
        self.assertEqual(res.data["externalRoomName"], f"{JAAS_APP_ID}/{meeting.room_name}")

    def test_outsider_is_forbidden(self):
        meeting = self._live_meeting()
        res = self._join(meeting, self.outsider)
        self.assertEqual(res.status_code, 403)
        self.assertNotIn("jwt", res.data)

    def test_anonymous_is_rejected(self):
        meeting = self._live_meeting()
        self.client.logout()
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/join-config/", {}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_missing_meeting_is_404(self):
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{uuid.uuid4()}/join-config/", {}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_different_lessons_get_different_rooms(self):
        other_student_user = User.objects.create_user(username="jaas_student_2", password="pass")
        Profile.objects.filter(user=other_student_user).update(role=Profile.Role.STUDENT)
        other_student = Student.objects.create(
            teacher=self.teacher,
            user=other_student_user,
            first_name="Пётр",
            last_name="Второй",
            status="active",
        )
        now = timezone.now()
        other_event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Второй урок JaaS",
                "starts_at": now + timedelta(minutes=5),
                "ends_at": now + timedelta(minutes=50),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[other_student.pk],
            notify=False,
        )
        first = self._live_meeting()
        second = self._live_meeting(other_event)
        self.client.force_login(self.teacher)
        res_a = self.client.post(f"/api/video-meetings/{first.uuid}/join-config/", {}, format="json")
        res_b = self.client.post(f"/api/video-meetings/{second.uuid}/join-config/", {}, format="json")
        self.assertEqual(res_a.status_code, 200)
        self.assertEqual(res_b.status_code, 200)
        self.assertNotEqual(res_a.data["roomName"], res_b.data["roomName"])
        self.assertNotEqual(res_a.data["externalRoomName"], res_b.data["externalRoomName"])
        self.assertNotEqual(VideoMeeting.objects.get(pk=first.pk).room_name, second.room_name)

    @override_settings(
        VIDEO_PROVIDER="jaas",
        JAAS_APP_ID="",
        JAAS_API_KEY_ID="",
        JAAS_PRIVATE_KEY="",
        JAAS_PRIVATE_KEY_PATH="",
    )
    def test_missing_jaas_config_is_503(self):
        meeting = self._live_meeting()
        res = self._join(meeting, self.teacher)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data.get("code"), "jwt_config")
        self.assertNotIn("PRIVATE KEY", str(res.data))
        self.assertNotIn("jwt", res.data)

    @override_settings(
        VIDEO_PROVIDER="meet",
        JITSI_DOMAIN="meet.example.test",
        JITSI_AUTH_MODE="jwt",
        JITSI_APP_ID="itflux-test",
        JITSI_APP_SECRET="test-secret-not-for-production-32b",
        JITSI_SUB="meet.example.test",
        JITSI_AUD="jitsi",
    )
    def test_meet_provider_keeps_existing_jitsi(self):
        meeting = self._live_meeting()
        res = self._join(meeting, self.teacher)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["provider"], "meet")
        self.assertEqual(res.data["domain"], "meet.example.test")
        self.assertEqual(res.data["externalRoomName"], meeting.room_name)
        self.assertEqual(res.data["scriptUrl"], "https://meet.example.test/libs/external_api.min.js")
        header = jwt.get_unverified_header(res.data["jwt"])
        self.assertEqual(header["alg"], "HS256")
        claims = decode_jitsi_jwt_unsafe_for_tests(res.data["jwt"])
        self.assertEqual(claims["room"], meeting.room_name)


class JaasPrivateKeyParsingTests(TestCase):
    def test_literal_newlines_in_env_become_pem(self):
        escaped = JAAS_PRIVATE_KEY.replace("\n", "\\n")
        self.assertNotIn("\n", escaped)
        restored = normalize_jaas_private_key(escaped)
        self.assertIn("BEGIN PRIVATE KEY", restored)
        self.assertIn("\n", restored)

    @override_settings(JAAS_PRIVATE_KEY="", JAAS_PRIVATE_KEY_PATH="")
    def test_empty_config_does_not_invent_a_key(self):
        self.assertEqual(load_jaas_private_key(), "")
