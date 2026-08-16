import functools

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django_otp.middleware import is_verified as otp_is_verified

from Generator.admin_otp import (
    RestrictedOTPAdminAuthenticationForm,
    RestrictedOTPAdminSite,
    is_admin_otp_username_allowed,
)


def _attach_otp(user, *, verified: bool):
    user.otp_device = object() if verified else None
    user.is_verified = functools.partial(otp_is_verified, user)
    return user


class AdminOtpAllowlistHelperTests(SimpleTestCase):
    @override_settings(ADMIN_OTP_ALLOWED_USERNAMES=frozenset({"admin_dasha", "darsorokinaa"}))
    def test_allows_whitelisted_usernames(self):
        self.assertTrue(is_admin_otp_username_allowed(User(username="admin_dasha")))
        self.assertTrue(is_admin_otp_username_allowed(User(username="Darsorokinaa")))
        self.assertFalse(is_admin_otp_username_allowed(User(username="admin")))

    @override_settings(ADMIN_OTP_ALLOWED_USERNAMES=None)
    def test_none_means_unrestricted(self):
        self.assertTrue(is_admin_otp_username_allowed(User(username="admin")))


class RestrictedOTPAdminSiteTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.site = RestrictedOTPAdminSite(name="admin")

    def _request(self, username, *, verified=True, staff=True):
        user = _attach_otp(
            User.objects.create_user(
                username, password="pass12345", is_staff=staff, is_active=True
            ),
            verified=verified,
        )
        request = self.factory.get("/admin/")
        request.user = user
        return request

    @override_settings(ADMIN_OTP_ALLOWED_USERNAMES=frozenset({"admin_dasha", "darsorokinaa"}))
    def test_whitelisted_verified_staff_allowed(self):
        self.assertTrue(self.site.has_permission(self._request("admin_dasha")))
        self.assertTrue(self.site.has_permission(self._request("darsorokinaa")))

    @override_settings(ADMIN_OTP_ALLOWED_USERNAMES=frozenset({"admin_dasha", "darsorokinaa"}))
    def test_other_staff_blocked_even_with_otp(self):
        self.assertFalse(self.site.has_permission(self._request("admin")))

    @override_settings(ADMIN_OTP_ALLOWED_USERNAMES=frozenset({"admin_dasha", "darsorokinaa"}))
    def test_login_form_rejects_other_staff(self):
        user = User.objects.create_user("admin", password="pass12345", is_staff=True)
        form = RestrictedOTPAdminAuthenticationForm()
        with self.assertRaises(ValidationError) as ctx:
            form.confirm_login_allowed(user)
        self.assertEqual(ctx.exception.code, "admin_otp_not_allowed")

    @override_settings(ADMIN_OTP_ALLOWED_USERNAMES=frozenset({"admin_dasha", "darsorokinaa"}))
    def test_login_form_allows_whitelisted_staff(self):
        user = User.objects.create_user("admin_dasha", password="pass12345", is_staff=True)
        RestrictedOTPAdminAuthenticationForm().confirm_login_allowed(user)
