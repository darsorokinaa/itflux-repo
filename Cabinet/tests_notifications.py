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
            ):
                continue
            self.assertIn(field, PREFERENCE_EVENT_MAP, msg=f"{field} not in catalog")
        self.assertIn("journal_comment", PREFERENCE_EVENT_MAP.get("notify_journal_comment", ()))
        self.assertIn(
            "journal_recommendation",
            PREFERENCE_EVENT_MAP.get("notify_journal_recommendation", ()),
        )


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
        note = Notification.objects.get(
            recipient_user=self.student_user,
            event_type=NotificationEventType.HOMEWORK_CHECKED,
        )
        self.assertIn("focus=results", (note.payload or {}).get("url", ""))

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


class ReminderMinutesAndQuietHoursTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="tz_user", password="pass")
        Profile.objects.update_or_create(
            user=self.user,
            defaults={"role": Profile.Role.TEACHER, "timezone": "Europe/Moscow"},
        )

    def test_empty_reminder_list_disables(self):
        prefs = get_or_create_preferences(self.user)
        prefs.lesson_reminder_minutes = []
        prefs.save(update_fields=["lesson_reminder_minutes"])
        self.assertEqual(prefs.effective_lesson_reminder_minutes(), [])
        enabled, reason = NotificationPreferenceService.is_event_enabled(
            self.user, NotificationEventType.LESSON_REMINDER, prefs=prefs
        )
        self.assertFalse(enabled)
        self.assertEqual(reason, "reminders_disabled")

    def test_selected_reminders_only(self):
        prefs = get_or_create_preferences(self.user)
        prefs.lesson_reminder_minutes = [60]
        prefs.save(update_fields=["lesson_reminder_minutes"])
        self.assertEqual(prefs.effective_lesson_reminder_minutes(), [60])

    def test_quiet_hours_overnight(self):
        from datetime import datetime, time
        from zoneinfo import ZoneInfo

        from Cabinet.notification_time import is_in_quiet_hours

        tz = ZoneInfo("Europe/Moscow")
        self.assertTrue(
            is_in_quiet_hours(
                enabled=True,
                start=time(22, 0),
                end=time(7, 0),
                now_local=datetime(2026, 8, 3, 23, 30, tzinfo=tz),
            )
        )
        self.assertTrue(
            is_in_quiet_hours(
                enabled=True,
                start=time(22, 0),
                end=time(7, 0),
                now_local=datetime(2026, 8, 4, 6, 0, tzinfo=tz),
            )
        )
        self.assertFalse(
            is_in_quiet_hours(
                enabled=True,
                start=time(22, 0),
                end=time(7, 0),
                now_local=datetime(2026, 8, 4, 12, 0, tzinfo=tz),
            )
        )

    def test_quiet_hours_same_start_end_means_always(self):
        from datetime import datetime, time
        from zoneinfo import ZoneInfo

        from Cabinet.notification_time import is_in_quiet_hours

        tz = ZoneInfo("UTC")
        self.assertTrue(
            is_in_quiet_hours(
                enabled=True,
                start=time(0, 0),
                end=time(0, 0),
                now_local=datetime(2026, 8, 3, 15, 0, tzinfo=tz),
            )
        )

    def test_dnd_blocks_non_urgent_push(self):
        from datetime import time

        prefs = get_or_create_preferences(self.user)
        prefs.dnd_enabled = True
        prefs.dnd_start = time(8, 0)
        prefs.dnd_end = time(8, 0)  # одинаковые границы = круглосуточная тишина
        prefs.dnd_allow_urgent = True
        prefs.push_enabled = True
        prefs.save()
        PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example/dnd",
            p256dh="p" * 30,
            auth="a" * 20,
            is_active=True,
        )
        with patch("Cabinet.webpush.webpush_configured", return_value=True):
            result = send_web_push_to_user(
                self.user,
                title="Обычное",
                body="текст",
                priority="normal",
                urgent=False,
                create_log=False,
            )
        self.assertEqual(result["reason"], "dnd")
        self.assertEqual(result["sent"], 0)

    def test_privacy_mode_hides_push_body(self):
        prefs = get_or_create_preferences(self.user)
        prefs.push_privacy_mode = True
        prefs.push_enabled = True
        prefs.in_app_enabled = True
        prefs.notify_system = True
        prefs.save()
        with patch(
            "Cabinet.webpush.send_web_push_to_user",
            return_value={"sent": 1, "active": 1, "reason": "", "errors": []},
        ) as mock_push:
            result = NotificationDispatcher.notify(
                self.user,
                NotificationEventType.SYSTEM_ANNOUNCEMENT,
                title="Новый ученик Александр",
                message='Сдал работу "Системы счисления"',
                skip_actor=False,
                create_telegram=False,
                create_push=True,
                dedup_key="privacy-test-1",
            )
        self.assertFalse(result.skipped, result.reason)
        self.assertTrue(mock_push.called)
        self.assertEqual(mock_push.call_args.kwargs["title"], "Новое уведомление")
        self.assertIn("новое событие", mock_push.call_args.kwargs["body"].lower())


class PushSubscriptionDedupTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="push_dedup", password="pass")
        Profile.objects.update_or_create(
            user=self.user, defaults={"role": Profile.Role.TEACHER}
        )

    def test_upsert_same_endpoint_no_duplicate(self):
        from Cabinet.webpush import upsert_subscription

        a = upsert_subscription(
            self.user,
            endpoint="https://push.example/same",
            p256dh="p" * 30,
            auth="a" * 20,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605",
        )
        b = upsert_subscription(
            self.user,
            endpoint="https://push.example/same",
            p256dh="q" * 30,
            auth="b" * 20,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605",
        )
        self.assertEqual(a.pk, b.pk)
        self.assertEqual(
            PushSubscription.objects.filter(endpoint="https://push.example/same").count(),
            1,
        )

    def test_serialize_distinguishes_iphone_ipad(self):
        from Cabinet.webpush import serialize_device

        iphone = PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example/iphone",
            p256dh="p" * 30,
            auth="a" * 20,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1",
            is_active=True,
        )
        ipad = PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example/ipad",
            p256dh="q" * 30,
            auth="b" * 20,
            user_agent="Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1",
            is_active=True,
        )
        s1 = serialize_device(iphone, current_endpoint=iphone.endpoint)
        s2 = serialize_device(ipad)
        self.assertIn("iPhone", s1["device_type"])
        self.assertIn("iPad", s2["device_type"])
        self.assertTrue(s1["is_current"])
        self.assertFalse(s2["is_current"])
        self.assertIn("текущее устройство", s1["device_label"])


class RescheduleReminderLogTests(TestCase):
    def setUp(self):
        from Cabinet.models import EventReminderLog, ScheduleEvent, ScheduleEventParticipant
        from Cabinet.choices import ParticipantStatus

        self.teacher = User.objects.create_user(username="t_move", password="pass")
        Profile.objects.update_or_create(
            user=self.teacher, defaults={"role": Profile.Role.TEACHER}
        )
        now = timezone.now()
        self.event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок",
            starts_at=now + timedelta(hours=2),
            ends_at=now + timedelta(hours=3),
            status=ScheduleEvent.Status.PLANNED,
        )
        ScheduleEventParticipant.objects.create(
            event=self.event,
            user=self.teacher,
            status=ParticipantStatus.ACCEPTED,
            notification_enabled=True,
        )
        EventReminderLog.objects.create(
            event=self.event,
            recipient=self.teacher,
            reminder_minutes=60,
        )
        self.EventReminderLog = EventReminderLog

    def test_move_clears_reminder_logs(self):
        from Cabinet.models import ScheduleEvent
        from Cabinet.schedule_service import move_event

        new_start = timezone.now() + timedelta(hours=5)
        move_event(
            self.event,
            starts_at=new_start,
            ends_at=new_start + timedelta(hours=1),
            changed_by=self.teacher,
            notify=False,
        )
        self.assertEqual(
            self.EventReminderLog.objects.filter(event=self.event).count(),
            0,
        )
        self.event.refresh_from_db()
        self.assertEqual(self.event.status, ScheduleEvent.Status.MOVED)


class TelegramChannelAutoTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="tg_auto", password="pass")
        Profile.objects.update_or_create(
            user=self.user, defaults={"role": Profile.Role.TEACHER}
        )
        # Сброс кэша reverse OneToOne после update_or_create
        if hasattr(self.user, "_state"):
            self.user.refresh_from_db()
        try:
            del self.user.profile
        except AttributeError:
            pass
        prefs = get_or_create_preferences(self.user)
        prefs.telegram_enabled = True
        prefs.telegram_chat_id = "123456"
        prefs.notify_system = True
        prefs.save()

    @patch("Cabinet.telegram_connect.send_telegram_to_user", return_value=True)
    def test_dispatcher_sends_telegram_when_connected(self, mock_tg):
        prefs = get_or_create_preferences(self.user)
        self.assertTrue(prefs.telegram_connected)
        result = NotificationDispatcher.notify(
            self.user,
            NotificationEventType.SYSTEM_ANNOUNCEMENT,
            title="Системное",
            message="Тест",
            payload={"type": "system_announcement", "url": "/cabinet"},
            dedup_key="tg-auto-1",
            skip_actor=False,
            create_push=False,
            create_telegram=True,
        )
        self.assertFalse(result.skipped, result.reason)
        mock_tg.assert_called_once()
        self.assertIn("telegram", result.channels)

    @patch("Cabinet.telegram_connect.send_telegram_to_user", return_value=True)
    def test_disabled_type_skips_telegram(self, mock_tg):
        prefs = get_or_create_preferences(self.user)
        prefs.notify_system = False
        prefs.save(update_fields=["notify_system"])
        result = NotificationDispatcher.notify(
            self.user,
            NotificationEventType.SYSTEM_ANNOUNCEMENT,
            title="Системное",
            message="Тест",
            skip_actor=False,
            create_push=False,
            create_telegram=True,
        )
        self.assertTrue(result.skipped)
        mock_tg.assert_not_called()


