# Generated manually for truth table UI config

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0047_alter_task_vpr_advanced_alter_task_vpr_basic_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="truth_table",
            field=models.JSONField(
                blank=True,
                help_text="Опционально: {enabled, variables, expression, steps, mode} для виджета проверки без eval.",
                null=True,
                verbose_name="Таблица истинности (UI)",
            ),
        ),
    ]
