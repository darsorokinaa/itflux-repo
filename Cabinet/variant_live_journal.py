"""r126: результаты «Решать вариант» в журнале — отдельная строка на ученика и сессию.

Считается на лету из HomeworkSubmission, поэтому баллы второй части,
выставленные позже, сразу отражаются в строке журнала (ученика, учителя, родителя).
"""

from __future__ import annotations

import logging

from django.utils import timezone

logger = logging.getLogger("cabinet.variant_live")

BADGE = "Вариант по ссылке"


def _scoring(homework, submission) -> dict:
    payload = submission.result_payload if isinstance(submission.result_payload, dict) else {}
    scoring = payload.get("scoring") if isinstance(payload.get("scoring"), dict) else None
    try:
        from .homework_api import store_variant_scoring
        from .lesson_locked_scores import reapply_locked_scores

        fresh = store_variant_scoring(
            reapply_locked_scores(dict(payload)),
            homework,
            previous_snapshot=payload.get("tasks_snapshot") if isinstance(payload.get("tasks_snapshot"), list) else None,
            previous_grading=payload.get("grading_snapshot") if isinstance(payload.get("grading_snapshot"), list) else None,
        )
        if isinstance(fresh, dict) and isinstance(fresh.get("scoring"), dict):
            scoring = fresh["scoring"]
    except Exception:
        logger.exception("live journal scoring failed submission=%s", submission.pk)
    return scoring or {}


def _num(v):
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def build_entry(session, submission, *, student) -> dict:
    homework = session.homework
    scoring = _scoring(homework, submission)
    earned = _num(scoring.get("earned_points"))
    max_points = _num(scoring.get("max_points"))
    pending = int(scoring.get("pending_review_count") or 0)
    percent = _num(scoring.get("percentage"))
    if percent is None and earned is not None and max_points:
        percent = round(earned * 100 / max_points, 2)
    title = session.title or f"Вариант №{session.variant_id}"
    when = session.created_at or submission.updated_at
    local = timezone.localtime(when) if when else None
    status = "pending_review" if pending else "checked"
    score_text = ""
    if earned is not None and max_points:
        score_text = f"{earned:g} из {max_points:g}"
    return {
        "id": f"live-{session.pk}-{student.id}",
        "entry_type": "homework",
        "entry_subtype": "live_variant",
        "entry_type_label": BADGE,
        "badge": BADGE,
        "live_session_id": str(session.pk),
        "variant_id": session.variant_id,
        "date": local.date().isoformat() if local else None,
        "sort_at": when.isoformat() if when else None,
        "student_id": student.id,
        "student_name": student.full_name,
        "group_id": None,
        "group_name": "",
        "teacher_id": session.teacher_id,
        "title": f"{BADGE}: {title}",
        "variant_title": title,
        "subject": "",
        "status": status,
        "status_label": "Ждёт оценки части 2" if pending else "Проверено",
        "attendance": None,
        "score": percent,
        "score_percent": percent,
        "max_score": 100,
        "earned_points": earned,
        "max_points": max_points,
        "pending_review_count": pending,
        "score_text": score_text,
        "comment": "",
        "homework_id": None,
        "submission_id": submission.id,
        "is_overdue": False,
        "submitted_late": False,
        "review_type": "live",
        "attempt_count": None,
        "attempts": [],
        "tasks": [],
        "review_url": "/cabinet/live-variants",
    }


def live_entries(*, teacher=None, student_ids=None, date_from=None, date_to=None, limit=500) -> list[dict]:
    from .models import HomeworkSubmission

    qs = (
        HomeworkSubmission.objects.filter(homework__variant_live_sessions__isnull=False)
        .select_related("student", "homework")
        .order_by("-updated_at", "-id")
    )
    if teacher is not None:
        qs = qs.filter(homework__variant_live_sessions__teacher=teacher)
    if student_ids is not None:
        qs = qs.filter(student_id__in=list(student_ids))
    if date_from:
        qs = qs.filter(homework__variant_live_sessions__created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(homework__variant_live_sessions__created_at__date__lte=date_to)
    entries = []
    seen = set()
    for sub in qs.distinct()[: limit * 2]:
        session = sub.homework.variant_live_sessions.select_related("teacher").first()
        if session is None or sub.student is None:
            continue
        key = (session.pk, sub.student_id)
        if key in seen:  # дубли сдач — берём последнюю правку
            continue
        seen.add(key)
        entries.append(build_entry(session, sub, student=sub.student))
        if len(entries) >= limit:
            break
    return entries
