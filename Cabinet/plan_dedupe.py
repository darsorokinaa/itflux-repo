"""Дедупликация активных назначений планов. Не удаляет записи — только архивирует дубли."""

from __future__ import annotations

import logging
from collections import defaultdict

from django.db.models import Q
from django.utils import timezone

from .choices import EnrollmentStatus
from .models import LessonPlanEnrollment

logger = logging.getLogger("cabinet.plan_sync")


def _scope_key(enrollment: LessonPlanEnrollment):
    if enrollment.student_id and enrollment.student_subject_id:
        return ("subject", enrollment.teacher_id, enrollment.student_id, enrollment.student_subject_id)
    if enrollment.student_id:
        return ("unbound", enrollment.teacher_id, enrollment.student_id)
    if enrollment.group_id:
        return ("group", enrollment.teacher_id, enrollment.group_id)
    return ("other", enrollment.pk)


def cancel_duplicate_active_enrollments(*, apply: bool = False) -> dict:
    """Оставляет одно активное назначение на ученика+предмет / группу.

    Canonical = самое новое (id). Остальные active/paused → cancelled.
    Связанные LessonPlan / ScheduleEvent не удаляются.
    """
    qs = (
        LessonPlanEnrollment.objects.filter(
            status__in=[EnrollmentStatus.ACTIVE, EnrollmentStatus.PAUSED],
        )
        .select_related("plan")
        .order_by("id")
    )
    groups = defaultdict(list)
    for enrollment in qs:
        groups[_scope_key(enrollment)].append(enrollment)

    cancelled = []
    kept = []
    for key, rows in groups.items():
        if key[0] == "other" or len(rows) < 2:
            continue
        canonical = max(rows, key=lambda row: (row.created_at, row.pk))
        kept.append(canonical.pk)
        for row in rows:
            if row.pk == canonical.pk:
                continue
            cancelled.append({
                "id": row.pk,
                "plan_id": row.plan_id,
                "canonical_id": canonical.pk,
                "scope": key[0],
            })
            if apply:
                row.status = EnrollmentStatus.CANCELLED
                row.notes = (
                    (row.notes or "")
                    + f"\n[dedupe {timezone.now().date().isoformat()}] "
                    f"дубль активного назначения, каноническое #{canonical.pk}"
                ).strip()
                row.save(update_fields=["status", "notes", "updated_at"])
                logger.info(
                    "cancelled duplicate enrollment=%s kept=%s scope=%s",
                    row.pk,
                    canonical.pk,
                    key[0],
                )

    return {
        "duplicate_groups": sum(1 for rows in groups.values() if len(rows) > 1 and rows[0] and _scope_key(rows[0])[0] != "other"),
        "kept": kept,
        "cancelled": cancelled,
        "cancelled_count": len(cancelled),
        "applied": apply,
    }


def find_duplicate_active_enrollments() -> list[dict]:
    report = cancel_duplicate_active_enrollments(apply=False)
    return report["cancelled"]
