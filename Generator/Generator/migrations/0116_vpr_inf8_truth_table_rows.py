# Условия ВПР информатика 8, задание 6: без «запишите 4 цифры», ответ по строкам таблицы.

from django.db import migrations


def forwards(apps, schema_editor):
    # Историческая Task на состоянии 0115: без source_key, import_batch, solution
    # и answer_spec. Эти колонки добавляет 0117. Живая модель их уже объявляет,
    # поэтому Task.objects.filter() на свежей базе падает с ProgrammingError
    # «column Generator_task.source_key does not exist» ещё до правки строк.
    # Набор строк и сами правки условия/ответа не меняются.
    from Generator.vpr_truth_table_tasks import affected_tasks, apply_task, plan_changes

    Task = apps.get_model("Generator", "Task")
    for task, change in plan_changes(affected_tasks(Task)):
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
