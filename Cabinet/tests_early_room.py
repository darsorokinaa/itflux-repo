"""Ранний вход ученика: окно [начало −15 мин, конец], экран ожидания, безопасность JWT."""

from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.early_room import (
    EARLY_ENTRY_BEFORE,
    early_entry_state,
    early_entry_window,
    ensure_meeting_for_student_early_entry,
)
from Cabinet.models import Homework, Profile, ScheduleEvent, Student, StudentGroup, VideoMeeting
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import (
    VideoMeetingError,
    build_join_config,
    get_or_create_meeting_for_event,
    start_meeting,
)

JITSI = dict(
    VIDEO_FAILOVER_ENABLED=False,
    VIDEO_PROVIDER="meet",
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


def _user(username, role, **kw):
    user = User.objects.create_user(username=username, password="pass", **kw)
    Profile.objects.filter(user=user).update(role=role)
    return User.objects.get(pk=user.pk)


@override_settings(**JITSI)
class EarlyRoomTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = _user("er_teacher", Profile.Role.TEACHER)
        self.student_user = _user("er_student", Profile.Role.STUDENT, first_name="Иван")
        self.other_user = _user("er_other", Profile.Role.STUDENT)
        self.student = Student.objects.create(
            teacher=self.teacher, user=self.student_user, first_name="Иван", last_name="У", status="active"
        )
        # Ученик того же учителя, но не этого урока.
        self.other = Student.objects.create(
            teacher=self.teacher, user=self.other_user, first_name="Пётр", last_name="Д", status="active"
        )
        self.starts = timezone.now() + timedelta(hours=2)
        self.ends = self.starts + timedelta(minutes=60)
        self.event = self._event(self.starts, self.ends, student_ids=[self.student.pk])

    def _event(self, starts, ends, **kw):
        return create_single_event(
            teacher=self.teacher,
            data={
                "title": "Урок",
                "starts_at": starts,
                "ends_at": ends,
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            notify=False,
            **kw,
        )

    # --- окно ---------------------------------------------------------------
    def test_window_bounds(self):
        opens, closes = early_entry_window(self.event)
        self.assertEqual(opens, self.starts - timedelta(minutes=15))
        self.assertEqual(closes, self.ends)
        self.assertEqual(EARLY_ENTRY_BEFORE, timedelta(minutes=15))

    def test_state_by_time(self):
        s = self.starts
        self.assertEqual(early_entry_state(self.event, None, now=s - timedelta(minutes=16)), "too_early")
        self.assertEqual(early_entry_state(self.event, None, now=s - timedelta(minutes=15)), "open")
        self.assertEqual(early_entry_state(self.event, None, now=s - timedelta(minutes=1)), "open")
        self.assertEqual(early_entry_state(self.event, None, now=self.ends), "open")
        self.assertEqual(early_entry_state(self.event, None, now=self.ends + timedelta(seconds=1)), "closed")

    def test_cancelled_and_offline_not_eligible(self):
        ScheduleEvent.objects.filter(pk=self.event.pk).update(status=ScheduleEvent.Status.CANCELLED)
        self.event.refresh_from_db()
        self.assertEqual(early_entry_state(self.event, None, now=self.starts), "not_eligible")
        offline = self._event(self.starts, self.ends, student_ids=[self.student.pk])
        ScheduleEvent.objects.filter(pk=offline.pk).update(format=ScheduleEvent.Format.OFFLINE)
        offline.refresh_from_db()
        self.assertEqual(early_entry_state(offline, None, now=self.starts), "not_eligible")

    def test_external_manual_link_not_replaced(self):
        ScheduleEvent.objects.filter(pk=self.event.pk).update(
            meeting_provider="manual", telemost_url="https://telemost.example/abc"
        )
        self.event.refresh_from_db()
        self.assertEqual(early_entry_state(self.event, None, now=self.starts), "not_eligible")

    def test_timezone_teacher_vladivostok_student_kaliningrad(self):
        """Урок в 18:00 по Владивостоку = 08:00 UTC; окно не зависит от поясов."""
        Profile.objects.filter(user=self.teacher).update(timezone="Asia/Vladivostok")
        Profile.objects.filter(user=self.student_user).update(timezone="Europe/Kaliningrad")
        day = (timezone.now() + timedelta(days=3)).date()
        starts = datetime(day.year, day.month, day.day, 18, 0, tzinfo=ZoneInfo("Asia/Vladivostok"))
        event = self._event(starts, starts + timedelta(minutes=60), student_ids=[self.student.pk])
        event.refresh_from_db()
        utc_start = datetime(day.year, day.month, day.day, 8, 0, tzinfo=ZoneInfo("UTC"))
        self.assertEqual(event.starts_at, utc_start)
        # 09:44 по Калининграду (UTC+2) = 07:44 UTC — ещё рано; 09:45 — открыто.
        kal = ZoneInfo("Europe/Kaliningrad")
        too_early = datetime(day.year, day.month, day.day, 9, 44, tzinfo=kal)
        on_time = datetime(day.year, day.month, day.day, 9, 45, tzinfo=kal)
        self.assertEqual(early_entry_state(event, None, now=too_early), "too_early")
        self.assertEqual(early_entry_state(event, None, now=on_time), "open")

    # --- доступ ------------------------------------------------------------
    def _post_entry(self, user, event=None):
        self.client.force_login(user)
        return self.client.post(f"/api/video-meetings/for-event/{(event or self.event).pk}/early-entry/")

    def test_student_too_early_rejected_and_no_meeting_created(self):
        res = self._post_entry(self.student_user)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "too_early")
        self.assertFalse(VideoMeeting.objects.filter(schedule_event=self.event).exists())

    def test_student_in_window_gets_scheduled_room_without_jwt(self):
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts - timedelta(minutes=10)):
            res = self._post_entry(self.student_user)
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["pageUrl"].startswith("/cabinet/meetings/"))
        self.assertNotIn("jwt", str(res.data).lower())
        meeting = VideoMeeting.objects.get(schedule_event=self.event)
        self.assertEqual(meeting.status, VideoMeeting.Status.SCHEDULED)
        self.assertIsNone(meeting.actual_started_at)
        self.assertEqual(meeting.created_by_id, self.teacher.pk)

    def test_after_end_rejected(self):
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.ends + timedelta(minutes=1)):
            res = self._post_entry(self.student_user)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "window_closed")

    def test_outsider_and_other_student_forbidden(self):
        outsider = _user("er_outsider", Profile.Role.STUDENT)
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            self.assertEqual(self._post_entry(outsider).status_code, 403)
            self.assertEqual(self._post_entry(self.other_user).status_code, 403)
        self.assertFalse(VideoMeeting.objects.filter(schedule_event=self.event).exists())

    def test_group_member_allowed_non_member_forbidden(self):
        group = StudentGroup.objects.create(teacher=self.teacher, title="Г", status="active")
        group.students.add(self.student)
        event = self._event(self.starts, self.ends, group_id=group.pk)
        ScheduleEvent.objects.filter(pk=event.pk).update(group=group, student=None)
        event.refresh_from_db()
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            self.assertEqual(self._post_entry(self.other_user, event).status_code, 403)
            self.assertEqual(self._post_entry(self.student_user, event).status_code, 200)

    def test_teacher_cannot_use_student_entry(self):
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            self.assertEqual(self._post_entry(self.teacher).status_code, 403)

    # --- безопасность комнаты ---------------------------------------------
    def test_no_join_config_before_teacher_start(self):
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            meeting = ensure_meeting_for_student_early_entry(user=self.student_user, event=self.event)
        with self.assertRaises(VideoMeetingError) as ctx:
            build_join_config(meeting=meeting, user=self.student_user)
        self.assertEqual(ctx.exception.code, "not_live")
        self.client.force_login(self.student_user)
        res = self.client.get(f"/api/video-meetings/{meeting.uuid}/join-config/")
        self.assertEqual(res.status_code, 409)
        self.assertNotIn("jwt", res.data)

    def test_student_cannot_start_and_teacher_start_unaffected(self):
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            meeting = ensure_meeting_for_student_early_entry(user=self.student_user, event=self.event)
        self.client.force_login(self.student_user)
        res = self.client.post(f"/api/video-meetings/{meeting.uuid}/start/")
        self.assertEqual(res.status_code, 403)
        meeting.refresh_from_db()
        self.assertEqual(meeting.status, VideoMeeting.Status.SCHEDULED)
        # Учитель видит ту же комнату и стартует как обычно.
        same, created = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        self.assertFalse(created)
        self.assertEqual(same.pk, meeting.pk)
        started = start_meeting(meeting=same, user=self.teacher)
        self.assertEqual(started.status, VideoMeeting.Status.LIVE)
        cfg = build_join_config(meeting=started, user=self.student_user)
        self.assertFalse(cfg["meeting"]["isModerator"])
        from Cabinet.jitsi_service import decode_jitsi_jwt_unsafe_for_tests

        claims = decode_jitsi_jwt_unsafe_for_tests(cfg["jwt"])
        user_claim = (claims.get("context") or {}).get("user") or {}
        self.assertNotIn(str(user_claim.get("moderator", "false")).lower(), ("true", "1"))
        teacher_cfg = build_join_config(meeting=started, user=self.teacher)
        self.assertTrue(teacher_cfg["meeting"]["isModerator"])

    # --- экран ожидания -----------------------------------------------------
    def test_waiting_room_payload(self):
        Homework.objects.create(
            teacher=self.teacher, student=self.student, title="Дроби", status="assigned"
        )
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts - timedelta(minutes=5)):
            meeting = ensure_meeting_for_student_early_entry(user=self.student_user, event=self.event)
            self.client.force_login(self.student_user)
            res = self.client.get(f"/api/video-meetings/{meeting.uuid}/waiting-room/")
        self.assertEqual(res.status_code, 200, res.data)
        hw = res.data["reminders"]["homework"]
        self.assertEqual(len(hw), 1)
        self.assertEqual(hw[0]["href"], f"/cabinet/student/assignments/{hw[0]['id']}")
        self.assertIn("ещё не сдано", hw[0]["text"])
        self.assertIsNone(res.data["reminders"]["previousTopic"])
        self.assertEqual(res.data["materials"], [])
        blob = str(res.data)
        self.assertNotIn("jwt", blob.lower())

    def test_waiting_room_forbidden_outside_window_and_for_others(self):
        meeting, _ = get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        self.client.force_login(self.student_user)
        res = self.client.get(f"/api/video-meetings/{meeting.uuid}/waiting-room/")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["code"], "too_early")
        self.client.force_login(self.other_user)
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            res = self.client.get(f"/api/video-meetings/{meeting.uuid}/waiting-room/")
        self.assertEqual(res.status_code, 403)

    def test_previous_topic_from_published_journal(self):
        from Cabinet.journal_models import LessonJournal, StudentLessonRecord

        prev = self._event(
            self.starts - timedelta(days=7), self.ends - timedelta(days=7), student_ids=[self.student.pk]
        )
        journal = LessonJournal.objects.create(
            schedule_event=prev,
            teacher=self.teacher,
            student=self.student,
            lesson_date=prev.starts_at.date(),
            actual_topic="Квадратные уравнения",
        )
        record = StudentLessonRecord.objects.create(journal=journal, student=self.student)
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            meeting = ensure_meeting_for_student_early_entry(user=self.student_user, event=self.event)
            self.client.force_login(self.student_user)
            res = self.client.get(f"/api/video-meetings/{meeting.uuid}/waiting-room/")
            self.assertIsNone(res.data["reminders"]["previousTopic"])  # черновик не показываем
            StudentLessonRecord.objects.filter(pk=record.pk).update(publish_status="published")
            res = self.client.get(f"/api/video-meetings/{meeting.uuid}/waiting-room/")
        self.assertEqual(res.data["reminders"]["previousTopic"]["topic"], "Квадратные уравнения")
        self.assertEqual(res.data["reminders"]["previousTopic"]["text"], "Повторите тему «Квадратные уравнения».")

    def test_student_cards_expose_entry_path(self):
        from Cabinet.student_api import _video_meeting_payload

        payload, _url = _video_meeting_payload(self.event)
        self.assertIsNone(payload["uuid"])
        self.assertEqual(payload["pageUrl"], f"/cabinet/student/lessons/room/{self.event.pk}")
        self.assertTrue(payload["earlyEntry"]["eligible"])
        self.assertFalse(payload["earlyEntry"]["open"])


