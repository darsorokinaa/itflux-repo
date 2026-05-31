# -*- coding: utf-8 -*-
"""
Данные: привести TaskList.id и Task.id к последовательности 1…n в порядке прежних id.

Только PostgreSQL (SQLite и др. — no-op). Обратного переноса нет (noop_reverse).

Логика: ``Generator.renumber_primary_keys``.
"""

from django.db import migrations

from Generator.renumber_primary_keys import noop_reverse, run_full_renumber_for_migration


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0055_task_fk_verbose_name"),
    ]

    operations = [
        migrations.RunPython(run_full_renumber_for_migration, noop_reverse),
    ]
