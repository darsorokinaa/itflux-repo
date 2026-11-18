"""Запасной Телемост не подменяет Jitsi/LiveKit и не отдаёт OAuth-токен."""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import ParticipantRole, ParticipantStatus
from Cabinet.models import Profile, ScheduleEventParticipant, Student, VideoMeeting
from Cabinet.schedule_service import create_single_event
from Cabinet.telemost_models import TelemostConference
from Cabinet.video_meeting_service import get_or_create_meeting_for_event, start_meeting


YANDEX_JOIN_URL = "https://telemost.yandex.ru/j/abc123XYZ"
SERVICE_TOKEN = "unit-test-telemost-token"


class _FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or ""

    def json(self):
        return self._payload


@override_settings(
    VIDEO_FAILOVER_ENABLED=False,
    VIDEO_PROVIDER="meet",
    JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="jwt",
    JITSI_APP_ID="itflux-test",
    JITSI_APP_SECRET="test-secret-not-for-production-32b",
    JITSI_SUB="meet.example.test",
    JITSI_AUD="jitsi",
    JITSI_TOKEN_TTL_SECONDS=3600,
    TELEMOST_BACKUP_ENABLED=True,
    YANDEX_TELEMOST_OAUTH_TOKEN=SERVICE_TOKEN,
    YANDEX_TELEMOST_REFRESH_TOKEN="",
    YANDEX_TELEMOST_CLIENT_ID="",
    YANDEX_TELEMOST_CLIENT_SECRET="",
    YANDEX_TELEMOST_COHOST_EMAIL="someone@example.com",
    YANDEX_ACCOUNT_EMAIL="someone@example.com",
)
class TelemostBackupApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="tm_teacher", password="pass")
        Profile.objects.filter(user=self.teacher).update(
            role=Profile.Role.TEACHER, name="Анна", surname="Учитель",
        )
        self.student_user = User.objects.create_user(username="tm_student", password="pass")
        Profile.objects.filter(user=self.student_user).update(
            role=Profile.Role.STUDENT, name="Иван", surname="Ученик",
        )
        self.outsider = User.objects.create_user(username="tm_outsider", password="pass")
        Profile.objects.filter(user=self.outsider).update(role=Profile.Role.STUDENT)
        self.coteacher = User.objects.create_user(username="tm_coteacher", password="pass")
        Profile.objects.filter(user=self.coteacher).update(
            role=Profile.Role.TEACHER, name="Олег", surname="Соучитель",
        )
        self.staff = User.objects.create_user(username="tm_staff", password="pass", is_staff=True)
        Profile.objects.filter(user=self.staff).update(role=Profile.Role.TEACHER)
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Ученик",
            status="active",
        )
        self.meeting = self._live_meeting("Урок Телемост")
        ScheduleEventParticipant.objects.create(
            event=self.meeting.schedule_event,
            user=self.coteacher,
            teacher=self.coteacher,
            role=ParticipantRole.COTEACHER,
            status=ParticipantStatus.ACCEPTED,
            display_name="Олег Соучитель",
        )

    def _live_meeting(self, title):
        now = timezone.now()
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": title,
                "starts_at": now + timedelta(minutes=5),
                "ends_at": now + timedelta(minutes=50),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        meeting, _created = get_or_create_meeting_for_event(event=event, created_by=self.teacher)
        start_meeting(meeting=meeting, user=self.teacher)
        meeting.refresh_from_db()
        return meeting

    def _post(self, user, meeting=None):
        meeting = meeting or self.meeting
        self.client.force_login(user)
        return self.client.post(f"/api/video-meetings/{meeting.uuid}/telemost/", {}, format="json")

    def test_teacher_and_student_share_one_conference(self):
        yandex = _FakeResponse(201, {"id": "conf-1", "join_url": YANDEX_JOIN_URL})
        with patch("Cabinet.telemost_backup._request_conference", return_value=yandex) as mocked:
            teacher = self._post(self.teacher)
            student = self._post(self.student_user)
        self.assertEqual(teacher.status_code, 200)
        self.assertEqual(student.status_code, 200)
        self.assertEqual(teacher.data["provider"], "telemost")
        self.assertEqual(teacher.data["url"], YANDEX_JOIN_URL)
        self.assertEqual(teacher.data["id"], "conf-1")
        self.assertEqual(student.data["url"], teacher.data["url"])
        self.assertEqual(student.data["id"], teacher.data["id"])
        self.assertEqual(TelemostConference.objects.filter(meeting=self.meeting).count(), 1)
        mocked.assert_called_once_with(SERVICE_TOKEN, {"waiting_room_level": "PUBLIC"})
        self.assertNotIn(SERVICE_TOKEN, str(teacher.data))
        self.assertNotIn(SERVICE_TOKEN, str(student.data))

    def test_coteacher_and_staff_can_create(self):
        yandex = _FakeResponse(201, {"id": "conf-2", "join_url": YANDEX_JOIN_URL})
        with patch("Cabinet.telemost_backup._request_conference", return_value=yandex):
            res = self._post(self.coteacher)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["url"], YANDEX_JOIN_URL)

        other = self._live_meeting("Другой урок")
        yandex2 = _FakeResponse(201, {"id": "conf-3", "join_url": "https://telemost.yandex.ru/j/staffRoom"})
        with patch("Cabinet.telemost_backup._request_conference", return_value=yandex2):
            res = self._post(self.staff, other)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["id"], "conf-3")

    def test_student_cannot_create_before_teacher(self):
        with patch("Cabinet.telemost_backup._request_conference") as mocked:
            res = self._post(self.student_user)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "telemost_not_open")
        self.assertIn("ещё не открыл", res.data["error"])
        mocked.assert_not_called()

    def test_outsider_gets_403(self):
        res = self._post(self.outsider)
        self.assertEqual(res.status_code, 403)

    def test_not_live_returns_409(self):
        now = timezone.now()
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Ещё не начат",
                "starts_at": now + timedelta(minutes=5),
                "ends_at": now + timedelta(minutes=50),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        meeting, _created = get_or_create_meeting_for_event(event=event, created_by=self.teacher)
        with patch("Cabinet.telemost_backup._request_conference") as mocked:
            res = self._post(self.teacher, meeting)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "not_live")
        mocked.assert_not_called()

    def test_detail_and_status_flags_hide_url(self):
        TelemostConference.objects.create(
            meeting=self.meeting,
            conference_id="conf-1",
            join_url=YANDEX_JOIN_URL,
            waiting_room_level="PUBLIC",
        )
        self.client.force_login(self.student_user)
        detail = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["telemost"], {"id": "telemost", "available": True, "open": True})
        self.assertNotIn(YANDEX_JOIN_URL, str(detail.data["telemost"]))
        status = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/status/")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.data["telemost"], {"id": "telemost", "available": True, "open": True})
        self.assertNotIn(YANDEX_JOIN_URL, str(status.data))

    @override_settings(
        YANDEX_TELEMOST_OAUTH_TOKEN="",
        TELEMOST_OAUTH_TOKEN="",
        TELEMOST_REFRESH_TOKEN="",
        YANDEX_TELEMOST_REFRESH_TOKEN="",
        YANDEX_TELEMOST_AUTH_CODE="",
    )
    def test_hidden_when_token_missing(self):
        self.client.force_login(self.teacher)
        detail = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/")
        self.assertEqual(detail.data["telemost"]["available"], False)
        self.assertEqual(detail.data["telemost"]["open"], False)
        with patch("Cabinet.telemost_backup._request_conference") as mocked:
            res = self._post(self.teacher)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["code"], "telemost_not_configured")
        mocked.assert_not_called()

    @override_settings(
        YANDEX_TELEMOST_OAUTH_TOKEN="",
        TELEMOST_OAUTH_TOKEN="alias-service-token",
        TELEMOST_REFRESH_TOKEN="",
        YANDEX_TELEMOST_REFRESH_TOKEN="",
    )
    def test_accepts_telemost_oauth_token_alias(self):
        yandex = _FakeResponse(201, {"id": "alias-1", "join_url": YANDEX_JOIN_URL})
        with patch("Cabinet.telemost_backup._request_conference", return_value=yandex) as mocked:
            res = self._post(self.teacher)
        self.assertEqual(res.status_code, 200)
        mocked.assert_called_once_with("alias-service-token", {"waiting_room_level": "PUBLIC"})

    def test_yandex_401_returns_russian_error_and_does_not_keep_conference(self):
        yandex = _FakeResponse(401, {"error": "Unauthorized"}, text="Unauthorized")
        with patch("Cabinet.telemost_backup._request_conference", return_value=yandex):
            res = self._post(self.teacher)
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.data["code"], "telemost_unauthorized")
        self.assertIn("токен", res.data["error"].lower())
        self.assertFalse(TelemostConference.objects.filter(meeting=self.meeting).exists())
        self.assertNotIn(SERVICE_TOKEN, str(res.data))

    def test_yandex_403_and_429(self):
        forbidden = _FakeResponse(403, {"error": "Forbidden"})
        with patch("Cabinet.telemost_backup._request_conference", return_value=forbidden):
            res = self._post(self.teacher)
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.data["code"], "telemost_forbidden")

        limited = _FakeResponse(429, {"error": "TooManyRequests"})
        with patch("Cabinet.telemost_backup._request_conference", return_value=limited):
            res = self._post(self.teacher)
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.data["code"], "telemost_rate_limited")
        self.assertIn("Подождите", res.data["error"])

    def test_join_config_stays_on_meet(self):
        self.client.force_login(self.teacher)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/join-config/",
            {},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data.get("provider"), "meet")

    def test_rejects_leaked_secret_in_yandex_payload(self):
        yandex = _FakeResponse(
            201,
            {"id": "bad", "join_url": YANDEX_JOIN_URL, "token": SERVICE_TOKEN},
        )
        with patch("Cabinet.telemost_backup._request_conference", return_value=yandex):
            res = self._post(self.teacher)
        self.assertEqual(res.status_code, 502)
        self.assertFalse(TelemostConference.objects.filter(meeting=self.meeting).exists())
        self.assertNotIn(SERVICE_TOKEN, str(res.data))
