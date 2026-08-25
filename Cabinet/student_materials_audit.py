"""Read-only diagnostics for student materials visibility gaps."""

from __future__ import annotations

from django.db.models import Count, Q

from .choices import HomeworkStatus, MaterialStatus
from .models import (
    DirectMaterialAssignment,
    Homework,
    LessonAssignment,
    LessonPlanItem,
    Material,
    ScheduleEvent,
    Student,
)


SAMPLE_LIMIT = 50


def _sample_ids(qs, field="id", limit=SAMPLE_LIMIT):
    return list(qs.values_list(field, flat=True)[:limit])


def build_student_materials_audit(*, student_id=None, teacher_id=None, limit=SAMPLE_LIMIT):
    """
    Сводка расхождений выдачи и Student Materials API.
    Только чтение, без PII и содержимого файлов.
    """
    dma = DirectMaterialAssignment.objects.all()
    materials = Material.objects.all()
    lessons = LessonAssignment.objects.all()
    homeworks = Homework.objects.exclude(status=HomeworkStatus.DRAFT)
    students = Student.objects.all()

    if student_id:
        dma = dma.filter(Q(student_id=student_id) | Q(group__students__id=student_id))
        lessons = lessons.filter(Q(student_id=student_id) | Q(group__students__id=student_id))
        homeworks = homeworks.filter(Q(student_id=student_id) | Q(group__students__id=student_id))
        students = students.filter(pk=student_id)
    if teacher_id:
        dma = dma.filter(teacher_id=teacher_id)
        materials = materials.filter(Q(teacher_id=teacher_id) | Q(is_public=True))
        lessons = lessons.filter(teacher_id=teacher_id)
        homeworks = homeworks.filter(teacher_id=teacher_id)
        students = students.filter(teacher_id=teacher_id)

    unpublished_direct = dma.exclude(material__status=MaterialStatus.PUBLISHED)
    orphan_direct = dma.filter(student__isnull=True, group__isnull=True)
    materials_no_teacher = materials.filter(teacher__isnull=True, is_public=False)

    from .files_models import CabinetFileRelation, CabinetFileRelationType

    hw_relations_no_material = CabinetFileRelation.objects.filter(
        relation_type=CabinetFileRelationType.HOMEWORK,
        homework__in=homeworks,
        material__isnull=True,
    )

    finished_events = ScheduleEvent.objects.filter(
        Q(status__in=("done", "completed")) | Q(ends_at__isnull=False)
    )
    if teacher_id:
        finished_events = finished_events.filter(owner_id=teacher_id)
    if student_id:
        finished_events = finished_events.filter(
            Q(student_id=student_id) | Q(group__students__id=student_id)
        )

    plan_items_with_materials = LessonPlanItem.objects.filter(materials__isnull=False).distinct()
    if teacher_id:
        plan_items_with_materials = plan_items_with_materials.filter(
            Q(plan__teacher_id=teacher_id) | Q(plan__is_public=True)
        )

    duplicate_direct = (
        dma.filter(student_id__isnull=False)
        .values("teacher_id", "student_id", "material_id")
        .annotate(c=Count("id"))
        .filter(c__gt=1)
    )

    type_counts = {
        row["material_type"]: row["c"]
        for row in materials.values("material_type").annotate(c=Count("id"))
    }

    issues = []
    if unpublished_direct.exists():
        issues.append({
            "code": "direct_unpublished",
            "severity": "HIGH",
            "count": unpublished_direct.count(),
            "sample_ids": _sample_ids(unpublished_direct, limit=limit),
            "note": "Прямая выдача черновика/архива не попадает в вкладку Материалы.",
        })
    if orphan_direct.exists():
        issues.append({
            "code": "direct_orphan_target",
            "severity": "MEDIUM",
            "count": orphan_direct.count(),
            "sample_ids": _sample_ids(orphan_direct, limit=limit),
            "note": "DirectMaterialAssignment без ученика и группы.",
        })
    if materials_no_teacher.exists():
        issues.append({
            "code": "material_no_teacher",
            "severity": "MEDIUM",
            "count": materials_no_teacher.count(),
            "sample_ids": _sample_ids(materials_no_teacher, limit=limit),
            "note": "Непубличные материалы без teacher.",
        })
    if hw_relations_no_material.exists():
        issues.append({
            "code": "homework_file_without_material",
            "severity": "HIGH",
            "count": hw_relations_no_material.count(),
            "sample_ids": _sample_ids(hw_relations_no_material, limit=limit),
            "note": "Файлы ДЗ без Material-моста могут не попасть в библиотеку ученика.",
        })
    dup_count = duplicate_direct.count()
    if dup_count:
        issues.append({
            "code": "duplicate_direct_assignments",
            "severity": "LOW",
            "count": dup_count,
            "sample_ids": [
                f"{row['teacher_id']}:{row['student_id']}:{row['material_id']}"
                for row in duplicate_direct[:limit]
            ],
            "note": "Повторные прямые выдачи одного материала одному ученику.",
        })

    return {
        "filters": {"student_id": student_id, "teacher_id": teacher_id},
        "counts": {
            "students": students.count(),
            "direct_assignments": dma.count(),
            "lesson_assignments": lessons.count(),
            "homeworks": homeworks.count(),
            "materials": materials.count(),
            "materials_by_type": type_counts,
            "finished_events": finished_events.count(),
            "plan_items_with_materials": plan_items_with_materials.count(),
        },
        "issues": issues,
    }
