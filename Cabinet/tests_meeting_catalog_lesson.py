"""Каталожный урок в комнате: HTML сразу, без карточки покупки."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.lesson_access import ACCESS_LOCKED, ACCESS_MEETING, LessonAccessService
from Cabinet.meeting_catalog_lesson import (
    catalog_lesson_slug_from_url,
    meeting_lesson_content_url,
    url_refers_to_catalog_lesson,
)
from Cabinet.models import Profile, Student
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import get_or_create_meeting_for_event, start_meeting
from Generator.models import Lesson


class CatalogLessonUrlTests(TestCase):
    def test_preview_and_viewer_urls(self):
        self.assertEqual(
            catalog_lesson_slug_from_url("/lessons?preview=grafiki-funkci"),
            "grafiki-funkci",
        )
        self.assertEqual(
            catalog_lesson_slug_from_url("/lessons/grafiki-funkci/view"),
            "grafiki-funkci",
        )
        self.assertEqual(
            catalog_lesson_slug_from_url("https://itflux.ru/lessons/grafiki-funkci/view/"),
            "grafiki-funkci",
        )
        self.assertEqual(
            meeting_lesson_content_url("/lessons?preview=grafiki-funkci"),
            "/api/lessons/grafiki-funkci/view/",
        )
        self.assertEqual(
            meeting_lesson_content_url("/api/cabinet/files/1/preview/"),
            "/api/cabinet/files/1/preview/",
        )
        self.assertTrue(url_refers_to_catalog_lesson("/lessons?preview=grafiki-funkci", "grafiki-funkci"))
        self.assertFalse(url_refers_to_catalog_lesson("/lessons?preview=other", "grafiki-funkci"))


@override_settings(
    JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="jwt",
    JITSI_APP_ID="itflux-test",
    JITSI_APP_SECRET="test-secret-not-for-production-32b",
    JITSI_SUB="meet.example.test",
    JITSI_AUD="jitsi",
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
)
class MeetingCatalogLessonAccessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="mcl_teacher", password="pass")
        Profile.objects.filter(user=self.teacher).update(role=Profile.Role.TEACHER)
        self.student_user = User.objects.create_user(username="mcl_student", password="pass")
        Profile.objects.filter(user=self.student_user).update(role=Profile.Role.STUDENT)
        self.outsider = User.objects.create_user(username="mcl_out", password="pass")
        Profile.objects.filter(user=self.outsider).update(role=Profile.Role.STUDENT)
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Тес",
            last_name="Ученик",
            status="active",
        )
        now = timezone.now()
        self.event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Живой урок",
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
        self.lesson = Lesson.objects.create(
            title="Закрытый урок",
            slug="private-live-lesson",
            subject="Математика",
            access_level=Lesson.AccessLevel.PRIVATE,
            status=Lesson.Status.PUBLISHED,
            standalone_purchase_enabled=True,
            standalone_price=Decimal("100"),
        )

    def test_preview_url_becomes_html_for_student(self):
        self.client.force_login(self.teacher)
        res = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/",
            {
                "kind": "library_lesson",
                "resourceKind": "embed",
                "title": self.lesson.title,
                "url": f"/lessons?preview={self.lesson.slug}",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(
            res.data["materialSession"]["material"]["openUrl"],
            f"/api/lessons/{self.lesson.slug}/view/",
        )
        self.client.force_login(self.student_user)
        sync = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/material-session/")
        self.assertEqual(sync.status_code, 200)
        self.assertEqual(
            sync.data["materialSession"]["material"]["openUrl"],
            f"/api/lessons/{self.lesson.slug}/view/",
        )

    def test_participant_gets_view_without_purchase(self):
        locked = LessonAccessService.get_access(self.student_user, self.lesson)
        self.assertEqual(locked.access_type, ACCESS_LOCKED)
        self.assertFalse(locked.can_view)

        self.client.force_login(self.teacher)
        opened = self.client.post(
            f"/api/video-meetings/{self.meeting.uuid}/material-session/",
            {
                "kind": "library_lesson",
                "resourceKind": "embed",
                "title": self.lesson.title,
                "url": f"/lessons?preview={self.lesson.slug}",
            },
            format="json",
        )
        self.assertEqual(opened.status_code, 200, opened.content)

        live = LessonAccessService.get_access(self.student_user, self.lesson)
        self.assertEqual(live.access_type, ACCESS_MEETING)
        self.assertTrue(live.can_view)
        self.assertFalse(live.is_full)

        outsider = LessonAccessService.get_access(self.outsider, self.lesson)
        self.assertEqual(outsider.access_type, ACCESS_LOCKED)
        self.assertFalse(outsider.can_view)
