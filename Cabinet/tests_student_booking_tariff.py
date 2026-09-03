"""Tariff gate for student self-booking / availability (Teacher+)."""

from datetime import timedelta
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.availability_models import TeacherAvailability, TeacherBooking, TeacherBookingLink
from Cabinet.availability_service import deactivate_teacher_booking_link
from Cabinet.models import Profile, ScheduleEvent, Student, TariffPlan, TeacherSubscription
from Cabinet.schedule_service import create_single_event
from Cabinet.subscription_access import SubscriptionAccessService


MOSCOW = ZoneInfo("Europe/Moscow")


def _future_weekday(weekday, weeks=1):
    today = timezone.now().astimezone(MOSCOW).date()
    delta = (weekday - today.weekday()) % 7
    if delta == 0:
        delta = 7
    return today + timedelta(days=delta + 7 * (weeks - 1))


def _ensure_plans():
    plans = {}
    for slug, name, rank, is_free in (
        ("start", "Старт", 0, True),
        ("teacher", "Учитель", 1, False),
        ("pro", "Профи", 2, False),
        ("premium", "Премиум", 3, False),
    ):
        plans[slug], _ = TariffPlan.objects.update_or_create(
            slug=slug,
            defaults={
                "name": name,
                "price_month": 0 if is_free else 1990,
                "content_access_rank": rank,
                "is_free": is_free,
                "is_active": True,
                "sort_order": rank,
            },
        )
    return plans


def _set_plan(user, plan):
    TeacherSubscription.objects.update_or_create(
        teacher=user,
        defaults={
            "plan": plan,
            "status": TeacherSubscription.Status.ACTIVE,
            "source": TeacherSubscription.Source.ADMIN,
        },
    )


