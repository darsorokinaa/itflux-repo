"""Tests for centralized notification dispatch, prefs, push and dedup."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import NotificationChannel
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    Notification,
    NotificationPreference,
    Profile,
    PushDeliveryLog,
    PushSubscription,
    ReviewItem,
    Student,
)
from Cabinet.notification_catalog import (
    PREFERENCE_EVENT_MAP,
    UI_PREFERENCE_FIELDS,
    NotificationEventType,
    orphan_ui_preference_fields,
)
from Cabinet.notification_dispatch import (
    NotificationDispatcher,
    NotificationPreferenceService,
    get_or_create_preferences,
)
from Cabinet.webpush import notify_user_channels, send_web_push_to_user


class NotificationCatalogTests(TestCase):
    def test_ui_toggles_map_to_catalog_events(self):
        orphans = orphan_ui_preference_fields()
        self.assertEqual(orphans, [])
        for field in UI_PREFERENCE_FIELDS:
            if field in (
                "notify_daily_schedule_empty",
                "notify_billing_weekly_digest",
                "notify_journal_comment",
                "notify_journal_recommendation",
            ):
                continue
            self.assertIn(field, PREFERENCE_EVENT_MAP, msg=f"{field} not in catalog")


class NotificationPreferenceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="pref_user", password="pass")
        Profile.objects.update_or_create(
            user=self.user, defaults={"role": Profile.Role.TEACHER}
        )

    def test_get_or_create_does_not_reset(self):
        prefs = get_or_create_preferences(self.user)
        prefs.notify_homework = False
        prefs.save(update_fields=["notify_homework"])
        again = get_or_create_preferences(self.user)
        self.assertFalse(again.notify_homework)

    def test_preference_save_via_api(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        url = "/api/cabinet/settings/notifications/"
        resp = client.patch(url, {"notify_homework": False}, format="json")
        self.assertEqual(resp.status_code, 200)
        prefs = NotificationPreference.objects.get(user=self.user)
        self.assertFalse(prefs.notify_homework)
        resp2 = client.get(url)
        self.assertEqual(resp2.status_code, 200)
        self.assertFalse(resp2.data.get("notify_homework"))


class NotificationDispatcherTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="t_disp", password="pass")
        self.student_user = User.objects.create_user(username="s_disp", password="pass")
        Profile.objects.update_or_create(
            user=self.teacher, defaults={"role": Profile.Role.TEACHER}
        )
        Profile.objects.update_or_create(
            user=self.student_user, defaults={"role": Profile.Role.STUDENT}
        )
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Ученик",
            last_name="Тест",
        )

    def test_enabled_event_creates_in_app(self):
        result = NotificationDispatcher.notify(
            self.student_user,
            NotificationEventType.HOMEWORK_ASSIGNED,
            title="Новое ДЗ",
            message="Тест",
            actor=self.teacher,
            dedup_key="hw-assign-test-1",
            create_push=False,
            create_telegram=False,
        )
        self.assertFalse(result.skipped)
        self.assertIsNotNone(result.in_app)
        self.assertEqual(
            Notification.objects.filter(
                recipient_user=self.student_user, channel=NotificationChannel.IN_APP
            ).count(),
            1,
        )

    def test_disabled_event_skips(self):
        prefs = get_or_create_preferences(self.student_user)
        prefs.notify_homework = False
        prefs.save(update_fields=["notify_homework"])
        result = NotificationDispatcher.notify(
            self.student_user,
            NotificationEventType.HOMEWORK_ASSIGNED,
            title="Новое ДЗ",
            message="Тест",
            actor=self.teacher,
            create_push=False,
        )
        self.assertTrue(result.skipped)
        self.assertIn("pref_disabled", result.reason)
        self.assertEqual(
            Notification.objects.filter(recipient_user=self.student_user).count(),
            0,
        )

    def test_actor_does_not_receive_own_action(self):
        result = NotificationDispatcher.notify(
            self.teacher,
            NotificationEventType.LESSON_UPDATED,
            title="Изменено",
            message="x",
            actor=self.teacher,
            skip_actor=True,
            create_push=False,
        )
        self.assertTrue(result.skipped)
        self.assertEqual(result.reason, "actor_is_recipient")

    def test_dedup_key_prevents_duplicate(self):
        kwargs = dict(
            title="ДЗ",
            message="x",
            actor=self.teacher,
            dedup_key="dedup-same",
            create_push=False,
        )
        r1 = NotificationDispatcher.notify(
            self.student_user, NotificationEventType.HOMEWORK_ASSIGNED, **kwargs
        )
        r2 = NotificationDispatcher.notify(
            self.student_user, NotificationEventType.HOMEWORK_ASSIGNED, **kwargs
        )
        self.assertFalse(r1.skipped)
        self.assertTrue(r2.skipped)
        self.assertEqual(r2.reason, "duplicate")
        self.assertEqual(
            Notification.objects.filter(recipient_user=self.student_user).count(),
            1,
        )

    def test_student_does_not_get_teacher_event(self):
        result = NotificationDispatcher.notify(
            self.student_user,
            NotificationEventType.HOMEWORK_SUBMITTED,
            title="Сдано",
            message="x",
            create_push=False,
        )
        self.assertTrue(result.skipped)
        self.assertIn("role_not_allowed", result.reason)

    def test_push_disabled_still_creates_in_app(self):
        prefs = get_or_create_preferences(self.student_user)
        prefs.push_enabled = False
        prefs.save(update_fields=["push_enabled"])
        with patch("Cabinet.webpush.send_web_push_to_user") as mock_push:
            result = NotificationDispatcher.notify(
                self.student_user,
                NotificationEventType.HOMEWORK_CHECKED,
                title="Проверено",
                message="ok",
                actor=self.teacher,
                create_push=True,
            )
        self.assertFalse(result.skipped)
        self.assertIsNotNone(result.in_app)
        mock_push.assert_not_called()

    def test_in_app_survives_push_failure(self):
        PushSubscription.objects.create(
            user=self.student_user,
            endpoint="https://example.com/push/1",
            p256dh="x" * 20,
            auth="y" * 10,
            is_active=True,
        )
        with patch(
            "Cabinet.webpush.send_web_push_to_user",
            return_value={"sent": 0, "active": 1, "reason": "send_failed", "errors": ["boom"]},
        ):
            result = NotificationDispatcher.notify(
                self.student_user,
                NotificationEventType.HOMEWORK_CHECKED,
                title="Проверено",
                message="ok",
                actor=self.teacher,
            )
        self.assertIsNotNone(result.in_app)
        self.assertEqual(result.in_app.is_read, False)

    def test_mark_all_as_read_only_own(self):
        other = User.objects.create_user(username="other_n", password="pass")
        Notification.objects.create(
            recipient_user=self.teacher,
            channel=NotificationChannel.IN_APP,
            title="a",
            message="b",
        )
        Notification.objects.create(
            recipient_user=other,
            channel=NotificationChannel.IN_APP,
            title="c",
            message="d",
        )
        count = NotificationDispatcher.mark_all_as_read(self.teacher)
        self.assertEqual(count, 1)
        self.assertTrue(
            Notification.objects.get(recipient_user=self.teacher).is_read
        )
        self.assertFalse(Notification.objects.get(recipient_user=other).is_read)

    def test_cannot_patch_foreign_preferences(self):
        client = APIClient()
        client.force_authenticate(user=self.student_user)
        # Preferences endpoint always updates request.user — not another id
        url = "/api/cabinet/settings/notifications/"
        resp = client.patch(url, {"notify_review": False}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            NotificationPreference.objects.get(user=self.student_user).notify_review
        )
        self.assertTrue(
            get_or_create_preferences(self.teacher).notify_review
        )


class WebPushDeliveryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="push_u", password="pass")
        Profile.objects.update_or_create(
            user=self.user, defaults={"role": Profile.Role.TEACHER}
        )
        self.sub1 = PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example/1",
            p256dh="p" * 30,
            auth="a" * 20,
            is_active=True,
        )
        self.sub2 = PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example/2",
            p256dh="q" * 30,
            auth="b" * 20,
            is_active=True,
        )

    @patch("Cabinet.webpush.webpush_configured", return_value=True)
    @patch("Cabinet.webpush._load_vapid", return_value=object())
    def test_multiple_devices_and_410_deactivates_one(self, _vapid, _cfg):
        class WebPushException(Exception):
            def __init__(self, message="", response=None):
                super().__init__(message)
                self.response = response

        def side_effect(**kwargs):
            endpoint = kwargs["subscription_info"]["endpoint"]
            if endpoint.endswith("/1"):
                raise WebPushException("gone", response=MagicMock(status_code=410))
            return None

        fake_mod = MagicMock()
        fake_mod.WebPushException = WebPushException
        fake_mod.webpush = MagicMock(side_effect=side_effect)
        with patch.dict("sys.modules", {"pywebpush": fake_mod}):
            result = send_web_push_to_user(
                self.user,
                title="T",
                body="B",
                force=True,
                create_log=False,
                event_type="push_test",
            )
        self.sub1.refresh_from_db()
        self.sub2.refresh_from_db()
        self.assertFalse(self.sub1.is_active)
        self.assertTrue(self.sub2.is_active)
        self.assertEqual(result["sent"], 1)

    @patch("Cabinet.webpush.webpush_configured", return_value=True)
    @patch("Cabinet.webpush._load_vapid", return_value=object())
    def test_500_does_not_deactivate(self, _vapid, _cfg):
        class WebPushException(Exception):
            def __init__(self, message="", response=None):
                super().__init__(message)
                self.response = response

        fake_mod = MagicMock()
        fake_mod.WebPushException = WebPushException
        fake_mod.webpush = MagicMock(
            side_effect=WebPushException("server", response=MagicMock(status_code=500))
        )
        with patch.dict("sys.modules", {"pywebpush": fake_mod}):
            send_web_push_to_user(
                self.user,
                title="T",
                body="B",
                force=True,
                create_log=False,
                only_endpoint=self.sub1.endpoint,
            )
        self.sub1.refresh_from_db()
        self.assertTrue(self.sub1.is_active)
        self.assertTrue(
            PushDeliveryLog.objects.filter(
                user=self.user, status=PushDeliveryLog.DeliveryStatus.FAILED
            ).exists()
        )

    def test_push_test_only_current_user(self):
        other = User.objects.create_user(username="other_push", password="pass")
        client = APIClient()
        client.force_authenticate(user=self.user)
        with patch("Cabinet.push_api.webpush_configured", return_value=True), patch(
            "Cabinet.push_api.send_web_push_to_user",
            return_value={"sent": 1, "active": 1, "reason": "", "errors": []},
        ) as mock_send:
            resp = client.post("/api/cabinet/push/test/", {"endpoint": self.sub1.endpoint}, format="json")
        self.assertEqual(resp.status_code, 200)
        mock_send.assert_called_once()
        self.assertEqual(mock_send.call_args.args[0], self.user)
        self.assertNotEqual(mock_send.call_args.args[0], other)

    def test_subscribe_only_own_user(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        with patch("Cabinet.push_api.webpush_configured", return_value=True):
            resp = client.post(
                "/api/cabinet/push/subscribe/",
                {
                    "endpoint": "https://push.example/new",
                    "keys": {"p256dh": "k" * 30, "auth": "z" * 20},
                },
                format="json",
            )
        self.assertEqual(resp.status_code, 200)
        sub = PushSubscription.objects.get(endpoint="https://push.example/new")
        self.assertEqual(sub.user_id, self.user.pk)


class HomeworkReviewNotifyTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="t_rev", password="pass")
        self.student_user = User.objects.create_user(username="s_rev", password="pass")
        Profile.objects.update_or_create(
            user=self.teacher, defaults={"role": Profile.Role.TEACHER}
        )
        Profile.objects.update_or_create(
            user=self.student_user, defaults={"role": Profile.Role.STUDENT}
        )
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Rev",
            last_name="Student",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="HW1",
            status="assigned",
        )
        self.submission = HomeworkSubmission.objects.create(
            homework=self.homework,
            student=self.student,
            status="submitted",
        )
        self.review = ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=self.submission.pk,
            title="HW1",
            status="pending",
        )

    def test_check_notifies_student_when_review_enabled(self):
        from Cabinet.student_notifications import notify_student_homework_reviewed

        ok = notify_student_homework_reviewed(
            review_item=self.review,
            submission=self.submission,
            checked=True,
            actor=self.teacher,
        )
        self.assertTrue(ok)
        self.assertTrue(
            Notification.objects.filter(
                recipient_user=self.student_user,
                event_type=NotificationEventType.HOMEWORK_CHECKED,
            ).exists()
        )

    def test_check_skipped_when_review_disabled(self):
        from Cabinet.student_notifications import notify_student_homework_reviewed

        prefs = get_or_create_preferences(self.student_user)
        prefs.notify_review = False
        prefs.save(update_fields=["notify_review"])
        ok = notify_student_homework_reviewed(
            review_item=self.review,
            submission=self.submission,
            checked=True,
            actor=self.teacher,
        )
        self.assertFalse(ok)


class ScheduleNotifyDedupTests(TestCase):
    def setUp(self):
        from Cabinet.models import ScheduleEvent, ScheduleEventParticipant
        from Cabinet.choices import ParticipantStatus

        self.teacher = User.objects.create_user(username="t_sch", password="pass")
        Profile.objects.update_or_create(
            user=self.teacher, defaults={"role": Profile.Role.TEACHER}
        )
        self.student_user = User.objects.create_user(username="s_sch", password="pass")
        Profile.objects.update_or_create(
            user=self.student_user, defaults={"role": Profile.Role.STUDENT}
        )
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Sch",
            last_name="Student",
        )
        now = timezone.now()
        self.event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок",
            starts_at=now + timedelta(hours=2),
            ends_at=now + timedelta(hours=3),
        )
        ScheduleEventParticipant.objects.create(
            event=self.event,
            student=self.student,
            user=self.student_user,
            status=ParticipantStatus.ACCEPTED,
            notification_enabled=True,
        )

    def test_reminder_dedup_via_event_key(self):
        from Cabinet.notifications import NotificationService

        NotificationService.notify_before_lesson(self.event, 60)
        NotificationService.notify_before_lesson(self.event, 60)
        count = Notification.objects.filter(
            recipient_user=self.student_user,
            channel=NotificationChannel.IN_APP,
            event_type=NotificationEventType.LESSON_REMINDER,
        ).count()
        self.assertEqual(count, 1)

    def test_plain_resave_updated_without_change_still_can_notify_once(self):
        from Cabinet.notifications import NotificationService

        NotificationService.notify_event_updated(self.event, changes={"topic": "a"})
        # Without dedup_suffix for updated, may create again — ensure prefs gate works
        prefs = get_or_create_preferences(self.student_user)
        prefs.notify_lesson_updated = False
        prefs.save(update_fields=["notify_lesson_updated"])
        before = Notification.objects.filter(recipient_user=self.student_user).count()
        NotificationService.notify_event_updated(self.event, changes={"topic": "a"})
        after = Notification.objects.filter(recipient_user=self.student_user).count()
        self.assertEqual(before, after)


class SystemAnnouncementPrefTests(TestCase):
    def test_notify_system_toggle(self):
        user = User.objects.create_user(username="sys_u", password="pass")
        Profile.objects.update_or_create(
            user=user, defaults={"role": Profile.Role.TEACHER}
        )
        prefs = get_or_create_preferences(user)
        prefs.notify_system = False
        prefs.save(update_fields=["notify_system"])
        result = NotificationDispatcher.notify(
            user,
            NotificationEventType.SYSTEM_ANNOUNCEMENT,
            title="Система",
            message="Важно",
            create_push=False,
            skip_actor=False,
        )
        self.assertTrue(result.skipped)
        prefs.notify_system = True
        prefs.save(update_fields=["notify_system"])
        result2 = NotificationDispatcher.notify(
            user,
            NotificationEventType.SYSTEM_ANNOUNCEMENT,
            title="Система",
            message="Важно",
            create_push=False,
            skip_actor=False,
            dedup_key="sys-1",
        )
        self.assertFalse(result2.skipped)
