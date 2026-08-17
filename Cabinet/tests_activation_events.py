"""Activation instrumentation: events, idempotency, permissions, onboarding states."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.activation_analytics import BASELINE, build_activation_report
from Cabinet.activation_events import (
    CORE_ACTIVATED,
    FIRST_CABINET_OPENED,
    LESSON_CREATED,
    REPEAT_CORE,
    STUDENT_CREATED,
    STUDENT_INVITE_ACCEPTED,
    STUDENT_INVITE_CREATED,
    STUDENT_INVITE_OPENED,
    STUDENT_INVITE_WRONG_ACCOUNT,
    SUBJECT_CREATED,
    TEACHER_REGISTERED,
    maybe_record_core,
)
from Cabinet.activation_models import ActivationEvent
from Cabinet.choices import InvitationStatus
from Cabinet.invitations import create_student_invitation
from Cabinet.models import Profile, Student, VideoMeeting
from Cabinet.onboarding_service import build_teacher_onboarding_state
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import generate_room_name


class ActivationEventTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _teacher(self, username="act_teacher"):
        user = User.objects.create_user(username=username, password="pass", email=f"{username}@t.ru")
        user.profile.role = Profile.Role.TEACHER
        user.profile.save(update_fields=["role"])
        return user

    def _student_user(self, username="act_student"):
        user = User.objects.create_user(username=username, password="pass", email=f"{username}@s.ru")
        user.profile.role = Profile.Role.STUDENT
        user.profile.save(update_fields=["role"])
        return user

    def test_teacher_registration_event(self):
        resp = self.client.post(
            "/api/cabinet/register/",
            {
                "email": "newteacher@example.com",
                "password": "ComplexPass123!",
                "password_confirm": "ComplexPass123!",
                "name": "Иван",
                "role": "teacher",
                "utm_source": "vk",
                "utm_campaign": "spring",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        user = User.objects.get(email="newteacher@example.com")
        self.assertTrue(
            ActivationEvent.objects.filter(user=user, event_name=TEACHER_REGISTERED).exists()
        )
        self.assertEqual(user.profile.acquisition_source, "social")
        self.assertEqual(
            ActivationEvent.objects.filter(user=user, event_name=TEACHER_REGISTERED).count(),
            1,
        )

    def test_first_cabinet_opened_only_once(self):
        teacher = self._teacher()
        self.client.force_authenticate(user=teacher)
        self.client.get("/api/cabinet/dashboard/")
        self.client.get("/api/cabinet/dashboard/")
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=FIRST_CABINET_OPENED).count(),
            1,
        )

    def test_student_cta_tracking(self):
        teacher = self._teacher()
        other = self._teacher("other_t")
        self.client.force_authenticate(user=teacher)
        resp = self.client.post(
            "/api/cabinet/activation-events/",
            {
                "event_name": "add_student_clicked",
                "source": "dashboard",
                "user_id": other.pk,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 202, resp.content)
        self.assertTrue(
            ActivationEvent.objects.filter(
                user=teacher, event_name="add_student_clicked"
            ).exists()
        )
        self.assertFalse(
            ActivationEvent.objects.filter(
                user=other, event_name="add_student_clicked"
            ).exists()
        )

    def test_student_created_backend_event(self):
        teacher = self._teacher()
        self.client.force_authenticate(user=teacher)
        resp = self.client.post(
            "/api/cabinet/invitations/",
            {"first_name": "Оля", "last_name": "Петрова"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=STUDENT_CREATED).count(),
            1,
        )
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=STUDENT_INVITE_CREATED).count(),
            1,
        )

    def test_retry_create_does_not_duplicate_student_created(self):
        teacher = self._teacher()
        self.client.force_authenticate(user=teacher)
        payload = {"first_name": "Оля", "last_name": "Петрова", "email": "olya-dup@example.com"}
        first = self.client.post("/api/cabinet/invitations/", payload, format="json")
        second = self.client.post("/api/cabinet/invitations/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=STUDENT_CREATED).count(),
            1,
        )
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=STUDENT_INVITE_CREATED).count(),
            1,
        )

    def test_invite_created(self):
        teacher = self._teacher()
        invitation = create_student_invitation(teacher, first_name="Кирилл")
        self.assertTrue(
            ActivationEvent.objects.filter(
                user=teacher,
                event_name=STUDENT_INVITE_CREATED,
                object_id=invitation.pk,
            ).exists()
        )

    def test_invite_opened(self):
        teacher = self._teacher()
        invitation = create_student_invitation(teacher, first_name="Кирилл")
        self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.client.get(f"/api/cabinet/invitations/join/{invitation.token}/")
        self.assertEqual(
            ActivationEvent.objects.filter(
                user=teacher, event_name=STUDENT_INVITE_OPENED
            ).count(),
            1,
        )

    def test_invite_accepted(self):
        teacher = self._teacher()
        invitation = create_student_invitation(teacher, first_name="Кирилл")
        resp = self.client.post(
            "/api/cabinet/register/",
            {
                "email": "kid@example.com",
                "password": "ComplexPass123!",
                "password_confirm": "ComplexPass123!",
                "name": "Кирилл",
                "role": "student",
                "invite_token": invitation.token,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(resp.json().get("invite_accepted"))
        self.assertEqual(
            ActivationEvent.objects.filter(
                user=teacher, event_name=STUDENT_INVITE_ACCEPTED
            ).count(),
            1,
        )
        blob = str(ActivationEvent.objects.filter(user=teacher).values_list("metadata", flat=True))
        self.assertNotIn(invitation.token, blob)
        self.assertNotIn("kid@example.com", blob)

    def test_invite_wrong_account(self):
        teacher = self._teacher()
        invitation = create_student_invitation(teacher, first_name="Кирилл")
        first = User.objects.create_user(username="s1", password="pass", email="s1@x.ru")
        first.profile.role = Profile.Role.STUDENT
        first.profile.save(update_fields=["role"])
        from Cabinet.invitations import accept_student_invitation

        accept_student_invitation(invitation.token, first)
        other = self._student_user("s2")
        self.client.force_authenticate(user=other)
        resp = self.client.post(f"/api/cabinet/invitations/join/{invitation.token}/accept/")
        self.assertEqual(resp.status_code, 409)
        self.assertTrue(
            ActivationEvent.objects.filter(
                user=teacher, event_name=STUDENT_INVITE_WRONG_ACCOUNT
            ).exists()
        )

    def test_failed_acceptance(self):
        teacher = self._teacher()
        invitation = create_student_invitation(teacher, first_name="Кирилл")
        invitation.status = InvitationStatus.EXPIRED
        invitation.save(update_fields=["status"])
        student = self._student_user()
        self.client.force_authenticate(user=student)
        resp = self.client.post(f"/api/cabinet/invitations/join/{invitation.token}/accept/")
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(
            ActivationEvent.objects.filter(
                user=teacher, event_name="student_invite_accept_failed"
            ).exists()
        )

    def test_subject_created(self):
        teacher = self._teacher()
        student = Student.objects.create(teacher=teacher, first_name="А", last_name="Б")
        self.client.force_authenticate(user=teacher)
        resp = self.client.post(
            f"/api/cabinet/students/{student.pk}/subjects/",
            {"subject": "inf", "title": "ОГЭ", "direction": "oge"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=SUBJECT_CREATED).count(),
            1,
        )

    def test_lesson_created(self):
        teacher = self._teacher()
        student = Student.objects.create(teacher=teacher, first_name="А", last_name="Б")
        starts = timezone.now() + timedelta(days=1)
        event = create_single_event(
            teacher=teacher,
            data={
                "title": "Урок",
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
        self.assertEqual(
            ActivationEvent.objects.filter(
                user=teacher, event_name=LESSON_CREATED, object_id=event.pk
            ).count(),
            1,
        )
        create_single_event(
            teacher=teacher,
            data={
                "title": "Урок 2",
                "starts_at": starts + timedelta(days=1),
                "ends_at": starts + timedelta(days=1, minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=LESSON_CREATED).count(),
            2,
        )

    def test_core_activation(self):
        teacher = self._teacher()
        student = Student.objects.create(teacher=teacher, first_name="А", last_name="Б")
        starts = timezone.now() + timedelta(hours=1)
        event = create_single_event(
            teacher=teacher,
            data={
                "title": "Урок",
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
        VideoMeeting.objects.create(
            schedule_event=event,
            created_by=teacher,
            room_name=generate_room_name(),
            status=VideoMeeting.Status.FINISHED,
            actual_started_at=timezone.now(),
            actual_finished_at=timezone.now(),
        )
        maybe_record_core(teacher, source="test", object_type="schedule_event", object_id=event.pk)
        maybe_record_core(teacher, source="test", object_type="schedule_event", object_id=event.pk)
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=CORE_ACTIVATED).count(),
            1,
        )
        self.assertFalse(
            ActivationEvent.objects.filter(user=teacher, event_name=REPEAT_CORE).exists()
        )

    def test_repeat_core(self):
        teacher = self._teacher()
        student = Student.objects.create(teacher=teacher, first_name="А", last_name="Б")
        starts = timezone.now() + timedelta(hours=1)
        first = create_single_event(
            teacher=teacher,
            data={
                "title": "Урок 1",
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
        second = create_single_event(
            teacher=teacher,
            data={
                "title": "Урок 2",
                "starts_at": starts + timedelta(days=1),
                "ends_at": starts + timedelta(days=1, minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
        for event in (first, second):
            event.status = event.Status.COMPLETED
            event.save(update_fields=["status"])
        maybe_record_core(teacher, source="test", object_type="schedule_event", object_id=first.pk)
        maybe_record_core(teacher, source="test", object_type="schedule_event", object_id=second.pk)
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=CORE_ACTIVATED).count(),
            1,
        )
        self.assertEqual(
            ActivationEvent.objects.filter(user=teacher, event_name=REPEAT_CORE).count(),
            1,
        )

    def test_onboarding_state_no_students(self):
        teacher = self._teacher()
        state = build_teacher_onboarding_state(teacher)
        self.assertTrue(state["visible"])
        self.assertEqual(state["next_step"], "student")
        self.assertEqual(state["cta"]["label"], "Добавить ученика")

    def test_onboarding_state_student_no_connection(self):
        teacher = self._teacher()
        Student.objects.create(teacher=teacher, first_name="А", last_name="Б")
        state = build_teacher_onboarding_state(teacher)
        self.assertEqual(state["next_step"], "invite")
        self.assertIn("приглашен", state["cta"]["label"].lower())

    def test_onboarding_state_connected_no_lesson(self):
        teacher = self._teacher()
        user = self._student_user()
        Student.objects.create(teacher=teacher, first_name="А", last_name="Б", user=user)
        state = build_teacher_onboarding_state(teacher)
        self.assertEqual(state["next_step"], "schedule")
        self.assertIn("занят", state["cta"]["label"].lower())

    def test_onboarding_hidden_after_lesson(self):
        teacher = self._teacher()
        student = Student.objects.create(teacher=teacher, first_name="А", last_name="Б")
        starts = timezone.now() + timedelta(days=1)
        create_single_event(
            teacher=teacher,
            data={
                "title": "Урок",
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=45),
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[student.pk],
            notify=False,
        )
        state = build_teacher_onboarding_state(teacher)
        self.assertFalse(state["visible"])
        self.assertIsNone(state["next_step"])

    def test_analytics_permissions(self):
        teacher = self._teacher()
        self.client.force_authenticate(user=teacher)
        resp = self.client.get("/api/cabinet/internal/activation/")
        self.assertEqual(resp.status_code, 403)
        staff = User.objects.create_user(username="staff_act2", password="pass", is_staff=True)
        staff.profile.role = Profile.Role.TEACHER
        staff.profile.save(update_fields=["role"])
        self.client.force_authenticate(user=staff)
        resp = self.client.get("/api/cabinet/internal/activation/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("first_30_minutes", data)
        self.assertIn("never_touched", data)
        self.assertEqual(data["baseline"]["registration_to_student_created"], BASELINE["registration_to_student_created"])
        self.assertEqual(data["dashboard_priority"], "activation_funnel")

    def test_user_cannot_write_confirmed_events_for_another_user(self):
        teacher = self._teacher()
        other = self._teacher("victim")
        self.client.force_authenticate(user=teacher)
        resp = self.client.post(
            "/api/cabinet/activation-events/",
            {
                "event_name": "student_created",
                "user_id": other.pk,
                "object_id": 999,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(ActivationEvent.objects.filter(event_name=STUDENT_CREATED).exists())
        resp = self.client.post(
            "/api/cabinet/activation-events/",
            {"event_name": "core_activated", "user_id": other.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_report_has_no_pii(self):
        teacher = self._teacher("secret_teacher")
        Student.objects.create(
            teacher=teacher,
            first_name="Секрет",
            last_name="Фамилия",
            email="hidden@example.com",
        )
        create_student_invitation(teacher, first_name="Секрет", email="hidden@example.com")
        report = build_activation_report()
        blob = str(report)
        self.assertNotIn("hidden@example.com", blob)
        self.assertNotIn("Секрет", blob)
        self.assertNotIn("Фамилия", blob)
        self.assertNotIn("secret_teacher", blob)
        self.assertIn("never_touched", report)
        self.assertEqual(report["baseline"]["core_to_repeat"], 33.3)
