"""Helpers for student–teacher subject links (StudentSubject)."""

from django.db.models import Q

from .choices import StudentSubjectStatus
from .models import (
    DirectMaterialAssignment,
    Homework,
    LessonPlanEnrollment,
    ScheduleEvent,
    StudentSubject,
)
from .plan_subjects import get_plan_subject_label, normalize_plan_subject_id


def subject_display_payload(student_subject):
    if not student_subject:
        return None
    return {
        "id": student_subject.id,
        "subject": student_subject.subject,
        "subject_label": student_subject.subject_label,
        "title": student_subject.title or "",
        "direction": student_subject.direction or "",
        "direction_label": (
            student_subject.get_direction_display() if student_subject.direction else ""
        ),
        "level": student_subject.level or "",
        "status": student_subject.status,
        "status_label": student_subject.get_status_display(),
        "display_label": student_subject.display_label,
        "is_active": student_subject.is_active,
    }


def active_subjects_for_student(student, *, include_archived=False):
    qs = StudentSubject.objects.filter(student=student)
    if not include_archived:
        qs = qs.filter(status=StudentSubjectStatus.ACTIVE)
    return qs.order_by("subject", "title", "id")


def get_teacher_student_subject(*, teacher, student_subject_id, student=None):
    """Resolve StudentSubject owned by teacher; optionally bound to a student."""
    qs = StudentSubject.objects.select_related("student").filter(
        pk=student_subject_id,
        student__teacher=teacher,
    )
    if student is not None:
        qs = qs.filter(student=student)
    return qs.first()


def validate_subject_belongs_to_student(*, teacher, student, student_subject_id):
    """
    Returns StudentSubject or raises ValueError with a user-facing message.
    """
    if not student_subject_id:
        raise ValueError("Укажите предмет ученика.")
    ss = get_teacher_student_subject(
        teacher=teacher,
        student_subject_id=student_subject_id,
        student=student,
    )
    if ss is None:
        raise ValueError("Предмет не принадлежит выбранному ученику.")
    return ss


def student_subject_has_history(student_subject):
    """True if archiving is preferred over hard delete."""
    if ScheduleEvent.objects.filter(student_subject=student_subject).exists():
        return True
    if Homework.objects.filter(student_subject=student_subject).exists():
        return True
    if LessonPlanEnrollment.objects.filter(student_subject=student_subject).exists():
        return True
    if DirectMaterialAssignment.objects.filter(student_subject=student_subject).exists():
        return True
    return False


def archive_student_subject(student_subject):
    student_subject.status = StudentSubjectStatus.ARCHIVED
    student_subject.save(update_fields=["status", "updated_at"])
    return student_subject


def subjects_compatible(plan_subject, student_subject_code):
    """Loose compatibility check between LessonPlan.subject and StudentSubject.subject."""
    a = normalize_plan_subject_id(plan_subject)
    b = normalize_plan_subject_id(student_subject_code)
    if not a or not b:
        return True
    if a == b:
        return True
    aliases = {
        "informatics": "inf",
        "inf": "inf",
        "math": "math",
        "math_base": "math",
    }
    return aliases.get(a, a) == aliases.get(b, b)


def resolve_student_subject_for_write(
    *,
    teacher,
    student=None,
    student_subject_id=None,
    allow_empty=True,
    require_active=True,
):
    """
    Validate optional student_subject_id for create/update flows.
    If student has exactly one active subject and id is omitted, auto-pick it
    when allow_empty is False... callers decide.
    """
    if hasattr(student_subject_id, "pk"):
        # Уже экземпляр StudentSubject из validated_data сериализатора.
        ss = student_subject_id
        if student is not None and ss.student_id != student.id:
            raise ValueError("Предмет не принадлежит выбранному ученику.")
        if ss.student.teacher_id != getattr(teacher, "id", teacher):
            raise ValueError("Предмет не принадлежит выбранному ученику.")
        if require_active and ss.status != StudentSubjectStatus.ACTIVE:
            raise ValueError("Нельзя выбрать архивный предмет.")
        return ss

    if student_subject_id in (None, "", 0, "0"):
        if allow_empty:
            return None
        if student is None:
            raise ValueError("Укажите предмет ученика.")
        active = list(active_subjects_for_student(student)[:2])
        if len(active) == 1:
            return active[0]
        if not active:
            raise ValueError(
                "У ученика нет активных предметов. Добавьте предмет в карточке ученика."
            )
        raise ValueError("Укажите предмет занятия.")

    ss = get_teacher_student_subject(
        teacher=teacher,
        student_subject_id=int(student_subject_id),
        student=student,
    )
    if ss is None:
        raise ValueError("Предмет не принадлежит выбранному ученику.")
    if require_active and ss.status != StudentSubjectStatus.ACTIVE:
        raise ValueError("Нельзя выбрать архивный предмет.")
    return ss


def filter_qs_by_student_subject(qs, student_subject_id, field="student_subject_id"):
    if student_subject_id in (None, "", "all"):
        return qs
    if str(student_subject_id).lower() in ("none", "null", "empty"):
        return qs.filter(Q(**{f"{field}__isnull": True}))
    return qs.filter(**{field: student_subject_id})


def subject_label_or_empty(code):
    return get_plan_subject_label(code) or (code or "")
