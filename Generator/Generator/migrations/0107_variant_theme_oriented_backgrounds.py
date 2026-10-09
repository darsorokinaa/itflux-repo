import Generator.variant_theme_models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0106_variant_theme_legacy_route_gradient"),
    ]

    operations = [
        migrations.AddField(
            model_name="varianttheme",
            name="background_image_vertical",
            field=models.ImageField(
                blank=True,
                help_text="Фон страницы варианта в книжной ориентации. Если не задан, берётся альбомный.",
                null=True,
                upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                verbose_name="Фон, книжный",
            ),
        ),
        migrations.AddField(
            model_name="varianttheme",
            name="sheet_background_image_vertical",
            field=models.ImageField(
                blank=True,
                help_text="Фон рабочего листа и печатного варианта в книжной ориентации. Если не задан, берётся альбомный.",
                null=True,
                upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                verbose_name="Фон листа, книжный",
            ),
        ),
        migrations.AlterField(
            model_name="varianttheme",
            name="background_image",
            field=models.ImageField(
                blank=True,
                help_text="Фон страницы варианта в альбомной ориентации. Если книжный фон не задан, используется и для узкого экрана.",
                null=True,
                upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                verbose_name="Фон, альбомный",
            ),
        ),
        migrations.AlterField(
            model_name="varianttheme",
            name="block_background_image",
            field=models.ImageField(
                blank=True,
                help_text="Рисунок карточки задания. На карточке он прозрачный и виден на 30%.",
                null=True,
                upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                verbose_name="Фон блоков",
            ),
        ),
        migrations.AlterField(
            model_name="varianttheme",
            name="sheet_background_image",
            field=models.ImageField(
                blank=True,
                help_text="Фон рабочего листа и печатного варианта в альбомной ориентации.",
                null=True,
                upload_to=Generator.variant_theme_models.variant_theme_upload_to,
                verbose_name="Фон листа, альбомный",
            ),
        ),
    ]
