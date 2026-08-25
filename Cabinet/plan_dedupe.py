"""Дедупликация назначений и автопланов учеников.

Не удаляет LessonPlan / ScheduleEvent / journal — дубли архивируются,
пункты переносятся в канонический план с сохранением PK.
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict

from django.db import transaction
from django.db.models import Count, Max
from django.utils import timezone

from .choices import EnrollmentStatus, PlanStatus
from .models import LessonPlan, LessonPlanEnrollment, ScheduleEvent
from .plan_schedule import AUTO_MATERIALS_PLAN_DESCRIPTION

logger = logging.getLogger("cabinet.plan_sync")

AUTO_STUDENT_PLAN_RE = re.compile(r"^План:\s+.+\s+[—–-]\s+.+$", re.IGNORECASE)


def is_auto_student_plan_title(title: str) -> bool:
    return bool(AUTO_STUDENT_PLAN_RE.match((title or "").strip()))


def _normalize_auto_title(title: str) -> str:
    text = (title or "").strip().casefold()
    return re.sub(r"\s+[—–-]\s+", " — ", text)


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
        "duplicate_groups": sum(
            1 for rows in groups.values()
            if len(rows) > 1 and rows[0] and _scope_key(rows[0])[0] != "other"
        ),
        "kept": kept,
        "cancelled": cancelled,
        "cancelled_count": len(cancelled),
        "applied": apply,
    }


def find_duplicate_active_enrollments() -> list[dict]:
    report = cancel_duplicate_active_enrollments(apply=False)
    return report["cancelled"]


def _is_materials_plan(plan: LessonPlan) -> bool:
    return (plan.description or "").strip() == AUTO_MATERIALS_PLAN_DESCRIPTION


def _is_personal_plan(plan: LessonPlan, student_id: int) -> bool:
    others = plan.enrollments.exclude(status=EnrollmentStatus.CANCELLED).exclude(
        student_id=student_id,
    )
    if others.filter(student__isnull=False).exists():
        return False
    if others.filter(group__isnull=False).exists():
        return False
    return True


def _plan_richness(plan: LessonPlan) -> tuple:
    item_count = getattr(plan, "item_count", None)
    if item_count is None:
        item_count = plan.items.count()
    event_count = ScheduleEvent.objects.filter(lesson_plan_item__plan_id=plan.pk).count()
    named_bonus = 0 if is_auto_student_plan_title(plan.title) else 10_000
    return (named_bonus, item_count, event_count, -plan.pk)


def _pick_canonical(plans: list[LessonPlan]) -> LessonPlan:
    return max(plans, key=_plan_richness)


def _merge_note(canonical: LessonPlan) -> str:
    return (
        f"[merge {timezone.now().date().isoformat()}] "
        f"объединён в план #{canonical.pk} «{canonical.title}»"
    )


def _rebind_enrollment(enrollment: LessonPlanEnrollment, canonical: LessonPlan) -> str:
    """Переносит назначение на канон. Второй ACTIVE по тому же scope отменяется."""
    clash = (
        LessonPlanEnrollment.objects.filter(
            teacher_id=enrollment.teacher_id,
            student_id=enrollment.student_id,
            status__in=[EnrollmentStatus.ACTIVE, EnrollmentStatus.PAUSED],
        )
        .exclude(pk=enrollment.pk)
    )
    if enrollment.student_subject_id:
        clash = clash.filter(student_subject_id=enrollment.student_subject_id)
    else:
        clash = clash.filter(student_subject__isnull=True)
    clash = clash.first()

    action = "rebind"
    enrollment.plan = canonical
    if clash is not None and enrollment.status in (
        EnrollmentStatus.ACTIVE,
        EnrollmentStatus.PAUSED,
    ):
        enrollment.status = EnrollmentStatus.CANCELLED
        enrollment.notes = f"{enrollment.notes}\n{_merge_note(canonical)}".strip()
        action = "cancel_rebind"
        if clash.plan_id != canonical.pk:
            clash.plan = canonical
            clash.save(update_fields=["plan", "updated_at"])
    enrollment.save()
    return action


def _merge_plan_group(canonical: LessonPlan, duplicates: list[LessonPlan], *, apply: bool) -> dict:
    moved_items = 0
    rebound = 0
    archived = []
    next_order = canonical.items.aggregate(m=Max("order")).get("m") or 0

    for dup in duplicates:
        items = list(dup.items.order_by("order", "id"))
        enrollments = list(dup.enrollments.all())
        if apply:
            for item in items:
                next_order += 1
                item.plan = canonical
                item.order = next_order
                item.save(update_fields=["plan", "order", "updated_at"])
            for enrollment in enrollments:
                _rebind_enrollment(enrollment, canonical)
                rebound += 1
            dup.status = PlanStatus.ARCHIVED
            dup.lessons_count = 0
            dup.description = f"{dup.description}\n{_merge_note(canonical)}".strip()
            dup.save(update_fields=["status", "lessons_count", "description", "updated_at"])
            logger.info(
                "merged duplicate plan=%s into canonical=%s items=%s",
                dup.pk,
                canonical.pk,
                len(items),
            )
        else:
            next_order += len(items)
            rebound += len(enrollments)
        moved_items += len(items)
        archived.append(dup.pk)

    if apply:
        canonical.lessons_count = canonical.items.count()
        if canonical.status == PlanStatus.ARCHIVED:
            canonical.status = PlanStatus.PUBLISHED
            canonical.save(update_fields=["lessons_count", "status", "updated_at"])
        else:
            canonical.save(update_fields=["lessons_count", "updated_at"])

    return {
        "canonical_id": canonical.pk,
        "canonical_title": canonical.title,
        "duplicate_ids": [plan.pk for plan in duplicates],
        "moved_items": moved_items,
        "rebound_enrollments": rebound,
        "archived_plan_ids": archived,
    }


def merge_duplicate_student_plans(*, teacher_id: int | None = None, apply: bool = False) -> dict:
    """Объединяет автопланы одного ученика. По умолчанию dry-run.

    1) Одинаковое автоназвание «План: Имя — Предмет» у одного учителя.
    2) Автоплан + личный именованный план того же ученика/предмета.
       Общий шаблон (несколько учеников) не трогаем.
    """
    if apply:
        with transaction.atomic():
            return _merge_duplicate_student_plans(teacher_id=teacher_id, apply=True)
    return _merge_duplicate_student_plans(teacher_id=teacher_id, apply=False)


def _merge_duplicate_student_plans(*, teacher_id: int | None = None, apply: bool = False) -> dict:
    qs = (
        LessonPlan.objects.filter(teacher__isnull=False, is_public=False)
        .exclude(status=PlanStatus.ARCHIVED)
        .exclude(description=AUTO_MATERIALS_PLAN_DESCRIPTION)
        .annotate(item_count=Count("items", distinct=True))
    )
    if teacher_id:
        qs = qs.filter(teacher_id=teacher_id)

    plans_by_id = {plan.pk: plan for plan in qs}
    consumed: set[int] = set()
    groups: list[dict] = []

    title_buckets = defaultdict(list)
    for plan in plans_by_id.values():
        if not is_auto_student_plan_title(plan.title):
            continue
        key = (plan.teacher_id, _normalize_auto_title(plan.title))
        title_buckets[key].append(plan)

    for rows in title_buckets.values():
        if len(rows) < 2:
            continue
        canonical = _pick_canonical(rows)
        duplicates = [plan for plan in rows if plan.pk != canonical.pk]
        groups.append(_merge_plan_group(canonical, duplicates, apply=apply) | {
            "reason": "same_auto_title",
        })
        consumed.update(plan.pk for plan in duplicates)
        if apply:
            canonical.refresh_from_db()
            canonical.item_count = canonical.items.count()
            plans_by_id[canonical.pk] = canonical
            for dup in duplicates:
                if dup.pk in plans_by_id:
                    plans_by_id[dup.pk].status = PlanStatus.ARCHIVED

    enrollments = (
        LessonPlanEnrollment.objects.filter(student__isnull=False)
        .select_related("plan")
        .exclude(plan__description=AUTO_MATERIALS_PLAN_DESCRIPTION)
    )
    if teacher_id:
        enrollments = enrollments.filter(teacher_id=teacher_id)

    clusters = defaultdict(list)
    for enrollment in enrollments:
        plan = plans_by_id.get(enrollment.plan_id)
        if plan is None or plan.status == PlanStatus.ARCHIVED:
            continue
        subject_key = enrollment.student_subject_id or f"subj:{plan.subject}"
        clusters[(enrollment.teacher_id, enrollment.student_id, subject_key)].append(enrollment)

    for (_teacher, student_id, _subject), rows in clusters.items():
        cluster_plans = []
        seen = set()
        for enrollment in rows:
            plan = plans_by_id.get(enrollment.plan_id)
            if plan is None or plan.pk in seen:
                continue
            seen.add(plan.pk)
            cluster_plans.append(plan)
        if len(cluster_plans) < 2:
            continue

        autos = [
            plan for plan in cluster_plans
            if is_auto_student_plan_title(plan.title) and plan.pk not in consumed
        ]
        named_personal = [
            plan for plan in cluster_plans
            if not is_auto_student_plan_title(plan.title)
            and _is_personal_plan(plan, student_id)
            and plan.pk not in consumed
        ]
        if named_personal and autos:
            canonical = _pick_canonical(named_personal)
            duplicates = [plan for plan in autos if plan.pk != canonical.pk]
            extra_named = [plan for plan in named_personal if plan.pk != canonical.pk]
            # Второй личный именованный план того же ученика тоже вливаем.
            duplicates.extend(extra_named)
            if not duplicates:
                continue
            groups.append(_merge_plan_group(canonical, duplicates, apply=apply) | {
                "reason": "personal_named_plus_auto",
                "student_id": student_id,
            })
            consumed.add(canonical.pk)
            consumed.update(plan.pk for plan in duplicates)
        elif len(autos) > 1:
            canonical = _pick_canonical(autos)
            duplicates = [plan for plan in autos if plan.pk != canonical.pk]
            groups.append(_merge_plan_group(canonical, duplicates, apply=apply) | {
                "reason": "same_student_autos",
                "student_id": student_id,
            })
            consumed.add(canonical.pk)
            consumed.update(plan.pk for plan in duplicates)

    if apply:
        cancel_duplicate_active_enrollments(apply=True)

    return {
        "applied": apply,
        "groups": groups,
        "group_count": len(groups),
        "archived_plans": sum(len(group["archived_plan_ids"]) for group in groups),
        "moved_items": sum(group["moved_items"] for group in groups),
    }
