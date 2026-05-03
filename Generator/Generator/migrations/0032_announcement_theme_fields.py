from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0031_announcement_background_field"),
    ]

    operations = [
        migrations.AddField(
            model_name="announcement",
            name="theme_overlay",
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to="announcements/theme",
                verbose_name="Тема: оверлей на фон",
                help_text="Картинка поверх фона сайта (repeat). Пусто = без оверлея.",
            ),
        ),
        migrations.AddField(
            model_name="announcement",
            name="theme_header_bg",
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to="announcements/theme",
                verbose_name="Тема: фон шапки",
            ),
        ),
        migrations.AddField(
            model_name="announcement",
            name="theme_logo",
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to="announcements/theme",
                verbose_name="Тема: иконка у логотипа",
            ),
        ),
        migrations.AddField(
            model_name="announcement",
            name="theme_decor",
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to="announcements/theme",
                verbose_name="Тема: декоративные элементы",
                help_text="Картинка-декор поверх контента (repeat, полупрозрачная).",
            ),
        ),
    ]
