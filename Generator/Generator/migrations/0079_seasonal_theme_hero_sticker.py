from django.db import migrations, models


HONEY_SPAS_TEXT = (
    "14 августа — праздник первого мёда и урожая. "
    "На Руси в этот день освящали мёд нового сбора и начинали его пробовать. "
    "Тёплое напоминание о конце лета и простых радостях."
)


def seed_honey_sticker(apps, schema_editor):
    SeasonalTheme = apps.get_model("Generator", "SeasonalTheme")
    SeasonalTheme.objects.filter(slug="medovyj-spas").update(
        hero_sticker_title="Медовый Спас",
        hero_sticker_text=HONEY_SPAS_TEXT,
    )


def unseed_honey_sticker(apps, schema_editor):
    SeasonalTheme = apps.get_model("Generator", "SeasonalTheme")
    SeasonalTheme.objects.filter(slug="medovyj-spas").update(
        hero_sticker_title="",
        hero_sticker_text="",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0078_seasonal_theme_animation_image"),
    ]

    operations = [
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_sticker_title",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Бумажка-стикер в левом нижнем углу hero-блока. Пусто — стикер скрыт.",
                max_length=80,
                verbose_name="Стикер на главной: заголовок",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_sticker_text",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Короткое описание праздника / темы (2–4 предложения).",
                verbose_name="Стикер на главной: текст",
            ),
        ),
        migrations.RunPython(seed_honey_sticker, unseed_honey_sticker),
    ]
