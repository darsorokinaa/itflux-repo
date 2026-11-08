# Условия ВПР информатика 8, задание 6: без «запишите 4 цифры», ответ по строкам таблицы.

from django.db import migrations


def forwards(apps, schema_editor):
    from Generator.vpr_truth_table_tasks import affected_tasks, apply_task, plan_changes

    for task, change in plan_changes(affected_tasks()):
        if change.get("skip"):
            continue
        apply_task(task, change)


def backwards(apps, schema_editor):
    # Тексты условий и эталоны до правки не восстанавливаются.
    return


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0115_r131_razbor"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
