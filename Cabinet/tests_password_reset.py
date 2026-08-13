from urllib.parse import parse_qs, urlparse

from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from Cabinet.models import Profile


@override_settings(LK_PUBLIC_URL="https://itflux-academy.ru")
class PasswordResetApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        self.user = User.objects.create_user(
            username="reset_user",
            email="reset@test.ru",
            password="OldPass123!",
        )
        self.user.profile.role = Profile.Role.STUDENT
        self.user.profile.save(update_fields=["role"])

    def _request_reset(self, login_id):
        return self.client.post(
            "/api/cabinet/password-reset/",
            data={"login": login_id},
            content_type="application/json",
        )

    def _parse_reset_link(self):
        self.assertEqual(len(mail.outbox), 1)
        url = next(line.strip() for line in mail.outbox[0].body.splitlines() if "cabinet/login" in line)
        query = parse_qs(urlparse(url).query)
        return query["uid"][0], query["token"][0]

    def test_request_sends_email_for_existing_account(self):
        response = self._request_reset("reset@test.ru")
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertIn("отправили ссылку", payload["message"])
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["reset@test.ru"])
        self.assertIn("https://itflux-academy.ru/cabinet/login?", mail.outbox[0].body)

    def test_request_by_username_uses_account_email(self):
        response = self._request_reset("reset_user")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["reset@test.ru"])

    def test_unknown_login_returns_same_ok_without_email(self):
        response = self._request_reset("nobody@test.ru")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(len(mail.outbox), 0)

    def test_blocked_account_does_not_receive_email(self):
        self.user.profile.account_blocked = True
        self.user.profile.save(update_fields=["account_blocked"])
        response = self._request_reset("reset@test.ru")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(len(mail.outbox), 0)

    def test_confirm_changes_password_and_logs_in(self):
        self._request_reset("reset@test.ru")
        uid, token = self._parse_reset_link()
        response = self.client.post(
            "/api/cabinet/password-reset/confirm/",
            data={
                "uid": uid,
                "token": token,
                "password": "NewPass123!",
                "password_confirm": "NewPass123!",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["user"]["email"], "reset@test.ru")

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewPass123!"))
        self.assertFalse(self.user.check_password("OldPass123!"))

        me = self.client.get("/api/cabinet/me/")
        self.assertTrue(me.json().get("authenticated"))

    def test_token_cannot_be_reused(self):
        self._request_reset("reset@test.ru")
        uid, token = self._parse_reset_link()
        first = self.client.post(
            "/api/cabinet/password-reset/confirm/",
            data={
                "uid": uid,
                "token": token,
                "password": "NewPass123!",
                "password_confirm": "NewPass123!",
            },
            content_type="application/json",
        )
        self.assertEqual(first.status_code, 200, first.content)
        second = self.client.post(
            "/api/cabinet/password-reset/confirm/",
            data={
                "uid": uid,
                "token": token,
                "password": "AnotherPass123!",
                "password_confirm": "AnotherPass123!",
            },
            content_type="application/json",
        )
        self.assertEqual(second.status_code, 400)
        self.assertIn("недействительна", second.json()["error"])

    def test_invalid_token_is_rejected(self):
        self._request_reset("reset@test.ru")
        uid, _token = self._parse_reset_link()
        response = self.client.post(
            "/api/cabinet/password-reset/confirm/",
            data={
                "uid": uid,
                "token": "not-a-real-token",
                "password": "NewPass123!",
                "password_confirm": "NewPass123!",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OldPass123!"))

    def test_password_mismatch_is_rejected(self):
        self._request_reset("reset@test.ru")
        uid, token = self._parse_reset_link()
        response = self.client.post(
            "/api/cabinet/password-reset/confirm/",
            data={
                "uid": uid,
                "token": token,
                "password": "NewPass123!",
                "password_confirm": "OtherPass123!",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("не совпадают", response.json()["error"])

    def test_request_rate_limit_returns_429(self):
        for i in range(6):
            response = self.client.post(
                "/api/cabinet/password-reset/",
                data={"login": f"user{i}@test.ru"},
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 429)
