"""История попыток сдачи ДЗ — снимки перед перезаписью текущей сдачи."""

from __future__ import annotations

from copy import deepcopy

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from .choices import SubmissionStatus
from .models import HomeworkSubmission, HomeworkSubmissionAttempt


def next_attempt_number(submission: HomeworkSubmission) -> int:
    current = (
        HomeworkSubmissionAttempt.objects.filter(submission=submission)
        .aggregate(m=Max("attempt_number"))
        .get("m")
        or 0
    )
    return int(current) + 1


@transaction.atomic
def snapshot_submission_attempt(
    submission: HomeworkSubmission,
    *,
    is_final: bool = False,
    checked_at=None,
) -> HomeworkSubmissionAttempt | None:
    """
    Сохраняет снимок текущего состояния сдачи.
    Не создаёт снимок, если нечего фиксировать (пустой черновик без сдачи).
    """
    has_content = bool(
        submission.submitted_at
        or submission.score is not None
        or (submission.result_payload or {})
        or (submission.answer_text or "").strip()
        or submission.attached_file
        or (submission.teacher_comment or "").strip()
    )
    if not has_content:
        return None

    attempt = HomeworkSubmissionAttempt.objects.create(
        submission=submission,
        attempt_number=next_attempt_number(submission),
        status=submission.status or SubmissionStatus.SUBMITTED,
        score=submission.score,
        result_payload=deepcopy(submission.result_payload or {}),
        answer_text=submission.answer_text or "",
        teacher_comment=submission.teacher_comment or "",
        submitted_at=submission.submitted_at,
        checked_at=checked_at,
        is_final=is_final,
    )
    HomeworkSubmission.objects.filter(pk=submission.pk).update(
        attempt_count=attempt.attempt_number,
        updated_at=timezone.now(),
    )
    submission.attempt_count = attempt.attempt_number
    return attempt


def maybe_snapshot_before_resubmit(submission: HomeworkSubmission) -> HomeworkSubmissionAttempt | None:
    """Перед повторной сдачей после возврата/доработки."""
    if submission.status in (SubmissionStatus.RETURNED, SubmissionStatus.NEEDS_REVISION):
        return snapshot_submission_attempt(submission, is_final=False)
    if submission.submitted_at and submission.status == SubmissionStatus.CHECKED:
        return None
    return None


def snapshot_on_review(submission: HomeworkSubmission, *, checked: bool) -> HomeworkSubmissionAttempt | None:
    """После проверки или возврата — зафиксировать итог попытки."""
    return snapshot_submission_attempt(
        submission,
        is_final=checked,
        checked_at=timezone.now() if checked else None,
    )


def serialize_attempts(submission: HomeworkSubmission) -> list[dict]:
    rows = []
    for a in submission.attempts.all().order_by("attempt_number"):
        status_key = a.status or SubmissionStatus.SUBMITTED
        rows.append(
            {
                "id": a.id,
                "attempt_number": a.attempt_number,
                "status": status_key,
                "status_label": dict(SubmissionStatus.choices).get(status_key, status_key),
                "score": float(a.score) if a.score is not None else None,
                "teacher_comment": a.teacher_comment or "",
                "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
                "checked_at": a.checked_at.isoformat() if a.checked_at else None,
                "is_final": a.is_final,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
        )
    return rows
