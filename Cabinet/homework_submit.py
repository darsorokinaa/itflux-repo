"""Единая сдача ДЗ: одна текущая запись на (homework, student)."""

from __future__ import annotations

from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.utils import timezone

from .choices import SubmissionStatus
from .models import Homework, HomeworkSubmission


class HomeworkSubmitError(Exception):
    def __init__(self, message: str, *, code: str = "submit_error", status: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


@dataclass
class HomeworkSubmitResult:
    submission: HomeworkSubmission
    already_submitted: bool
    is_resubmit: bool
    review_item: object | None


def get_or_create_locked_submission(homework: Homework, student) -> HomeworkSubmission:
    """Одна строка на пару. Вызывать внутри transaction.atomic()."""
    Homework.objects.select_for_update().get(pk=homework.pk)
    existing = (
        HomeworkSubmission.objects.select_for_update()
        .filter(homework=homework, student=student)
        .order_by("-submitted_at", "-id")
        .first()
    )
    if existing is not None:
        return existing
    try:
        return HomeworkSubmission.objects.create(homework=homework, student=student)
    except IntegrityError:
        raced = (
            HomeworkSubmission.objects.select_for_update()
            .filter(homework=homework, student=student)
            .order_by("-submitted_at", "-id")
            .first()
        )
        if raced is None:
            raise
        return raced


def _result_answers(payload) -> dict:
    if not isinstance(payload, dict):
        return {}
    by_id = payload.get("by_task_id")
    if not isinstance(by_id, dict):
        by_id = {}
    return {str(key): by_id.get(key) for key in by_id}


def incoming_matches_stored(
    submission: HomeworkSubmission,
    *,
    answer_text: str | None = None,
    result=None,
) -> bool:
    if result is not None:
        from .homework_api import _merge_result_payload

        merged = _merge_result_payload(submission.result_payload, result)
        return _result_answers(merged) == _result_answers(submission.result_payload)
    if answer_text is not None:
        return (answer_text or "").strip() == (submission.answer_text or "").strip()
    return True


@transaction.atomic
def submit_homework_for_student(
    *,
    homework: Homework,
    student,
    answer_text: str | None = None,
    result=None,
    uploaded_files: list | None = None,
):
    """
    Source of truth для сдачи.

    - CHECKED: нельзя менять.
    - RETURNED / NEEDS_REVISION: снимок попытки, затем новая сдача.
    - SUBMITTED + тот же контент: идемпотентный успех.
    - SUBMITTED + новый контент: обновляет ту же строку (retry не теряет тело).
    - Черновик: первая сдача.
    """
    from .homework_api import (
        _ensure_review_item,
        _merge_result_payload,
        _notify_homework_submitted,
        compute_score_percent,
    )
    from .homework_attempts import maybe_snapshot_before_resubmit
    from .submission_files import save_submission_files, submission_has_files

    uploaded_files = uploaded_files or []
    submission = get_or_create_locked_submission(homework, student)
    old_status = submission.status

    if submission.status == SubmissionStatus.CHECKED:
        raise HomeworkSubmitError("Работа уже проверена.", code="already_checked", status=403)

    is_open_submit = bool(submission.submitted_at) and submission.status == SubmissionStatus.SUBMITTED
    has_new_files = bool(uploaded_files)
    same_content = incoming_matches_stored(
        submission, answer_text=answer_text, result=result
    )
    can_append_first_files = (
        is_open_submit
        and has_new_files
        and not submission_has_files(submission)
    )

    if is_open_submit and has_new_files and submission_has_files(submission):
        raise HomeworkSubmitError(
            "Работа уже отправлена на проверку.",
            code="already_submitted",
            status=403,
        )

    if is_open_submit and same_content and not can_append_first_files:
        review_item = _ensure_review_item(submission)
        return HomeworkSubmitResult(
            submission=submission,
            already_submitted=True,
            is_resubmit=False,
            review_item=review_item,
        )

    maybe_snapshot_before_resubmit(submission)

    if result is not None:
        merged = _merge_result_payload(submission.result_payload, result)
        submission.result_payload = merged
        computed = compute_score_percent(merged)
        if computed is not None:
            submission.score = computed

    if answer_text is not None and (answer_text or not (submission.submitted_at and not has_new_files)):
        submission.answer_text = answer_text

    submission.status = SubmissionStatus.SUBMITTED
    submission.submitted_at = timezone.now()

    if uploaded_files:
        save_submission_files(submission, uploaded_files)
    else:
        submission.save()

    review_item = _ensure_review_item(submission)
    is_resubmit = old_status in (SubmissionStatus.RETURNED, SubmissionStatus.NEEDS_REVISION)
    if not is_open_submit or is_resubmit:
        _notify_homework_submitted(submission, review_item, is_resubmit=is_resubmit)

    return HomeworkSubmitResult(
        submission=submission,
        already_submitted=False,
        is_resubmit=is_resubmit,
        review_item=review_item,
    )
