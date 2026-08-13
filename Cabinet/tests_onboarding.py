"""Teacher onboarding state, nudges, and staff activation analytics."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.activation_analytics import build_activation_report
from Cabinet.choices import HomeworkStatus, SubmissionStatus
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    Material,
    Notification,
    Profile,
    ScheduleEvent,
    ScheduleEventMaterial,
    Student,
    StudentSubject,
    VideoMeeting,
)
from Cabinet.onboarding_notifications import send_onboarding_nudges
from Cabinet.onboarding_service import build_teacher_onboarding_state
from Cabinet.schedule_service import create_single_event
from Cabinet.video_meeting_service import generate_room_name


class TeacherOnboardingStateTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="onb_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.other = User.objects.create_user(username="onb_other", password="pass")
        self.other.profile.role = Profile.Role.TEACHER
        self.other.profile.save(update_fields=["role"])
        self.client = APIClient()
        self.client.force_authenticate(user=self.teacher)

    def _student(self, teacher=None, **kwargs):
        defaults = {
            "teacher": teacher or self.teacher,
            "first_name": "Анна",
            "last_name": "Иванова",
            "status": "active",
        }
        defaults.update(kwargs)
        return Student.objects.create(**defaults)

    def _event(self, teacher=None, student=None, **kwargs):
        starts = timezone.now() + timedelta(days=1)
        data = {
            "title": "Урок",
            "starts_at": starts,
            "ends_at": starts + timedelta(minutes=45),
            "event_type": "individual_lesson",
            "notify_participants": False,
        }
        data.update(kwargs.pop("data", {}))
        return create_single_event(
            teacher=teacher or self.teacher,
            data=data,
            student_ids=[student.pk] if student else None,
            notify=False,
        )

    def test_new_teacher_sees_add_student(self):
        state = build_teacher_onboarding_state(self.teacher)
        self.assertTrue(state["visible"])
        self.assertEqual(state["next_step"], "student")
        self.assertEqual(state["completed_steps"], 0)
        self.assertEqual(state["cta"]["label"], "Добавить первого ученика")
        self.assertIn("invite=1", state["cta"]["href"])
        self.assertTrue(state["steps"][0]["done"])
        self.assertEqual(state["steps"][0]["key"], "registered")

    def test_pre_profile_student_counts_without_accept(self):
        student = self._student(user=None)
        state = build_teacher_onboarding_state(self.teacher)
        self.assertTrue(state["flags"]["has_student"])
        self.assertFalse(state["flags"]["has_connected_student"])
        self.assertEqual(state["next_step"], "subject")
        self.assertEqual(state["context"]["student_id"], student.pk)
        self.assertIn(f"editStudent={student.pk}", state["cta"]["href"])

    def test_connected_student_without_subject(self):
        user = User.objects.create_user(username="onb_s", password="pass")
        user.profile.role = Profile.Role.STUDENT
        user.profile.save(update_fields=["role"])
        self._student(user=user)
        state = build_teacher_onboarding_state(self.teacher)
        self.assertTrue(state["flags"]["has_connected_student"])
        self.assertEqual(state["next_step"], "subject")

    def test_subject_then_schedule(self):
        student = self._student()
        StudentSubject.objects.create(
            student=student, subject="inf", title="ОГЭ", direction="oge"
        )
        state = build_teacher_onboarding_state(self.teacher)
        self.assertEqual(state["next_step"], "schedule")
        self.assertIn(f"student={student.pk}", state["cta"]["href"])

    def test_multiple_subjects_still_one_step(self):
        student = self._student()
        StudentSubject.objects.create(student=student, subject="inf", title="ОГЭ", direction="oge")
        StudentSubject.objects.create(student=student, subject="math", title="Школа", direction="school")
        state = build_teacher_onboarding_state(self.teacher)
        self.assertTrue(state["flags"]["has_subject"])
        self.assertEqual(state["next_step"], "schedule")

    def test_event_without_materials(self):
        student = self._student()
        StudentSubject.objects.create(student=student, subject="inf", title="ОГЭ", direction="oge")
        event = self._event(student=student)
        state = build_teacher_onboarding_state(self.teacher)
        self.assertEqual(state["next_step"], "materials")
        self.assertEqual(state["context"]["event_id"], event.pk)
        self.assertIn(f"event={event.pk}", state["cta"]["href"])
        self.assertIn("prepare=1", state["cta"]["href"])

    def test_cancelled_event_does_not_count(self):
        student = self._student()
        StudentSubject.objects.create(student=student, subject="inf", title="ОГЭ", direction="oge")
        event = self._event(student=student)
        event.status = ScheduleEvent.Status.CANCELLED
        event.save(update_fields=["status"])
        state = build_teacher_onboarding_state(self.teacher)
        self.assertEqual(state["next_step"], "schedule")

    def test_group_event_counts(self):
        student = self._student()
        StudentSubject.objects.create(student=student, subject="inf", title="ОГЭ", direction="oge")
        starts = timezone.now() + timedelta(days=2)
        create_single_event(
            teacher=self.teacher,
            data={
                "title": "Группа",
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=45),
                "event_type": "group_lesson",
                "notify_participants": False,
            },
            notify=False,
        )
        state = build_teacher_onboarding_state(self.teacher)
        self.assertTrue(state["flags"]["has_schedule_event"])
        self.assertEqual(state["next_step"], "materials")

    def test_material_then_conduct(self):
        student = self._student()
        StudentSubject.objects.create(student=student, subject="inf", title="ОГЭ", direction="oge")
        event = self._event(student=student)
        material = Material.objects.create(teacher=self.teacher, title="Конспект")
        ScheduleEventMaterial.objects.create(event=event, material=material)
        state = build_teacher_onboarding_state(self.teacher)
        self.assertTrue(state["flags"]["has_materials"])
        self.assertEqual(state["next_step"], "conduct")
        self.assertEqual(state["cta"]["label"], "Всё готово к первому уроку")

    def test_finished_video_hides_onboarding(self):
        student = self._student()
        event = self._event(student=student)
        VideoMeeting.objects.create(
            schedule_event=event,
            created_by=self.teacher,
            room_name=generate_room_name(),
            status=VideoMeeting.Status.FINISHED,
            actual_started_at=timezone.now(),
            actual_finished_at=timezone.now(),
        )
        state = build_teacher_onboarding_state(self.teacher)
        self.assertFalse(state["visible"])
        self.assertIsNone(state["next_step"])
        self.assertTrue(state["flags"]["has_conducted_lesson"])

    def test_completed_event_without_video_hides_onboarding(self):
        student = self._student()
        event = self._event(student=student)
        event.status = ScheduleEvent.Status.COMPLETED
        event.save(update_fields=["status"])
        state = build_teacher_onboarding_state(self.teacher)
        self.assertFalse(state["visible"])

    def test_foreign_teacher_data_isolated(self):
        self._student(teacher=self.other)
        own = build_teacher_onboarding_state(self.teacher)
        other = build_teacher_onboarding_state(self.other)
        self.assertEqual(own["next_step"], "student")
        self.assertEqual(other["next_step"], "subject")
        self.assertNotEqual(own["context"]["student_id"], other["context"]["student_id"])

    def test_dashboard_includes_onboarding(self):
        resp = self.client.get("/api/cabinet/dashboard/")
        self.assertEqual(resp.status_code, 200)
        onboarding = resp.json().get("onboarding") or {}
        self.assertTrue(onboarding.get("visible"))
        self.assertEqual(onboarding.get("next_step"), "student")
        self.assertNotIn("email", str(onboarding).lower())
        self.assertNotIn("@", str(onboarding.get("cta") or {}))

    def test_invitation_returns_pre_student(self):
        resp = self.client.post(
            "/api/cabinet/invitations/",
            {"first_name": "Оля", "last_name": "Петрова"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(resp.data.get("pre_student"))
        state = build_teacher_onboarding_state(self.teacher)
        self.assertEqual(state["context"]["student_id"], resp.data["pre_student"])

    def test_dashboard_idempotent(self):
        self.client.get("/api/cabinet/dashboard/")
        resp = self.client.get("/api/cabinet/dashboard/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["onboarding"]["completed_steps"], 0)


class OnboardingNudgeTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="nudge_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.teacher.date_joined = timezone.now() - timedelta(days=2)
        self.teacher.save(update_fields=["date_joined"])

    def test_nudge_without_student(self):
        stats = send_onboarding_nudges()
        self.assertEqual(stats["sent"], 1)
        n = Notification.objects.get(recipient_user=self.teacher)
        self.assertEqual(n.event_type, "onboarding_add_student")
        self.assertNotIn("@", n.message)
        send_onboarding_nudges()
        self.assertEqual(Notification.objects.filter(recipient_user=self.teacher).count(), 1)

    def test_no_nudge_for_activated_teacher(self):
        student = Student.objects.create(
            teacher=self.teacher, first_name="А", last_name="Б", status="active"
        )
        starts = timezone.now() + timedelta(hours=2)
        event = create_single_event(
            teacher=self.teacher,
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
        event.status = ScheduleEvent.Status.COMPLETED
        event.save(update_fields=["status"])
        stats = send_onboarding_nudges()
        self.assertEqual(stats["sent"], 0)
        self.assertFalse(Notification.objects.filter(recipient_user=self.teacher).exists())

    def test_old_teacher_not_nudged(self):
        self.teacher.date_joined = timezone.now() - timedelta(days=60)
        self.teacher.save(update_fields=["date_joined"])
        stats = send_onboarding_nudges()
        self.assertEqual(stats["sent"], 0)


class ActivationAnalyticsTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user(
            username="staff_act", password="pass", is_staff=True
        )
        self.staff.profile.role = Profile.Role.TEACHER
        self.staff.profile.save(update_fields=["role"])
        self.teacher = User.objects.create_user(username="act_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.teacher.date_joined = timezone.now() - timedelta(days=10)
        self.teacher.save(update_fields=["date_joined"])
        self.client = APIClient()

    def test_teacher_cannot_read_internal_metrics(self):
        self.client.force_authenticate(user=self.teacher)
        resp = self.client.get("/api/cabinet/internal/activation/")
        self.assertEqual(resp.status_code, 403)

    def test_staff_metrics_have_no_pii(self):
        Student.objects.create(
            teacher=self.teacher,
            first_name="Секрет",
            last_name="Фамилия",
            email="secret@example.com",
            status="active",
        )
        hw = Homework.objects.create(
            teacher=self.teacher,
            title="ДЗ",
            status=HomeworkStatus.ASSIGNED,
        )
        HomeworkSubmission.objects.create(
            homework=hw,
            student=Student.objects.get(teacher=self.teacher),
            status=SubmissionStatus.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get("/api/cabinet/internal/activation/")
        self.assertEqual(resp.status_code, 200)
        blob = str(resp.json())
        self.assertNotIn("secret@example.com", blob)
        self.assertNotIn("Секрет", blob)
        self.assertNotIn("Фамилия", blob)
        data = resp.json()
        self.assertIn("funnel", data)
        self.assertIn("cohorts_weekly", data)
        self.assertIn("core_activation", data)
        self.assertIn("retention", data)
        self.assertGreaterEqual(data["funnel"]["first_student"]["count"], 1)
        self.assertGreaterEqual(data["funnel"]["first_homework_assigned"]["count"], 1)
        self.assertGreaterEqual(data["funnel"]["first_homework_submission"]["count"], 1)

    def test_d7_excludes_young_teachers(self):
        young = User.objects.create_user(username="young_t", password="pass")
        young.profile.role = Profile.Role.TEACHER
        young.profile.save(update_fields=["role"])
        report = build_activation_report()
        blob = str(report)
        self.assertNotIn("young_t", blob)
        self.assertNotIn("act_t", blob)
        self.assertNotIn("secret@example.com", blob)
        eligible = report["retention"]["registration_d7"]["eligible"]
        total = report["teachers_total"]
        self.assertLess(eligible, total)
