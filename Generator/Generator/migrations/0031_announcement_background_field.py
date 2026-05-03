from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0030_announcement_ckeditor_corner_image"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="announcement",
            name="accent",
        ),
        migrations.AddField(
            model_name="announcement",
            name="background",
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to="announcements/bg",
                verbose_name="Фон слайда",
                help_text="Фоновая картинка слайда на главной. Если не указана — синий градиент по умолчанию.",
            ),
        ),
    ]
