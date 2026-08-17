"""Скачивание file/archive урока и «Интересного» из админки."""

from __future__ import annotations

import tempfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from Generator.models import InterestingItem, Lesson


class AdminCatalogFileDownloadTests(TestCase):
    def setUp(self):
        self._media = tempfile.TemporaryDirectory()
        self._media_override = override_settings(MEDIA_ROOT=self._media.name)
        self._media_override.enable()
        self.addCleanup(self._media_override.disable)
        self.addCleanup(self._media.cleanup)
        self.admin = User.objects.create_superuser("admin_files", "admin@example.com", "pass12345")
        self.client.force_login(self.admin)

    def test_lesson_file_downloads_as_attachment(self):
        lesson = Lesson.objects.create(
            title="Урок скачивание",
            slug="urok-download",
            subject="Информатика",
            file=SimpleUploadedFile("source.html", b"<html>lesson</html>", content_type="text/html"),
        )
        url = reverse("admin:Generator_lesson_download_stored", args=[lesson.pk, "file"])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertIn("urok-download", response["Content-Disposition"])
        self.assertEqual(b"".join(response.streaming_content), b"<html>lesson</html>")

    def test_interesting_archive_downloads_as_attachment(self):
        item = InterestingItem.objects.create(
            title="Интерактив",
            slug="interactive-download",
            archive=SimpleUploadedFile("pack.zip", b"PK\x03\x04zip", content_type="application/zip"),
        )
        url = reverse("admin:Generator_interestingitem_download_stored", args=[item.pk, "archive"])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        self.assertEqual(b"".join(response.streaming_content), b"PK\x03\x04zip")

    def test_change_form_shows_download_button(self):
        lesson = Lesson.objects.create(
            title="Урок кнопка",
            slug="urok-button",
            subject="Информатика",
            file=SimpleUploadedFile("source.html", b"<html>ok</html>", content_type="text/html"),
        )
        url = reverse("admin:Generator_lesson_change", args=[lesson.pk])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertIn("Скачать файл", content)
        self.assertIn(f"/admin/Generator/lesson/{lesson.pk}/download/file/", content)

    def test_unknown_field_is_404(self):
        lesson = Lesson.objects.create(
            title="Урок 404",
            slug="urok-404",
            subject="Информатика",
        )
        url = reverse("admin:Generator_lesson_download_stored", args=[lesson.pk, "cover_image"])
        response = self.client.get(url)
        self.assertEqual(response.status_code, 404)

    def test_anonymous_is_redirected(self):
        lesson = Lesson.objects.create(
            title="Урок гость",
            slug="urok-guest",
            subject="Информатика",
            file=SimpleUploadedFile("source.html", b"<html>ok</html>", content_type="text/html"),
        )
        self.client.logout()
        url = reverse("admin:Generator_lesson_download_stored", args=[lesson.pk, "file"])
        response = self.client.get(url)
        self.assertIn(response.status_code, (302, 403))
