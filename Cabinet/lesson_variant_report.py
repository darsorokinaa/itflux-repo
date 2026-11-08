"""PDF журнала — тот же файл, что «Скачать отчёт» после «Завершить вариант».

Собирает JSON, который ResultsModal отправляет в report-pdf, и отдаёт его
в finish_variant_report_response. Непроверенные задания в файл не попадают
нулём: шаблон отчёта считает пропущенный балл нулём. Завершённый ноль остаётся.
"""

from __future__ import annotations

from .lesson_variant_results import (
    lesson_variant_homeworks,
    lesson_variant_id_from_description,
    student_report_name,
)


class VariantReportNotReady(Exception):
    """Итог ещё не завершён: файл отчёта не подменяет его нулём."""


def _num(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_finish_variant_report_data(*, student_name: str, submission, variant_id, lesson_date=None) -> dict:
    raw = submission.result_payload if submission is not None and isinstance(submission.result_payload, dict) else {}
    scoring = raw.get("scoring") if isinstance(raw.get("scoring"), dict) else {}
    snap = {
        str(row.get("id")): row
        for row in (raw.get("tasks_snapshot") or [])
        if isinstance(row, dict) and row.get("id") is not None
    }
    review = scoring.get("review_status")
    pending = int(scoring.get("pending_review_count") or 0)
    final = review == "final" and pending == 0
    tasks = []
    scores = {}
    for row in scoring.get("tasks") or []:
        if not isinstance(row, dict) or row.get("id") is None:
            continue
        status = row.get("status")
        points = _num(row.get("points"))
        if not final and (status == "pending_review" or points is None):
            continue
        if points is None:
            continue
        tid = str(row.get("id"))
        source = snap.get(tid) or {}
        max_score = _num(row.get("max_points"))
        if max_score is None:
            max_score = _num(source.get("max_score"))
        if max_score is None:
            max_score = 1
        scores[tid] = points
        tasks.append(
            {
                "id": row.get("id"),
                "number": row.get("number") if row.get("number") is not None else source.get("number"),
                "task_title": source.get("task_title") or "",
                "max_score": max_score,
                "subtopic_title": source.get("subtopic_title") or "",
            }
        )
    if final and scoring.get("earned_points") is not None and scoring.get("max_points") is not None:
        total = scoring.get("earned_points")
        maximum = scoring.get("max_points")
    elif tasks:
        total = sum(scores.values())
        maximum = sum(task["max_score"] for task in tasks)
    else:
        raise VariantReportNotReady
    if not final and not tasks:
        raise VariantReportNotReady

    date_solution = ""
    if lesson_date is not None:
        date_solution = lesson_date.strftime("%d.%m.%Y")
    task_times = raw.get("taskTimes") if isinstance(raw.get("taskTimes"), dict) else {}
    return {
        "studentName": student_name or "Ученик",
        "variantId": variant_id,
        "dateSolutionLocal": date_solution,
        "timeStartLocal": "",
        "timeEndLocal": "",
        "totalTimeFormatted": raw.get("totalTimeFormatted") or "",
        "taskTimes": task_times,
        "scores": scores,
        "totalScore": total,
        "maxScore": maximum,
        "tasks": tasks,
    }


def lesson_variant_submission(journal, student, variant_id):
    event_id = journal.schedule_event_id
    if not event_id or variant_id is None:
        return None
    for homework in lesson_variant_homeworks(event_id, journal.teacher):
        found = lesson_variant_id_from_description(homework.description or "", event_id)
        if found != int(variant_id):
            continue
        from .models import HomeworkSubmission

        return (
            HomeworkSubmission.objects.filter(homework=homework, student=student)
            .order_by("-updated_at", "-id")
            .first()
        )
    return None


def report_student_name(student) -> str:
    return student_report_name(student)
