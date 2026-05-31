# Replace JSON truth_table with boolean truth_table_enabled

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0048_task_truth_table"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="task",
            name="truth_table",
        ),
        migrations.AddField(
            model_name="task",
            name="truth_table_enabled",
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text="Если включено, на странице варианта для этого задания показывается виджет таблицы истинности; ответ по-прежнему вводится строкой из 0 и 1 без подстановки правильных значений.",
                verbose_name="Таблица истинности на сайте",
            ),
        ),
    ]
