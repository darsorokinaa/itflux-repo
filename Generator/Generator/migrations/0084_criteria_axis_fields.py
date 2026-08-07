from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0083_catalog_engagement_views_likes"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="criteria",
            options={
                "ordering": ("task_number", "axis_order", "-criteria_score", "id"),
                "verbose_name": "Критерий",
                "verbose_name_plural": "Критерии",
            },
        ),
        migrations.AddField(
            model_name="criteria",
            name="axis_code",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="",
                help_text="Пусто — старый режим одной карточки. Иначе: phonetics, q1, content…",
                max_length=64,
                verbose_name="Код оси",
            ),
        ),
        migrations.AddField(
            model_name="criteria",
            name="axis_title",
            field=models.CharField(
                blank=True,
                default="",
                max_length=200,
                verbose_name="Название оси",
            ),
        ),
        migrations.AddField(
            model_name="criteria",
            name="axis_order",
            field=models.PositiveSmallIntegerField(default=0, verbose_name="Порядок оси"),
        ),
        migrations.AddField(
            model_name="criteria",
            name="axis_max",
            field=models.PositiveSmallIntegerField(
                default=0,
                help_text="0 — взять max(criteria_score) по уровням оси.",
                verbose_name="Макс. балл оси",
            ),
        ),
        migrations.AddField(
            model_name="criteria",
            name="is_gate",
            field=models.BooleanField(
                default=False,
                help_text="Если по этой оси 0 баллов — всё задание обнуляется (как содержание в задании 4 устной части).",
                verbose_name="Gate-ось",
            ),
        ),
    ]
