from django.db import migrations, models


def backfill_vpr_tasks(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    Task.objects.filter(task__level__level__iexact="vpr").update(
        vpr_class=8,
        vpr_advanced=True,
        vpr_basic=True,
    )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0044_task_is_active"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="vpr_class",
            field=models.PositiveSmallIntegerField(
                blank=True,
                db_index=True,
                help_text="Класс для ВПР (например 7, 8, 10). Только для заданий уровня ВПР.",
                null=True,
                verbose_name="Класс (ВПР)",
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="vpr_advanced",
            field=models.BooleanField(
                blank=True,
                db_index=True,
                help_text="Да/нет. Имеет смысл только для заданий уровня ВПР.",
                null=True,
                verbose_name="ВПР: углублённый уровень",
            ),
        ),
        migrations.AddField(
            model_name="task",
            name="vpr_basic",
            field=models.BooleanField(
                blank=True,
                db_index=True,
                help_text="Да/нет. Имеет смысл только для заданий уровня ВПР.",
                null=True,
                verbose_name="ВПР: базовый уровень",
            ),
        ),
        migrations.RunPython(backfill_vpr_tasks, noop_reverse),
    ]
