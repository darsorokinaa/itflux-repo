# Generated manually

import django_ckeditor_5.fields
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0029_announcement"),
    ]

    operations = [
        migrations.AlterField(
            model_name="announcement",
            name="body",
            field=django_ckeditor_5.fields.CKEditor5Field(
                blank=True,
                config_name="default",
                verbose_name="Текст",
            ),
        ),
        migrations.AddField(
            model_name="announcement",
            name="corner_image",
            field=models.ImageField(
                blank=True,
                help_text="Необязательно. Нижний левый угол карточки на главной странице.",
                null=True,
                upload_to="announcements",
                verbose_name="Картинка в углу",
            ),
        ),
    ]
