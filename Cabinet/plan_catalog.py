from django.conf import settings


def can_publish_catalog_lesson_plan(user) -> bool:
    """Может ли учитель публиковать план как общий шаблон (каталог)."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    email = (getattr(user, "email", None) or "").strip().lower()
    if not email:
        return False
    allowed = getattr(settings, "LESSON_PLAN_CATALOG_PUBLISHER_EMAILS", ())
    return email in allowed
