# -*- coding: utf-8 -*-
"""
ОГЭ информатика №13: в банке тексты были с переносами \\n без тегов <p>,
из-за чего в браузере сливался в один блок. Оборачиваем в <p>…</p> и <br>
(идемпотентно: уже с <p> не трогаем).
"""

import re

from django.db import migrations


def plain_newlines_to_p_html(s: str) -> str:
    if not s or re.search(r"<p\b", s, re.I):
        return s
    if "\n" not in s and "\r" not in s:
        return s
    t = s.replace("\r\n", "\n").strip()
    t = re.sub(r"\n", "<br>", t)
    t = re.sub(r"(?:<br\s*/?>\s*){2,}", "</p><p>", t, flags=re.I)
    return f"<p>{t}</p>"


def forwards(apps, schema_editor):
    Task = apps.get_model("Generator", "Task")
    TaskList = apps.get_model("Generator", "TaskList")
    Level = apps.get_model("Generator", "Level")
    Subject = apps.get_model("Generator", "Subject")

    try:
        level = Level.objects.get(level="oge")
        subject = Subject.objects.get(subject_short="inf")
        tl = TaskList.objects.get(level=level, subject=subject, task_number=13)
    except (Level.DoesNotExist, Subject.DoesNotExist, TaskList.DoesNotExist):
        return

    for task in Task.objects.filter(task=tl).iterator(chunk_size=50):
        old = task.task_template or ""
        new = plain_newlines_to_p_html(old)
        if new != old:
            task.task_template = new
            task.save(update_fields=["task_template"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0058_wrap_logic_connectives_spans"),
    ]

    operations = [
        migrations.RunPython(forwards, noop_reverse),
    ]
