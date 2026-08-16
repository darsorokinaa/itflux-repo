"""OTP-вход в Django admin с временным whitelist username."""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django_otp.admin import OTPAdminAuthenticationForm, OTPAdminSite


def is_admin_otp_username_allowed(user) -> bool:
    """True, если username в ADMIN_OTP_ALLOWED_USERNAMES (None = без ограничения)."""
    allowed = getattr(settings, "ADMIN_OTP_ALLOWED_USERNAMES", None)
    if allowed is None:
        return True
    username = (getattr(user, "get_username", None) or (lambda: ""))()
    if not username:
        username = getattr(user, "username", "") or ""
    return str(username).strip().lower() in allowed


class RestrictedOTPAdminAuthenticationForm(OTPAdminAuthenticationForm):
    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not is_admin_otp_username_allowed(user):
            raise ValidationError(
                "Вход в админку по OTP временно разрешён только ограниченному "
                "списку пользователей.",
                code="admin_otp_not_allowed",
            )


class RestrictedOTPAdminSite(OTPAdminSite):
    login_form = RestrictedOTPAdminAuthenticationForm

    def has_permission(self, request):
        return super().has_permission(request) and is_admin_otp_username_allowed(
            request.user
        )
