from datetime import date, timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import PlanItemStatus, PlanStatus
from Cabinet.models import (
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Profile,
    Student,
    StudentSubject,
)
from Cabinet.plan_dates import generate_plan_dates, apply_plan_item_dates
from Cabinet.plan_sync import PlanSyncService
from Cabinet.schedule_service import create_single_event


class PlanDatesHelperTests(TestCase):
    def test_weekly_dates(self):
        dates = generate_plan_dates(date(2026, 9, 1), 4, "weekly")
        self.assertEqual(dates, [
            date(2026, 9, 1),
            date(2026, 9, 8),
            date(2026, 9, 15),
            date(2026, 9, 22),
        ])

    def test_twice_weekly_alternating(self):
        dates = generate_plan_dates(date(2026, 9, 1), 4, "twice_weekly")
        self.assertEqual(dates, [
            date(2026, 9, 1),
            date(2026, 9, 4),
            date(2026, 9, 8),
            date(2026, 9, 11),
        ])

    def test_biweekly_dates(self):
        dates = generate_plan_dates(date(2026, 9, 1), 3, "biweekly")
        self.assertEqual(dates, [
            date(2026, 9, 1),
            date(2026, 9, 15),
            date(2026, 9, 29),
        ])

    def test_thrice_weekly_dates(self):
        dates = generate_plan_dates(date(2026, 9, 1), 4, "thrice_weekly")
        self.assertEqual(dates, [
            date(2026, 9, 1),
            date(2026, 9, 3),
            date(2026, 9, 5),
            date(2026, 9, 8),
        ])

    def test_four_weekly_dates(self):
        dates = generate_plan_dates(date(2026, 9, 1), 5, "four_weekly")
        self.assertEqual(dates, [
            date(2026, 9, 1),
            date(2026, 9, 2),
            date(2026, 9, 4),
            date(2026, 9, 5),
            date(2026, 9, 8),
        ])

    def test_daily_dates(self):
        dates = generate_plan_dates(date(2026, 9, 1), 4, "daily")
        self.assertEqual(dates, [
            date(2026, 9, 1),
            date(2026, 9, 2),
            date(2026, 9, 3),
            date(2026, 9, 4),
        ])


class PlanDatesApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="dates_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Ира",
            last_name="Ученица",
            status="active",
        )
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Информатика",
            subject="inf",
            status=PlanStatus.PUBLISHED,
        )
        self.items = [
            LessonPlanItem.objects.create(
                plan=self.plan, order=n, title=f"Урок {n}", topic=f"Тема {n}",
            )
            for n in range(1, 4)
        ]
        self.client = APIClient()
        self.client.force_authenticate(user=self.teacher)

    def test_fill_dates_from_first_lesson(self):
        resp = self.client.post(
            f"/api/cabinet/lesson-plans/{self.plan.pk}/fill-dates/",
            {"start_date": "2026-09-07", "interval": "weekly"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        dates = [item.scheduled_date for item in self.plan.items.order_by("order")]
        self.assertEqual(dates, [
            date(2026, 9, 7),
            date(2026, 9, 14),
            date(2026, 9, 21),
        ])
        self.assertEqual(
            LessonPlanItem.objects.filter(plan=self.plan, status=PlanItemStatus.PLANNED).count(),
            3,
        )

    def test_patch_item_date_keeps_manual_edit(self):
        apply_plan_item_dates(self.plan, date(2026, 9, 7), "weekly")
        item = self.items[1]
        resp = self.client.patch(
            f"/api/cabinet/lesson-plan-items/{item.pk}/",
            {"scheduled_date": "2026-09-16", "title": item.title},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        item.refresh_from_db()
        self.assertEqual(item.scheduled_date, date(2026, 9, 16))
        self.items[0].refresh_from_db()
        self.assertEqual(self.items[0].scheduled_date, date(2026, 9, 7))

    def test_enroll_with_start_date_fills_items(self):
        ss = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge",
        )
        resp = self.client.post(
            "/api/cabinet/lesson-plan-enrollments/",
            {
                "plan": self.plan.id,
                "student": self.student.id,
                "student_subject": ss.id,
                "format": "individual",
                "start_date": "2026-10-01",
                "frequency": "weekly",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        dates = list(
            LessonPlanItem.objects.filter(plan=self.plan).order_by("order")
            .values_list("scheduled_date", flat=True)
        )
        self.assertEqual(dates[0], date(2026, 10, 1))
        self.assertEqual(dates[1], date(2026, 10, 8))
        enrollment = LessonPlanEnrollment.objects.get(pk=resp.data["id"])
        self.assertEqual(enrollment.start_date, date(2026, 10, 1))

    def test_different_plans_per_student_subjects(self):
        ss_inf = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge",
        )
        ss_math = StudentSubject.objects.create(
            student=self.student, subject="math", title="Алгебра", direction="school",
        )
        plan_math = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Математика",
            subject="math",
            status=PlanStatus.PUBLISHED,
        )
        inf_resp = self.client.post(
            "/api/cabinet/lesson-plan-enrollments/",
            {
                "plan": self.plan.id,
                "student": self.student.id,
                "student_subject": ss_inf.id,
                "format": "individual",
            },
            format="json",
        )
        math_resp = self.client.post(
            "/api/cabinet/lesson-plan-enrollments/",
            {
                "plan": plan_math.id,
                "student": self.student.id,
                "student_subject": ss_math.id,
                "format": "individual",
            },
            format="json",
        )
        self.assertEqual(inf_resp.status_code, 201, inf_resp.content)
        self.assertEqual(math_resp.status_code, 201, math_resp.content)
        self.assertEqual(
            LessonPlanEnrollment.objects.filter(
                student=self.student, status="active",
            ).count(),
            2,
        )
        self.assertEqual(
            LessonPlanEnrollment.objects.get(
                student_subject=ss_inf, status="active",
            ).plan_id,
            self.plan.id,
        )
        self.assertEqual(
            LessonPlanEnrollment.objects.get(
                student_subject=ss_math, status="active",
            ).plan_id,
            plan_math.id,
        )

    def test_subject_create_with_plan_and_start_date(self):
        resp = self.client.post(
            f"/api/cabinet/students/{self.student.id}/subjects/",
            {
                "subject": "inf",
                "title": "ОГЭ",
                "direction": "oge",
                "plan_id": self.plan.id,
                "start_date": "2026-09-02",
                "date_interval": "weekly",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        enrollment = LessonPlanEnrollment.objects.get(
            student=self.student, plan=self.plan, status="active",
        )
        self.assertEqual(enrollment.start_date, date(2026, 9, 2))
        self.assertEqual(
            LessonPlanItem.objects.get(pk=self.items[0].pk).scheduled_date,
            date(2026, 9, 2),
        )
        self.assertEqual(
            LessonPlanItem.objects.get(pk=self.items[1].pk).scheduled_date,
            date(2026, 9, 2) + timedelta(days=7),
        )
        self.assertEqual(resp.data["plan_enrollment"]["plan_id"], self.plan.id)
        self.assertEqual(resp.data["plan_enrollment"]["start_date"], "2026-09-02")


class PlanDateScheduleSyncTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="dates_sync_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Тест",
            last_name="Ученик",
            status="active",
        )
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Информатика",
            subject="inf",
            status=PlanStatus.PUBLISHED,
        )
        self.items = [
            LessonPlanItem.objects.create(
                plan=self.plan, order=n, title=title, topic=title,
            )
            for n, title in enumerate(["Кодирование", "Системы счисления", "Логика"], start=1)
        ]
        self.subject = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge",
        )
        self.enrollment = LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=self.plan,
            student=self.student,
            student_subject=self.subject,
            status="active",
            format="individual",
        )

    def _today_event(self, *, hours_ago=2, student_subject=None):
        starts = timezone.now().replace(second=0, microsecond=0) - timedelta(hours=hours_ago)
        ends = starts + timedelta(minutes=45)
        data = {
            "title": "Урок",
            "starts_at": starts,
            "ends_at": ends,
            "event_type": "individual_lesson",
            "notify_participants": False,
        }
        if student_subject is not None:
            data["student_subject_id"] = student_subject.pk
        return create_single_event(
            teacher=self.teacher,
            data=data,
            student_ids=[self.student.pk],
            notify=False,
        )

    def test_today_lesson_gets_topic_even_if_time_passed(self):
        event = self._today_event(student_subject=self.subject)
        event.refresh_from_db()
        self.assertEqual(event.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(event.topic, "Кодирование")

    def test_unbound_today_lesson_syncs_after_plan_dates(self):
        """Урок без предмета + план по предмету: дата в плане подтягивает тему."""
        event = self._today_event(student_subject=None)
        event.student_subject = None
        event.lesson_plan_item = None
        event.topic = ""
        event.save(update_fields=["student_subject", "lesson_plan_item", "topic", "updated_at"])

        apply_plan_item_dates(self.plan, timezone.localdate(), "weekly")
        event.refresh_from_db()
        self.assertEqual(event.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(event.topic, "Кодирование")

    def test_item_dated_today_binds_that_topic_not_first(self):
        today = timezone.localdate()
        self.items[0].scheduled_date = today - timedelta(days=7)
        self.items[0].save(update_fields=["scheduled_date", "updated_at"])
        self.items[1].scheduled_date = today
        self.items[1].save(update_fields=["scheduled_date", "updated_at"])
        event = self._today_event(student_subject=self.subject)
        PlanSyncService.realign_enrollment_topics(self.enrollment)
        event.refresh_from_db()
        self.assertEqual(event.lesson_plan_item_id, self.items[1].id)
        self.assertEqual(event.topic, "Системы счисления")

