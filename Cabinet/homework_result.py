"""Единый summary результата домашнего задания для карточек и API.

Не пересчитывает вариант и не запускает grading. Берёт уже сохранённые
`HomeworkSubmission.score` и лёгкую статистику из `result_payload`.
"""

from __future__ import annotations

from typing import Any

from .choices import SubmissionStatus

COMMENT_PREVIEW_LEN = 140

_FINAL_STATUSES = {SubmissionStatus.CHECKED}
_COMMENT_VISIBLE_STATUSES = {
    SubmissionStatus.CHECKED,
    SubmissionStatus.RETURNED,
    SubmissionStatus.NEEDS_REVISION,
}


def _as_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _as_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def payload_checked_counts(payload: dict | None) -> tuple[int | None, int | None]:
    if not isinstance(payload, dict):
        return None, None
    checked = payload.get("checked")
    if not isinstance(checked, dict) or not checked:
        return None, None
    total = len(checked)
    if total <= 0:
        return None, None
    correct = sum(1 for value in checked.values() if value is True)
    return correct, total


def payload_manual_counts(payload: dict | None) -> tuple[int | None, int | None]:
    if not isinstance(payload, dict):
        return None, None
    stats = payload.get("manual_stats")
    if not isinstance(stats, dict):
        return None, None
    total = _as_int(stats.get("total"))
    correct = _as_int(stats.get("correct"))
    if not total or total <= 0:
        return None, None
    return max(0, correct or 0), total


def _truncate_comment(text: str) -> str:
    value = (text or "").strip()
    if not value:
        return ""
    if len(value) <= COMMENT_PREVIEW_LEN:
        return value
    return value[: COMMENT_PREVIEW_LEN - 1].rstrip() + "…"


def _submission_status_key(submission) -> str:
    if submission is None:
        return "not_submitted"
    raw = (submission.status or "").strip().lower()
    submitted_at = getattr(submission, "submitted_at", None)
    if raw == SubmissionStatus.SUBMITTED and not submitted_at:
        return "not_submitted"
    if raw in {
        SubmissionStatus.CHECKED,
        SubmissionStatus.RETURNED,
        SubmissionStatus.NEEDS_REVISION,
        SubmissionStatus.SUBMITTED,
    }:
        return raw
    if submitted_at:
        return "submitted"
    return "not_submitted"


def build_submission_result_summary(submission, *, for_student: bool = False) -> dict[str, Any]:
    """Краткий итог для списка/карточки.

    Процент и баллы появляются только у окончательно проверенной работы.
    Непроверенная работа не получает фиктивных `0%` / `0 из 0`.
    """
    payload = getattr(submission, "result_payload", None) if submission is not None else None
    if not isinstance(payload, dict):
        payload = {}

    status_key = _submission_status_key(submission)
    is_final = status_key in _FINAL_STATUSES
    auto_correct, auto_total = payload_checked_counts(payload)
    manual_correct, manual_total = payload_manual_counts(payload)

    correct_count = None
    total_count = None
    percentage = None

    if is_final:
        if manual_total:
            correct_count, total_count = manual_correct, manual_total
        elif auto_total:
            correct_count, total_count = auto_correct, auto_total

        percentage = _as_float(getattr(submission, "score", None))
        if percentage is None:
            from .homework_api import compute_score_percent

            percentage = compute_score_percent(payload)
        if percentage is None and correct_count is not None and total_count:
            percentage = round(correct_count * 100 / total_count, 2)
        if percentage is not None:
            percentage = round(float(percentage), 2)
        if total_count == 0:
            correct_count = None
            total_count = None

    comment = ""
    if submission is not None:
        comment = (getattr(submission, "teacher_comment", None) or "").strip()
    comment_ok = status_key in _COMMENT_VISIBLE_STATUSES
    preview = _truncate_comment(comment) if comment_ok else ""

    summary: dict[str, Any] = {
        "status": status_key,
        "is_final": is_final,
        "percentage": percentage,
        "correct_count": correct_count,
        "total_count": total_count,
        "score": percentage,
        "max_score": 100 if percentage is not None else None,
        "teacher_comment_preview": preview,
    }

    if for_student:
        return summary

    needs_manual = False
    if not is_final and status_key == SubmissionStatus.SUBMITTED:
        from .teacher_notifications import result_needs_manual_review

        needs_manual, _reason = result_needs_manual_review(payload)

    summary["needs_manual_review"] = bool(needs_manual)
    summary["teacher_comment"] = comment if comment_ok else ""
    if not is_final and auto_total:
        summary["auto_correct_count"] = auto_correct
        summary["auto_total_count"] = auto_total
    return summary
