# Generated manually

from django.db import migrations, models

import Cabinet.models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0015_referral_links"),
    ]

    operations = [
        migrations.AlterField(
            model_name="interactivebackground",
            name="css_background",
            field=models.TextField(
                blank=True,
                help_text="Значение для CSS-свойства background (необязательно, если задано изображение)",
                verbose_name="CSS фона",
            ),
        ),
        migrations.AddField(
            model_name="interactivebackground",
            name="background_image",
            field=models.ImageField(
                blank=True,
                help_text="Изображение фона (альтернатива CSS)",
                null=True,
                upload_to=Cabinet.models.interactive_background_upload_to,
                verbose_name="Фон-картинка",
            ),
        ),
    ]
