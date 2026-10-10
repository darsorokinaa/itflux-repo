"""После правки задачи в банке обновляет эталон там, где задача уже использована.

Состав варианта и попытки не пересобирается. Меняется ответ в сохранённых
снимках, и по нему заново считаются баллы — в том числе у уже проверенных
домашних заданий и вариантов.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone


def propagate_task_content(task) -> None:
    """Разослать текущий ответ задачи в варианты, ДЗ и итоги урока."""
    answer = str(getattr(task, "answer", "") or "")
    task_id = getattr(task, "pk", None)
    if not task_id:
        return
    subject = ""
    task_list = getattr(task, "task", None)
    subject_row = getattr(task_list, "subject", None) if task_list is not None else None
    if subject_row is not None:
        subject = str(getattr(subject_row, "subject_short", "") or "")
    with transaction.atomic():
        _sync_homework_attempts(task_id, answer)
        _sync_journal_variant_results(task_id, answer, subject=subject)
        _sync_lesson_answers(task, answer, subject=subject)


def refresh_stored_variant_result(variant_result, task_id, new_answer: str, *, subject: str = ""):
    """Обновить correct_answer и автовердикт в сохранённом результате варианта."""
    if not isinstance(variant_result, dict):
        return None
    tasks = variant_result.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        return None
    try:
        from Generator.answer_check import answers_equal
    except Exception:
        from Generator.Generator.answer_check import answers_equal

    key = str(task_id)
    fresh = _plain_answer(new_answer)
    found = False
    changed = False
    verdicts_changed = False
    updated = []
    for row in tasks:
        if not isinstance(row, dict):
            updated.append(row)
            continue
        row = dict(row)
        if str(row.get("id")) != key:
            updated.append(row)
            continue
        found = True
        old_expected = str(row.get("correct_answer") or "")
        if old_expected != fresh:
            row["correct_answer"] = fresh
            changed = True
        student = str(row.get("student_answer") or "")
        if student.strip() and fresh:
            new_ok = answers_equal(student, new_answer, subject=subject)
            if row.get("ok") is None or bool(row.get("ok")) != bool(new_ok):
                row["ok"] = new_ok
                verdicts_changed = True
                changed = True
        updated.append(row)
    if not found or not changed:
        return None
    out = dict(variant_result)
    out["tasks"] = updated
    if verdicts_changed:
        checked_rows = [row for row in updated if isinstance(row, dict) and row.get("ok") is not None]
        correct = sum(1 for row in checked_rows if row.get("ok") is True)
        out["checked_count"] = len(checked_rows)
        out["correct_count"] = correct
        if checked_rows:
            out["score_percent"] = round(correct * 100 / len(checked_rows), 2)
    return out


def _plain_answer(value: str) -> str:
    try:
        from .journal_service import _strip_answer_html
    except Exception:
        return str(value or "").strip()
    return _strip_answer_html(value)


def _apply_attempt_answer(payload, task_id, answer: str, *, level: str, subject: str):
    try:
        from Generator.variant_scoring import apply_bank_answer_to_attempt
    except Exception:
        from Generator.Generator.variant_scoring import apply_bank_answer_to_attempt
    return apply_bank_answer_to_attempt(
        payload,
        task_id,
        answer,
        level=level,
        subject=subject,
    )


def _score_percent(payload):
    from .homework_api import compute_score_percent

    return compute_score_percent(payload if isinstance(payload, dict) else None)


def _level_subject(homework, cache: dict) -> tuple[str, str]:
    homework_id = getattr(homework, "pk", None)
    if homework_id in cache:
        return cache[homework_id]
    from .homework_api import extract_variant_id

    try:
        from Generator.models import Variant
    except Exception:
        from Generator.Generator.models import Variant

    level = ""
    subject = ""
    tasks = homework.tasks.all() if homework is not None else []
    for task in tasks:
        variant_id = extract_variant_id(getattr(task, "description", "") or "")
        if not variant_id:
            continue
        variant = (
            Variant.objects.select_related("level", "var_subject")
            .filter(pk=variant_id)
            .first()
        )
        if variant is None:
            break
        level = str(getattr(getattr(variant, "level", None), "level", "") or "")
        subject = str(getattr(getattr(variant, "var_subject", None), "subject_short", "") or "")
        break
    cache[homework_id] = (level, subject)
    return level, subject


def _sync_homework_attempts(task_id: int, answer: str) -> None:
    from .models import HomeworkSubmission, HomeworkSubmissionAttempt

    needle = [{"id": task_id}]
    needle_text = [{"id": str(task_id)}]
    match = Q(result_payload__grading_snapshot__contains=needle) | Q(
        result_payload__grading_snapshot__contains=needle_text
    )
    contexts: dict = {}
    submissions = (
        HomeworkSubmission.objects.filter(match)
        .select_related("homework")
    )
    for submission in submissions:
        level, subject = _level_subject(submission.homework, contexts)
        updated = _apply_attempt_answer(
            submission.result_payload,
            task_id,
            answer,
            level=level,
            subject=subject,
        )
        if updated is None:
            continue
        submission.result_payload = updated
        submission.score = _score_percent(updated)
        submission.save(update_fields=["result_payload", "score", "updated_at"])
        _sync_checked_homework_journal(submission)

    attempts = HomeworkSubmissionAttempt.objects.filter(match).select_related("submission__homework")
    for attempt in attempts:
        homework = getattr(attempt.submission, "homework", None)
        level, subject = _level_subject(homework, contexts)
        updated = _apply_attempt_answer(
            attempt.result_payload,
            task_id,
            answer,
            level=level,
            subject=subject,
        )
        if updated is None:
            continue
        attempt.result_payload = updated
        attempt.score = _score_percent(updated)
        attempt.save(update_fields=["result_payload", "score"])


def _sync_journal_variant_results(task_id: int, answer: str, *, subject: str) -> None:
    from .journal_models import StudentLessonRecord

    needle = [{"id": task_id}]
    needle_text = [{"id": str(task_id)}]
    records = StudentLessonRecord.objects.filter(
        Q(variant_result__tasks__contains=needle) | Q(variant_result__tasks__contains=needle_text)
    )
    for record in records:
        updated = refresh_stored_variant_result(
            record.variant_result,
            task_id,
            answer,
            subject=subject,
        )
        if updated is None:
            continue
        fields = ["variant_result", "updated_at"]
        old_percent = (record.variant_result or {}).get("score_percent") if isinstance(record.variant_result, dict) else None
        new_percent = updated.get("score_percent")
        from_variant = str(record.overall_score_explanation or "").startswith("По варианту")
        if (
            new_percent not in (None, "")
            and not _close(old_percent, new_percent)
            and (
                from_variant
                or (
                    record.overall_score is not None
                    and old_percent not in (None, "")
                    and _close(record.overall_score, old_percent)
                )
            )
        ):
            record.overall_score = Decimal(str(new_percent))
            correct = updated.get("correct_count") or 0
            checked = updated.get("checked_count") or 0
            record.overall_score_explanation = f"По варианту: {correct}/{checked} верно"
            fields.extend(["overall_score", "overall_score_explanation"])
        record.variant_result = updated
        record.save(update_fields=fields)


def _sync_checked_homework_journal(submission) -> None:
    """Уже проверенное ДЗ остаётся проверенным, но статус в журнале берётся из нового балла."""
    from .choices import SubmissionStatus

    if getattr(submission, "status", "") != SubmissionStatus.CHECKED:
        return
    from .journal_service import sync_previous_homework_status_from_submission

    sync_previous_homework_status_from_submission(submission)


def _close(left, right) -> bool:
    try:
        return abs(float(left) - float(right)) < 0.02
    except (TypeError, ValueError):
        return False


def _lesson_keys(task) -> dict[int, set[str]]:
    try:
        from Generator.models import VariantContent
    except Exception:
        from Generator.Generator.models import VariantContent

    task_id = task.pk
    own = list(
        VariantContent.objects.filter(task_id=task_id).select_related("task__task")
    )
    if not own:
        return {}
    variant_ids = [row.variant_id for row in own]
    grouped: dict[int, list] = {}
    for row in VariantContent.objects.filter(variant_id__in=variant_ids).select_related("task__task"):
        grouped.setdefault(row.variant_id, []).append(row)
    keys_by_variant: dict[int, set[str]] = {}
    for row in own:
        siblings = grouped.get(row.variant_id) or [row]
        keys = {f"t{task_id}"}
        number = getattr(getattr(row.task, "task", None), "task_number", None)
        if number is not None:
            same_number = [
                item
                for item in siblings
                if getattr(getattr(item.task, "task", None), "task_number", None) == number
            ]
            if len(same_number) == 1:
                keys.add(str(number))
        same_order = [item for item in siblings if item.order == row.order]
        if len(same_order) == 1:
            keys.add(str(row.order))
        keys_by_variant.setdefault(row.variant_id, set()).update(keys)
    return keys_by_variant


def _sync_lesson_answers(task, answer: str, *, subject: str) -> None:
    keys_by_variant = _lesson_keys(task)
    if not keys_by_variant:
        return
    try:
        from Generator.answer_check import answers_equal
        from Generator.models import LessonStudentResult, LessonStudentsAnswer, VariantContent
        from Generator.variant_scoring import lesson_result_counts
    except Exception:
        from Generator.Generator.answer_check import answers_equal
        from Generator.Generator.models import LessonStudentResult, LessonStudentsAnswer, VariantContent
        from Generator.Generator.variant_scoring import lesson_result_counts

    query = Q()
    for variant_id, keys in keys_by_variant.items():
        query |= Q(variant_id=variant_id, task_number__in=list(keys))
    affected = set()
    for row in LessonStudentsAnswer.objects.filter(query):
        if row.is_empty or not str(row.answer or "").strip():
            is_correct = False
        else:
            is_correct = answers_equal(row.answer, answer, subject=subject)
        if row.is_correct == is_correct:
            continue
        row.is_correct = is_correct
        row.save(update_fields=["is_correct", "updated_at"])
        affected.add((row.room_id, row.variant_id, row.student))

    for room_id, variant_id, student in affected:
        answers = LessonStudentsAnswer.objects.filter(
            room_id=room_id,
            variant_id=variant_id,
            student=student,
        )
        total_tasks = VariantContent.objects.filter(variant_id=variant_id).count()
        if total_tasks <= 0:
            total_tasks = answers.count()
        counted = lesson_result_counts(
            total_tasks=total_tasks,
            correct_count=answers.filter(is_correct=True, is_empty=False).count(),
            answered_wrong_count=answers.filter(is_correct=False, is_empty=False).count(),
        )
        LessonStudentResult.objects.filter(
            room_id=room_id,
            variant_id=variant_id,
            student=student,
        ).update(
            total_tasks=counted["total_tasks"],
            correct_count=counted["correct_count"],
            wrong_count=counted["wrong_count"],
            empty_count=counted["empty_count"],
            updated_at=timezone.now(),
        )
