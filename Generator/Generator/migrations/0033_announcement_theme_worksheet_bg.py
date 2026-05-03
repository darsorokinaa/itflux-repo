from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0032_announcement_theme_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="announcement",
            name="theme_worksheet_bg",
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to="announcements/theme",
                verbose_name="Тема: фон рабочего листа",
                help_text="Фоновая картинка для рабочего листа (основной контентной области).",
            ),
        ),
    ]
