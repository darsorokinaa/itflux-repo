from django.db import migrations, models


def fill_null_vpr_flags(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    Task.objects.filter(vpr_advanced__isnull=True).update(vpr_advanced=False)
    Task.objects.filter(vpr_basic__isnull=True).update(vpr_basic=False)


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0045_task_vpr_fields"),
    ]

    operations = [
        migrations.RunPython(fill_null_vpr_flags, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="task",
            name="vpr_advanced",
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text="Да/нет. Имеет смысл только для заданий уровня ВПР.",
                verbose_name="ВПР: углублённый уровень",
            ),
        ),
        migrations.AlterField(
            model_name="task",
            name="vpr_basic",
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text="Да/нет. Имеет смысл только для заданий уровня ВПР.",
                verbose_name="ВПР: базовый уровень",
            ),
        ),
    ]
