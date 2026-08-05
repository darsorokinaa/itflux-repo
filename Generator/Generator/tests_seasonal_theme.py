"""Тесты сезонного / праздничного оформления."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from Cabinet.models import SeasonalThemePreference
from Generator.seasonal_theme_models import SeasonalTheme
from Generator.seasonal_theme_service import (
    get_cached_active_theme,
    invalidate_seasonal_theme_cache,
    list_period_themes,
    select_active_theme,
)


def _make_theme(**kwargs) -> SeasonalTheme:
    now = timezone.now()
    defaults = {
        "name": "Test Theme",
        "slug": f"test-{SeasonalTheme.objects.count() + 1}",
        "is_active": True,
        "is_draft": False,
        "priority": 100,
        "start_at": now - timedelta(days=1),
        "end_at": now + timedelta(days=1),
        "allow_user_disable": True,
        "allow_manual_selection": True,
        "is_default_seasonal_theme": True,
        "admin_only": False,
    }
    defaults.update(kwargs)
    return SeasonalTheme.objects.create(**defaults)


class SeasonalThemeSelectionTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_theme_activates_in_period(self):
        theme = _make_theme(slug="in-period")
        self.assertEqual(select_active_theme(), theme)
        self.assertEqual(theme.compute_status(), "active")

    def test_theme_off_after_end(self):
        now = timezone.now()
        _make_theme(
            slug="ended",
            start_at=now - timedelta(days=10),
            end_at=now - timedelta(days=1),
        )
        self.assertIsNone(select_active_theme())

    def test_priority_wins(self):
        now = timezone.now()
        low = _make_theme(slug="low", priority=10, start_at=now - timedelta(hours=2))
        high = _make_theme(slug="high", priority=200, start_at=now - timedelta(hours=1))
        self.assertEqual(select_active_theme(), high)
        self.assertNotEqual(select_active_theme(), low)

    def test_later_start_breaks_priority_tie(self):
        now = timezone.now()
        earlier = _make_theme(slug="earlier", priority=50, start_at=now - timedelta(days=5))
        later = _make_theme(slug="later", priority=50, start_at=now - timedelta(hours=1))
        self.assertEqual(select_active_theme(), later)
        self.assertNotEqual(select_active_theme(), earlier)

    def test_inactive_theme_hidden(self):
        _make_theme(slug="off", is_active=False)
        self.assertIsNone(select_active_theme())

    def test_draft_not_selected(self):
        _make_theme(slug="draft", is_draft=True)
        self.assertIsNone(select_active_theme())

    def test_admin_only_hidden_from_public(self):
        _make_theme(slug="admin-only", admin_only=True)
        self.assertIsNone(select_active_theme(include_admin_only=False))
        self.assertIsNotNone(select_active_theme(include_admin_only=True))

    def test_cache_invalidated_on_save(self):
        theme = _make_theme(slug="cached")
        self.assertEqual(get_cached_active_theme(), theme)
        theme.is_active = False
        theme.save()
        self.assertIsNone(get_cached_active_theme())

    def test_cache_invalidated_explicitly(self):
        theme = _make_theme(slug="cached2")
        self.assertEqual(get_cached_active_theme(), theme)
        invalidate_seasonal_theme_cache()
        theme.delete()
        self.assertIsNone(get_cached_active_theme())

    def test_force_active_ignores_default_flag(self):
        now = timezone.now()
        theme = _make_theme(
            slug="force-non-default",
            is_default_seasonal_theme=False,
            force_active_for_testing=True,
            start_at=now - timedelta(days=30),
            end_at=now - timedelta(days=1),
        )
        self.assertEqual(select_active_theme(), theme)

    def test_list_period_themes_returns_all_overlapping(self):
        low = _make_theme(slug="period-low", priority=10, button_emoji="🍯")
        high = _make_theme(slug="period-high", priority=200, button_emoji="🎄")
        _make_theme(
            slug="period-out",
            start_at=timezone.now() + timedelta(days=10),
            end_at=timezone.now() + timedelta(days=20),
        )
        items = list_period_themes(None)
        ids = [item["id"] for item in items]
        self.assertEqual(ids[0], high.id)
        self.assertIn(low.id, ids)
        self.assertEqual(len(ids), 2)
        self.assertEqual(items[0]["button_emoji"], "🎄")

    def test_non_default_without_force_not_selected(self):
        _make_theme(
            slug="non-default",
            is_default_seasonal_theme=False,
            force_active_for_testing=False,
        )
        self.assertIsNone(select_active_theme())

    def test_negative_cache_cleared_after_invalidate_and_create(self):
        self.assertIsNone(get_cached_active_theme())
        # Имитация admin update() без signals — stamp не двигается сам
        theme = _make_theme(slug="after-miss")
        # Без invalidate старый negative cache (0) ещё мог бы жить; stamp после save() уже сдвинут signals
        self.assertEqual(get_cached_active_theme(), theme)

    def test_queryset_update_needs_manual_invalidate(self):
        """QuerySet.update() не стреляет signals — после invalidate тема появляется."""
        self.assertIsNone(get_cached_active_theme())
        # Закэшируем negative miss
        self.assertIsNone(get_cached_active_theme())
        theme = SeasonalTheme(
            name="Bulk",
            slug="bulk-force",
            is_active=False,
            is_draft=True,
            is_default_seasonal_theme=False,
        )
        theme.save()
        # Как admin action: update без save()
        SeasonalTheme.objects.filter(pk=theme.pk).update(
            force_active_for_testing=True,
            is_active=True,
            is_draft=False,
        )
        # Без invalidate кеш stamp мог остаться (save() выше уже bump'нул при create).
        # Главное: после invalidate выбор видит force-тему.
        invalidate_seasonal_theme_cache()
        self.assertEqual(get_cached_active_theme(), theme)

    def test_timezone_window_uses_theme_timezone(self):
        """Тема с timezone учитывается в проверке окна (aware compare)."""
        from Generator.seasonal_theme_service import project_now, _theme_in_window

        now_msk = project_now("Europe/Moscow")
        theme = _make_theme(
            slug="tz-theme",
            timezone="Europe/Moscow",
            start_at=now_msk - timedelta(hours=1),
            end_at=now_msk + timedelta(hours=1),
        )
        self.assertTrue(_theme_in_window(theme))
        theme.end_at = now_msk - timedelta(minutes=1)
        theme.save(update_fields=["end_at"])
        theme.refresh_from_db()
        self.assertFalse(_theme_in_window(theme))


class SeasonalThemeApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client()
        self.user = User.objects.create_user("teacher1", "t@example.com", "pass12345")
        self.staff = User.objects.create_superuser("admin1", "a@example.com", "pass12345")

    def test_current_returns_theme(self):
        theme = _make_theme(slug="api-active", name="Новогоднее")
        resp = self.client.get("/api/seasonal-theme/current/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["mode"], "auto")
        self.assertIsNotNone(data["theme"])
        self.assertEqual(data["theme"]["slug"], "api-active")
        self.assertEqual(data["theme"]["name"], "Новогоднее")
        self.assertNotIn("force_active_for_testing", data["theme"])

    def test_manual_preference_saved(self):
        theme = _make_theme(slug="manual-ok")
        self.client.force_login(self.user)
        resp = self.client.patch(
            "/api/seasonal-theme/preference/",
            data={"mode": "manual", "selected_theme_id": theme.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        pref = SeasonalThemePreference.objects.get(user=self.user)
        self.assertEqual(pref.mode, "manual")
        self.assertEqual(pref.selected_theme_id, theme.id)
        self.assertEqual(resp.json()["mode"], "manual")

    def test_default_mode_disables_theme(self):
        _make_theme(slug="still-active")
        self.client.force_login(self.user)
        resp = self.client.patch(
            "/api/seasonal-theme/preference/",
            data={"mode": "default"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["mode"], "default")
        self.assertIsNone(resp.json()["theme"])

    def test_deleted_manual_theme_falls_back(self):
        theme = _make_theme(slug="to-delete")
        pref = SeasonalThemePreference.objects.create(
            user=self.user,
            mode=SeasonalThemePreference.Mode.MANUAL,
            selected_theme=theme,
        )
        theme.delete()
        self.client.force_login(self.user)
        resp = self.client.get("/api/seasonal-theme/current/")
        self.assertEqual(resp.status_code, 200)
        pref.refresh_from_db()
        self.assertEqual(pref.mode, "auto")
        self.assertIsNone(pref.selected_theme_id)

    def test_disabled_manual_theme_falls_back(self):
        theme = _make_theme(slug="disabled-manual")
        SeasonalThemePreference.objects.create(
            user=self.user,
            mode=SeasonalThemePreference.Mode.MANUAL,
            selected_theme=theme,
        )
        theme.is_active = False
        theme.save()
        self.client.force_login(self.user)
        resp = self.client.get("/api/seasonal-theme/current/")
        self.assertEqual(resp.status_code, 200)
        pref = SeasonalThemePreference.objects.get(user=self.user)
        self.assertEqual(pref.mode, "auto")

    def test_preview_staff_only(self):
        theme = _make_theme(slug="preview-me", is_draft=True, is_active=False)
        # Обычный пользователь
        self.client.force_login(self.user)
        resp = self.client.post(
            "/api/seasonal-theme/preview/start/",
            data={"theme_id": theme.id},
            content_type="application/json",
        )
        self.assertIn(resp.status_code, (403, 401))

        # Staff
        self.client.force_login(self.staff)
        resp = self.client.post(
            "/api/seasonal-theme/preview/start/",
            data={"theme_id": theme.id},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["preview"]["active"])
        self.assertEqual(data["theme"]["slug"], "preview-me")

        resp = self.client.post("/api/seasonal-theme/preview/stop/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["preview"]["active"])

    def test_draft_not_visible_to_regular_user(self):
        _make_theme(slug="secret-draft", is_draft=True, is_active=True)
        resp = self.client.get("/api/seasonal-theme/current/")
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.json()["theme"])

    def test_animations_toggle(self):
        self.client.force_login(self.user)
        resp = self.client.patch(
            "/api/seasonal-theme/preference/",
            data={"animations_enabled": False},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["animations_enabled"])
