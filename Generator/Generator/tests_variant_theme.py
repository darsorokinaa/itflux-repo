"""Темы оформления вариантов: права, API, fallback, назначение theme_id."""

import json

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, SimpleTestCase, TestCase
from rest_framework.test import APIClient

from Cabinet.models import Profile
from Generator.models import Level, Part, Subject, Task, TaskList, Variant, VariantContent
from Generator.variant_theme_access import can_manage_variant_themes, can_select_variant_theme
from Generator.variant_theme_models import VariantTheme
from Generator.variant_theme_service import (
    ALLOWED_ANIMATIONS,
    ALLOWED_DECORATIONS,
    TRAVEL_CONFIG,
    animation_ids_from_catalog,
    decoration_ids_from_catalog,
    sanitize_variant_theme_config,
)


class DecorationCatalogTests(SimpleTestCase):
    def test_server_allows_ids_from_the_catalog_file(self):
        ids = decoration_ids_from_catalog()
        animations = animation_ids_from_catalog()
        self.assertEqual(ALLOWED_DECORATIONS, ids)
        self.assertEqual(ALLOWED_ANIMATIONS, animations)
        self.assertIn("clouds", ids)
        self.assertIn("route-dots", ids)
        self.assertNotIn("falling-leaves", ids)
        self.assertIn("falling-leaves", animations)
        self.assertNotIn("plane-route", animations)
        self.assertNotIn("plane", ids)
        self.assertNotIn("camera", ids)
        self.assertNotIn("malware", ids)


def _make_teacher(username):
    user = User.objects.create_user(username=username, password="pass12345")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


class VariantThemePermissionTests(TestCase):
    def test_anonymous_denied(self):
        self.assertFalse(can_manage_variant_themes(None))
        self.assertFalse(can_select_variant_theme(None))

    def test_teacher_denied_both(self):
        teacher = _make_teacher("theme_teacher")
        self.assertFalse(can_manage_variant_themes(teacher))
        self.assertFalse(can_select_variant_theme(teacher))

    def test_staff_has_both(self):
        staff = User.objects.create_user("theme_staff", password="pass12345", is_staff=True)
        self.assertTrue(can_manage_variant_themes(staff))
        self.assertTrue(can_select_variant_theme(staff))

    def test_superuser_has_both(self):
        root = User.objects.create_superuser("theme_root", "root@example.com", "pass12345")
        self.assertTrue(can_manage_variant_themes(root))
        self.assertTrue(can_select_variant_theme(root))


class VariantThemeApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.api = APIClient()
        self.subject = Subject.objects.create(subject_short="math", subject_name="Математика")
        self.level = Level.objects.create(level="oge", level_rus="ОГЭ")
        self.part = Part.objects.create(part_title="Часть 1")
        self.tl = TaskList.objects.create(
            subject=self.subject,
            level=self.level,
            part=self.part,
            task_number=1,
            task_title="Планиметрия",
            max_score=1,
        )
        self.task = Task.objects.create(
            task=self.tl,
            task_template="<p>2+2?</p>",
            answer="4",
            is_active=True,
        )
        self.staff = User.objects.create_user("vt_staff", password="pass12345", is_staff=True)
        self.teacher = _make_teacher("vt_teacher")
        self.travel, _ = VariantTheme.objects.get_or_create(
            slug="travel",
            defaults={
                "name": "Путешествие",
                "layout_type": "route",
                "config": TRAVEL_CONFIG,
                "is_active": True,
                "is_published": False,
            },
        )
        self.draft = VariantTheme.objects.create(
            name="Черновик",
            slug="draft-theme",
            layout_type="cards",
            is_active=True,
            is_published=False,
        )
        self.disabled = VariantTheme.objects.create(
            name="Выключена",
            slug="disabled-theme",
            layout_type="classic",
            is_active=False,
            is_published=True,
        )

    def _create_variant(self, theme=None):
        variant = Variant.objects.create(
            var_subject=self.subject,
            level=self.level,
            created_by="test",
            theme=theme,
        )
        VariantContent.objects.create(variant=variant, task=self.task, order=1)
        return variant

    def test_travel_theme_seeded(self):
        self.assertEqual(self.travel.layout_type, "route")
        self.assertTrue(self.travel.is_active)
        self.assertFalse(self.travel.is_published)

    def test_existing_variant_has_null_theme(self):
        variant = self._create_variant()
        self.assertIsNone(variant.theme_id)
        resp = self.client.get(f"/api/oge/math/variant/{variant.id}/")
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertIsNone(payload.get("theme_id"))
        self.assertIsNone(payload.get("theme"))
        self.assertTrue(payload.get("tasks"))

    def test_active_theme_is_in_variant_payload(self):
        variant = self._create_variant(theme=self.travel)
        resp = self.client.get(f"/api/oge/math/variant/{variant.id}/")
        self.assertEqual(resp.status_code, 200)
        theme = resp.json().get("theme") or {}
        self.assertEqual(theme.get("slug"), "travel")
        self.assertEqual(theme.get("layout_type"), "route")
        self.assertEqual(theme.get("config", {}).get("labels", {}).get("task"), "Остановка")
        self.assertIn("background_image_url", theme)
        self.assertIn("background_image_vertical_url", theme)
        self.assertIn("block_background_image_url", theme)
        self.assertIn("sheet_background_image_url", theme)
        self.assertIn("sheet_background_image_vertical_url", theme)
        self.assertEqual(theme.get("block_background_image_url"), "")
        self.assertEqual(theme.get("sheet_background_image_url"), "")
        self.assertEqual(theme.get("background_image_vertical_url"), "")
        self.assertEqual(theme.get("sheet_background_image_vertical_url"), "")

    def test_disabled_theme_falls_back_to_classic_payload(self):
        variant = self._create_variant(theme=self.disabled)
        resp = self.client.get(f"/api/oge/math/variant/{variant.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json().get("theme_id"), self.disabled.id)
        self.assertIsNone(resp.json().get("theme"))

    def test_deleted_theme_nulls_fk(self):
        variant = self._create_variant(theme=self.draft)
        self.draft.delete()
        variant.refresh_from_db()
        self.assertIsNone(variant.theme_id)

    def test_teacher_cannot_create_theme(self):
        self.api.force_authenticate(self.teacher)
        resp = self.api.post(
            "/api/admin/variant-themes/",
            {"name": "Хаос", "slug": "chaos", "layout_type": "route"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_teacher_available_catalog_is_empty(self):
        self.api.force_authenticate(self.teacher)
        resp = self.api.get("/api/variant-themes/available/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json().get("can_select_variant_theme"))
        self.assertFalse(resp.json().get("can_manage_variant_themes"))
        self.assertEqual(resp.json().get("themes"), [])

    def test_staff_sees_unpublished_themes(self):
        self.api.force_authenticate(self.staff)
        resp = self.api.get("/api/variant-themes/available/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json().get("can_select_variant_theme"))
        slugs = {row["slug"] for row in resp.json().get("themes") or []}
        self.assertIn("travel", slugs)
        self.assertIn("draft-theme", slugs)

    def test_staff_can_create_and_patch_theme(self):
        self.api.force_authenticate(self.staff)
        resp = self.api.post(
            "/api/admin/variant-themes/",
            {
                "name": "Осень",
                "slug": "autumn",
                "layout_type": "cards",
                "config": {
                    "labels": {"task": "<b>Листок</b>", "next": "Дальше"},
                    "animation": "falling-leaves",
                    "script": "alert(1)",
                },
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        payload = resp.json()
        self.assertEqual(payload["config"]["labels"]["task"], "Листок")
        self.assertNotIn("script", payload["config"])
        theme_id = payload["id"]
        resp = self.api.patch(
            f"/api/admin/variant-themes/{theme_id}/",
            {"is_published": True, "is_active": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["is_published"])

    def test_staff_can_upload_page_and_block_backgrounds(self):
        from io import BytesIO
        from PIL import Image

        def tiny_png(name):
            buf = BytesIO()
            Image.new("RGB", (2, 2), (80, 160, 220)).save(buf, format="PNG")
            return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")

        self.api.force_authenticate(self.staff)
        resp = self.api.patch(
            f"/api/admin/variant-themes/{self.travel.id}/",
            {
                "background_image": tiny_png("page.png"),
                "background_image_vertical": tiny_png("page-tall.png"),
                "block_background_image": tiny_png("blocks.png"),
                "sheet_background_image": tiny_png("sheet.png"),
                "sheet_background_image_vertical": tiny_png("sheet-tall.png"),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertTrue(payload.get("background_image_url"))
        self.assertTrue(payload.get("background_image_vertical_url"))
        self.assertTrue(payload.get("block_background_image_url"))
        self.assertTrue(payload.get("sheet_background_image_url"))
        self.assertTrue(payload.get("sheet_background_image_vertical_url"))
        self.assertNotEqual(payload["background_image_url"], payload["background_image_vertical_url"])
        self.assertNotEqual(payload["sheet_background_image_url"], payload["sheet_background_image_vertical_url"])
        self.assertNotEqual(payload["background_image_url"], payload["block_background_image_url"])
        self.assertNotEqual(payload["sheet_background_image_url"], payload["background_image_url"])
        self.travel.refresh_from_db()
        self.assertTrue(self.travel.background_image)
        self.assertTrue(self.travel.background_image_vertical)
        self.assertTrue(self.travel.block_background_image)
        self.assertTrue(self.travel.sheet_background_image)
        self.assertTrue(self.travel.sheet_background_image_vertical)

    def test_teacher_cannot_set_theme_id_on_create(self):
        self.client.force_login(self.teacher)
        resp = self.client.post(
            "/api/oge/math/variant-from-ids/",
            data={"task_ids": [self.task.id], "theme_id": self.travel.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(Variant.objects.filter(theme=self.travel).exists())

    def test_teacher_cannot_patch_theme_id(self):
        variant = self._create_variant()
        self.client.force_login(self.teacher)
        resp = self.client.patch(
            f"/api/oge/math/variant/{variant.id}/",
            data={"theme_id": self.travel.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)
        variant.refresh_from_db()
        self.assertIsNone(variant.theme_id)

    def test_staff_can_assign_and_clear_theme(self):
        variant = self._create_variant()
        self.client.force_login(self.staff)
        resp = self.client.patch(
            f"/api/oge/math/variant/{variant.id}/",
            data={"theme_id": self.travel.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json().get("theme", {}).get("slug"), "travel")
        variant.refresh_from_db()
        self.assertEqual(variant.theme_id, self.travel.id)

        resp = self.client.patch(
            f"/api/oge/math/variant/{variant.id}/",
            data={"theme_id": None},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        variant.refresh_from_db()
        self.assertIsNone(variant.theme_id)

    def test_legacy_route_color_keeps_its_visible_gradient(self):
        import importlib

        from django.apps import apps

        migration = importlib.import_module(
            "Generator.migrations.0106_variant_theme_legacy_route_gradient"
        )
        legacy = VariantTheme.objects.create(
            name="Старый маршрут",
            slug="old-route",
            layout_type="route",
            config={
                "background": {"type": "color", "color": "#e7f3fb"},
                "labels": {"task": "Остановка"},
            },
        )
        custom = VariantTheme.objects.create(
            name="Свой цвет",
            slug="custom-color",
            layout_type="route",
            config={"background": {"type": "color", "color": "#224466"}},
        )
        migration.preserve_legacy_route_gradient(apps, None)
        legacy.refresh_from_db()
        custom.refresh_from_db()
        self.assertEqual(legacy.config["background"]["type"], "gradient")
        self.assertEqual(legacy.config["background"]["colors"][0], "#9fc8e4")
        self.assertEqual(legacy.config["labels"]["task"], "Остановка")
        self.assertEqual(custom.config["background"]["color"], "#224466")
        self.assertEqual(custom.config["background"]["type"], "color")

    def test_config_rejects_html_and_unknown_animation(self):
        cleaned = sanitize_variant_theme_config(
            {
                "labels": {"task": "<script>x</script>Стоп", "hack": "nope"},
                "animation": "eval()",
                "decorations": ["clouds", "malware"],
                "background": {"type": "image", "url": "javascript:alert(1)", "color": "#12"},
            }
        )
        self.assertEqual(cleaned["labels"]["task"], "xСтоп")
        self.assertNotIn("hack", cleaned["labels"])
        self.assertEqual(cleaned["animation"], "none")
        self.assertEqual(cleaned["decorations"], ["clouds"])
        self.assertNotIn("url", cleaned["background"])

    def test_travel_json_config_is_kept(self):
        cleaned = sanitize_variant_theme_config(
            {
                "labels": {
                    "next": "Следующая остановка",
                    "task": "Остановка",
                    "tasks": "Маршрут",
                    "finish": "Завершить путешествие",
                    "previous": "Вернуться",
                },
                "animation": "clouds",
                "background": {
                    "type": "gradient",
                    "colors": ["#f7d6a3", "#f6b97a", "#9dcfe3"],
                    "direction": "sunset",
                },
                "decorations": [
                    "map",
                    "camera",
                    "route-dots",
                    "mountains",
                    "sea",
                    "sailboats",
                    "flowers",
                ],
            }
        )
        self.assertEqual(cleaned["animation"], "clouds")
        self.assertEqual(cleaned["labels"]["task"], "Остановка")
        self.assertEqual(cleaned["background"]["type"], "gradient")
        self.assertEqual(cleaned["background"]["colors"], ["#f7d6a3", "#f6b97a", "#9dcfe3"])
        self.assertEqual(cleaned["background"]["direction"], "sunset")
        self.assertEqual(
            cleaned["decorations"],
            [
                "map",
                "route-dots",
                "mountains",
                "sea",
                "sailboats",
                "flowers",
            ],
        )

    def test_staff_can_upload_preview_and_patch_travel_config(self):
        from io import BytesIO
        from PIL import Image

        buf = BytesIO()
        Image.new("RGB", (4, 4), (240, 180, 80)).save(buf, format="PNG")
        preview = SimpleUploadedFile("preview.png", buf.getvalue(), content_type="image/png")
        self.api.force_authenticate(self.staff)
        resp = self.api.patch(
            f"/api/admin/variant-themes/{self.travel.id}/",
            {
                "preview_image": preview,
                "config": json.dumps(
                    {
                        "labels": {"task": "Остановка", "finish": "Завершить путешествие"},
                        "animation": "clouds",
                        "background": {
                            "type": "gradient",
                            "colors": ["#f7d6a3", "#f6b97a", "#9dcfe3"],
                            "direction": "sunset",
                        },
                        "decorations": ["map"],
                    }
                ),
            },
            format="multipart",
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertTrue(payload.get("preview_image_url"))
        self.assertEqual(payload["config"]["animation"], "clouds")
        self.assertEqual(payload["config"]["background"]["type"], "gradient")
        self.travel.refresh_from_db()
        self.assertTrue(self.travel.preview_image)
        self.assertEqual(self.travel.config.get("animation"), "clouds")

    def test_me_exposes_theme_permissions(self):
        self.client.force_login(self.staff)
        resp = self.client.get("/api/cabinet/me/")
        user = resp.json().get("user") or {}
        self.assertTrue(user.get("can_manage_variant_themes"))
        self.assertTrue(user.get("can_select_variant_theme"))

        self.client.force_login(self.teacher)
        resp = self.client.get("/api/cabinet/me/")
        user = resp.json().get("user") or {}
        self.assertFalse(user.get("can_manage_variant_themes"))
        self.assertFalse(user.get("can_select_variant_theme"))
