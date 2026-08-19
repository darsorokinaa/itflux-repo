from django.db import migrations, models


def enable_demo_for_paid_lessons(apps, schema_editor):
    Lesson = apps.get_model("Generator", "Lesson")
    Lesson.objects.exclude(access_level__in=["free", "", None]).update(demo_enabled=True)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0086_update_url_and_link_text"),
    ]

    operations = [
        migrations.AddField(
            model_name="lesson",
            name="standalone_purchase_enabled",
            field=models.BooleanField(
                default=False,
                help_text="Можно купить этот урок отдельно, даже если текущий тариф ниже требуемого.",
                verbose_name="Отдельная покупка",
            ),
        ),
        migrations.AddField(
            model_name="lesson",
            name="standalone_price",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=10,
                null=True,
                verbose_name="Цена отдельной покупки",
            ),
        ),
        migrations.AddField(
            model_name="lesson",
            name="standalone_currency",
            field=models.CharField(default="RUB", max_length=8, verbose_name="Валюта покупки"),
        ),
        migrations.AddField(
            model_name="lesson",
            name="demo_enabled",
            field=models.BooleanField(
                default=False,
                help_text="Одноразовое демо для зарегистрированных пользователей без полного доступа.",
                verbose_name="Демоверсия",
            ),
        ),
        migrations.AddField(
            model_name="lesson",
            name="demo_mode",
            field=models.CharField(
                choices=[
                    ("partial", "Ограниченный фрагмент"),
                    ("full_watermarked", "Весь урок с водяным знаком"),
                ],
                default="full_watermarked",
                help_text="Пользователю технические названия не показываются.",
                max_length=32,
                verbose_name="Режим демоверсии",
            ),
        ),
        migrations.AddField(
            model_name="lesson",
            name="demo_page_count",
            field=models.PositiveSmallIntegerField(default=3, verbose_name="Экранов/страниц в фрагменте"),
        ),
        migrations.AddField(
            model_name="lesson",
            name="demo_fragment",
            field=models.TextField(blank=True, default="", verbose_name="Фрагмент демоверсии"),
        ),
        migrations.AddField(
            model_name="lesson",
            name="demo_duration_minutes",
            field=models.PositiveSmallIntegerField(
                default=40,
                help_text="В этом релизе demo-session всегда 40 минут.",
                verbose_name="Длительность демо (мин)",
            ),
        ),
        migrations.RunPython(enable_demo_for_paid_lessons, noop),
    ]
