"""API tests for teacher interactives (create/edit/list/permissions)."""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.models import FlashcardItem, Interactive, Profile


class InteractiveApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="ix_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])

        self.other = User.objects.create_user(username="ix_other", password="pass")
        self.other.profile.role = Profile.Role.TEACHER
        self.other.profile.save(update_fields=["role"])

        self.student_user = User.objects.create_user(username="ix_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])

        self.client = APIClient()
        self.client.force_login(self.teacher)

    def test_list_returns_own_interactives(self):
        Interactive.objects.create(
            teacher=self.teacher,
            title="Мой",
            interactive_type="flashcards",
            status="draft",
        )
        Interactive.objects.create(
            teacher=self.other,
            title="Чужой",
            interactive_type="flashcards",
            status="published",
        )
        response = self.client.get("/api/cabinet/interactives/")
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        items = payload if isinstance(payload, list) else payload.get("results", [])
        titles = [item["title"] for item in items]
        self.assertIn("Мой", titles)
        self.assertNotIn("Чужой", titles)

    def test_create_response_includes_id_and_detail_shape(self):
        response = self.client.post(
            "/api/cabinet/interactives/",
            data={
                "title": "Карточки ОГЭ",
                "interactive_type": "flashcards",
                "direction": "oge",
                "exam_type": "oge",
                "status": "draft",
                "flashcards": [
                    {
                        "front_text": "AND",
                        "back_text": "И",
                        "front_image_url": "",
                        "back_image_url": "",
                        "order": 0,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertIsNotNone(data.get("id"))
        self.assertEqual(data["title"], "Карточки ОГЭ")
        self.assertEqual(data["interactive_type"], "flashcards")
        self.assertIn("flashcards", data)
        self.assertEqual(len(data["flashcards"]), 1)
        self.assertEqual(data["flashcards"][0]["front_text"], "AND")
        self.assertIn("status", data)
        self.assertIn("updated_at", data)

    def test_patch_preserves_id_and_accepts_relative_image_url(self):
        interactive = Interactive.objects.create(
            teacher=self.teacher,
            title="Без обложки",
            interactive_type="flashcards",
            status="draft",
        )
        FlashcardItem.objects.create(
            interactive=interactive,
            front_text="A",
            back_text="B",
            order=0,
        )
        response = self.client.patch(
            f"/api/cabinet/interactives/{interactive.pk}/",
            data={
                "title": "С картинкой",
                "flashcards": [
                    {
                        "front_text": "A",
                        "back_text": "B",
                        "front_image_url": "/media/cabinet/interactives/uploads/1/card.png",
                        "back_image_url": "",
                        "order": 0,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["id"], interactive.pk)
        self.assertEqual(data["title"], "С картинкой")
        self.assertEqual(
            data["flashcards"][0]["front_image_url"],
            "/media/cabinet/interactives/uploads/1/card.png",
        )

    def test_retrieve_existing_and_missing(self):
        interactive = Interactive.objects.create(
            teacher=self.teacher,
            title="Существует",
            interactive_type="matching",
            status="draft",
        )
        ok = self.client.get(f"/api/cabinet/interactives/{interactive.pk}/")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["id"], interactive.pk)

        missing = self.client.get("/api/cabinet/interactives/999999/")
        self.assertEqual(missing.status_code, 404)

    def test_other_teacher_cannot_edit(self):
        interactive = Interactive.objects.create(
            teacher=self.teacher,
            title="Приватный",
            interactive_type="quiz",
            status="draft",
        )
        other_client = APIClient()
        other_client.force_login(self.other)
        response = other_client.patch(
            f"/api/cabinet/interactives/{interactive.pk}/",
            data={"title": "Взлом"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        interactive.refresh_from_db()
        self.assertEqual(interactive.title, "Приватный")

    def test_student_cannot_access_teacher_editor_api(self):
        interactive = Interactive.objects.create(
            teacher=self.teacher,
            title="Только учителю",
            interactive_type="flashcards",
            status="published",
        )
        student_client = APIClient()
        student_client.force_login(self.student_user)
        response = student_client.get(f"/api/cabinet/interactives/{interactive.pk}/")
        self.assertIn(response.status_code, (403, 404))

    def test_publish_sets_published_at(self):
        interactive = Interactive.objects.create(
            teacher=self.teacher,
            title="К публикации",
            interactive_type="flashcards",
            status="draft",
        )
        response = self.client.post(f"/api/cabinet/interactives/{interactive.pk}/publish/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["status"], "published")
        self.assertEqual(data["id"], interactive.pk)
        interactive.refresh_from_db()
        self.assertEqual(interactive.status, "published")
        self.assertIsNotNone(interactive.published_at)

    def test_anonymous_cannot_list(self):
        anon = APIClient()
        response = anon.get("/api/cabinet/interactives/")
        self.assertIn(response.status_code, (401, 403))
