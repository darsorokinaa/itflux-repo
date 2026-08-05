import Generator.seasonal_theme_models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0081_seasonal_theme_hero_appearance"),
    ]

    operations = [
        migrations.AddField(
            model_name="seasonaltheme",
            name="hero_history_image",
            field=models.ImageField(
                blank=True,
                help_text="Основная иллюстрация внутри модального окна.",
                null=True,
                upload_to=Generator.seasonal_theme_models.seasonal_theme_upload_to,
                verbose_name="Историческая справка: картинка",
            ),
        ),
    ]
