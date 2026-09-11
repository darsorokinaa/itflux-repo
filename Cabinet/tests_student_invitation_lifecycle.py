import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import close_old_connections
from django.test import Client, TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import InvitationStatus
from Cabinet.invitations import (
    InvitationError,
    accept_student_invitation,
    create_student_invitation,
)
from Cabinet.models import LessonPlan, LessonPlanEnrollment, Profile, Student
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
        self.assertEqual(preview.json()["status"], "already_linked")
        self.assertIn("уже связан", preview.json()["message"])
        accept = api.post(f"/api/cabinet/invitations/join/{invitation.token}/accept/", {})
        self.assertEqual(accept.status_code, 409)
        self.assertEqual(accept.json().get("code"), "already_linked")
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
        self.assertEqual(wrong.json().get("invite_error_code"), "already_linked")
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

    def test_named_invite_keeps_student_and_plan_on_register(self):
        invitation = create_student_invitation(self.teacher, first_name="Кирилл")
        student = invitation.pre_student
        self.assertIsNotNone(student)
        plan = LessonPlan.objects.create(teacher=self.teacher, title="План Кирилла")
        LessonPlanEnrollment.objects.create(teacher=self.teacher, plan=plan, student=student)
        before = Student.objects.filter(teacher=self.teacher).count()

        response = _register_student(self.client, invitation, email="kirill-new@test.ru")
        self._assert_registered(response)
        student.refresh_from_db()

        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), before)
        self.assertIsNotNone(student.user_id)
        self.assertEqual(LessonPlanEnrollment.objects.filter(student=student, plan=plan).count(), 1)

    def test_expired_invite_reissue_reuses_same_student_without_email(self):
        invitation = create_student_invitation(self.teacher, first_name="Маша")
        student = invitation.pre_student
        plan = LessonPlan.objects.create(teacher=self.teacher, title="План Маши")
        LessonPlanEnrollment.objects.create(teacher=self.teacher, plan=plan, student=student)
        invitation.status = InvitationStatus.EXPIRED
        invitation.expires_at = timezone.now() - timedelta(days=1)
        invitation.save(update_fields=["status", "expires_at"])

        api = APIClient()
        api.force_authenticate(user=self.teacher)
        renewed = api.post(f"/api/cabinet/invitations/{invitation.id}/renew/", {})
        self.assertEqual(renewed.status_code, 201, renewed.content)
        payload = renewed.json()
        self.assertEqual(payload["pre_student"], student.id)
        self.assertNotEqual(payload["token"], invitation.token)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)

        created = _register_student(
            self.client,
            type("Inv", (), {"token": payload["token"]})(),
            email="masha@test.ru",
        )
        self._assert_registered(created)
        student.refresh_from_db()
        invitation.refresh_from_db()
        self.assertEqual(student.user.email, "masha@test.ru")
        self.assertEqual(LessonPlanEnrollment.objects.filter(student=student, plan=plan).count(), 1)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)
        self.assertIsNone(invitation.pre_student_id)

    def test_create_with_student_id_does_not_duplicate(self):
        first = create_student_invitation(self.teacher, first_name="Олег")
        student = first.pre_student
        first.status = InvitationStatus.EXPIRED
        first.save(update_fields=["status"])
        api = APIClient()
        api.force_authenticate(user=self.teacher)
        created = api.post(
            "/api/cabinet/invitations/",
            {"first_name": "Олег", "student_id": student.id},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["pre_student"], student.id)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)

    def test_create_rejects_foreign_student_id(self):
        other_teacher = _teacher()
        other_invite = create_student_invitation(other_teacher, first_name="Чужой")
        api = APIClient()
        api.force_authenticate(user=self.teacher)
        resp = api.post(
            "/api/cabinet/invitations/",
            {"first_name": "Чужой", "student_id": other_invite.pre_student_id},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 0)

    def test_deleting_invite_keeps_unregistered_student(self):
        invitation = create_student_invitation(self.teacher, first_name="Ника")
        student_id = invitation.pre_student_id
        api = APIClient()
        api.force_authenticate(user=self.teacher)
        resp = api.delete(f"/api/cabinet/invitations/{invitation.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertTrue(Student.objects.filter(pk=student_id).exists())

    def test_reset_access_for_unregistered_reuses_student(self):
        invitation = create_student_invitation(self.teacher, first_name="Рома")
        student = invitation.pre_student
        invitation.status = InvitationStatus.EXPIRED
        invitation.save(update_fields=["status"])
        payload = create_student_access_reset(self.teacher, student)
        self.assertEqual(payload["type"], "invitation")
        self.assertEqual(payload["student_id"], student.id)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)

    def test_existing_account_binds_to_invited_student(self):
        invitation = create_student_invitation(self.teacher, first_name="Ева")
        student = invitation.pre_student
        user = User.objects.create_user(
            username=f"eva_{uuid.uuid4().hex[:8]}",
            email="eva-login@test.ru",
            password="StrongPass123!",
        )
        user.profile.role = Profile.Role.STUDENT
        user.profile.save(update_fields=["role"])
        login = self.client.post(
            "/api/cabinet/login/",
            data={
                "login": "eva-login@test.ru",
                "password": "StrongPass123!",
                "invite_token": invitation.token,
            },
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200, login.content)
        self.assertTrue(login.json().get("invite_accepted"))
        student.refresh_from_db()
        self.assertEqual(student.user_id, user.id)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)

    def test_reopen_used_invite_is_idempotent(self):
        invitation = create_student_invitation(
            self.teacher, first_name="Ида", email="ida-reopen@test.ru"
        )
        self._assert_registered(_register_student(self.client, invitation, email="ida-reopen@test.ru"))
        preview = self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(preview.json()["status"], "accepted")
        user = User.objects.get(email="ida-reopen@test.ru")
        student_a, _ = accept_student_invitation(invitation.token, user)
        student_b, _ = accept_student_invitation(invitation.token, user)
        self.assertEqual(student_a.id, student_b.id)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)

    def test_already_linked_student_is_not_reassigned(self):
        invitation = create_student_invitation(self.teacher, first_name="Оля")
        owner = User.objects.create_user(
            username=f"owner_{uuid.uuid4().hex[:8]}",
            email="owner-link@test.ru",
            password="StrongPass123!",
        )
        owner.profile.role = Profile.Role.STUDENT
        owner.profile.save(update_fields=["role"])
        student, _ = accept_student_invitation(invitation.token, owner)
        original_user_id = student.user_id

        other = User.objects.create_user(
            username=f"other_{uuid.uuid4().hex[:8]}",
            email="other-link@test.ru",
            password="StrongPass123!",
        )
        other.profile.role = Profile.Role.STUDENT
        other.profile.save(update_fields=["role"])
        with self.assertRaises(InvitationError) as ctx:
            accept_student_invitation(invitation.token, other)
        self.assertEqual(ctx.exception.code, "already_linked")
        student.refresh_from_db()
        self.assertEqual(student.user_id, original_user_id)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)

    def test_expired_preview_keeps_student(self):
        invitation = create_student_invitation(self.teacher, first_name="Эля")
        student_id = invitation.pre_student_id
        invitation.status = InvitationStatus.EXPIRED
        invitation.save(update_fields=["status"])
        preview = self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(preview.status_code, 410)
        self.assertIn("истёк", preview.json()["message"].lower())
        self.assertTrue(Student.objects.filter(pk=student_id).exists())


