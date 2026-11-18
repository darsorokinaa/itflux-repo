"""Статистика звонка: белый список полей, доступ, лимиты и сводка для персонала."""

import json
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.call_stats import MAX_BODY_BYTES, clean_call_stats, has_metrics
from Cabinet.call_stats_models import CallStatsSample
from Cabinet.models import Profile, Student
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import get_or_create_meeting_for_event, start_meeting

SAMPLE = {
    "provider": "livekit",
    "rtt_ms": 84.4,
    "jitter_ms": 12,
    "loss_in_pct": 3.456,
    "loss_out_pct": 0,
    "bitrate_in_kbps": 1450.7,
    "bitrate_out_kbps": 620,
    "audio_out_kbps": 47,
    "share_direction": "send",
    "share_fps": 7.5,
    "share_width": 1920,
    "share_height": 1080,
    "quality_limitation": "bandwidth",
    "connection_type": "relay",
    "transport": "udp",
    "connection_quality": "poor",
    "reconnects": 2,
}


class CleanCallStatsTests(SimpleTestCase):
    def test_keeps_only_known_fields(self):
        cleaned = clean_call_stats(
            {**SAMPLE, "ip": "10.0.0.1", "name": "Иван", "ua": "Chrome"}
        )
        self.assertNotIn("ip", cleaned)
        self.assertNotIn("name", cleaned)
        self.assertNotIn("ua", cleaned)
        self.assertEqual(cleaned["rtt_ms"], 84)
        self.assertEqual(cleaned["loss_in_pct"], 3.46)
        self.assertEqual(cleaned["connection_type"], "relay")

    def test_drops_garbage_and_clamps(self):
        cleaned = clean_call_stats(
            {
                "rtt_ms": float("nan"),
                "jitter_ms": -5,
                "loss_in_pct": 250,
                "share_fps": True,
                "bitrate_in_kbps": "900",
                "connection_type": "vpn",
                "provider": "zoom",
            }
        )
        self.assertEqual(cleaned, {"loss_in_pct": 100.0})

    def test_needs_at_least_one_metric(self):
        self.assertFalse(
            has_metrics(clean_call_stats({"reconnects": 3, "provider": "livekit"}))
        )
        self.assertTrue(has_metrics(clean_call_stats({"rtt_ms": 10})))
        self.assertEqual(clean_call_stats(["rtt_ms", 10]), {})


@override_settings(
    VIDEO_FAILOVER_ENABLED=False,
    VIDEO_PROVIDER="meet",
    JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="none",
)
class CallStatsApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.teacher = User.objects.create_user("cs_teacher", None, "pass")
        Profile.objects.filter(user=self.teacher).update(role=Profile.Role.TEACHER)
        self.student_user = User.objects.create_user("cs_student", None, "pass")
        Profile.objects.filter(user=self.student_user).update(role=Profile.Role.STUDENT)
        self.outsider = User.objects.create_user("cs_outsider", None, "pass")
        Profile.objects.filter(user=self.outsider).update(role=Profile.Role.STUDENT)
        self.staff = User.objects.create_user("cs_staff", None, "pass", is_staff=True)
        student = Student.objects.create(
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
                "title": "Урок",
                "starts_at": now + timedelta(minutes=5),
                "ends_at": now + timedelta(minutes=50),
                "event_type": "individual_lesson",
                "format": "online",
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
        self.meeting, _ = get_or_create_meeting_for_event(
            event=event, created_by=self.teacher
        )
        start_meeting(meeting=self.meeting, user=self.teacher)
        self.url = f"/api/video-meetings/{self.meeting.uuid}/call-stats/"

    def _post(self, user, payload):
        self.client.force_login(user)
        return self.client.post(self.url, payload, format="json")

    def test_participants_store_samples_without_extra_fields(self):
        response = self._post(self.student_user, {**SAMPLE, "email": "x@example.test"})
        self.assertEqual(response.status_code, 201)
        sample = CallStatsSample.objects.get(pk=response.json()["id"])
        self.assertEqual(sample.meeting_id, self.meeting.pk)
        self.assertEqual(sample.user_id, self.student_user.pk)
        self.assertEqual(sample.share_height, 1080)
        self.assertEqual(sample.reconnects, 2)
        self.assertEqual(self._post(self.teacher, SAMPLE).status_code, 201)

    def test_outsider_and_anonymous_are_rejected(self):
        self.assertEqual(self._post(self.outsider, SAMPLE).status_code, 403)
        self.client.logout()
        anonymous = self.client.post(self.url, SAMPLE, format="json")
        self.assertIn(anonymous.status_code, (401, 403))
        self.assertFalse(CallStatsSample.objects.exists())

    def test_rejects_large_and_empty_reports(self):
        self.client.force_login(self.student_user)
        big = json.dumps({**SAMPLE, "pad": "x" * (MAX_BODY_BYTES + 10)})
        response = self.client.post(self.url, big, content_type="application/json")
        self.assertEqual(response.status_code, 413)
        self.assertEqual(
            self._post(self.student_user, {"provider": "livekit"}).status_code, 400
        )
        self.assertFalse(CallStatsSample.objects.exists())

    def test_rate_limited_per_user(self):
        codes = [self._post(self.student_user, SAMPLE).status_code for _ in range(7)]
        self.assertEqual(codes[:6], [201] * 6)
        self.assertEqual(codes[6], 429)
        self.assertEqual(self._post(self.teacher, SAMPLE).status_code, 201)

    def test_summary_is_staff_only(self):
        self._post(self.student_user, SAMPLE)
        self._post(
            self.student_user, {**SAMPLE, "rtt_ms": 200, "connection_type": "direct"}
        )
        self.client.force_login(self.teacher)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.client.force_login(self.staff)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        rows = response.json()["participants"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["userId"], self.student_user.pk)
        self.assertEqual(rows[0]["samples"], 2)
        self.assertEqual(rows[0]["rttMaxMs"], 200)
        self.assertEqual(rows[0]["relaySharePct"], 50.0)

    def test_admin_changelist_renders_totals(self):
        self._post(self.student_user, SAMPLE)
        self.staff.is_superuser = True
        self.staff.save(update_fields=["is_superuser"])
        self.client.force_login(self.staff)
        response = self.client.get("/admin/Cabinet/callstatssample/")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Снимков:")
