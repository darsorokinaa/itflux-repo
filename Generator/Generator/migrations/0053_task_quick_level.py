from django.db import migrations, models
import django.db.models.deletion


def copy_level_from_tasklist(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    TaskList = apps.get_model("Generator", "TaskList")
    for row in Task.objects.exclude(task_id=None).values_list("pk", "task_id"):
        pk, tl_id = row
        level_id = TaskList.objects.filter(pk=tl_id).values_list("level_id", flat=True).first()
        if level_id is not None:
            Task.objects.filter(pk=pk).update(quick_level_id=level_id)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0052_supportinfo_vpr_class"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="quick_level",
            field=models.ForeignKey(
                blank=True,
                db_index=True,
                help_text="Копия уровня номера задания для правки прямо в списке админки; при изменении обновляется TaskList.level.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="Generator.level",
                verbose_name="Уровень",
            ),
        ),
        migrations.RunPython(copy_level_from_tasklist, noop_reverse),
    ]
