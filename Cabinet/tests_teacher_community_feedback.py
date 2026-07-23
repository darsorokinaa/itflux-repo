"""Tests for teacher community feedback API."""

import json

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from Cabinet.models import Profile, TeacherCommunityFeedback


@override_settings(
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "teacher-community-feedback-tests",
        }
    }
)
class TeacherCommunityFeedbackApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        self.url = "/api/teacher-community-feedback/"

    def _post(self, payload, **kwargs):
        return self.client.post(
            self.url,
            data=json.dumps(payload),
            content_type="application/json",
            **kwargs,
        )

    def test_anonymous_feedback_ok(self):
        resp = self._post(
            {
                "feedbackType": "review",
                "message": "После урока удобно проверять работы.",
                "name": "Анна",
                "subjectArea": "Математика",
            }
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        self.assertTrue(data["ok"])
        self.assertGreater(data["id"], 0)

        fb = TeacherCommunityFeedback.objects.get(pk=data["id"])
        self.assertEqual(fb.feedback_type, TeacherCommunityFeedback.FeedbackType.REVIEW)
        self.assertEqual(fb.message, "После урока удобно проверять работы.")
        self.assertEqual(fb.name, "Анна")
        self.assertEqual(fb.subject_area, "Математика")
        self.assertIsNone(fb.user)
        self.assertEqual(fb.status, TeacherCommunityFeedback.Status.NEW)

    def test_authenticated_user_attached(self):
        user = User.objects.create_user(
            username="teacher_fb",
            email="teacher_fb@ex.com",
            password="Pass12345!",
        )
        user.profile.role = Profile.Role.TEACHER
        user.profile.save(update_fields=["role"])
        self.client.force_login(user)

        resp = self._post(
            {
                "feedbackType": "feature",
                "message": "Хотелось бы шаблоны для расписания.",
            }
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        fb = TeacherCommunityFeedback.objects.get(pk=resp.json()["id"])
        self.assertEqual(fb.user_id, user.id)

    def test_requires_feedback_type_and_message(self):
        resp = self._post({"message": "Текст без типа"})
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(resp.json()["ok"])

        resp = self._post({"feedbackType": "bug"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("сообщение", resp.json()["error"].lower())

        self.assertEqual(TeacherCommunityFeedback.objects.count(), 0)

    def test_contact_requires_consent(self):
        resp = self._post(
            {
                "feedbackType": "other",
                "message": "Есть идея",
                "contact": "@teacher",
                "consent": False,
            }
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(TeacherCommunityFeedback.objects.count(), 0)

        resp = self._post(
            {
                "feedbackType": "other",
                "message": "Есть идея",
                "contact": "@teacher",
                "consent": True,
            }
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        fb = TeacherCommunityFeedback.objects.get()
        self.assertTrue(fb.consent_given)
        self.assertEqual(fb.contact, "@teacher")

    def test_honeypot_silently_accepted(self):
        resp = self._post(
            {
                "feedbackType": "review",
                "message": "spam",
                "website": "https://bot.example",
            }
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["id"], 0)
        self.assertEqual(TeacherCommunityFeedback.objects.count(), 0)

    def test_message_length_limit(self):
        resp = self._post(
            {
                "feedbackType": "bug",
                "message": "x" * 5001,
            }
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(TeacherCommunityFeedback.objects.count(), 0)

    def test_rate_limit(self):
        payload = {
            "feedbackType": "testing",
            "message": "Готов тестировать обновления.",
        }
        for _ in range(10):
            resp = self._post(payload)
            self.assertEqual(resp.status_code, 200, resp.content)

        resp = self._post(payload)
        self.assertEqual(resp.status_code, 429)
        self.assertEqual(resp.json().get("code"), "RATE_LIMITED")
        self.assertEqual(TeacherCommunityFeedback.objects.count(), 10)

    def test_method_not_allowed(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 405)
