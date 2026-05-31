from django.db import migrations


def fill_oge(apps, schema_editor):
    Level = apps.get_model("Generator", "Level")
    Task = apps.get_model("Generator", "Task")
    TaskList = apps.get_model("Generator", "TaskList")

    oge = Level.objects.filter(level__iexact="oge").first()
    if not oge:
        return

    qs = Task.objects.filter(quick_level__isnull=True)
    tl_ids = list(qs.exclude(task_id=None).values_list("task_id", flat=True).distinct())
    qs.update(quick_level_id=oge.pk)
    if tl_ids:
        TaskList.objects.filter(pk__in=tl_ids).update(level_id=oge.pk)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0053_task_quick_level"),
    ]

    operations = [
        migrations.RunPython(fill_oge, noop_reverse),
    ]
