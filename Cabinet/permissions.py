from rest_framework.permissions import BasePermission

from .models import Profile


class IsCabinetTeacher(BasePermission):
    message = "Доступ только для учителей."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        profile = getattr(request.user, "profile", None)
        if profile is None:
            return False
        if profile.account_blocked or not profile.account_active:
            return False
        return profile.role == Profile.Role.TEACHER


class IsCabinetStudent(BasePermission):
    message = "Доступ только для учеников."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        profile = getattr(request.user, "profile", None)
        if profile is None:
            return False
        if profile.account_blocked or not profile.account_active:
            return False
        return profile.role == Profile.Role.STUDENT
