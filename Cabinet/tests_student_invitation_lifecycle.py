from django.contrib.auth.models import User
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
    user = User.objects.create_user(username="inv_teacher", password="pass", email="t@test.ru")
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
        self.teacher = _teacher()
        self.client = Client()

    def test_reuse_invite_after_register_shows_login_not_new_account(self):
        invitation = create_student_invitation(
            self.teacher, first_name="Кирилл", email="kid@test.ru"
        )
        response = _register_student(self.client, invitation)
        self.assertEqual(response.status_code, 201, response.content)
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
        self.assertEqual(created.status_code, 201, created.content)
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
        self.assertEqual(created.status_code, 201, created.content)
        self.client.post("/api/cabinet/logout/", content_type="application/json")
        login = self.client.post(
            "/api/cabinet/login/",
            data={"login": "  spaced@test.ru  ", "password": "  StrongPass123!  "},
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200, login.content)

    def test_wrong_account_does_not_relink(self):
        invitation = create_student_invitation(self.teacher, email="one@test.ru", first_name="Один")
        _register_student(self.client, invitation, email="one@test.ru")
        self.client.post("/api/cabinet/logout/", content_type="application/json")

        other = User.objects.create_user(
            username="other_kid", email="other@test.ru", password="StrongPass123!"
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
        _register_student(self.client, invitation, email="stay@test.ru")
        preview = self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(preview.json()["status"], "accepted")

    def test_create_invitation_reuses_student_by_email(self):
        first = create_student_invitation(self.teacher, first_name="Катя", email="katya@test.ru")
        second = create_student_invitation(self.teacher, first_name="Катя", email="katya@test.ru")
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Student.objects.filter(teacher=self.teacher, email="katya@test.ru").count(), 1)

    def test_new_invite_after_accept_still_asks_to_login(self):
        invitation = create_student_invitation(self.teacher, first_name="Катя", email="katya2@test.ru")
        _register_student(self.client, invitation, email="katya2@test.ru")
        self.client.post("/api/cabinet/logout/", content_type="application/json")
        again = create_student_invitation(self.teacher, first_name="Катя", email="katya2@test.ru")
        preview = self.client.get(f"/api/cabinet/invitations/join/{again.token}/")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["status"], "already_registered")
        self.assertEqual(Student.objects.filter(teacher=self.teacher, email="katya2@test.ru").count(), 1)

    def test_teacher_reset_access_returns_link_not_password(self):
        invitation = create_student_invitation(self.teacher, email="resetme@test.ru", first_name="Рома")
        _register_student(self.client, invitation, email="resetme@test.ru")
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
        _register_student(self.client, invitation, email="idem@test.ru")
        user = User.objects.get(email="idem@test.ru")
        student_a, _ = accept_student_invitation(invitation.token, user)
        student_b, _ = accept_student_invitation(invitation.token, user)
        self.assertEqual(student_a.id, student_b.id)
        self.assertEqual(Student.objects.filter(teacher=self.teacher, user=user).count(), 1)
        invitation.refresh_from_db()
        self.assertEqual(invitation.status, InvitationStatus.ACCEPTED)