class StudentInviteAcceptConcurrencyTests(TransactionTestCase):
    def setUp(self):
        cache.clear()
        self.teacher = _teacher()
        self.invitation = create_student_invitation(self.teacher, first_name="Гонка")
        self.student_id = self.invitation.pre_student_id
        self.u1 = User.objects.create_user(username=f"race1_{uuid.uuid4().hex[:8]}", password="pass")
        self.u1.profile.role = Profile.Role.STUDENT
        self.u1.profile.save(update_fields=["role"])
        self.u2 = User.objects.create_user(username=f"race2_{uuid.uuid4().hex[:8]}", password="pass")
        self.u2.profile.role = Profile.Role.STUDENT
        self.u2.profile.save(update_fields=["role"])

    def test_parallel_accept_same_user_does_not_duplicate(self):
        token = self.invitation.token
        user_id = self.u1.id

        def worker():
            close_old_connections()
            user = User.objects.get(pk=user_id)
            try:
                student, _ = accept_student_invitation(token, user)
                result = ("ok", student.id)
            except InvitationError as exc:
                result = ("err", exc.code)
            close_old_connections()
            return result

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result() for future in as_completed([
                pool.submit(worker),
                pool.submit(worker),
            ])]

        oks = [item for item in results if item[0] == "ok"]
        self.assertGreaterEqual(len(oks), 1)
        self.assertEqual(len({item[1] for item in oks}), 1)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)
        self.assertEqual(
            Student.objects.filter(teacher=self.teacher, user_id=user_id).count(),
            1,
        )

    def test_parallel_accept_two_users_keeps_one_student(self):
        token = self.invitation.token
        user_ids = [self.u1.id, self.u2.id]

        def worker(user_id):
            close_old_connections()
            user = User.objects.get(pk=user_id)
            try:
                student, _ = accept_student_invitation(token, user)
                result = ("ok", user_id, student.id)
            except InvitationError as exc:
                result = ("err", user_id, exc.code)
            close_old_connections()
            return result

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result() for future in as_completed([
                pool.submit(worker, user_ids[0]),
                pool.submit(worker, user_ids[1]),
            ])]

        oks = [item for item in results if item[0] == "ok"]
        self.assertEqual(len(oks), 1)
        self.assertEqual(Student.objects.filter(teacher=self.teacher).count(), 1)
        linked = Student.objects.get(pk=self.student_id)
        self.assertIsNotNone(linked.user_id)
        self.assertIn(linked.user_id, user_ids)