@override_settings(**JITSI)
class EarlyRoomAttachedMaterialsTests(TestCase):
    """Материалы, прикреплённые к уроку в расписании/плане, — только ученику урока и в окне."""

    setUp = EarlyRoomTests.setUp
    _event = EarlyRoomTests._event

    def _material(self, title, **kw):
        from Cabinet.models import Material

        return Material.objects.create(
            owner=self.teacher, teacher=self.teacher, title=title, status="published", **kw
        )

    def _attach(self, material, event=None):
        from Cabinet.models import ScheduleEventMaterial

        ScheduleEventMaterial.objects.create(event=event or self.event, material=material)

    def _waiting(self, user, now):
        with mock.patch("Cabinet.early_room.timezone.now", return_value=now):
            meeting = VideoMeeting.objects.filter(schedule_event=self.event).first() or \
                get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)[0]
            self.client.force_login(user)
            return self.client.get(f"/api/video-meetings/{meeting.uuid}/waiting-room/")

    def test_schedule_material_shown_in_window_with_student_link(self):
        m = self._material("Конспект", external_url="https://example.org/konspekt")
        self._attach(m)
        res = self._waiting(self.student_user, self.starts - timedelta(minutes=5))
        self.assertEqual(res.status_code, 200, res.data)
        mats = res.data["materials"]
        self.assertEqual([x["id"] for x in mats], [m.id])
        self.assertEqual(mats[0]["href"], "https://example.org/konspekt")

    def test_draft_and_foreign_teacher_material_hidden(self):
        draft = self._material("Черновик")
        type(draft).objects.filter(pk=draft.pk).update(status="draft")
        other_teacher = _user("er_t2", Profile.Role.TEACHER)
        from Cabinet.models import Material

        foreign = Material.objects.create(owner=other_teacher, teacher=other_teacher, title="Чужой", status="published")
        self._attach(draft)
        self._attach(foreign)
        res = self._waiting(self.student_user, self.starts)
        self.assertEqual(res.data["materials"], [])

    def test_file_access_rule_only_in_window_and_only_for_lesson_student(self):
        from Cabinet.files_services import student_can_access_material_file

        m = self._material("Файл урока", file="cabinet/materials/x.pdf")
        self._attach(m)
        get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts - timedelta(minutes=30)):
            self.assertFalse(student_can_access_material_file(self.student_user, m))
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts - timedelta(minutes=10)):
            self.assertTrue(student_can_access_material_file(self.student_user, m))
            self.assertFalse(student_can_access_material_file(self.other_user, m))
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.ends + timedelta(minutes=1)):
            self.assertFalse(student_can_access_material_file(self.student_user, m))
        # Вид ссылки — авторизованный адрес ученика, не публичный /media/.
        res = self._waiting(self.student_user, self.starts)
        self.assertEqual(res.data["materials"][0]["href"], f"/api/cabinet/student/materials/{m.id}/preview/")

    def test_material_download_endpoint_enforces_window(self):
        m = self._material("Файл урока 2", file="cabinet/materials/y.pdf")
        self._attach(m)
        get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        self.client.force_login(self.other_user)
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            res = self.client.get(f"/api/cabinet/student/materials/{m.id}/file/")
        self.assertEqual(res.status_code, 403)
        self.client.force_login(self.student_user)
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts - timedelta(hours=1)):
            res = self.client.get(f"/api/cabinet/student/materials/{m.id}/file/")
        self.assertEqual(res.status_code, 403)

    def test_plan_item_material_included(self):
        from types import SimpleNamespace

        from Cabinet.models import Material

        m = self._material("Из плана")
        item = SimpleNamespace(materials=Material.objects.filter(pk=m.pk))
        with mock.patch("Cabinet.plan_schedule.resolve_plan_item_for_event", return_value=(item, 1)):
            res = self._waiting(self.student_user, self.starts)
        self.assertEqual([x["id"] for x in res.data["materials"]], [m.id])
        self.assertEqual(res.data["materials"][0]["href"], "")

    def test_cabinet_file_rule(self):
        from Cabinet.early_room import student_can_access_waiting_material

        m = self._material("Без файла")
        self._attach(m)
        get_or_create_meeting_for_event(event=self.event, created_by=self.teacher)
        with mock.patch("Cabinet.early_room.timezone.now", return_value=self.starts):
            self.assertTrue(student_can_access_waiting_material(self.student_user, m))
            self.assertFalse(student_can_access_waiting_material(self.other_user, m))
            self.assertFalse(student_can_access_waiting_material(self.teacher, m))
