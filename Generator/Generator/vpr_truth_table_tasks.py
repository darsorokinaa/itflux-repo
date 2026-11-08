"""Правка условий ВПР информатика 8, задание 6: убрать «запишите 4 цифры», ответ — по строкам таблицы.

Не вызывается само по себе. Команда и миграция используют plan/apply.
"""

from __future__ import annotations

import re

from django.db.models import Q

from .truth_table_check import (
    canonical_row_answer,
    compile_truth_table,
    strip_truth_table_answer_hint,
)

_FILL_RE = re.compile(r"заполните\s+таблиц\w*\s+истинност", re.IGNORECASE)


def affected_tasks():
    """Только ВПР информатика, 8 класс, задание 6, где просят заполнить таблицу истинности."""
    from .models import Task

    return (
        Task.objects.filter(
            task__level__level__iexact="vpr",
            task__subject__subject_short__iexact="inf",
            task__task_number=6,
            vpr_class=8,
        )
        .filter(
            Q(vpr_advanced=True)
            | Q(truth_table_enabled=True)
            | Q(task_template__icontains="таблиц")
        )
        .select_related("task", "task__level", "task__subject")
        .order_by("id")
    )


def _is_target(task) -> bool:
    text = str(task.task_template or "")
    if not _FILL_RE.search(text):
        return False
    level = getattr(getattr(task.task, "level", None), "level", "") or ""
    subject = getattr(getattr(task.task, "subject", None), "subject_short", "") or ""
    number = getattr(task.task, "task_number", None)
    return (
        str(level).lower() == "vpr"
        and str(subject).lower() == "inf"
        and number == 6
        and task.vpr_class == 8
    )


def _answer_text(value: str) -> str:
    return re.sub(r"<[^>]+>", " ", str(value or ""))


def _answer_is_canonical(stored: str, spec: dict) -> bool:
    current = re.sub(r"\s+", " ", _answer_text(stored)).strip()
    canonical = canonical_row_answer(spec)
    if current == canonical:
        return True
    if len(spec["columns"]) == 1 and current.replace(" ", "") == spec["columns"][0]:
        return True
    return False


def plan_task(task) -> dict | None:
    if not _is_target(task):
        return None
    original = str(task.task_template or "")
    stripped = strip_truth_table_answer_hint(original)
    spec = compile_truth_table(stripped or original)
    if spec is None:
        return {
            "id": task.pk,
            "skip": "формула не разбирается",
            "text_changed": stripped != original,
            "answer_changed": False,
        }
    answer_changed = not _answer_is_canonical(task.answer, spec)
    text_changed = stripped != original
    if not answer_changed and not text_changed:
        return None
    return {
        "id": task.pk,
        "skip": "",
        "text_changed": text_changed,
        "answer_changed": answer_changed,
        "old_answer": _answer_text(task.answer).strip(),
        "new_answer": canonical_row_answer(spec) if answer_changed else _answer_text(task.answer).strip(),
        "new_template": stripped,
    }


def apply_task(task, change: dict) -> list[str]:
    fields = []
    if change.get("text_changed"):
        task.task_template = change["new_template"]
        fields.append("task_template")
    if change.get("answer_changed"):
        task.answer = change["new_answer"]
        fields.append("answer")
    if not task.truth_table_enabled:
        task.truth_table_enabled = True
        fields.append("truth_table_enabled")
    if fields:
        task.save(update_fields=fields)
    return fields


def plan_changes(tasks=None):
    planned = []
    for task in tasks if tasks is not None else affected_tasks():
        change = plan_task(task)
        if change:
            planned.append((task, change))
    return planned
