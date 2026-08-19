"""
Полный доступ к учебному контенту для реальных учеников, привязанных к учителю.

Не путать с тарифом учителя и не выдавать обход paywall учителю в режиме просмотра.
"""

from __future__ import annotations

from django.contrib.auth.models import User

from .choices import StudentStatus
from .models import Profile, Student


def is_real_linked_student(user) -> bool:
    """
    Ученический аккаунт, связанный с учителем через Student.user (не архив).

    Учитель (Profile.Role.TEACHER) никогда не считается учеником, даже если у него
    есть строка Student с user_id=teacher (self-roster / preview).
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    profile = getattr(user, "profile", None)
    if profile is None or profile.role != Profile.Role.STUDENT:
        return False
    return (
        Student.objects.filter(user=user)
        .exclude(status=StudentStatus.ARCHIVED)
        .exists()
    )


def _generator_lesson():
    from Generator.models import Lesson as GeneratorLesson

    return GeneratorLesson


def student_can_access_catalog_lesson(user, lesson) -> bool:
    """Опубликованный урок каталога, доступный ученикам (не draft/private)."""
    if not is_real_linked_student(user) or lesson is None:
        return False
    GeneratorLesson = _generator_lesson()
    status = getattr(lesson, "status", None)
    if status and status != GeneratorLesson.Status.PUBLISHED:
        return False
    level = getattr(lesson, "access_level", None) or ""
    if level == GeneratorLesson.AccessLevel.PRIVATE:
        return False
    return True


def student_can_access_catalog_interesting(user, item) -> bool:
    if not is_real_linked_student(user) or item is None:
        return False
    from Generator.models import InterestingItem

    status = getattr(item, "status", None)
    if status and status != InterestingItem.Status.PUBLISHED:
        return False
    return True


def has_student_full_content_access(user) -> bool:
    """Есть ли у пользователя entitlement на полный учебный контент платформы."""
    return is_real_linked_student(user)
