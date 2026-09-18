from django.db import migrations, models
import Generator.variant_theme_models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0095_variant_theme"),
    ]

    operations = [
        migrations.AddField(
            model_name="varianttheme",
            name="block_background_image",
            field=models.ImageField(
                blank=True,
                help_text="Фон карточек: вариант, задания, таймер и оформление.",
                null=True,
                upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                verbose_name="Фон блоков",
            ),
        ),
        migrations.AlterField(
            model_name="varianttheme",
            name="background_image",
            field=models.ImageField(
                blank=True,
                help_text="Фон всей страницы варианта.",
                null=True,
                upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                verbose_name="Фон",
            ),
        ),
    ]
