"""OAuth-источник, события воронки и платформенная почта."""

import json
import secrets
import time
from pathlib import Path
from urllib.parse import quote

from django.contrib.auth.models import User
from django.core import mail
from django.core.management import call_command
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.acquisition import acquisition_from_request
from Cabinet.choices import HomeworkStatus
from Cabinet.invitations import accept_student_invitation, create_student_invitation
from Cabinet.models import Homework, Payment, Profile, Student, TariffPlan
from Cabinet.onboarding_service import build_teacher_onboarding_state
from Cabinet.r91_oauth import PENDING_KEY
from Cabinet.social_auth import create_oauth_user
from Cabinet.storefront_models import StorefrontEvent


def _teacher(username):
    user = User.objects.create_user(username, f"{username}@example.com")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


def _student_user(username):
    user = User.objects.create_user(username, f"{username}@example.com")
    user.profile.role = Profile.Role.STUDENT
    user.profile.email_confirmed = False
    user.profile.save(update_fields=["role", "email_confirmed"])
    return user


class OAuthAcquisitionTests(TestCase):
    def test_cookie_and_query_survive_without_provider_referrer(self):
        payload = {
            "utm_source": "vk",
            "utm_medium": "cpc",
            "utm_campaign": "potok1110",
            "utm_content": "post1",
            "ref": "608",
            "referrer": "https://vk.com/wall1?secret=1",
        }
        request = RequestFactory().get(
            "/api/cabinet/oauth/vk/start/?source_ref=608",
            HTTP_REFERER="https://oauth.yandex.ru/authorize?code=1",
        )
        request.COOKIES["itflux_acq"] = quote(json.dumps(payload))
        stored = acquisition_from_request(request)
        self.assertEqual(stored["utm_source"], "vk")
        self.assertEqual(stored["utm_campaign"], "potok1110")
        self.assertEqual(stored["ref"], "608")
        self.assertIn("vk.com", stored["referrer"])
        self.assertNotIn("secret", stored["utm_source"])

    def test_oauth_teacher_source_reaches_payment(self):
        request = RequestFactory().get("/api/cabinet/oauth/vk/callback/")
        stored = {
            "utm_source": "vk",
            "utm_medium": "cpc",
            "utm_campaign": "potok1110",
            "utm_content": "post1",
            "ref": "608",
            "referrer": "https://vk.com/wall1",
        }
        user = create_oauth_user(
            "vk",
            {"uid": "vk-1", "email": "oauth-vk@example.com", "first_name": "Анна", "last_name": "И"},
            Profile.Role.TEACHER,
            request,
            stored,
        )
        profile = user.profile
        self.assertEqual(profile.acquisition_source, "social")
        self.assertEqual(profile.acquisition_medium, "cpc")
        self.assertEqual(profile.acquisition_campaign, "potok1110")
        self.assertEqual(profile.acquisition_touch["utm_source"], "vk")
        self.assertEqual(profile.acquisition_touch["ref"], "608")
        self.assertNotIn("referrer", profile.acquisition_touch)
        self.assertNotIn("@", json.dumps(profile.acquisition_touch))
        self.assertTrue(profile.email_confirmed)

        plan = TariffPlan.objects.get(slug="teacher")
        client = APIClient()
        client.force_authenticate(user=user)
        with override_settings(DEBUG=True, PAYMENTS_ENABLED=True, PAYMENT_PROVIDER="mock"):
            resp = client.post(
                "/api/cabinet/subscription/create-payment/",
                {"plan_slug": plan.slug, "billing_period": "month"},
                format="json",
            )
        self.assertEqual(resp.status_code, 201, resp.content)
        payment = Payment.objects.get(pk=resp.json()["payment_id"])
        self.assertEqual(payment.metadata["acquisition"]["utm_source"], "vk")
        self.assertEqual(payment.metadata["acquisition"]["utm_campaign"], "potok1110")
        self.assertNotIn("email", payment.metadata["acquisition"])

    def test_role_picker_keeps_acquisition(self):
        client = APIClient()
        session = client.session
        session[PENDING_KEY] = {
            "provider": "yandex",
            "ident": {
                "uid": "ya-9",
                "email": "ya9@example.com",
                "first_name": "Яна",
                "last_name": "О",
            },
            "next": "/cabinet",
            "pd": False,
            "mkt": False,
            "acquisition": {
                "utm_source": "yandex",
                "utm_medium": "cpc",
                "utm_campaign": "potok1110",
                "referrer": "https://yandex.ru/search",
            },
            "ts": int(time.time()),
        }
        session.save()
        resp = client.post("/api/cabinet/oauth/complete/", {"role": "teacher"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        user = User.objects.get(email="ya9@example.com")
        self.assertEqual(user.profile.acquisition_source, "search")
        self.assertEqual(user.profile.acquisition_touch["utm_campaign"], "potok1110")
        self.assertNotIn("referrer", user.profile.acquisition_touch)


class FunnelEventTests(TestCase):
    def test_homework_and_accepted_invite_are_storefront_events(self):
        teacher = _teacher("funnel_t")
        invitation = create_student_invitation(teacher, first_name="Кирилл", last_name="С")
        pending = build_teacher_onboarding_state(teacher)
        self.assertEqual(pending["next_step"], "accepted")
        self.assertTrue(pending["steps"][0]["done"])
        self.assertFalse(pending["steps"][1]["done"])

        pupil = _student_user("funnel_s")
        accept_student_invitation(invitation.token, pupil)
        invite_event = StorefrontEvent.objects.get(event_name="invite_accepted")
        self.assertEqual(invite_event.user_id, teacher.id)
        self.assertEqual(invite_event.metadata.get("object_id"), invitation.pk)
        self.assertNotIn("email", json.dumps(invite_event.metadata))
        self.assertNotIn("Кирилл", json.dumps(invite_event.metadata))

        student = Student.objects.get(teacher=teacher, user=pupil)
        homework = Homework.objects.create(
            teacher=teacher,
            student=student,
            title="Секретное ДЗ",
            status=HomeworkStatus.DRAFT,
        )
        self.assertFalse(
            StorefrontEvent.objects.filter(event_name="homework_created").exists()
        )
        homework.status = HomeworkStatus.ASSIGNED
        homework.save(update_fields=["status"])
        created = StorefrontEvent.objects.get(event_name="homework_created")
        self.assertEqual(created.idempotency_key, f"homework:{homework.pk}")
        self.assertNotIn("Секретное", json.dumps(created.metadata))
        homework.title = "Другое"
        homework.save(update_fields=["title"])
        self.assertEqual(
            StorefrontEvent.objects.filter(event_name="homework_created").count(),
            1,
        )
        state = build_teacher_onboarding_state(teacher)
        self.assertIsNone(state["next_step"])
        self.assertFalse(state["visible"])


class PlatformMailTests(TestCase):
    def test_unconfirmed_email_can_log_in(self):
        user = _teacher("mail_login")
        user.profile.email_confirmed = False
        user.profile.save(update_fields=["email_confirmed"])
        secret = secrets.token_urlsafe(18)
        user.set_password(secret)
        user.save(update_fields=["password"])
        client = APIClient()
        resp = client.post(
            "/api/cabinet/login/",
            {"login": user.username, "password": secret},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["ok"])
        self.assertFalse(resp.json()["user"]["email_confirmed"])

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        EMAIL_HOST="smtp.yandex.ru",
        EMAIL_PORT=465,
        EMAIL_HOST_USER="box@itflux-academy.ru",
        DEFAULT_FROM_EMAIL="coach@itflux-academy.ru",
        LK_PUBLIC_URL="https://itflux-academy.ru",
    )
    def test_command_sends_reset_and_confirmation(self):
        user = _teacher("mail_cmd")
        user.profile.email_confirmed = False
        user.profile.save(update_fields=["email_confirmed"])
        call_command("send_platform_test_mail", user.email)
        self.assertEqual(len(mail.outbox), 2)
        subjects = {item.subject for item in mail.outbox}
        self.assertTrue(any("парол" in item.lower() for item in subjects))
        self.assertTrue(any("Подтверждение" in item for item in subjects))
        for item in mail.outbox:
            self.assertEqual(item.from_email, "coach@itflux-academy.ru")
            self.assertNotIn("localhost", item.from_email)
            self.assertEqual(item.to, [user.email])
        confirm = next(item for item in mail.outbox if "Подтверждение" in item.subject)
        link = next(line.strip() for line in confirm.body.splitlines() if "email-confirm" in line)
        from urllib.parse import urlparse

        parsed = urlparse(link)
        client = APIClient()
        resp = client.get(f"{parsed.path}?{parsed.query}")
        self.assertEqual(resp.status_code, 302)
        self.assertIn("email_confirmed=1", resp.url)
        user.profile.refresh_from_db()
        self.assertTrue(user.profile.email_confirmed)

    def test_web_and_shell_settings_define_the_same_smtp(self):
        root = Path(__file__).resolve().parents[1]
        web = (root / "Generator" / "settings.py").read_text(encoding="utf-8")
        shell = (root / "Generator" / "Generator" / "settings.py").read_text(encoding="utf-8")
        for text in (web, shell):
            self.assertIn("EMAIL_BACKEND", text)
            self.assertIn("smtp.yandex.ru", text)
            self.assertIn("DEFAULT_FROM_EMAIL", text)
            self.assertIn("SERVER_EMAIL", text)
            self.assertNotIn("webmaster@localhost", text)
