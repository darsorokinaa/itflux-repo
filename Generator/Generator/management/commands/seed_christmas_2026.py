"""Локальная копия темы christmas_2026: тёмно-красный фон и кремовые карточки.

Не для продакшена. Картинки лежат в Generator/fixtures/christmas_2026/.
"""

from __future__ import annotations

import shutil
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from Generator.seasonal_theme_models import SeasonalTheme

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "christmas_2026"
FILES = {
    "background_pattern": "pattern.png",
    "background_pattern_mobile": "pattern-mobile.png",
    "menu_background": "menu.png",
    "card_pattern": "card.png",
    "header_decor": "header.png",
    "meeting_header_decor": "meeting.png",
    "corner_image": "corner.png",
    "button_icon": "button.png",
    "hero_history_icon": "history-icon.png",
    "hero_history_image": "history.png",
    "hero_history_corner_image": "history-corner.png",
    "animation_image": "snowflake.png",
}


class Command(BaseCommand):
    help = "Создать или обновить локальную сезонную тему christmas_2026."

    def handle(self, *args, **options):
        media_dir = Path(settings.MEDIA_ROOT) / "seasonal-themes" / "christmas_2026"
        media_dir.mkdir(parents=True, exist_ok=True)
        for filename in FILES.values():
            src = FIXTURE_DIR / filename
            if not src.is_file():
                self.stderr.write(f"нет файла {src}")
                continue
            shutil.copyfile(src, media_dir / filename)

        now = timezone.now()
        theme, created = SeasonalTheme.objects.get_or_create(
            slug="christmas_2026",
            defaults={"name": "Рождество 2026"},
        )
        theme.name = "Рождество 2026"
        theme.description = "Локальная копия: тёмно-красный фон #8E2632 и кремовые карточки."
        theme.is_active = True
        theme.is_draft = False
        theme.priority = 500
        theme.start_at = now - timedelta(days=2)
        theme.end_at = now + timedelta(days=40)
        theme.allow_user_disable = True
        theme.allow_manual_selection = True
        theme.is_default_seasonal_theme = True
        theme.admin_only = False
        theme.force_active_for_testing = True
        theme.background_color = "#8E2632"
        theme.dark_background = True
        theme.background_opacity = 0.55
        theme.background_size = "96px"
        theme.background_repeat = "repeat"
        theme.background_position = "0 0"
        theme.background_overlay_color = "#5c1018"
        theme.background_overlay_opacity = 0.18
        theme.card_pattern_opacity = 0.45
        theme.card_border_color = "#E4C48A"
        theme.accent_color = "#C9A227"
        theme.button_emoji = "⭐"
        theme.animation_type = SeasonalTheme.AnimationType.SNOW
        theme.animation_intensity = SeasonalTheme.Intensity.MINIMAL
        theme.animation_max_elements = 18
        theme.hero_sticker_title = "Рождество"
        theme.hero_sticker_text = (
            "Праздничное оформление платформы: снег, звезда и короткая история праздника."
        )
        theme.hero_sticker_background_color = "#fff6c8"
        theme.hero_sticker_title_color = "#8E2632"
        theme.hero_sticker_text_color = "#3b2a16"
        theme.hero_history_title = "Рождество: короткая справка"
        theme.hero_history_body = (
            "Рождество отмечают как праздник рождения и света.\n\n"
            "На платформе это оформление включает фон, карточки, меню и эту справку."
        )
        theme.hero_history_link_label = "Узнать историю праздника"
        theme.hero_history_button_label = "Понятно"
        theme.hero_history_background_color = "#faf6ee"
        theme.hero_history_border_color = "#d4a24a"
        theme.hero_history_title_color = "#8E2632"
        theme.hero_history_text_color = "#3b2a16"
        theme.hero_history_button_color = "#8E2632"
        theme.hero_history_show_corners = True
        theme.surfaces = {"task_card": {"background_color": "#FFF6EA"}}
        for field, filename in FILES.items():
            getattr(theme, field).name = f"seasonal-themes/christmas_2026/{filename}"
        theme.save()
        verb = "Создана" if created else "Обновлена"
        self.stdout.write(f"{verb} тема {theme.slug} (id={theme.id})")
