from datetime import timedelta

from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from Generator.models import Update


class UpdateApiTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_hidden_updates_are_excluded(self):
        Update.objects.create(title="Скрытое", description="нет", show=False)
        Update.objects.create(title="Видимое", description="да", show=True)
        res = self.client.get(reverse("api_updates"))
        self.assertEqual(res.status_code, 200)
        titles = [item["title"] for item in res.json()["updates"]]
        self.assertEqual(titles, ["Видимое"])

    def test_empty_list_when_nothing_visible(self):
        Update.objects.create(title="Скрытое", show=False)
        res = self.client.get(reverse("api_updates"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["updates"], [])

    def test_legacy_record_without_link_is_returned(self):
        Update.objects.create(title="Без ссылки", description="Текст", show=True)
        res = self.client.get(reverse("api_updates"))
        item = res.json()["updates"][0]
        self.assertEqual(item["title"], "Без ссылки")
        self.assertEqual(item["description"], "Текст")
        self.assertEqual(item["url"], "")
        self.assertEqual(item["link_text"], "")
        self.assertIn("created_iso", item)

    def test_optional_link_fields(self):
        Update.objects.create(
            title="Настройки уведомлений",
            description="Теперь можно настроить уведомления.",
            url="/cabinet",
            link_text="Подробнее",
            show=True,
        )
        item = self.client.get(reverse("api_updates")).json()["updates"][0]
        self.assertEqual(item["url"], "/cabinet")
        self.assertEqual(item["link_text"], "Подробнее")

    def test_url_without_scheme_or_slash_is_normalized(self):
        Update.objects.create(title="Кабинет", url="cabinet", show=True)
        Update.objects.create(title="Сайт", url="www.example.com/page", show=True)
        payload = {item["title"]: item["url"] for item in self.client.get(reverse("api_updates")).json()["updates"]}
        self.assertEqual(payload["Кабинет"], "/cabinet")
        self.assertEqual(payload["Сайт"], "https://www.example.com/page")

    def test_unsafe_url_is_stripped(self):
        Update.objects.create(
            title="Вредоносная ссылка",
            url="javascript:alert(1)",
            show=True,
        )
        item = self.client.get(reverse("api_updates")).json()["updates"][0]
        self.assertEqual(item["url"], "")

    def test_newest_first(self):
        older = Update.objects.create(title="Старое", show=True)
        Update.objects.create(title="Новое", show=True)
        Update.objects.filter(pk=older.pk).update(
            created=timezone.now() - timedelta(days=2)
        )
        titles = [item["title"] for item in self.client.get(reverse("api_updates")).json()["updates"]]
        self.assertEqual(titles, ["Новое", "Старое"])
