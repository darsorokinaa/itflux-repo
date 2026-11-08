# Хранение спецификации ответа ВПР. Задачи пакетов этой миграцией не создаются.

from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0116_vpr_inf8_truth_table_rows"),
    ]

    operations = [
        migrations.AddField(
            model_name="tasklist",
            name="vpr_class",
            field=models.PositiveSmallIntegerField(
                blank=True,
                db_index=True,
                help_text="Пусто — список для всех классов этого уровня. 7 и 8 не делят один список: максимум и критерии у них разные.",
                null=True,
                verbose_name="Класс ВПР",
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="source_key",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Внешний id пакета, например ma7-b-01-01. Пусто у старых задач. По нему дедуп и откат будущего импорта.",
                max_length=64,
                null=True,
                verbose_name="Ключ источника",
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="import_batch",
            field=models.CharField(
                blank=True,
                db_index=True,
                help_text="Метка партии. Контент ВПР-2026 этой миграцией не загружается.",
                max_length=64,
                null=True,
                verbose_name="Партия импорта",
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="solution",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Разбор и графический эталон. Короткий ответ остаётся в поле answer.",
                verbose_name="Решение",
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="answer_spec",
            field=models.JSONField(
                blank=True,
                help_text="Формат, answer_data, критерии, verification и SVG эталона как в пакете. Без этого поля проверка остаётся прежней.",
                null=True,
                verbose_name="Спецификация ответа",
            ),
        ),
        migrations.AddConstraint(
            model_name="task",
            constraint=models.UniqueConstraint(
                condition=Q(source_key__isnull=False),
                fields=("source_key",),
                name="task_source_key_uniq",
            ),
        ),
    ]
