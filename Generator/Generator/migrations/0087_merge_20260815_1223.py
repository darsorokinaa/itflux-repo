# Parallel branch: seasonal theme hero field tweaks (already on some production servers).

import Generator.seasonal_theme_models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0086_update_url_and_link_text"),
    ]

    operations = [
        migrations.AlterField(
            model_name="seasonaltheme",
            name="hero_history_icon",
            field=models.ImageField(
                blank=True,
                help_text="Небольшая тематическая иконка рядом с заголовком. Необязательно.",
                null=True,
                upload_to=Generator.seasonal_theme_models.seasonal_theme_upload_to,
                verbose_name="Историческая справка: иконка",
            ),
        ),
        migrations.AlterField(
            model_name="seasonaltheme",
            name="hero_sticker_text",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Короткое описание на стикере (2–4 предложения).",
                verbose_name="Стикер на главной: текст",
            ),
        ),
        migrations.AlterField(
            model_name="seasonaltheme",
            name="hero_sticker_title",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Бумажка-стикер слева от синего hero на главной. Пусто — стикер скрыт.",
                max_length=80,
                verbose_name="Стикер на главной: заголовок",
            ),
        ),
    ]
