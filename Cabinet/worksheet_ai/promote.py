"""Одобренное AI-задание становится обычной задачей банка."""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.db.models import Max

from Generator.models import Level, Task, TaskList

from .models import AITaskCandidate


class PromoteError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def promote_candidate(candidate: AITaskCandidate) -> Task:
    if candidate.promoted_task_id:
        task = candidate.promoted_task
        if not task.ai_candidate_id:
            task.ai_candidate_id = candidate.id
            task.save(update_fields=["ai_candidate_id"])
        if candidate.review_status != AITaskCandidate.Review.APPROVED:
            candidate.review_status = AITaskCandidate.Review.APPROVED
            candidate.save(update_fields=["review_status"])
        return task

    level = _level_for(candidate)
    if level is None:
        raise PromoteError(f"Задание {candidate.id}: не указан класс или уровень.")
    if not (candidate.text or "").strip():
        raise PromoteError(f"Задание {candidate.id}: пустое условие.")

    title = (candidate.topic or "AI").strip()[:255]
    task_list = TaskList.objects.filter(
        subject_id=candidate.subject_id, level=level, task_title=title
    ).first()
    if task_list is None:
        number = (
            TaskList.objects.filter(subject_id=candidate.subject_id, level=level).aggregate(
                value=Max("task_number")
            )["value"]
            or 0
        ) + 1
        task_list = TaskList.objects.create(
            subject_id=candidate.subject_id,
            level=level,
            task_number=number,
            task_title=title,
            max_score=1,
        )
    grade = int(candidate.grade) if str(candidate.grade or "").isdigit() else None
    try:
        with transaction.atomic():
            task = Task.objects.create(
                task=task_list,
                task_template=candidate.text,
                answer=candidate.answer or "",
                is_active=True,
                scope=Task.Scope.GLOBAL,
                status=Task.Status.READY,
                vpr_class=grade,
                vpr_basic=candidate.difficulty == "basic",
                vpr_advanced=candidate.difficulty == "advanced",
                author="ai",
                created_by="AI",
                ai_candidate_id=candidate.id,
            )
            candidate.promoted_task = task
            candidate.review_status = AITaskCandidate.Review.APPROVED
            candidate.save(update_fields=["promoted_task", "review_status"])
    except IntegrityError as exc:
        existing = Task.objects.filter(ai_candidate_id=candidate.id).first()
        if existing is None:
            raise PromoteError(f"Задание {candidate.id}: не удалось добавить в банк.") from exc
        candidate.promoted_task = existing
        candidate.review_status = AITaskCandidate.Review.APPROVED
        candidate.save(update_fields=["promoted_task", "review_status"])
        return existing
    return task


def _level_for(candidate: AITaskCandidate):
    if candidate.level_id:
        return candidate.level
    grade = str(candidate.grade or "")
    if not grade.isdigit():
        return None
    return (
        Level.objects.filter(level=grade).first()
        or Level.objects.filter(level_rus__icontains=grade).first()
    )
