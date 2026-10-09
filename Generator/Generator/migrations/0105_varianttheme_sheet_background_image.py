import Generator.variant_theme_models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0104_alter_lesson_options_alter_variant_options_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="varianttheme",
            name="sheet_background_image",
            field=models.ImageField(
                blank=True,
                help_text="Рисунок для фона печатного варианта и рабочей тетради. На лист он накладывается отдельно.",
                null=True,
                upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                verbose_name="Фон варианта и рабочего листа",
            ),
        ),
    ]
