from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0104_screenshare_show_author_names"),
    ]

    operations = [
        migrations.AddField(
            model_name="interactive",
            name="custom_background_image_url",
            field=models.CharField(
                blank=True,
                default="",
                help_text="URL загруженного учителем фона. Если задан, перекрывает фон из каталога.",
                max_length=1000,
                verbose_name="Свой фон (картинка)",
            ),
        ),
        migrations.AddField(
            model_name="interactive",
            name="custom_background_tone",
            field=models.CharField(
                blank=True,
                choices=[("dark", "Тёмный"), ("light", "Светлый")],
                default="light",
                max_length=10,
                verbose_name="Тон текста на своём фоне",
            ),
        ),
    ]
