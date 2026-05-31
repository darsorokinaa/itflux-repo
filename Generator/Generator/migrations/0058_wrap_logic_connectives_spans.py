# -*- coding: utf-8 -*-
"""
Обёртка русских И / ИЛИ / НЕ в span.logic-connective-ru для TaskList pk=3 (см. 0057).

Нужно для отображения без курсива рядом с MathJax.
"""

from django.db import migrations

from Generator.logic_connectives_ru import wrap_plain_ru_logic_words

TASKLIST_PK = 3


def _apply(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    Criteria = apps.get_model("Generator", "Criteria")

    for t in Task.objects.filter(task_id=TASKLIST_PK).iterator(chunk_size=50):
        nt = wrap_plain_ru_logic_words(t.task_template or "")
        na = wrap_plain_ru_logic_words(t.answer or "")
        if nt != (t.task_template or "") or na != (t.answer or ""):
            t.task_template = nt
            t.answer = na
            t.save(update_fields=["task_template", "answer"])

    for c in Criteria.objects.filter(task_number_id=TASKLIST_PK).iterator(chunk_size=50):
        nx = wrap_plain_ru_logic_words(c.criteria_text or "")
        if nx != (c.criteria_text or ""):
            c.criteria_text = nx
            c.save(update_fields=["criteria_text"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0057_logic_words_tasklist_pk3"),
    ]

    operations = [
        migrations.RunPython(_apply, noop_reverse),
    ]
