from django.conf import settings
from rest_framework.permissions import BasePermission

def messaging_role_allowed(user) -> bool:
    profile = getattr(user, "profile", None)
    if profile is None or profile.account_blocked or not profile.account_active:
        return False
    allowed = getattr(settings, "MESSAGING_PARTICIPANT_ROLES", ["teacher", "student"])
    return profile.role in set(allowed)


class IsMessagingParticipant(BasePermission):
    """Свой раздел сообщений. Учителя и ученики. Список ролей в настройке."""

    message = "Раздел сообщений недоступен для этой роли."

    def has_permission(self, request, view):
        user = request.user
        if not user.is_authenticated:
            return False
        return messaging_role_allowed(user)


def user_can_staff_messaging(user, codename: str) -> bool:
    if not user.is_authenticated or not user.is_active:
        return False
    return user.is_superuser or user.has_perm(f"messaging.{codename}")
