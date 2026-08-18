"""Тесты просмотров и лайков каталога Lesson / InterestingItem."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from Generator.engagement import VIEW_DEDUP_MINUTES, register_view
from Generator.models import CatalogContentLike, InterestingItem, Lesson


def _lesson(**kwargs) -> Lesson:
    defaults = {
        "title": "Урок тест",
        "slug": kwargs.pop("slug", "lesson-eng-1"),
        "subject": "Информатика",
        "status": Lesson.Status.PUBLISHED,
        "access_level": Lesson.AccessLevel.FREE,
    }
    defaults.update(kwargs)
    return Lesson.objects.create(**defaults)


def _interesting(**kwargs) -> InterestingItem:
    defaults = {
        "title": "Интересное тест",
        "slug": kwargs.pop("slug", "interesting-eng-1"),
        "status": InterestingItem.Status.PUBLISHED,
    }
    defaults.update(kwargs)
    return InterestingItem.objects.create(**defaults)


@override_settings(DEBUG=True)
class CatalogEngagementTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user("eng_user", "e@example.com", "pass")
        self.user2 = User.objects.create_user("eng_user2", "e2@example.com", "pass")
        self.lesson = _lesson()
        self.item = _interesting()

    def test_first_view_increments(self):
        url = reverse("api_lesson_stats_view", kwargs={"slug": self.lesson.slug})
        res = self.client.post(url)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["counted"])
        self.assertEqual(data["views_count"], 1)
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.views_count, 1)

    def test_repeat_view_within_window_not_counted(self):
        url = reverse("api_lesson_stats_view", kwargs={"slug": self.lesson.slug})
        self.client.post(url)
        res = self.client.post(url)
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["counted"])
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.views_count, 1)

    def test_other_material_counted_separately(self):
        other = _lesson(slug="lesson-eng-2", title="Другой")
        self.client.post(reverse("api_lesson_stats_view", kwargs={"slug": self.lesson.slug}))
        self.client.post(reverse("api_lesson_stats_view", kwargs={"slug": other.slug}))
        self.lesson.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(self.lesson.views_count, 1)
        self.assertEqual(other.views_count, 1)

    def test_guest_can_view(self):
        url = reverse("api_interesting_stats_view", kwargs={"slug": self.item.slug})
        res = self.client.post(url)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["counted"])
        self.item.refresh_from_db()
        self.assertEqual(self.item.views_count, 1)

    def test_guest_cannot_like(self):
        url = reverse("api_lesson_stats_like", kwargs={"slug": self.lesson.slug})
        res = self.client.post(url)
        self.assertEqual(res.status_code, 401)

    def test_auth_like_and_unlike(self):
        self.client.force_login(self.user)
        url = reverse("api_lesson_stats_like", kwargs={"slug": self.lesson.slug})
        res = self.client.post(url)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["is_liked"])
        self.assertEqual(res.json()["likes_count"], 1)
        res = self.client.post(url)
        self.assertFalse(res.json()["is_liked"])
        self.assertEqual(res.json()["likes_count"], 0)

    def test_unique_like_constraint(self):
        self.client.force_login(self.user)
        url = reverse("api_interesting_stats_like", kwargs={"slug": self.item.slug})
        self.client.post(url)
        self.client.post(url)  # unlike
        self.client.post(url)  # like again
        self.assertEqual(
            CatalogContentLike.objects.filter(user=self.user).count(),
            1,
        )

    def test_two_users_can_like_same(self):
        url = reverse("api_lesson_stats_like", kwargs={"slug": self.lesson.slug})
        self.client.force_login(self.user)
        self.client.post(url)
        self.client.force_login(self.user2)
        res = self.client.post(url)
        self.assertEqual(res.json()["likes_count"], 2)

    def test_list_api_engagement_fields(self):
        self.client.force_login(self.user)
        self.client.post(reverse("api_lesson_stats_like", kwargs={"slug": self.lesson.slug}))
        self.client.post(reverse("api_lesson_stats_view", kwargs={"slug": self.lesson.slug}))
        res = self.client.get(reverse("api_lessons"))
        self.assertEqual(res.status_code, 200)
        row = next(x for x in res.json()["lessons"] if x["slug"] == self.lesson.slug)
        self.assertIn("views_count", row)
        self.assertIn("likes_count", row)
        self.assertIn("is_liked", row)
        self.assertTrue(row["is_liked"])
        self.assertGreaterEqual(row["likes_count"], 1)

    def test_draft_hidden_from_public(self):
        draft = _lesson(slug="draft-eng", status=Lesson.Status.DRAFT)
        res = self.client.post(reverse("api_lesson_stats_view", kwargs={"slug": draft.slug}))
        self.assertEqual(res.status_code, 404)
        res = self.client.post(reverse("api_lesson_stats_like", kwargs={"slug": draft.slug}))
        self.assertEqual(res.status_code, 401)  # auth first — login then 404
        self.client.force_login(self.user)
        res = self.client.post(reverse("api_lesson_stats_like", kwargs={"slug": draft.slug}))
        self.assertEqual(res.status_code, 404)

    def test_ordering_by_views(self):
        a = _lesson(slug="ord-a", title="A")
        b = _lesson(slug="ord-b", title="B")
        Lesson.objects.filter(pk=a.pk).update(views_count=5)
        Lesson.objects.filter(pk=b.pk).update(views_count=20)
        res = self.client.get(reverse("api_lessons"), {"ordering": "views"})
        slugs = [x["slug"] for x in res.json()["lessons"] if x["slug"] in ("ord-a", "ord-b")]
        self.assertEqual(slugs[:2], ["ord-b", "ord-a"])

    def test_newest_orders_by_created_not_updated(self):
        older = _lesson(slug="old-created", title="Older")
        newer = _lesson(slug="new-created", title="Newer")
        now = timezone.now()
        Lesson.objects.filter(pk=older.pk).update(
            created_at=now - timedelta(days=2),
            updated_at=now,
        )
        Lesson.objects.filter(pk=newer.pk).update(
            created_at=now - timedelta(hours=1),
            updated_at=now - timedelta(days=1),
        )
        res = self.client.get(reverse("api_lessons"))
        slugs = [x["slug"] for x in res.json()["lessons"] if x["slug"] in ("old-created", "new-created")]
        self.assertEqual(slugs[:2], ["new-created", "old-created"])

        older_item = _interesting(slug="old-int", title="Old I")
        newer_item = _interesting(slug="new-int", title="New I")
        InterestingItem.objects.filter(pk=older_item.pk).update(
            created_at=now - timedelta(days=2),
            updated_at=now,
        )
        InterestingItem.objects.filter(pk=newer_item.pk).update(
            created_at=now - timedelta(hours=1),
            updated_at=now - timedelta(days=1),
        )
        res = self.client.get(reverse("api_interesting"))
        slugs = [x["slug"] for x in res.json()["items"] if x["slug"] in ("old-int", "new-int")]
        self.assertEqual(slugs[:2], ["new-int", "old-int"])

    def test_list_no_n_plus_one(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        for i in range(12):
            _lesson(slug=f"n1-{i}", title=f"N{i}")
        # warmup contenttypes / auth
        self.client.get(reverse("api_lessons"))
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(reverse("api_lessons"))
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(res.json()["total"], 12)
        # annotate + list: без N+1 на карточку (обычно < 10 запросов)
        self.assertLessEqual(len(ctx), 10)

    def test_double_view_post_same_window(self):
        from django.test import RequestFactory

        rf = RequestFactory()
        request = rf.post("/")
        request.user = self.user
        request.COOKIES = {}
        r1 = register_view(self.lesson, request)
        r2 = register_view(self.lesson, request)
        self.assertTrue(r1["counted"])
        self.assertFalse(r2["counted"])
        self.assertEqual(VIEW_DEDUP_MINUTES, 30)
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.views_count, 1)

    def test_guest_is_liked_false(self):
        res = self.client.get(reverse("api_interesting"))
        row = next(x for x in res.json()["items"] if x["slug"] == self.item.slug)
        self.assertFalse(row["is_liked"])
