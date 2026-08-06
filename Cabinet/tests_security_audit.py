"""Regression tests for critical findings from SECURITY_PRIVACY_AUDIT.md."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.test import Client, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.billing_models import EventBillingRecord
from Cabinet.billing_service import event_billing_badge, get_or_create_billing_account
from Cabinet.choices import InvitationStatus, MaterialStatus, ParticipantRole
from Cabinet.invitations import accept_student_invitation, create_student_invitation
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    Material,
    Profile,
    ScheduleEvent,
    ScheduleEventParticipant,
    Student,
)


class PrivateMediaForbiddenTests(TestCase):
    def test_homework_and_materials_media_are_forbidden(self):
        cases = [
            "cabinet/homework/secret.pdf",
            "cabinet/materials/notes.pdf",
            "cabinet/my-files/x.bin",
            "cabinet/boards/scene.json",
        ]
        for path in cases:
            with self.subTest(path=path):
                response = self.client.get(f"/media/{path}")
                self.assertEqual(response.status_code, 403, path)


class MaterialFileAclTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="sec_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.other = User.objects.create_user(username="sec_other", password="pass")
        self.other.profile.role = Profile.Role.TEACHER
        self.other.profile.save(update_fields=["role"])
        self.material = Material.objects.create(
            teacher=self.teacher,
            title="Секретный конспект",
            material_type="file",
            status=MaterialStatus.PUBLISHED,
            is_public=False,
        )
        self.material.file.save("secret.txt", ContentFile(b"private-material"), save=True)

    def test_guest_cannot_download_material_file_api(self):
        client = APIClient()
        r = client.get(f"/api/cabinet/materials/{self.material.pk}/file/")
        self.assertIn(r.status_code, (401, 403))

    def test_other_teacher_cannot_download_private_material(self):
        client = APIClient()
        client.force_authenticate(user=self.other)
        r = client.get(f"/api/cabinet/materials/{self.material.pk}/file/")
        self.assertIn(r.status_code, (403, 404))

    def test_owner_teacher_can_download(self):
        client = APIClient()
        client.force_authenticate(user=self.teacher)
        r = client.get(f"/api/cabinet/materials/{self.material.pk}/file/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(b"".join(r.streaming_content), b"private-material")

    def test_material_file_url_is_api_not_public_media(self):
        from Cabinet.files_services import material_file_url

        url = material_file_url(self.material, for_student=False)
        self.assertTrue(url.startswith("/api/cabinet/materials/"))
        self.assertNotIn("/media/", url)


class BillingBadgeIsolationTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="bill_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.s1_user = User.objects.create_user(username="bill_s1", password="pass")
        self.s1_user.profile.role = Profile.Role.STUDENT
        self.s1_user.profile.save(update_fields=["role"])
        self.s2_user = User.objects.create_user(username="bill_s2", password="pass")
        self.s2_user.profile.role = Profile.Role.STUDENT
        self.s2_user.profile.save(update_fields=["role"])
        self.s1 = Student.objects.create(
            teacher=self.teacher, user=self.s1_user, first_name="А", last_name="Один", status="active"
        )
        self.s2 = Student.objects.create(
            teacher=self.teacher, user=self.s2_user, first_name="Б", last_name="Два", status="active"
        )
        starts = timezone.now()
        self.event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Группа",
            starts_at=starts,
            ends_at=starts + timedelta(hours=1),
            event_type=ScheduleEvent.EventType.GROUP_LESSON,
            status=ScheduleEvent.Status.PLANNED,
        )
        ScheduleEventParticipant.objects.create(
            event=self.event,
            user=self.s1_user,
            student=self.s1,
            role=ParticipantRole.STUDENT,
        )
        ScheduleEventParticipant.objects.create(
            event=self.event,
            user=self.s2_user,
            student=self.s2,
            role=ParticipantRole.STUDENT,
        )
        for student in (self.s1, self.s2):
            account = get_or_create_billing_account(self.teacher, student)
            EventBillingRecord.objects.create(
                event=self.event,
                billing_account=account,
                student=student,
                calculated_amount=Decimal("1000.00"),
                charged_amount=Decimal("1000.00"),
                paid_amount=Decimal("0.00"),
            )

    def test_student_badge_only_own_records(self):
        badges = event_billing_badge(self.event, student_ids=[self.s1.id])
        self.assertEqual(len(badges), 1)
        self.assertEqual(badges[0]["student_id"], self.s1.id)

        client = APIClient()
        client.force_authenticate(user=self.s1_user)
        r = client.get(f"/api/cabinet/billing/events/{self.event.pk}/badge/")
        self.assertEqual(r.status_code, 200)
        ids = {b["student_id"] for b in r.data.get("badges") or []}
        self.assertEqual(ids, {self.s1.id})


class StudentInviteAcceptRaceTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="inv_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.u1 = User.objects.create_user(username="inv_s1", password="pass")
        self.u1.profile.role = Profile.Role.STUDENT
        self.u1.profile.save(update_fields=["role"])
        self.u2 = User.objects.create_user(username="inv_s2", password="pass")
        self.u2.profile.role = Profile.Role.STUDENT
        self.u2.profile.save(update_fields=["role"])
        self.invitation = create_student_invitation(
            teacher=self.teacher,
            email="kid@example.com",
            first_name="Kid",
            last_name="One",
        )

    def test_second_accept_fails_after_first(self):
        accept_student_invitation(self.invitation.token, self.u1)
        self.invitation.refresh_from_db()
        self.assertEqual(self.invitation.status, InvitationStatus.ACCEPTED)
        with self.assertRaises(ValueError):
            accept_student_invitation(self.invitation.token, self.u2)


class RegisterCannotElevateStaffTests(TestCase):
    def test_register_ignores_is_staff_payload(self):
        client = Client()
        r = client.post(
            "/api/cabinet/register/",
            data={
                "username": "staff_try",
                "password": "ComplexPass123!",
                "password_confirm": "ComplexPass123!",
                "email": "staff_try@example.com",
                "role": "teacher",
                "is_staff": True,
                "is_superuser": True,
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        user = User.objects.get(email="staff_try@example.com")
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)


class ProfileAdminSecretsTests(TestCase):
    def test_oauth_tokens_excluded_from_admin(self):
        from Cabinet.admin import ProfileAdmin
        from django.contrib.admin.sites import AdminSite

        admin = ProfileAdmin(Profile, AdminSite())
        excluded = set(admin.exclude or ())
        self.assertIn("yandex_oauth_token", excluded)
        self.assertIn("yandex_refresh_token", excluded)


class LessonConsumerAuthUnitTests(TestCase):
    def test_token_required_helper(self):
        from urllib.parse import parse_qs

        def token_from_scope(scope):
            qs = parse_qs((scope.get("query_string") or b"").decode("utf-8", errors="ignore"))
            for key in ("token", "lesson_token"):
                values = qs.get(key) or []
                if values and str(values[0]).strip():
                    return str(values[0]).strip()
            return ""

        self.assertEqual(token_from_scope({"query_string": b""}), "")
        self.assertEqual(token_from_scope({"query_string": b"token=abc123"}), "abc123")


class HomeworkSubmissionMediaForbiddenTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="hw_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher, first_name="С", last_name="У", status="active"
        )
        self.hw = Homework.objects.create(
            teacher=self.teacher, student=self.student, title="ДЗ", status="assigned"
        )
        self.submission = HomeworkSubmission.objects.create(
            homework=self.hw, student=self.student
        )
        self.submission.attached_file.save(
            "answer.txt", ContentFile(b"student-answer"), save=True
        )

    def test_direct_media_path_forbidden(self):
        name = self.submission.attached_file.name
        self.assertTrue(name.startswith("cabinet/homework/"))
        r = self.client.get(f"/media/{name}")
        self.assertEqual(r.status_code, 403)