class StudentBookingTariffGateTests(TestCase):
    def setUp(self):
        self.plans = _ensure_plans()
        self.client = APIClient()
        self.wed = _future_weekday(2)
        self.period_to = self.wed + timedelta(days=14)

        self.start_teacher = User.objects.create_user("start_book_teacher", password="pass")
        self.start_teacher.profile.role = Profile.Role.TEACHER
        self.start_teacher.profile.timezone = "Europe/Moscow"
        self.start_teacher.profile.save(update_fields=["role", "timezone"])
        _set_plan(self.start_teacher, self.plans["start"])

        self.paid_teacher = User.objects.create_user("paid_book_teacher", password="pass")
        self.paid_teacher.profile.role = Profile.Role.TEACHER
        self.paid_teacher.profile.timezone = "Europe/Moscow"
        self.paid_teacher.profile.save(update_fields=["role", "timezone"])
        _set_plan(self.paid_teacher, self.plans["teacher"])

        self.pro_teacher = User.objects.create_user("pro_book_teacher", password="pass")
        self.pro_teacher.profile.role = Profile.Role.TEACHER
        self.pro_teacher.profile.timezone = "Europe/Moscow"
        self.pro_teacher.profile.save(update_fields=["role", "timezone"])
        _set_plan(self.pro_teacher, self.plans["pro"])

        self.student_user = User.objects.create_user("book_gate_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.paid_teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Иванова",
            status="active",
        )

    def test_start_can_create_regular_lesson(self):
        start = timezone.now().astimezone(MOSCOW).replace(hour=15, minute=0, second=0, microsecond=0)
        start = start + timedelta(days=2)
        event = create_single_event(
            teacher=self.start_teacher,
            data={
                "title": "Урок",
                "starts_at": start,
                "ends_at": start + timedelta(hours=1),
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "notify_participants": False,
            },
            student_ids=[],
            notify=False,
        )
        self.assertIsNotNone(event.pk)
        self.assertTrue(
            ScheduleEvent.objects.filter(owner=self.start_teacher, pk=event.pk).exists()
        )

    def test_start_cannot_create_availability(self):
        self.assertFalse(SubscriptionAccessService.can_use_student_booking(self.start_teacher))
        self.client.force_login(self.start_teacher)
        response = self.client.post(
            "/api/cabinet/availability/",
            {
                "dates": [self.wed.isoformat()],
                "start_time": "10:00",
                "end_time": "12:00",
                "slot_duration_minutes": 60,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "BOOKING_REQUIRES_TEACHER_PLAN")
        self.assertTrue(response.json().get("upgrade_required"))
        self.assertEqual(
            TeacherAvailability.objects.filter(teacher=self.start_teacher).count(), 0
        )

    def test_start_cannot_open_booking_link(self):
        self.client.force_login(self.start_teacher)
        response = self.client.post(
            "/api/cabinet/availability/link/",
            {
                "date_from": self.wed.isoformat(),
                "date_to": self.period_to.isoformat(),
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "BOOKING_REQUIRES_TEACHER_PLAN")

    def test_teacher_can_use_booking(self):
        self.assertTrue(SubscriptionAccessService.can_use_student_booking(self.paid_teacher))
        self.client.force_login(self.paid_teacher)
        created = self.client.post(
            "/api/cabinet/availability/",
            {
                "dates": [self.wed.isoformat()],
                "start_time": "10:00",
                "end_time": "12:00",
                "slot_duration_minutes": 60,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        publish = self.client.post(
            "/api/cabinet/availability/link/",
            {
                "date_from": self.wed.isoformat(),
                "date_to": self.period_to.isoformat(),
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(publish.status_code, 200, publish.content)
        self.assertTrue(publish.json()["is_active"])
        self.assertTrue(publish.json()["feature_allowed"])

    def test_higher_plans_can_use_booking(self):
        self.assertTrue(SubscriptionAccessService.can_use_student_booking(self.pro_teacher))
        self.client.force_login(self.pro_teacher)
        created = self.client.post(
            "/api/cabinet/availability/",
            {
                "dates": [self.wed.isoformat()],
                "start_time": "11:00",
                "end_time": "12:00",
                "slot_duration_minutes": 60,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)

    def test_downgrade_keeps_lessons_and_blocks_new_public_booking(self):
        self.client.force_login(self.paid_teacher)
        lesson_start = timezone.now().astimezone(MOSCOW).replace(
            hour=16, minute=0, second=0, microsecond=0
        ) + timedelta(days=3)
        event = create_single_event(
            teacher=self.paid_teacher,
            data={
                "title": "Сохранённый урок",
                "starts_at": lesson_start,
                "ends_at": lesson_start + timedelta(hours=1),
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        created = self.client.post(
            "/api/cabinet/availability/",
            {
                "dates": [self.wed.isoformat()],
                "start_time": "10:00",
                "end_time": "12:00",
                "slot_duration_minutes": 60,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        publish = self.client.post(
            "/api/cabinet/availability/link/",
            {
                "date_from": self.wed.isoformat(),
                "date_to": self.period_to.isoformat(),
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(publish.status_code, 200, publish.content)
        token = publish.json()["token"]

        # Downgrade to Start — lessons remain, public booking closes.
        _set_plan(self.paid_teacher, self.plans["start"])
        deactivated = deactivate_teacher_booking_link(self.paid_teacher)
        self.assertGreaterEqual(deactivated, 1)
        self.assertTrue(ScheduleEvent.objects.filter(pk=event.pk).exists())
        self.assertTrue(
            TeacherAvailability.objects.filter(teacher=self.paid_teacher, is_active=True).exists()
        )

        page = self.client.get(f"/api/cabinet/booking/{token}/")
        self.assertEqual(page.status_code, 404)

        self.client.force_login(self.student_user)
        book = self.client.post(
            f"/api/cabinet/booking/{token}/book/",
            {"date": self.wed.isoformat(), "start_time": "10:00"},
            format="json",
        )
        self.assertEqual(book.status_code, 404)
        self.assertEqual(TeacherBooking.objects.filter(teacher=self.paid_teacher).count(), 0)

        # Start still cannot reopen booking via API.
        self.client.force_login(self.paid_teacher)
        reopen = self.client.post(
            "/api/cabinet/availability/link/",
            {
                "date_from": self.wed.isoformat(),
                "date_to": self.period_to.isoformat(),
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(reopen.status_code, 403)
