from django.conf import settings
from django.db.models import Q

from .choices import PlanStatus


def can_publish_catalog_lesson_plan(user) -> bool:
    """Может ли учитель публиковать план как общий шаблон (каталог)."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    email = (getattr(user, "email", None) or "").strip().lower()
    if not email:
        return False
    allowed = getattr(settings, "LESSON_PLAN_CATALOG_PUBLISHER_EMAILS", ())
    return email in allowed


def is_catalog_lesson_plan(plan) -> bool:
    return bool(getattr(plan, "is_public", False))


def visible_lesson_plans_q(teacher):
    """Личные планы учителя и публичные шаблоны каталога."""
    return Q(teacher=teacher) | Q(is_public=True)


def personal_lesson_plans_q(teacher):
    return Q(teacher=teacher, is_public=False)


def published_catalog_lesson_plans_q():
    return Q(is_public=True, status=PlanStatus.PUBLISHED)


def visible_lesson_plan_items_q(teacher):
    return Q(plan__teacher=teacher) | Q(plan__is_public=True)


def can_edit_lesson_plan(user, plan) -> bool:
    """Редактировать/удалять можно свой личный план или любой шаблон каталога (издатель)."""
    if is_catalog_lesson_plan(plan):
        return can_publish_catalog_lesson_plan(user)
    return bool(user) and plan.teacher_id == getattr(user, "id", None)
