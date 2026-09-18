"""Права на темы оформления вариантов.

Две отдельные permissions:

- can_manage_variant_themes — CRUD шаблонов тем (только администратор).
- can_select_variant_theme — назначение theme_id существующему Variant.

Сейчас обе есть только у staff/superuser. Позже can_select_variant_theme
можно открыть учителям, не меняя Theme Engine и не открывая CRUD.
"""


def _is_admin(user) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


def can_manage_variant_themes(user) -> bool:
    """Создание, редактирование, публикация и удаление VariantTheme."""
    return _is_admin(user)


def can_select_variant_theme(user) -> bool:
    """Назначение опубликованной темы варианту.

    Сейчас совпадает с admin. В будущем можно вернуть True для учителя,
    оставив can_manage_variant_themes только администратору.
    """
    return _is_admin(user)
