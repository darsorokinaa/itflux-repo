# Единоразово: таблица истинности для ВПР инф. 8 кл. угл., задание 6

from django.db import migrations


def enable_truth_table_vpr8_inf6_advanced(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    Task.objects.filter(
        task__level__level__iexact="vpr",
        task__subject__subject_short__iexact="inf",
        task__task_number=6,
        vpr_class=8,
        vpr_advanced=True,
    ).update(truth_table_enabled=True)


def disable_truth_table_same_scope(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    Task.objects.filter(
        task__level__level__iexact="vpr",
        task__subject__subject_short__iexact="inf",
        task__task_number=6,
        vpr_class=8,
        vpr_advanced=True,
    ).update(truth_table_enabled=False)


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0049_task_truth_table_enabled"),
    ]

    operations = [
        migrations.RunPython(enable_truth_table_vpr8_inf6_advanced, disable_truth_table_same_scope),
    ]
