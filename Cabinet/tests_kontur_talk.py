"""Контур.Толк не подменяет Jitsi/8x8 и LiveKit и не отдаёт API-ключ."""

from datetime import timedelta
from io import BytesIO
from threading import Thread
from unittest import mock
from urllib.error import HTTPError

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.kontur_talk import room_name_for_meeting
from Cabinet.kontur_talk_models import KonturTalkRoom
from Cabinet.models import Profile, Student, VideoMeeting
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import get_or_create_meeting_for_event, start_meeting

API_KEY = "kontur-secret-key-do-not-leak"
SPACE = "itflux"


class _FakeResponse:
    def __init__(self, status=200):
        self.status = status

    def read(self, _n=-1):
        return b""

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def _capture_urlopen(calls):
    def _urlopen(request, timeout=10):
        calls.append(request)
        return _FakeResponse()

    return _urlopen


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
    KONTUR_TALK_ENABLED=True,
    KONTUR_TALK_SPACE=SPACE,
    KONTUR_TALK_API_KEY=API_KEY,
)
class KonturTalkApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="kt_teacher", password="pass")
        Profile.objects.filter(user=self.teacher).update(role=Profile.Role.TEACHER, name="Анна", surname="Учитель")
        self.student_user = User.objects.create_user(username="kt_student", password="pass")
        Profile.objects.filter(user=self.student_user).update(role=Profile.Role.STUDENT, name="Иван", surname="Ученик")
        self.outsider = User.objects.create_user(username="kt_outsider", password="pass")
        Profile.objects.filter(user=self.outsider).update(role=Profile.Role.STUDENT)
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Ученик",
            status="active",
        )
        self.meeting = self._live_meeting("Урок Контур")
        self.calls = []

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

    def _post(self, user, meeting):
        self.client.force_login(user)
        with mock.patch("Cabinet.kontur_talk.urllib_request.urlopen", _capture_urlopen(self.calls)):
            return self.client.post(f"/api/video-meetings/{meeting.uuid}/kontur-talk/", {}, format="json")

    def test_teacher_and_student_share_one_room(self):
        with self.assertLogs("Cabinet.kontur_talk", level="INFO") as logs:
            teacher = self._post(self.teacher, self.meeting)
            student = self._post(self.student_user, self.meeting)
        self.assertEqual(teacher.status_code, 200)
        self.assertEqual(student.status_code, 200)
        self.assertEqual(teacher.data["provider"], "kontur_talk")
        self.assertEqual(teacher.data["url"], student.data["url"])
        self.assertEqual(teacher.data["roomName"], f"itflux-{self.meeting.uuid.hex}")
        self.assertNotEqual(teacher.data["roomName"], f"itflux-{self.meeting.pk}")
        self.assertEqual(KonturTalkRoom.objects.filter(meeting=self.meeting).count(), 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0].get_method(), "PUT")
        self.assertEqual(
            self.calls[0].full_url,
            f"https://{SPACE}.ktalk.ru/api/Rooms/{teacher.data['roomName']}",
        )
        self.assertEqual(self.calls[0].get_header("X-auth-token"), API_KEY)
        body = self.calls[0].data.decode("utf-8")
        self.assertIn('"allowAnonymous": true', body)
        self.assertIn('"enableLobby": true', body)
        self.assertIn('"moderatorKeys": []', body)
        self.assertNotIn(API_KEY, body)
        self.assertNotIn(API_KEY, str(teacher.data))
        self.assertNotIn(API_KEY, "\n".join(logs.output))
        self.assertEqual(
            teacher.data["url"],
            f"https://{SPACE}.ktalk.ru/{teacher.data['roomName']}",
        )

    def test_repeat_open_does_not_create_another_room(self):
        first = self._post(self.teacher, self.meeting)
        second = self._post(self.student_user, self.meeting)
        self.assertEqual(first.data["roomName"], second.data["roomName"])
        self.assertEqual(KonturTalkRoom.objects.count(), 1)
        self.assertEqual(len(self.calls), 1)

    def test_different_lessons_get_different_rooms(self):
        other = self._live_meeting("Второй урок")
        first = self._post(self.teacher, self.meeting)
        second = self._post(self.teacher, other)
        self.assertNotEqual(first.data["roomName"], second.data["roomName"])
        self.assertEqual(second.data["roomName"], room_name_for_meeting(other))
        self.assertEqual(KonturTalkRoom.objects.count(), 2)
        self.assertEqual(len(self.calls), 2)

    def test_outsider_gets_no_link_and_no_room(self):
        res = self._post(self.outsider, self.meeting)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.calls, [])
        self.assertEqual(KonturTalkRoom.objects.count(), 0)
        self.assertNotIn(API_KEY, str(res.data))

    def test_scheduled_meeting_does_not_create_room(self):
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
        res = self._post(self.teacher, meeting)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data.get("code"), "not_live")
        self.assertEqual(self.calls, [])
        self.assertFalse(KonturTalkRoom.objects.filter(meeting=meeting).exists())

    def test_join_config_stays_on_current_provider(self):
        self.client.force_login(self.teacher)
        res = self.client.post(f"/api/video-meetings/{self.meeting.uuid}/join-config/", {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["provider"], "meet")
        self.assertNotIn("ktalk.ru", str(res.data["domain"]))
        detail = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/")
        self.assertEqual(detail.data["konturTalk"], {"id": "kontur_talk", "available": True})
        self.assertNotIn(API_KEY, str(detail.data))

    def test_remote_failure_does_not_keep_room_or_leak_key(self):
        def _fail(request, timeout=10):
            raise HTTPError(request.full_url, 401, "unauthorized", hdrs=None, fp=BytesIO(API_KEY.encode()))

        self.client.force_login(self.teacher)
        with mock.patch("Cabinet.kontur_talk.urllib_request.urlopen", _fail):
            with self.assertLogs("Cabinet.kontur_talk", level="WARNING") as logs:
                res = self.client.post(
                    f"/api/video-meetings/{self.meeting.uuid}/kontur-talk/",
                    {},
                    format="json",
                )
        self.assertEqual(res.status_code, 503)
        self.assertNotIn(API_KEY, str(res.data))
        self.assertNotIn(API_KEY, "\n".join(logs.output))
        self.assertFalse(KonturTalkRoom.objects.filter(meeting=self.meeting).exists())

    @override_settings(KONTUR_TALK_ENABLED=False)
    def test_disabled_flag_hides_provider_and_keeps_join_config(self):
        self.client.force_login(self.teacher)
        with mock.patch("Cabinet.kontur_talk.urllib_request.urlopen", side_effect=AssertionError("network")):
            hidden = self.client.post(f"/api/video-meetings/{self.meeting.uuid}/kontur-talk/", {}, format="json")
        self.assertEqual(hidden.status_code, 404)
        self.assertEqual(hidden.data.get("code"), "kontur_disabled")
        self.assertEqual(KonturTalkRoom.objects.count(), 0)
        detail = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/")
        self.assertEqual(detail.data["konturTalk"]["available"], False)
        join = self.client.post(f"/api/video-meetings/{self.meeting.uuid}/join-config/", {}, format="json")
        self.assertEqual(join.status_code, 200)
        self.assertEqual(join.data["provider"], "meet")


@override_settings(
    KONTUR_TALK_ENABLED=True,
    KONTUR_TALK_SPACE=SPACE,
    KONTUR_TALK_API_KEY=API_KEY,
)
class KonturTalkConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="kt_race_teacher", password="pass")
        Profile.objects.filter(user=self.teacher).update(role=Profile.Role.TEACHER)
        self.student_user = User.objects.create_user(username="kt_race_student", password="pass")
        Profile.objects.filter(user=self.student_user).update(role=Profile.Role.STUDENT)
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Ученик",
            status="active",
        )
        now = timezone.now()
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Гонка комнат",
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
        self.meeting = VideoMeeting.objects.get(pk=meeting.pk)

    def test_parallel_open_creates_one_room(self):
        from Cabinet.kontur_talk import issue_kontur_talk_link

        calls = []

        def _slow(request, timeout=10):
            calls.append(request.full_url)
            return _FakeResponse()

        errors = []

        def _open(user):
            close_old_connections()
            try:
                issue_kontur_talk_link(meeting=self.meeting, user=user)
            except Exception as exc:  # noqa: BLE001 — тест собирает ошибки потоков
                errors.append(exc)
            finally:
                close_old_connections()

        with mock.patch("Cabinet.kontur_talk.urllib_request.urlopen", _slow):
            threads = [
                Thread(target=_open, args=(self.teacher,)),
                Thread(target=_open, args=(self.student_user,)),
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(5)

        self.assertEqual(errors, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(KonturTalkRoom.objects.filter(meeting=self.meeting).count(), 1)
        self.assertEqual(
            KonturTalkRoom.objects.get(meeting=self.meeting).room_name,
            room_name_for_meeting(self.meeting),
        )
