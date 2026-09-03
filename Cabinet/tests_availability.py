"""Teacher availability → existing ScheduleEventSeries booking flow."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.availability_models import TeacherBooking
from Cabinet.availability_service import (
    SLOT_TAKEN_MESSAGE,
    book_slot,
    create_availability_windows,
    publish_booking_link,
)
from Cabinet.choices import SeriesStatus
from Cabinet.models import Profile, ScheduleEvent, Student, TariffPlan, TeacherSubscription
from Cabinet.schedule_service import cancel_event, create_series, create_single_event


MOSCOW = ZoneInfo("Europe/Moscow")


def _future_weekday(weekday, weeks=1):
    today = timezone.now().astimezone(MOSCOW).date()
    delta = (weekday - today.weekday()) % 7
    if delta == 0:
        delta = 7
    return today + timedelta(days=delta + 7 * (weeks - 1))


def _grant_teacher_plan(user):
    plan, _ = TariffPlan.objects.get_or_create(
        slug="teacher",
        defaults={
            "name": "Учитель",
            "price_month": 1990,
            "content_access_rank": 1,
            "is_free": False,
            "is_active": True,
            "sort_order": 1,
        },
    )
    TeacherSubscription.objects.update_or_create(
        teacher=user,
        defaults={
            "plan": plan,
            "status": TeacherSubscription.Status.ACTIVE,
            "source": TeacherSubscription.Source.ADMIN,
        },
    )
    return plan


class TeacherAvailabilityBookingTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="avail_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.name = "Дарья"
        self.teacher.profile.surname = "Витальевна"
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "name", "surname", "timezone"])
        _grant_teacher_plan(self.teacher)

        self.student_user = User.objects.create_user(
            username="avail_student", password="pass", email="anna@test.ru",
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.name = "Анна"
        self.student_user.profile.surname = "Иванова"
        self.student_user.profile.save(update_fields=["role", "name", "surname"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Иванова",
            status="active",
        )

        self.other_user = User.objects.create_user(username="avail_other", password="pass")
        self.other_user.profile.role = Profile.Role.STUDENT
        self.other_user.profile.save(update_fields=["role"])
        self.other_student = Student.objects.create(
            teacher=self.teacher,
            user=self.other_user,
            first_name="Пётр",
            last_name="Другой",
            status="active",
        )

        self.outsider = User.objects.create_user(username="avail_outsider", password="pass")
        self.outsider.profile.role = Profile.Role.STUDENT
        self.outsider.profile.save(update_fields=["role"])

        self.client = APIClient()
        self.wed = _future_weekday(2)
        self.period_to = self.wed + timedelta(days=14)

        self.client.force_login(self.teacher)
        created = self.client.post(
            "/api/cabinet/availability/",
            {
                "date_from": self.wed.isoformat(),
                "date_to": self.period_to.isoformat(),
                "weekdays": [2],
                "start_time": "15:00",
                "end_time": "19:00",
                "slot_duration_minutes": 60,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        publish = self.client.post(
            "/api/cabinet/availability/link/",
            {"date_from": self.wed.isoformat(), "date_to": self.period_to.isoformat()},
            format="json",
        )
        self.assertEqual(publish.status_code, 200, publish.content)
        self.token = publish.json()["token"]
        self.client.logout()

    def test_slots_are_hourly_inside_window(self):
        self.client.force_login(self.student_user)
        data = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        times = {
            slot["start_time"]
            for day in data["dates"]
            if day["date"] == self.wed.isoformat()
            for slot in day["slots"]
        }
        self.assertEqual(times, {"15:00", "16:00", "17:00", "18:00"})
        self.assertTrue(data["linked"])

    def test_booking_creates_weekly_series(self):
        self.client.force_login(self.student_user)
        response = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "17:00"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        booking = TeacherBooking.objects.get()
        self.assertEqual(booking.status, TeacherBooking.Status.ACTIVE)
        self.assertEqual(booking.series.recurrence_type, "weekly")
        self.assertEqual(booking.series.start_time.strftime("%H:%M"), "17:00")
        self.assertEqual(booking.student_id, self.student.pk)
        events = ScheduleEvent.objects.filter(series=booking.series, student=self.student)
        self.assertGreaterEqual(events.count(), 1)
        first = events.order_by("starts_at").first()
        self.assertEqual(first.starts_at.astimezone(MOSCOW).strftime("%H:%M"), "17:00")

        slots = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        times = {
            slot["start_time"]
            for day in slots["dates"]
            if day["date"] == self.wed.isoformat()
            for slot in day["slots"]
        }
        self.assertNotIn("17:00", times)
        self.assertIn("16:00", times)

    def test_second_student_gets_conflict(self):
        self.client.force_login(self.student_user)
        first = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "16:00"},
            format="json",
        )
        self.assertEqual(first.status_code, 201, first.content)
        self.client.force_login(self.other_user)
        second = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "16:00"},
            format="json",
        )
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.json()["code"], "slot_taken")
        self.assertEqual(second.json()["error"], SLOT_TAKEN_MESSAGE)
        self.assertEqual(TeacherBooking.objects.filter(status="active").count(), 1)

    def test_unlinked_student_cannot_book(self):
        self.client.force_login(self.outsider)
        response = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "15:00"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "not_linked")

    def test_anonymous_can_view_but_not_book(self):
        page = self.client.get(f"/api/cabinet/booking/{self.token}/")
        self.assertEqual(page.status_code, 200)
        self.assertFalse(page.json()["authenticated"])
        booked = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "15:00"},
            format="json",
        )
        self.assertEqual(booked.status_code, 401)

    def test_existing_series_hides_weekday_even_if_one_event_cancelled(self):
        start = timezone.now().astimezone(MOSCOW).replace(
            hour=17, minute=0, second=0, microsecond=0,
        )
        # Align created series to the same Wednesday weekday.
        while start.date().weekday() != 2:
            start += timedelta(days=1)
        start += timedelta(days=7)
        series, events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Уже стоит",
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "start_date": start.date(),
                "start_time": start.time().replace(tzinfo=None),
                "end_time": (start + timedelta(hours=1)).time().replace(tzinfo=None),
                "recurrence_type": "weekly",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertTrue(events)
        cancel_event(events[0], changed_by=self.teacher, notify=False)
        series.refresh_from_db()
        self.assertEqual(series.status, SeriesStatus.ACTIVE)

        self.client.force_login(self.other_user)
        data = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        times = {slot["start_time"] for slot in data["slots"]}
        self.assertNotIn("17:00", times)

    def test_cancel_keeps_past_and_frees_future_slot(self):
        self.client.force_login(self.student_user)
        booked = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "18:00"},
            format="json",
        )
        self.assertEqual(booked.status_code, 201, booked.content)
        booking_id = booked.json()["booking"]["id"]
        booking = TeacherBooking.objects.get(pk=booking_id)
        past = ScheduleEvent.objects.filter(series=booking.series).order_by("starts_at").first()
        past.starts_at = timezone.now() - timedelta(days=7)
        past.ends_at = past.starts_at + timedelta(hours=1)
        past.status = ScheduleEvent.Status.DONE
        past.save(update_fields=["starts_at", "ends_at", "status"])

        cancelled = self.client.post(
            f"/api/cabinet/student/permanent-schedule/{booking_id}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        past.refresh_from_db()
        self.assertEqual(past.status, ScheduleEvent.Status.DONE)
        booking.refresh_from_db()
        self.assertEqual(booking.status, TeacherBooking.Status.CANCELLED)
        future = ScheduleEvent.objects.filter(
            series=booking.series,
            starts_at__date__gte=timezone.now().astimezone(MOSCOW).date(),
        ).exclude(status=ScheduleEvent.Status.CANCELLED)
        self.assertFalse(future.exists())

        data = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        times = {
            slot["start_time"]
            for day in data["dates"]
            if day["date"] == self.wed.isoformat()
            for slot in day["slots"]
        }
        self.assertIn("18:00", times)

    def test_one_off_event_blocks_only_that_date(self):
        start = datetime(self.wed.year, self.wed.month, self.wed.day, 15, 0, tzinfo=MOSCOW)
        create_single_event(
            teacher=self.teacher,
            data={
                "title": "Разовое",
                "starts_at": start,
                "ends_at": start + timedelta(hours=1),
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.client.force_login(self.other_user)
        data = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        wed_times = {
            slot["start_time"]
            for day in data["dates"]
            if day["date"] == self.wed.isoformat()
            for slot in day["slots"]
        }
        self.assertNotIn("15:00", wed_times)
        later = self.wed + timedelta(days=7)
        later_times = {
            slot["start_time"]
            for day in data["dates"]
            if day["date"] == later.isoformat()
            for slot in day["slots"]
        }
        self.assertIn("15:00", later_times)

    def test_teacher_list_returns_slots_and_stable_link(self):
        self.client.force_login(self.teacher)
        first = self.client.get("/api/cabinet/availability/link/").json()
        second = self.client.get("/api/cabinet/availability/link/").json()
        self.assertEqual(first["token"], second["token"])
        listing = self.client.get(
            f"/api/cabinet/availability/?from={self.wed.isoformat()}&to={self.period_to.isoformat()}"
        )
        self.assertEqual(listing.status_code, 200)
        self.assertGreaterEqual(len(listing.json()["slots"]), 4)

    def test_public_page_expands_period_to_cover_painted_days(self):
        """Free days outside a narrower publish window must still become bookable."""
        from Cabinet.availability_models import TeacherAvailability, TeacherBookingLink

        painted = self.wed - timedelta(days=3)
        self.assertLess(painted, self.wed)

        self.client.force_login(self.teacher)
        created = self.client.post(
            "/api/cabinet/availability/",
            {
                "dates": [painted.isoformat()],
                "start_time": "10:00",
                "end_time": "12:00",
                "slot_duration_minutes": 60,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(
            TeacherAvailability.objects.filter(
                teacher=self.teacher, date=painted, is_active=True
            ).exists()
        )

        # Simulate a publish window that starts after the painted free day.
        link = TeacherBookingLink.objects.get(teacher=self.teacher)
        link.date_from = self.wed
        link.date_to = self.period_to
        link.is_active = True
        link.save(update_fields=["date_from", "date_to", "is_active", "updated_at"])

        self.client.force_login(self.student_user)
        data = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        available_dates = {day["date"] for day in data["dates"]}
        self.assertIn(painted.isoformat(), available_dates)
        self.assertEqual(data["date_from"], painted.isoformat())
        painted_times = {
            slot["start_time"]
            for day in data["dates"]
            if day["date"] == painted.isoformat()
            for slot in day["slots"]
        }
        self.assertEqual(painted_times, {"10:00", "11:00"})

    def test_teacher_cancel_series_frees_permanent_booking_slot(self):
        """Cancelling the series must release the ACTIVE TeacherBooking lock."""
        self.client.force_login(self.student_user)
        booked = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "15:00"},
            format="json",
        )
        self.assertEqual(booked.status_code, 201, booked.content)
        booking = TeacherBooking.objects.get()
        series_id = booking.series_id
        self.assertEqual(booking.status, TeacherBooking.Status.ACTIVE)

        self.client.force_login(self.teacher)
        cancelled = self.client.post(
            f"/api/cabinet/schedule-series/{series_id}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        booking.refresh_from_db()
        self.assertEqual(booking.status, TeacherBooking.Status.CANCELLED)

        self.client.force_login(self.other_user)
        rebook = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "15:00"},
            format="json",
        )
        self.assertEqual(rebook.status_code, 201, rebook.content)
        self.assertEqual(TeacherBooking.objects.filter(status="active").count(), 1)

    def test_partial_overlap_booking_is_rejected(self):
        """15:00–16:00 booking must block overlapping 15:30 start if offered."""
        self.client.force_login(self.student_user)
        first = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "15:00"},
            format="json",
        )
        self.assertEqual(first.status_code, 201, first.content)

        # Paint a 30-minute window that overlaps the booked hour.
        self.client.force_login(self.teacher)
        painted = self.client.post(
            "/api/cabinet/availability/",
            {
                "dates": [self.wed.isoformat()],
                "start_time": "15:30",
                "end_time": "16:30",
                "slot_duration_minutes": 60,
            },
            format="json",
        )
        self.assertEqual(painted.status_code, 201, painted.content)

        page = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        wed_times = {
            slot["start_time"]
            for day in page["dates"]
            if day["date"] == self.wed.isoformat()
            for slot in day["slots"]
        }
        self.assertNotIn("15:30", wed_times)

        self.client.force_login(self.other_user)
        second = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "15:30"},
            format="json",
        )
        self.assertEqual(second.status_code, 409)

    def test_public_booking_page_hides_other_students(self):
        self.client.force_login(self.student_user)
        booked = self.client.post(
            f"/api/cabinet/booking/{self.token}/book/",
            {"date": self.wed.isoformat(), "start_time": "18:00"},
            format="json",
        )
        self.assertEqual(booked.status_code, 201, booked.content)

        self.client.force_login(self.other_user)
        data = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        payload = str(data)
        self.assertNotIn("Анна", payload)
        self.assertNotIn("Иванова", payload)
        self.assertNotIn("@test.ru", payload)
        for day in data["dates"]:
            for slot in day["slots"]:
                self.assertNotIn("student", slot)
                self.assertNotIn("student_name", slot)

    def test_one_off_series_event_blocks_slot_on_that_date(self):
        """Series with recurrence none must still hide its concrete occurrence."""
        from Cabinet.choices import RecurrenceType, SeriesStatus
        from Cabinet.models import ScheduleEventSeries
        from Cabinet.schedule_service import create_single_event

        # Create a one-off event attached to a NONE series (edge path).
        start = datetime(self.wed.year, self.wed.month, self.wed.day, 12, 0, tzinfo=MOSCOW)
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Разовое через серию",
                "starts_at": start,
                "ends_at": start + timedelta(hours=1),
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        series = ScheduleEventSeries.objects.create(
            teacher=self.teacher,
            created_by=self.teacher,
            title="none-series",
            event_type="individual_lesson",
            timezone="Europe/Moscow",
            start_date=self.wed,
            start_time=start.time(),
            end_time=(start + timedelta(hours=1)).time(),
            recurrence_type=RecurrenceType.NONE,
            status=SeriesStatus.ACTIVE,
            format="online",
        )
        event.series = series
        event.save(update_fields=["series"])

        self.client.force_login(self.teacher)
        self.client.post(
            "/api/cabinet/availability/",
            {
                "dates": [self.wed.isoformat()],
                "start_time": "12:00",
                "end_time": "13:00",
                "slot_duration_minutes": 60,
            },
            format="json",
        )
        page = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        wed_times = {
            slot["start_time"]
            for day in page["dates"]
            if day["date"] == self.wed.isoformat()
            for slot in day["slots"]
        }
        self.assertNotIn("12:00", wed_times)


class TeacherAvailabilityConcurrencyTests(TransactionTestCase):
    """Real DB concurrency — must not use TestCase's outer transaction."""

    def setUp(self):
        self.teacher = User.objects.create_user(username="avail_conc_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "timezone"])
        _grant_teacher_plan(self.teacher)

        self.student_user = User.objects.create_user(username="avail_conc_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Иванова",
            status="active",
        )

        self.other_user = User.objects.create_user(username="avail_conc_other", password="pass")
        self.other_user.profile.role = Profile.Role.STUDENT
        self.other_user.profile.save(update_fields=["role"])
        self.other_student = Student.objects.create(
            teacher=self.teacher,
            user=self.other_user,
            first_name="Пётр",
            last_name="Другой",
            status="active",
        )

        self.wed = _future_weekday(2)
        self.period_to = self.wed + timedelta(days=14)
        create_availability_windows(
            self.teacher,
            {
                "date_from": self.wed.isoformat(),
                "date_to": self.period_to.isoformat(),
                "weekdays": [2],
                "start_time": "15:00",
                "end_time": "19:00",
                "slot_duration_minutes": 60,
            },
        )
        link = publish_booking_link(
            self.teacher,
            {"date_from": self.wed.isoformat(), "date_to": self.period_to.isoformat(), "is_active": True},
        )
        self.token = link["token"]

    def test_concurrent_double_booking_only_one_wins(self):
        import threading

        barrier = threading.Barrier(2)
        results = []
        lock = threading.Lock()

        def attempt(user):
            barrier.wait(timeout=5)
            try:
                booking, _ = book_slot(
                    token=self.token,
                    user=user,
                    date_value=self.wed.isoformat(),
                    start_time_value="16:00",
                )
                with lock:
                    results.append(("ok", booking.pk))
            except Exception as exc:
                with lock:
                    results.append(("err", getattr(exc, "code", type(exc).__name__)))

        t1 = threading.Thread(target=attempt, args=(self.student_user,))
        t2 = threading.Thread(target=attempt, args=(self.other_user,))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        oks = [item for item in results if item[0] == "ok"]
        errs = [item for item in results if item[0] == "err"]
        self.assertEqual(len(oks), 1, results)
        self.assertEqual(len(errs), 1, results)
        self.assertEqual(TeacherBooking.objects.filter(status="active").count(), 1)
