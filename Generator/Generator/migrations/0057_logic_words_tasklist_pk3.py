# -*- coding: utf-8 -*-
"""
Для всех Task с task_id = 3 (номер задания TaskList pk=3 после перенумерации):
в полях условия и ответа символы ∧ ∨ ¬ и LaTeX \\land \\lor \\neg …
заменяются на слова «И», «ИЛИ», «НЕ».

Обратного хода нет (noop_reverse).
"""

from django.db import migrations

from Generator.logic_connectives_ru import replace_logic_connectives_with_words

# Первичный ключ строки TaskList (не поле task_number варианта).
TASKLIST_PK = 3


def _apply(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    Criteria = apps.get_model("Generator", "Criteria")

    for t in Task.objects.filter(task_id=TASKLIST_PK).iterator(chunk_size=50):
        nt = replace_logic_connectives_with_words(t.task_template or "")
        na = replace_logic_connectives_with_words(t.answer or "")
        if nt != (t.task_template or "") or na != (t.answer or ""):
            t.task_template = nt
            t.answer = na
            t.save(update_fields=["task_template", "answer"])

    for c in Criteria.objects.filter(task_number_id=TASKLIST_PK).iterator(chunk_size=50):
        nx = replace_logic_connectives_with_words(c.criteria_text or "")
        if nx != (c.criteria_text or ""):
            c.criteria_text = nx
            c.save(update_fields=["criteria_text"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0056_renumber_tasklist_and_task_primary_keys"),
    ]

    operations = [
        migrations.RunPython(_apply, noop_reverse),
    ]
