import uuid

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import Client, TestCase
from rest_framework.test import APIClient

from Cabinet.choices import InvitationStatus
from Cabinet.invitations import (
    accept_student_invitation,
    create_student_invitation,
)
from Cabinet.models import Profile, Student
from Cabinet.student_access import create_student_access_reset


def _teacher():
    suffix = uuid.uuid4().hex[:8]
    user = User.objects.create_user(
        username=f"inv_teacher_{suffix}",
        password="pass",
        email=f"t_{suffix}@test.ru",
    )
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


def _register_student(client, invitation, email="kid@test.ru", password="StrongPass123!"):
    return client.post(
        "/api/cabinet/register/",
        data={
            "email": email,
            "password": password,
            "password_confirm": password,
            "name": "Кирилл",
            "role": "student",
            "invite_token": invitation.token,
        },
        content_type="application/json",
    )


class StudentInvitationLifecycleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.teacher = _teacher()
        self.client = Client()

    def _assert_registered(self, response):
        self.assertEqual(response.status_code, 201, response.content)
        payload = response.json()
        self.assertTrue(payload.get("ok"), payload)
        self.assertTrue(payload.get("invite_accepted"), payload)
        return payload

    def test_reuse_invite_after_register_shows_login_not_new_account(self):
        invitation = create_student_invitation(
            self.teacher, first_name="Кирилл", email="kid@test.ru"
        )
        response = _register_student(self.client, invitation)
        self._assert_registered(response)
        self.client.post("/api/cabinet/logout/", content_type="application/json")

        preview = self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(preview.status_code, 200, preview.content)
        data = preview.json()
        self.assertEqual(data["status"], "already_registered")
        self.assertIn("Войдите", data["message"])

        again = _register_student(self.client, invitation)
        self.assertEqual(again.status_code, 409, again.content)
        self.assertEqual(again.json()["code"], "already_registered")
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)
        self.assertEqual(User.objects.filter(email="kid@test.ru").count(), 1)

    def test_second_login_with_same_password_works(self):
        invitation = create_student_invitation(self.teacher, email="kid2@test.ru", first_name="Аня")
        created = _register_student(self.client, invitation, email="kid2@test.ru")
        self._assert_registered(created)
        self.client.post("/api/cabinet/logout/", content_type="application/json")

        login = self.client.post(
            "/api/cabinet/login/",
            data={
                "login": "kid2@test.ru",
                "password": "StrongPass123!",
                "invite_token": invitation.token,
            },
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200, login.content)
        payload = login.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload.get("invite_accepted"))

    def test_login_strips_spaces_around_password_and_email(self):
        invitation = create_student_invitation(self.teacher, email="spaced@test.ru", first_name="Боб")
        created = _register_student(self.client, invitation, email="spaced@test.ru")
        self._assert_registered(created)
        self.client.post("/api/cabinet/logout/", content_type="application/json")
        login = self.client.post(
            "/api/cabinet/login/",
            data={"login": "  spaced@test.ru  ", "password": "  StrongPass123!  "},
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200, login.content)

    def test_wrong_account_does_not_relink(self):
        invitation = create_student_invitation(self.teacher, email="one@test.ru", first_name="Один")
        self._assert_registered(_register_student(self.client, invitation, email="one@test.ru"))
        self.client.post("/api/cabinet/logout/", content_type="application/json")

        other = User.objects.create_user(
            username=f"other_kid_{uuid.uuid4().hex[:8]}",
            email="other@test.ru",
            password="StrongPass123!",
        )
        other.profile.role = Profile.Role.STUDENT
        other.profile.save(update_fields=["role"])
        api = APIClient()
        api.force_authenticate(user=other)
        preview = api.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(preview.json()["status"], "wrong_account")
        accept = api.post(f"/api/cabinet/invitations/join/{invitation.token}/accept/", {})
        self.assertEqual(accept.status_code, 409)
        original = Student.objects.get(email="one@test.ru", teacher=self.teacher)
        self.assertNotEqual(original.user_id, other.id)

    def test_already_logged_in_owner_skips_password(self):
        invitation = create_student_invitation(self.teacher, email="stay@test.ru", first_name="Стёпа")
        self._assert_registered(_register_student(self.client, invitation, email="stay@test.ru"))
        preview = self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(preview.json()["status"], "accepted")

    def test_create_invitation_reuses_student_by_email(self):
        first = create_student_invitation(self.teacher, first_name="Катя", email="katya@test.ru")
        second = create_student_invitation(self.teacher, first_name="Катя", email="katya@test.ru")
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Student.objects.filter(teacher=self.teacher, email="katya@test.ru").count(), 1)

    def test_new_invite_after_accept_still_asks_to_login(self):
        invitation = create_student_invitation(self.teacher, first_name="Катя", email="katya2@test.ru")
        self._assert_registered(_register_student(self.client, invitation, email="katya2@test.ru"))
        self.client.post("/api/cabinet/logout/", content_type="application/json")
        again = create_student_invitation(self.teacher, first_name="Катя", email="katya2@test.ru")
        preview = self.client.get(f"/api/cabinet/invitations/join/{again.token}/")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["status"], "already_registered")
        self.assertEqual(Student.objects.filter(teacher=self.teacher, email="katya2@test.ru").count(), 1)

    def test_teacher_reset_access_returns_link_not_password(self):
        invitation = create_student_invitation(self.teacher, email="resetme@test.ru", first_name="Рома")
        self._assert_registered(_register_student(self.client, invitation, email="resetme@test.ru"))
        student = Student.objects.get(email="resetme@test.ru", teacher=self.teacher)
        payload = create_student_access_reset(self.teacher, student)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["type"], "password_reset")
        self.assertIn("/cabinet/login?", payload["url"])
        self.assertNotIn("password", payload)
        api = APIClient()
        api.force_authenticate(user=self.teacher)
        response = api.post(f"/api/cabinet/students/{student.id}/reset-access/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("url", response.json())

    def test_accept_is_idempotent_for_same_user(self):
        invitation = create_student_invitation(self.teacher, email="idem@test.ru", first_name="Ида")
        self._assert_registered(_register_student(self.client, invitation, email="idem@test.ru"))
        user = User.objects.get(email="idem@test.ru")
        student_a, _ = accept_student_invitation(invitation.token, user)
        student_b, _ = accept_student_invitation(invitation.token, user)
        self.assertEqual(student_a.id, student_b.id)
        self.assertEqual(Student.objects.filter(teacher=self.teacher, user=user).count(), 1)
        invitation.refresh_from_db()
        self.assertEqual(invitation.status, InvitationStatus.ACCEPTED)

    def test_register_surfaces_invite_accept_failure(self):
        from unittest import mock

        from Cabinet.invitations import InvitationError

        invitation = create_student_invitation(
            self.teacher, email="failaccept@test.ru", first_name="Федя"
        )
        with mock.patch(
            "Cabinet.invitations.accept_student_invitation",
            side_effect=InvitationError("Приглашение истекло", "expired"),
        ):
            response = _register_student(self.client, invitation, email="failaccept@test.ru")
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertFalse(data["invite_accepted"])
        self.assertEqual(data["invite_error_code"], "expired")
        self.assertIn("истекло", data["invite_error"].lower())
        user = User.objects.get(email="failaccept@test.ru")
        self.assertFalse(Student.objects.filter(user=user).exists())

        retry = accept_student_invitation(invitation.token, user)
        self.assertEqual(Student.objects.filter(teacher=self.teacher, user=user).count(), 1)
        self.assertEqual(retry[0].user_id, user.id)

    def test_retry_accept_does_not_duplicate_student(self):
        invitation = create_student_invitation(
            self.teacher, email="retry@test.ru", first_name="Рита"
        )
        created = _register_student(self.client, invitation, email="retry@test.ru")
        self._assert_registered(created)
        user = User.objects.get(email="retry@test.ru")
        api = APIClient()
        api.force_authenticate(user=user)
        first = api.post(f"/api/cabinet/invitations/join/{invitation.token}/accept/", {})
        second = api.post(f"/api/cabinet/invitations/join/{invitation.token}/accept/", {})
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(Student.objects.filter(teacher=self.teacher, user=user).count(), 1)

    def test_invalid_and_expired_invite_are_explicit(self):
        missing = self.client.get("/api/cabinet/invitations/join/not-a-real-token/")
        self.assertIn(missing.status_code, (404, 400))

        invitation = create_student_invitation(
            self.teacher, email="exp@test.ru", first_name="Эля"
        )
        invitation.status = InvitationStatus.EXPIRED
        invitation.save(update_fields=["status"])
        preview = self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(preview.status_code, 410)
        self.assertEqual(preview.json()["status"], "expired")

        created = _register_student(self.client, invitation, email="exp@test.ru")
        self.assertEqual(created.status_code, 400)
        self.assertNotEqual(created.json().get("invite_accepted"), True)

    def test_teacher_cannot_accept_student_invite(self):
        invitation = create_student_invitation(
            self.teacher, email="teachinvite@test.ru", first_name="Тима"
        )
        api = APIClient()
        api.force_authenticate(user=self.teacher)
        preview = api.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertIn(preview.json()["status"], ("pending", "wrong_role", "wrong_account"))
        accept = api.post(f"/api/cabinet/invitations/join/{invitation.token}/accept/", {})
        self.assertEqual(accept.status_code, 400)
        self.assertEqual(accept.json().get("code"), "wrong_role")
        self.assertFalse(
            Student.objects.filter(teacher=self.teacher, user=self.teacher).exists()
        )

    def test_anonymous_preview_is_pending(self):
        invitation = create_student_invitation(
            self.teacher, email="newkid@test.ru", first_name="Ника"
        )
        preview = self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["status"], "pending")
        self.assertFalse(User.objects.filter(email="newkid@test.ru").exists())
        student = Student.objects.get(email="newkid@test.ru", teacher=self.teacher)
        self.assertIsNone(student.user_id)

    def test_existing_student_account_accepts_on_login(self):
        invitation = create_student_invitation(
            self.teacher, email="exist@test.ru", first_name="Ева"
        )
        user = User.objects.create_user(
            username=f"exist_{uuid.uuid4().hex[:8]}",
            email="exist@test.ru",
            password="StrongPass123!",
        )
        user.profile.role = Profile.Role.STUDENT
        user.profile.name = "Ева"
        user.profile.save(update_fields=["role", "name"])

        login = self.client.post(
            "/api/cabinet/login/",
            data={
                "login": "exist@test.ru",
                "password": "StrongPass123!",
                "invite_token": invitation.token,
            },
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200, login.content)
        payload = login.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload.get("invite_accepted"), payload)
        self.assertEqual(
            Student.objects.filter(teacher=self.teacher, user=user, email="exist@test.ru").count(),
            1,
        )

    def test_wrong_account_logout_login_then_accepts(self):
        invitation = create_student_invitation(
            self.teacher, email="owner@test.ru", first_name="Оля"
        )
        self._assert_registered(
            _register_student(self.client, invitation, email="owner@test.ru")
        )
        owner = User.objects.get(email="owner@test.ru")
        self.client.post("/api/cabinet/logout/", content_type="application/json")

        other = User.objects.create_user(
            username=f"intruder_{uuid.uuid4().hex[:8]}",
            email="intruder@test.ru",
            password="StrongPass123!",
        )
        other.profile.role = Profile.Role.STUDENT
        other.profile.save(update_fields=["role"])
        wrong = self.client.post(
            "/api/cabinet/login/",
            data={
                "login": "intruder@test.ru",
                "password": "StrongPass123!",
                "invite_token": invitation.token,
            },
            content_type="application/json",
        )
        self.assertEqual(wrong.status_code, 200, wrong.content)
        self.assertTrue(wrong.json()["ok"])
        self.assertFalse(wrong.json().get("invite_accepted"))
        self.assertEqual(wrong.json().get("invite_error_code"), "wrong_account")
        self.assertNotEqual(
            Student.objects.get(email="owner@test.ru", teacher=self.teacher).user_id,
            other.id,
        )

        logout = self.client.post("/api/cabinet/logout/", content_type="application/json")
        self.assertEqual(logout.status_code, 200, logout.content)

        again = self.client.post(
            "/api/cabinet/login/",
            data={
                "login": "owner@test.ru",
                "password": "StrongPass123!",
                "invite_token": invitation.token,
            },
            content_type="application/json",
        )
        self.assertEqual(again.status_code, 200, again.content)
        self.assertTrue(again.json().get("invite_accepted"), again.content)
        self.assertEqual(
            Student.objects.get(email="owner@test.ru", teacher=self.teacher).user_id,
            owner.id,
        )

    def test_login_surfaces_invite_accept_failure(self):
        from unittest import mock

        from Cabinet.invitations import InvitationError

        invitation = create_student_invitation(
            self.teacher, email="loginfail@test.ru", first_name="Лена"
        )
        user = User.objects.create_user(
            username=f"loginfail_{uuid.uuid4().hex[:8]}",
            email="loginfail@test.ru",
            password="StrongPass123!",
        )
        user.profile.role = Profile.Role.STUDENT
        user.profile.save(update_fields=["role"])
        with mock.patch(
            "Cabinet.invitations.accept_student_invitation",
            side_effect=InvitationError("Приглашение истекло", "expired"),
        ):
            login = self.client.post(
                "/api/cabinet/login/",
                data={
                    "login": "loginfail@test.ru",
                    "password": "StrongPass123!",
                    "invite_token": invitation.token,
                },
                content_type="application/json",
            )
        self.assertEqual(login.status_code, 200, login.content)
        data = login.json()
        self.assertTrue(data["ok"])
        self.assertFalse(data["invite_accepted"])
        self.assertEqual(data["invite_error_code"], "expired")
        self.assertFalse(Student.objects.filter(user=user).exists())

        retry = self.client.post(
            "/api/cabinet/login/",
            data={
                "login": "loginfail@test.ru",
                "password": "StrongPass123!",
                "invite_token": invitation.token,
            },
            content_type="application/json",
        )
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertTrue(retry.json().get("invite_accepted"), retry.content)
        self.assertEqual(Student.objects.filter(teacher=self.teacher, user=user).count(), 1)
