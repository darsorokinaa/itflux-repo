from django.conf import settings


def can_edit_task_tags(user) -> bool:
    """Может ли пользователь редактировать теги заданий в банке «Все задачи»."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    username = (getattr(user, "username", None) or "").strip().lower()
    if not username:
        return False
    allowed = getattr(settings, "TASK_TAG_EDITOR_USERNAMES", ())
    return username in allowed
