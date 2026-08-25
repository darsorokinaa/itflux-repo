"""OTP-вход в Django admin с временным whitelist username."""

from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django_otp.admin import OTPAdminAuthenticationForm, OTPAdminSite


def _admin_otp_username(user) -> str:
    getter = getattr(user, "get_username", None)
    username = getter() if callable(getter) else ""
    if not username:
        username = getattr(user, "username", "") or ""
    return str(username).strip()


def _user_has_confirmed_totp(user) -> bool:
    """True, если пользователю уже выдали TOTP через setup_admin_totp."""
    pk = getattr(user, "pk", None)
    if not pk:
        return False
    try:
        from django_otp.plugins.otp_totp.models import TOTPDevice
    except ImportError:
        return False
    return TOTPDevice.objects.filter(user_id=pk, confirmed=True).exists()


def is_admin_otp_username_allowed(user) -> bool:
    """True, если username в списке, ограничение снято, или есть confirmed TOTP."""
    allowed = getattr(settings, "ADMIN_OTP_ALLOWED_USERNAMES", None)
    if allowed is None:
        return True
    username = _admin_otp_username(user)
    if username.lower() in allowed:
        return True
    return _user_has_confirmed_totp(user)


class RestrictedOTPAdminAuthenticationForm(OTPAdminAuthenticationForm):
    def confirm_login_allowed(self, user):
        super().confirm_login_allowed(user)
        if not is_admin_otp_username_allowed(user):
            username = _admin_otp_username(user) or "—"
            raise ValidationError(
                f"Вход в админку для «{username}» не разрешён. "
                "Добавьте точный username в ADMIN_OTP_ALLOWED_USERNAMES "
                "(/etc/itflux/itflux.env) и выполните: sudo systemctl restart itflux. "
                "Либо выдайте TOTP: python manage.py setup_admin_totp <username>.",
                code="admin_otp_not_allowed",
            )


class RestrictedOTPAdminSite(OTPAdminSite):
    login_form = RestrictedOTPAdminAuthenticationForm

    def has_permission(self, request):
        return super().has_permission(request) and is_admin_otp_username_allowed(
            request.user
        )
