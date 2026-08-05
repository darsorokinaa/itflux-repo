import Generator.seasonal_theme_models
from django.db import migrations, models


def seed_honey_appearance(apps, schema_editor):
    SeasonalTheme = apps.get_model("Generator", "SeasonalTheme")
    SeasonalTheme.objects.filter(slug="medovyj-spas").update(
        hero_sticker_background_color="#fff6c8",
        hero_sticker_title_color="#5a3d0c",
        hero_sticker_text_color="#4a3a1a",
        hero_history_button_label="Понятно",
        hero_history_background_color="#faf6ee",
        hero_history_border_color="#d4a24a",
        hero_history_title_color="#0f2f7f",
        hero_history_text_color="#3b2a16",
        hero_history_button_color="#1d4ed8",
        hero_history_show_corners=True,
    )
    try:
        from Generator.seasonal_theme_service import invalidate_seasonal_theme_cache

        invalidate_seasonal_theme_cache()
    except Exception:
        pass


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0080_seasonal_theme_hero_history"),
    ]

    operations = [
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_sticker_background_color",
            field=models.CharField(
                blank=True,
                default="#fff6c8",
                help_text="Например #fff6c8. Пусто — значение по умолчанию.",
                max_length=32,
                verbose_name="Стикер: цвет фона",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_sticker_title_color",
            field=models.CharField(
                blank=True,
                default="#5a3d0c",
                max_length=32,
                verbose_name="Стикер: цвет заголовка",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_sticker_text_color",
            field=models.CharField(
                blank=True,
                default="#4a3a1a",
                max_length=32,
                verbose_name="Стикер: цвет текста",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_button_label",
            field=models.CharField(
                blank=True,
                default="Понятно",
                help_text="Подпись нижней кнопки закрытия.",
                max_length=40,
                verbose_name="Историческая справка: кнопка",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_background_color",
            field=models.CharField(
                blank=True,
                default="#faf6ee",
                help_text="Кремовый фон модалки, например #faf6ee.",
                max_length=32,
                verbose_name="Справка: цвет фона",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_border_color",
            field=models.CharField(
                blank=True,
                default="#d4a24a",
                help_text="Янтарная рамка, например #d4a24a.",
                max_length=32,
                verbose_name="Справка: цвет рамки",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_title_color",
            field=models.CharField(
                blank=True,
                default="#0f2f7f",
                help_text="Тёмно-синий заголовок для связи с платформой.",
                max_length=32,
                verbose_name="Справка: цвет заголовка",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_text_color",
            field=models.CharField(
                blank=True,
                default="#3b2a16",
                help_text="Тёмно-коричневый основной текст.",
                max_length=32,
                verbose_name="Справка: цвет текста",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_button_color",
            field=models.CharField(
                blank=True,
                default="#1d4ed8",
                help_text="Синяя кнопка платформы, например #1d4ed8.",
                max_length=32,
                verbose_name="Справка: цвет кнопки",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_show_corners",
            field=models.BooleanField(
                default=True,
                help_text="Показывать декоративные соты/узор по углам модалки.",
                verbose_name="Справка: декоративные углы",
            ),
        ),
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_corner_image",
            field=models.ImageField(
                blank=True,
                help_text="Опционально: своя картинка для углов. Без файла — встроенные соты.",
                null=True,
                upload_to=Generator.seasonal_theme_models.seasonal_theme_upload_to,
                verbose_name="Справка: картинка углов",
            ),
        ),
        migrations.RunPython(seed_honey_appearance, noop_reverse),
    ]
