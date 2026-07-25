"""Backfill сдач ДЗ, где ученик сохранил ответы, но не проставил submitted_at."""

from __future__ import annotations

import logging
from typing import Any

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

LIVE_MEETING_MARKER = "live-meeting:"


def submission_has_student_work(submission) -> bool:
    """Есть ли признаки реальной работы ученика (не пустой placeholder после выдачи)."""
    if submission is None:
        return False
    if (getattr(submission, "answer_text", None) or "").strip():
        return True
    if getattr(submission, "attached_file", None):
        try:
            if submission.attached_file.name:
                return True
        except Exception:
            pass
    payload = getattr(submission, "result_payload", None) or {}
    if not isinstance(payload, dict) or not payload:
        return False
    for key in (
        "by_task_id",
        "by_number",
        "byTaskId",
        "byNumber",
        "checked",
        "scores",
        "attachments_by_task_id",
        "attachments_by_number",
    ):
        value = payload.get(key)
        if isinstance(value, dict) and value:
            return True
        if isinstance(value, list) and value:
            return True
    return False


def is_live_meeting_homework_desc(description: str | None) -> bool:
    return LIVE_MEETING_MARKER in (description or "")


def backfill_unsubmitted_homework_with_answers(*, dry_run: bool = False) -> dict[str, Any]:
    """
    Проставить submitted_at и ReviewItem для сдач с ответами без submitted_at.

    - teacher берётся только из Homework.teacher (не из автора варианта);
    - live-meeting: только submitted_at (в очередь «Проверка» не ставим);
    - пустые placeholder-сдачи после выдачи не трогаем.
    """
    from .choices import SubmissionStatus
    from .models import HomeworkSubmission, ReviewItem

    qs = (
        HomeworkSubmission.objects.filter(submitted_at__isnull=True)
        .select_related("homework", "student", "homework__teacher", "homework__group")
        .order_by("id")
    )

    stats = {
        "scanned": 0,
        "with_work": 0,
        "submitted_at_set": 0,
        "review_created": 0,
        "review_exists": 0,
        "live_recovered": 0,
        "skipped_no_teacher": 0,
        "skipped_no_work": 0,
        "ids": [],
    }

    for submission in qs.iterator(chunk_size=200):
        stats["scanned"] += 1
        if not submission_has_student_work(submission):
            stats["skipped_no_work"] += 1
            continue

        stats["with_work"] += 1
        homework = submission.homework
        if homework is None or homework.teacher_id is None:
            stats["skipped_no_teacher"] += 1
            logger.warning(
                "homework.backfill skip_no_teacher submission_id=%s homework_id=%s",
                submission.pk,
                getattr(homework, "pk", None),
            )
            continue

        live = is_live_meeting_homework_desc(getattr(homework, "description", None))
        submitted_at = submission.updated_at or timezone.now()
        new_status = submission.status
        if new_status not in (
            SubmissionStatus.SUBMITTED,
            SubmissionStatus.CHECKED,
            SubmissionStatus.RETURNED,
            SubmissionStatus.NEEDS_REVISION,
        ):
            new_status = SubmissionStatus.SUBMITTED

        review_status = "pending"
        if new_status == SubmissionStatus.CHECKED:
            review_status = "checked"
        elif new_status in (SubmissionStatus.RETURNED, SubmissionStatus.NEEDS_REVISION):
            review_status = "returned"

        review_created = False
        if dry_run:
            stats["submitted_at_set"] += 1
            exists = ReviewItem.objects.filter(
                teacher_id=homework.teacher_id,
                source_type="homework",
                source_id=submission.pk,
            ).exists()
            if exists:
                stats["review_exists"] += 1
            else:
                stats["review_created"] += 1
                review_created = True
        else:
            with transaction.atomic():
                submission.submitted_at = submitted_at
                if submission.status != new_status:
                    submission.status = new_status
                    submission.save(update_fields=["submitted_at", "status", "updated_at"])
                else:
                    submission.save(update_fields=["submitted_at", "updated_at"])
                stats["submitted_at_set"] += 1

                _item, created = ReviewItem.objects.get_or_create(
                    teacher_id=homework.teacher_id,
                    source_type="homework",
                    source_id=submission.pk,
                    defaults={
                        "student_id": submission.student_id,
                        "group_id": homework.group_id,
                        "title": f"{homework.title} — {submission.student}",
                        "status": review_status,
                        "priority": "normal",
                    },
                )
                if created:
                    stats["review_created"] += 1
                    review_created = True
                else:
                    stats["review_exists"] += 1

        if live:
            stats["live_recovered"] += 1

        stats["ids"].append(submission.pk)
        logger.info(
            "homework.backfill %s submission_id=%s homework_id=%s teacher_id=%s "
            "student_id=%s live=%s review_created=%s",
            "dry_run" if dry_run else "ok",
            submission.pk,
            homework.pk,
            homework.teacher_id,
            submission.student_id,
            live,
            review_created,
        )

    return stats
