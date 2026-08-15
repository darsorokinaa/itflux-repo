from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0085_interesting_access_level"),
    ]

    operations = [
        migrations.AddField(
            model_name="update",
            name="url",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Необязательно. Полный URL или путь на сайте, например /cabinet",
                max_length=500,
                verbose_name="Ссылка",
            ),
        ),
        migrations.AddField(
            model_name="update",
            name="link_text",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Необязательно. Если пусто и указана ссылка, на сайте будет «Подробнее →».",
                max_length=120,
                verbose_name="Текст ссылки",
            ),
        ),
    ]