class NotificationRegressionScenariosTests(TestCase):
    """Scenarios A–F: persist prefs, restore push, never auto-enable after opt-out."""

    def setUp(self):
        self.user = User.objects.create_user(username="push_reg", password="pass")
        profile, _ = Profile.objects.update_or_create(
            user=self.user, defaults={"role": Profile.Role.TEACHER}
        )
        Profile.objects.filter(pk=profile.pk).update(role=Profile.Role.TEACHER)
        profile.refresh_from_db()
        self.user.profile = profile
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _fake_pywebpush(self, *, side_effect=None):
        import sys
        from types import ModuleType, SimpleNamespace

        previous = sys.modules.get("pywebpush")
        fake = ModuleType("pywebpush")

        class WebPushException(Exception):
            def __init__(self, message="", response=None):
                super().__init__(message)
                self.response = response

        fake.WebPushException = WebPushException
        fake.webpush = MagicMock(side_effect=side_effect)
        sys.modules["pywebpush"] = fake

        def _restore():
            if previous is None:
                sys.modules.pop("pywebpush", None)
            else:
                sys.modules["pywebpush"] = previous

        self.addCleanup(_restore)
        return fake, SimpleNamespace

    def test_a_deploy_keeps_push_enabled_and_same_endpoint(self):
        from Cabinet.webpush import upsert_subscription

        prefs = get_or_create_preferences(self.user)
        prefs.push_enabled = True
        prefs.save(update_fields=["push_enabled"])
        first = upsert_subscription(
            self.user,
            endpoint="https://push.example/device-a",
            p256dh="p" * 30,
            auth="a" * 20,
            activate=True,
        )
        after_deploy = upsert_subscription(
            self.user,
            endpoint="https://push.example/device-a",
            p256dh="p" * 30,
            auth="a" * 20,
            activate=False,
        )
        prefs.refresh_from_db()
        self.assertTrue(prefs.push_enabled)
        self.assertEqual(first.pk, after_deploy.pk)
        self.assertTrue(after_deploy.is_active)
        self.assertEqual(
            PushSubscription.objects.filter(user=self.user).count(),
            1,
        )
        fake, _ = self._fake_pywebpush()
        with patch("Cabinet.webpush.webpush_configured", return_value=True), patch(
            "Cabinet.webpush._load_vapid", return_value=object()
        ):
            result = send_web_push_to_user(
                self.user,
                title="После обновления",
                body="ok",
                create_log=False,
                force=True,
            )
        self.assertEqual(result["sent"], 1)
        fake.webpush.assert_called_once()

    def test_b_user_disable_survives_sync_after_deploy(self):
        from Cabinet.webpush import deactivate_endpoint, upsert_subscription

        prefs = get_or_create_preferences(self.user)
        prefs.push_enabled = True
        prefs.save(update_fields=["push_enabled"])
        upsert_subscription(
            self.user,
            endpoint="https://push.example/device-b",
            p256dh="p" * 30,
            auth="a" * 20,
            activate=True,
        )
        deactivate_endpoint(
            "https://push.example/device-b",
            user=self.user,
            by_user=True,
        )
        synced = upsert_subscription(
            self.user,
            endpoint="https://push.example/device-b",
            p256dh="p" * 30,
            auth="a" * 20,
            activate=False,
        )
        prefs.refresh_from_db()
        self.assertTrue(prefs.push_enabled)
        self.assertTrue(synced.disabled_by_user)
        self.assertFalse(synced.is_active)
        fake, _ = self._fake_pywebpush()
        with patch("Cabinet.webpush.webpush_configured", return_value=True), patch(
            "Cabinet.webpush._load_vapid", return_value=object()
        ):
            result = send_web_push_to_user(
                self.user,
                title="Не должно уйти",
                body="x",
                create_log=False,
            )
        fake.webpush.assert_not_called()
        self.assertEqual(result["reason"], "no_devices")

    def test_c_frontend_resubmits_lost_backend_subscription(self):
        from Cabinet.webpush import upsert_subscription

        prefs = get_or_create_preferences(self.user)
        prefs.push_enabled = True
        prefs.save(update_fields=["push_enabled"])
        PushSubscription.objects.filter(user=self.user).delete()
        restored = upsert_subscription(
            self.user,
            endpoint="https://push.example/lost-then-found",
            p256dh="p" * 30,
            auth="a" * 20,
            activate=False,
        )
        self.assertTrue(restored.is_active)
        self.assertFalse(restored.disabled_by_user)
        self.assertEqual(
            PushSubscription.objects.filter(
                user=self.user, endpoint="https://push.example/lost-then-found"
            ).count(),
            1,
        )

    def test_d_new_preference_field_does_not_reset_existing(self):
        prefs = get_or_create_preferences(self.user)
        prefs.notify_homework = True
        prefs.notify_payment_received = False
        prefs.save(update_fields=["notify_homework", "notify_payment_received"])
        resp = self.client.patch(
            "/api/cabinet/settings/notifications/",
            {"notify_new_student": False},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        prefs.refresh_from_db()
        self.assertTrue(prefs.notify_homework)
        self.assertFalse(prefs.notify_payment_received)
        self.assertFalse(prefs.notify_new_student)
        again = get_or_create_preferences(self.user)
        self.assertTrue(again.notify_homework)
        self.assertFalse(again.notify_payment_received)

    def test_e_disabled_type_skips_all_channels(self):
        prefs = get_or_create_preferences(self.user)
        prefs.notify_homework = False
        prefs.notify_system = True
        prefs.telegram_enabled = True
        prefs.telegram_chat_id = "111"
        prefs.in_app_enabled = True
        prefs.push_enabled = True
        prefs.save()
        self.assertEqual(self.user.profile.role, Profile.Role.TEACHER)
        with patch("Cabinet.telegram_connect.send_telegram_to_user") as mock_tg, patch(
            "Cabinet.webpush.send_web_push_to_user"
        ) as mock_push:
            skipped = NotificationDispatcher.notify(
                self.user,
                NotificationEventType.HOMEWORK_SUBMITTED,
                title="ДЗ",
                message="x",
                skip_actor=False,
            )
            other = NotificationDispatcher.notify(
                self.user,
                NotificationEventType.SYSTEM_ANNOUNCEMENT,
                title="Система",
                message="y",
                skip_actor=False,
                create_push=False,
                create_telegram=True,
            )
        self.assertTrue(skipped.skipped)
        self.assertIn("pref_disabled", skipped.reason)
        mock_tg.assert_called_once()
        mock_push.assert_not_called()
        self.assertFalse(other.skipped)
        self.assertEqual(
            Notification.objects.filter(
                recipient_user=self.user,
                event_type=NotificationEventType.HOMEWORK_SUBMITTED,
            ).count(),
            0,
        )

    def test_f_push_off_in_app_on_creates_only_cabinet(self):
        prefs = get_or_create_preferences(self.user)
        prefs.push_enabled = False
        prefs.in_app_enabled = True
        prefs.notify_system = True
        prefs.save()
        with patch("Cabinet.webpush.send_web_push_to_user") as mock_push:
            result = NotificationDispatcher.notify(
                self.user,
                NotificationEventType.SYSTEM_ANNOUNCEMENT,
                title="Только кабинет",
                message="x",
                skip_actor=False,
            )
        self.assertFalse(result.skipped, result.reason)
        self.assertIsNotNone(result.in_app)
        self.assertIn("in_app", result.channels)
        self.assertNotIn("push", result.channels)
        mock_push.assert_not_called()

    def test_gone_subscription_does_not_disable_global_push(self):
        prefs = get_or_create_preferences(self.user)
        prefs.push_enabled = True
        prefs.save(update_fields=["push_enabled"])
        sub = PushSubscription.objects.create(
            user=self.user,
            endpoint="https://push.example/gone",
            p256dh="p" * 30,
            auth="a" * 20,
            is_active=True,
        )
        fake, SimpleNamespace = self._fake_pywebpush()
        fake.webpush.side_effect = fake.WebPushException(
            "410 Gone",
            response=SimpleNamespace(status_code=410),
        )
        with patch("Cabinet.webpush.webpush_configured", return_value=True), patch(
            "Cabinet.webpush._load_vapid", return_value=object()
        ):
            send_web_push_to_user(
                self.user,
                title="t",
                body="b",
                create_log=False,
                force=True,
            )
        sub.refresh_from_db()
        prefs.refresh_from_db()
        self.assertFalse(sub.is_active)
        self.assertTrue(prefs.push_enabled)
        self.assertFalse(sub.disabled_by_user)
