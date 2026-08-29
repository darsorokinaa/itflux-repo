from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.invitations import (
    accept_student_invitation,
    create_student_invitation,
    invitation_join_path,
)
from Cabinet.models import NotificationPreference, Profile, StudentGroup, TelegramConnectToken
from Cabinet.telegram_connect import (
    bind_telegram_account,
    create_telegram_connect_link,
    get_active_connect_token,
)


class InvitePathAndTelegramConnectTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username="tg_teacher",
            email="tg_teacher@test.ru",
            password="StrongPass123!",
        )
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.name = "Дарья"
        self.teacher.profile.surname = "Витальевна"
        self.teacher.profile.save()

        self.student_user = User.objects.create_user(
            username="tg_student",
            email="tg_student@test.ru",
            password="StrongPass123!",
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.name = "Анна"
        self.student_user.profile.save()

        self.group = StudentGroup.objects.create(
            teacher=self.teacher,
            title="ОГЭ по информатике",
        )

    def test_invitation_join_path_is_unified_invite_url(self):
        invitation = create_student_invitation(self.teacher, group=self.group)
        self.assertEqual(invitation_join_path(invitation.token), f"/invite/{invitation.token}/")

        client = APIClient()
        client.force_login(self.teacher)
        response = client.get("/api/cabinet/invitations/")
        self.assertEqual(response.status_code, 200)
        rows = response.json()
        if isinstance(rows, dict):
            rows = rows.get("results", [])
        pending = next(item for item in rows if item["token"] == invitation.token)
        self.assertEqual(pending["join_path"], f"/invite/{invitation.token}/")

    def test_accept_returns_join_context_and_telegram_flag(self):
        invitation = create_student_invitation(self.teacher, group=self.group)
        client = APIClient()
        client.force_login(self.student_user)
        response = client.post(f"/api/cabinet/invitations/join/{invitation.token}/accept/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["status"], "accepted")
        self.assertEqual(data["teacher_name"], "Дарья Витальевна")
        self.assertEqual(data["group_title"], "ОГЭ по информатике")
        self.assertTrue(data["show_telegram_connect"])
        self.assertFalse(data["telegram_connected"])

    def test_preview_returns_accepted_payload_for_accepter(self):
        invitation = create_student_invitation(self.teacher, group=self.group)
        accept_student_invitation(invitation.token, self.student_user)

        client = APIClient()
        client.force_login(self.student_user)
        response = client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["status"], "accepted")
        self.assertEqual(data["group_title"], "ОГЭ по информатике")

    @override_settings(TELEGRAM_BOT_TOKEN="test-token", TELEGRAM_BOT_USERNAME="itflux_bot")
    def test_connect_link_invalidates_previous_token(self):
        first = create_telegram_connect_link(self.student_user)
        second = create_telegram_connect_link(self.student_user)
        self.assertNotEqual(first["deep_link"], second["deep_link"])

        old_token = first["deep_link"].rsplit("start=", 1)[-1]
        new_token = second["deep_link"].rsplit("start=", 1)[-1]
        self.assertIsNone(get_active_connect_token(old_token))
        self.assertIsNotNone(get_active_connect_token(new_token))
        self.assertTrue(second["deep_link"].startswith("https://t.me/itflux_bot?start="))
        self.assertLessEqual(
            TelegramConnectToken.objects.get(token=new_token).expires_at,
            timezone.now() + timedelta(minutes=15, seconds=5),
        )

    @override_settings(TELEGRAM_BOT_TOKEN="test-token", TELEGRAM_BOT_USERNAME="itflux_bot")
    def test_bind_telegram_is_one_active_connection(self):
        other = User.objects.create_user(
            username="other_student",
            email="other@test.ru",
            password="StrongPass123!",
        )
        other.profile.role = Profile.Role.STUDENT
        other.profile.save()

        link = create_telegram_connect_link(self.student_user)
        token = link["deep_link"].rsplit("start=", 1)[-1]
        bind_telegram_account(token=token, chat_id="111222", username="anna")

        prefs = NotificationPreference.objects.get(user=self.student_user)
        self.assertTrue(prefs.telegram_connected)
        self.assertEqual(prefs.telegram_chat_id, "111222")

        # Повторное использование токена невозможно.
        with self.assertRaises(ValueError):
            bind_telegram_account(token=token, chat_id="111222", username="anna")

        # Тот же chat_id переезжает на другого пользователя.
        link2 = create_telegram_connect_link(other)
        token2 = link2["deep_link"].rsplit("start=", 1)[-1]
        bind_telegram_account(token=token2, chat_id="111222", username="other")

        prefs.refresh_from_db()
        self.assertFalse(prefs.telegram_connected)
        other_prefs = NotificationPreference.objects.get(user=other)
        self.assertTrue(other_prefs.telegram_connected)

    @override_settings(
        TELEGRAM_BOT_TOKEN="test-token",
        TELEGRAM_BOT_USERNAME="itflux_bot",
        TELEGRAM_WEBHOOK_SECRET="hook-secret",
        DEBUG=False,
    )
    @patch("Generator.telegram_utils.send_telegram_message", return_value=True)
    def test_webhook_binds_account(self, _send):
        link = create_telegram_connect_link(self.student_user)
        token = link["deep_link"].rsplit("start=", 1)[-1]
        client = Client()
        response = client.post(
            "/api/cabinet/telegram/webhook/",
            data={
                "message": {
                    "text": f"/start {token}",
                    "chat": {"id": 998877},
                    "from": {"username": "anna_tg"},
                }
            },
            content_type="application/json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN="hook-secret",
        )
        self.assertEqual(response.status_code, 200)
        prefs = NotificationPreference.objects.get(user=self.student_user)
        self.assertEqual(prefs.telegram_chat_id, "998877")
        self.assertTrue(prefs.telegram_connected)

    @override_settings(TELEGRAM_BOT_TOKEN="test-token", TELEGRAM_BOT_USERNAME="itflux_bot")
    @patch("Cabinet.telegram_connect.send_telegram_to_user", return_value=True)
    def test_welcome_message_only_when_telegram_already_connected(self, send_mock):
        prefs, _ = NotificationPreference.objects.get_or_create(user=self.student_user)
        prefs.telegram_enabled = True
        prefs.telegram_chat_id = "555"
        prefs.save()

        invitation = create_student_invitation(self.teacher, group=self.group)
        accept_student_invitation(invitation.token, self.student_user)
        self.assertEqual(send_mock.call_count, 1)
        text = send_mock.call_args.args[1]
        self.assertIn("Вы присоединились к учителю", text)
        self.assertIn("ОГЭ по информатике", text)


class TelegramCabinetAndLinksTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username="cab_teacher",
            email="cab_teacher@test.ru",
            password="StrongPass123!",
        )
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.name = "Дарья"
        self.teacher.profile.save()

        self.student_user = User.objects.create_user(
            username="cab_student",
            email="cab_student@test.ru",
            password="StrongPass123!",
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.name = "Анна"
        self.student_user.profile.save()

        from Cabinet.models import Student

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Иванова",
        )
        teacher_prefs, _ = NotificationPreference.objects.get_or_create(user=self.teacher)
        teacher_prefs.telegram_enabled = True
        teacher_prefs.telegram_chat_id = "7001"
        teacher_prefs.save()

    def _post(self, payload, secret="hook-secret"):
        client = Client()
        return client.post(
            "/api/cabinet/telegram/webhook/",
            data=payload,
            content_type="application/json",
            HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN=secret,
        )

    @override_settings(LK_PUBLIC_URL="https://itflux-academy.ru")
    def test_teacher_open_link_is_full_url(self):
        from Cabinet.telegram_connect import telegram_message_with_open, telegram_open_html

        html = telegram_open_html("/cabinet/payments", "Открыть оплаты")
        self.assertIn('href="https://itflux-academy.ru/cabinet/payments"', html)
        self.assertIn("Открыть оплаты", html)
        self.assertNotIn("Открыть: /cabinet", html)

        text = telegram_message_with_open(
            "Поступила оплата\n\nОткрыть: /cabinet/payments",
            "/cabinet/payments?student=12",
            "Открыть оплаты",
        )
        self.assertNotIn("Открыть: /cabinet", text)
        self.assertIn("https://itflux-academy.ru/cabinet/payments?student=12", text)

    @override_settings(
        TELEGRAM_BOT_TOKEN="test-token",
        TELEGRAM_BOT_USERNAME="itflux_bot",
        TELEGRAM_WEBHOOK_SECRET="hook-secret",
        DEBUG=False,
        LK_PUBLIC_URL="https://itflux-academy.ru",
    )
    @patch("Generator.telegram_utils.send_telegram_message", return_value=True)
    def test_teacher_menu_and_today(self, send_mock):
        from Cabinet.models import ScheduleEvent
        from Cabinet.notification_time import user_local_now

        starts = user_local_now(self.teacher).replace(hour=15, minute=0, second=0, microsecond=0)
        ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Алгебра",
            starts_at=starts,
            ends_at=starts + timedelta(hours=1),
            student=self.student,
        )

        response = self._post(
            {"message": {"text": "/start", "chat": {"id": 7001}, "from": {"username": "daria"}}}
        )
        self.assertEqual(response.status_code, 200)
        menu_text = send_mock.call_args.args[0]
        self.assertIn("Личный кабинет в Telegram", menu_text)
        self.assertIn("Напомнить", menu_text)

        send_mock.reset_mock()
        response = self._post(
            {"message": {"text": "Сегодня", "chat": {"id": 7001}, "from": {"username": "daria"}}}
        )
        self.assertEqual(response.status_code, 200)
        today_text = send_mock.call_args.args[0]
        self.assertIn("Алгебра", today_text)
        self.assertIn("https://itflux-academy.ru/cabinet/schedule", today_text)
        self.assertNotIn("Открыть: /cabinet", today_text)

    @override_settings(
        TELEGRAM_BOT_TOKEN="test-token",
        TELEGRAM_BOT_USERNAME="itflux_bot",
        TELEGRAM_WEBHOOK_SECRET="hook-secret",
        DEBUG=False,
        LK_PUBLIC_URL="https://itflux-academy.ru",
    )
    @patch("Generator.telegram_utils.answer_telegram_callback_query", return_value=True)
    @patch("Generator.telegram_utils.send_telegram_message", return_value=True)
    def test_teacher_can_forward_or_send_reminder(self, send_mock, _answer):
        from Cabinet.models import Homework, ScheduleEvent
        from Cabinet.telegram_cabinet import build_student_reminder_text

        starts = timezone.now() + timedelta(hours=3)
        ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Алгебра",
            starts_at=starts,
            ends_at=starts + timedelta(hours=1),
            student=self.student,
        )
        Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="Дроби",
            status="assigned",
        )

        reminder = build_student_reminder_text(self.teacher, self.student)
        self.assertIn("Привет, Анна!", reminder)
        self.assertIn("Алгебра", reminder)
        self.assertIn("Дроби", reminder)
        self.assertIn("https://itflux-academy.ru/cabinet/student", reminder)
        self.assertNotIn("/cabinet/payments", reminder)

        response = self._post(
            {
                "callback_query": {
                    "id": "cb1",
                    "data": f"c:r:{self.student.pk}",
                    "from": {"id": 7001},
                    "message": {"chat": {"id": 7001}},
                }
            }
        )
        self.assertEqual(response.status_code, 200)
        shown = send_mock.call_args.args[0]
        self.assertIn("Привет, Анна!", shown)
        self.assertIn("переслать", shown.lower())

        student_prefs, _ = NotificationPreference.objects.get_or_create(user=self.student_user)
        student_prefs.telegram_enabled = True
        student_prefs.telegram_chat_id = "8002"
        student_prefs.save()

        send_mock.reset_mock()
        response = self._post(
            {
                "callback_query": {
                    "id": "cb2",
                    "data": f"c:x:{self.student.pk}",
                    "from": {"id": 7001},
                    "message": {"chat": {"id": 7001}},
                }
            }
        )
        self.assertEqual(response.status_code, 200)
        sent_texts = [call.args[0] for call in send_mock.call_args_list]
        self.assertTrue(any("Напоминание отправлено" in text for text in sent_texts))
        self.assertTrue(any("Привет, Анна!" in text and "Алгебра" in text for text in sent_texts))
