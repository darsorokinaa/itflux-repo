"""Задания варианта платформы без переписывания."""

from __future__ import annotations

from Generator.models import Task, Variant, VariantContent

from .integrity import is_themable
from .retrieval import RetrievedTask, difficulty_of_task
from .textutil import plain_text

MAX_VARIANT_TASKS = 60


class VariantSourceError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def load_variant_tasks(user, variant_id: int) -> tuple[Variant, list[RetrievedTask]]:
    variant = (
        Variant.objects.filter(pk=int(variant_id))
        .select_related("var_subject", "level")
        .first()
    )
    if not variant:
        raise VariantSourceError("Вариант с таким номером не найден.")
    teacher_id = getattr(user, "id", None)
    if variant.owner_teacher_id and variant.owner_teacher_id != teacher_id:
        raise VariantSourceError("Этот вариант недоступен.")
    contents = (
        VariantContent.objects.filter(variant=variant)
        .select_related("task", "task__task", "task__subtopic")
        .order_by("order", "id")
    )
    selected = []
    for item in contents:
        task = item.task
        if task.scope == Task.Scope.TEACHER and task.owner_teacher_id != teacher_id:
            continue
        text = plain_text(task.task_template)
        if not text:
            continue
        title = ""
        if task.task_id and task.task:
            title = task.task.task_title or ""
        selected.append(
            RetrievedTask(
                source="bank",
                bank_task_id=task.id,
                candidate_id=None,
                text=text,
                answer=plain_text(task.answer),
                solution="",
                difficulty=difficulty_of_task(task),
                topic=title,
                subtopic=task.subtopic.title if task.subtopic_id and task.subtopic else "",
                grade=str(task.vpr_class or ""),
                task_type="short_answer",
                skill=title[:255],
                score=0,
                themable=is_themable(text, exam_part=task.exam_part),
                exam_part=task.exam_part,
            )
        )
    if not selected:
        raise VariantSourceError("В этом варианте нет заданий.")
    if len(selected) > MAX_VARIANT_TASKS:
        raise VariantSourceError(f"В варианте больше {MAX_VARIANT_TASKS} заданий.")
    return variant, selected
