# ЕГЭ информатика: №26 и №27 по спецификации ФИПИ 2026/2027 оцениваются в 2 первичных балла
# (максимум за работу 29). Только данные, схема не меняется.
# Уже сданные попытки не пересчитываются: максимум заморожен в result_payload.grading_snapshot.

from django.db import migrations

NUMBERS = (26, 27)


def _task_lists(apps):
    TaskList = apps.get_model("Generator", "TaskList")
    return TaskList.objects.filter(
        subject__subject_short="inf",
        level__level="ege",
        task_number__in=NUMBERS,
    )


def forwards(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    task_lists = _task_lists(apps)
    ids = list(task_lists.values_list("id", flat=True))
    task_lists.update(max_score=2)
    Task.objects.filter(task_id__in=ids).update(max_score=2)


def backwards(apps, schema_editor):
    # Банки учителей (scope=teacher) не трогаем: часть из них стояла на 2 ещё до миграции.
    Task = apps.get_model("Generator", "Task")
    task_lists = _task_lists(apps)
    ids = list(task_lists.values_list("id", flat=True))
    task_lists.update(max_score=1)
    Task.objects.filter(task_id__in=ids, scope="global").update(max_score=1)


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0108_r57b_access_level_repetitor_label"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
