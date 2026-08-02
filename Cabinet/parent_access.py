"""Object-level доступ родителя к данным ученика."""

from __future__ import annotations

from django.contrib.auth.models import User
from django.db.models import QuerySet
from django.utils import timezone

from .choices import ParentRelationshipStatus
from .models import Student
from .parent_models import ParentStudentRelationship


class ParentAccessError(Exception):
    def __init__(self, message: str, *, code: str = "forbidden", status: int = 403):
        super().__init__(message)
        self.code = code
        self.status = status


def active_relationships_qs(parent: User) -> QuerySet[ParentStudentRelationship]:
    return (
        ParentStudentRelationship.objects.filter(
            parent=parent,
            status=ParentRelationshipStatus.ACTIVE,
        )
        .select_related("student", "student__teacher", "student__user", "student__user__profile")
        .order_by("student__last_name", "student__first_name", "id")
    )


def list_active_children(parent: User) -> list[Student]:
    return [rel.student for rel in active_relationships_qs(parent)]


def get_active_relationship(parent: User, student_id: int) -> ParentStudentRelationship:
    rel = (
        ParentStudentRelationship.objects.select_related(
            "student", "student__teacher", "student__user", "student__user__profile"
        )
        .filter(
            parent=parent,
            student_id=student_id,
            status=ParentRelationshipStatus.ACTIVE,
        )
        .first()
    )
    if rel is None:
        raise ParentAccessError("Нет доступа к этому ученику", code="not_linked", status=403)
    rel.last_activity_at = timezone.now()
    ParentStudentRelationship.objects.filter(pk=rel.pk).update(last_activity_at=rel.last_activity_at)
    return rel


def require_permission(rel: ParentStudentRelationship, key: str):
    if not rel.has_permission(key):
        raise ParentAccessError("Недостаточно прав для этого раздела", code="permission_denied", status=403)


def serialize_child_card(rel: ParentStudentRelationship) -> dict:
    student = rel.student
    teacher = student.teacher
    teacher_profile = getattr(teacher, "profile", None)
    subjects = [
        {
            "id": s.id,
            "subject": s.subject,
            "title": s.title or s.subject,
            "direction": s.direction,
            "level": s.level,
        }
        for s in student.subjects.filter(status="active")[:20]
    ]
    return {
        "relationship_id": rel.id,
        "student_id": student.id,
        "name": student.full_name,
        "grade": student.grade,
        "direction": student.direction,
        "direction_label": student.get_direction_display() if hasattr(student, "get_direction_display") else student.direction,
        "avatar_url": None,
        "relationship_type": rel.relationship_type,
        "relationship_type_label": rel.get_relationship_type_display(),
        "status": rel.status,
        "permissions": rel.permissions or {},
        "confirmed_at": rel.confirmed_at.isoformat() if rel.confirmed_at else None,
        "last_activity_at": rel.last_activity_at.isoformat() if rel.last_activity_at else None,
        "teachers": [
            {
                "id": teacher.id,
                "name": teacher_profile.get_display_name() if teacher_profile else teacher.get_username(),
            }
        ],
        "subjects": subjects,
    }
