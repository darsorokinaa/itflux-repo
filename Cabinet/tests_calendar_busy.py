"""Busy-interval engine, personal events, travel time, student privacy."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.availability_service import compute_available_slots, create_availability_windows, publish_booking_link
from Cabinet.busy_intervals import get_busy_intervals, occupancy_window
from Cabinet.models import Profile, ScheduleEvent, Student, TariffPlan, TeacherSubscription
from Cabinet.schedule_service import check_conflicts, create_series, create_single_event, move_event


MOSCOW = ZoneInfo("Europe/Moscow")


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


def _future_weekday(weekday):
    today = timezone.now().astimezone(MOSCOW).date()
    delta = (weekday - today.weekday()) % 7
    if delta == 0:
        delta = 7
    return today + timedelta(days=delta)


class CalendarBusyIntervalTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="cal_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "timezone"])
        _grant_teacher_plan(self.teacher)

        self.student_user = User.objects.create_user(username="cal_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Иванова",
            status="active",
        )
        self.day = _future_weekday(2)
        self.client = APIClient()

        create_availability_windows(
            self.teacher,
            {
                "date_from": self.day.isoformat(),
                "date_to": (self.day + timedelta(days=7)).isoformat(),
                "weekdays": [2],
                "start_time": "14:00",
                "end_time": "21:00",
                "slot_duration_minutes": 60,
            },
        )
        published = publish_booking_link(
            self.teacher,
            {
                "date_from": self.day.isoformat(),
                "date_to": (self.day + timedelta(days=7)).isoformat(),
                "is_active": True,
            },
        )
        self.token = published["token"]

    def _day_slots(self):
        slots = compute_available_slots(
            teacher=self.teacher,
            date_from=self.day,
            date_to=self.day,
        )
        return {slot["start_time"] for slot in slots if slot["date"] == self.day.isoformat()}

    def test_adjacent_intervals_do_not_overlap(self):
        start = datetime(self.day.year, self.day.month, self.day.day, 17, 0, tzinfo=MOSCOW)
        end = start + timedelta(hours=1)
        occ_start, occ_end = occupancy_window(start, end)
        later_start = end
        later_end = later_start + timedelta(hours=1)
        self.assertFalse(occ_start < later_end and occ_end > later_start)

    def test_personal_event_with_travel_blocks_student_slots(self):
        create_single_event(
            teacher=self.teacher,
            data={
                "title": "Университет",
                "event_type": "personal",
                "timezone": "Europe/Moscow",
                "starts_at": f"{self.day.isoformat()}T16:00:00",
                "ends_at": f"{self.day.isoformat()}T17:00:00",
                "location": "МГТУ им. Баумана",
                "travel_before_minutes": 30,
                "travel_after_minutes": 30,
                "visibility": "private",
                "notify_participants": False,
            },
            notify=False,
        )
        times = self._day_slots()
        self.assertNotIn("15:00", times)
        self.assertNotIn("16:00", times)
        self.assertNotIn("17:00", times)
        self.assertIn("18:00", times)

        self.client.force_login(self.student_user)
        page = self.client.get(f"/api/cabinet/booking/{self.token}/").json()
        payload = str(page)
        self.assertNotIn("Университет", payload)
        self.assertNotIn("МГТУ", payload)
        self.assertNotIn("Баумана", payload)

        schedule = self.client.get("/api/cabinet/student/schedule/").json()
        blob = str(schedule)
        self.assertNotIn("Университет", blob)
        self.assertNotIn("МГТУ", blob)

    def test_teacher_calendar_shows_travel_as_virtual_blocks(self):
        created = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Университет",
                "event_type": "personal",
                "timezone": "Europe/Moscow",
                "starts_at": f"{self.day.isoformat()}T16:00:00",
                "ends_at": f"{self.day.isoformat()}T17:00:00",
                "location": "МГТУ им. Баумана",
                "travel_before_minutes": 30,
                "travel_after_minutes": 45,
                "visibility": "private",
                "notify_participants": False,
            },
            notify=False,
        )
        self.client.force_login(self.teacher)
        data = self.client.get(
            "/api/cabinet/schedule/events/",
            {"from": self.day.isoformat(), "to": self.day.isoformat()},
        ).json()
        kinds = {ev["kind"] for ev in data["events"]}
        self.assertIn("personal", kinds)
        self.assertIn("travel", kinds)
        self.assertEqual(ScheduleEvent.objects.filter(owner=self.teacher, event_type="travel").count(), 0)
        personal = next(ev for ev in data["events"] if ev["kind"] == "personal")
        self.assertEqual(personal["title"], "Университет")
        self.assertEqual(personal["location"], "МГТУ им. Баумана")
        travel = [ev for ev in data["events"] if ev["kind"] == "travel"]
        self.assertEqual(len(travel), 2)
        self.assertTrue(all(row["parentEventId"] == personal["id"] for row in travel))
        self.assertEqual(created.pk, int(str(personal["id"]).replace("local-", "")))

    def test_moving_personal_event_moves_travel(self):
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Университет",
                "event_type": "personal",
                "timezone": "Europe/Moscow",
                "starts_at": f"{self.day.isoformat()}T16:00:00",
                "ends_at": f"{self.day.isoformat()}T17:00:00",
                "travel_before_minutes": 30,
                "travel_after_minutes": 30,
                "visibility": "private",
                "notify_participants": False,
            },
            notify=False,
        )
        new_start = event.starts_at + timedelta(hours=1)
        new_end = event.ends_at + timedelta(hours=1)
        move_event(event, starts_at=new_start, ends_at=new_end, changed_by=self.teacher, notify=False)
        event.refresh_from_db()
        busy = get_busy_intervals(self.teacher, self.day, self.day, tz=MOSCOW)
        windows = [(item.start.astimezone(MOSCOW).strftime("%H:%M"), item.end.astimezone(MOSCOW).strftime("%H:%M")) for item in busy]
        self.assertIn(("16:30", "18:30"), windows)
        times = self._day_slots()
        self.assertIn("15:00", times)
        self.assertNotIn("16:00", times)
        self.assertNotIn("17:00", times)
        self.assertNotIn("18:00", times)
        self.assertIn("19:00", times)

    def test_deleting_personal_event_frees_travel(self):
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Университет",
                "event_type": "personal",
                "timezone": "Europe/Moscow",
                "starts_at": f"{self.day.isoformat()}T16:00:00",
                "ends_at": f"{self.day.isoformat()}T17:00:00",
                "travel_before_minutes": 30,
                "travel_after_minutes": 30,
                "visibility": "private",
                "notify_participants": False,
            },
            notify=False,
        )
        self.client.force_login(self.teacher)
        deleted = self.client.delete(f"/api/cabinet/schedule/events/local-{event.pk}/delete/")
        self.assertEqual(deleted.status_code, 200, deleted.content)
        times = self._day_slots()
        self.assertIn("15:00", times)
        self.assertIn("16:00", times)

    def test_personal_over_lesson_warns_but_blocks_new_bookings(self):
        lesson = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Урок с Анной",
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "starts_at": f"{self.day.isoformat()}T17:00:00",
                "ends_at": f"{self.day.isoformat()}T18:00:00",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        conflicts = check_conflicts(
            teacher=self.teacher,
            starts_at=lesson.starts_at,
            ends_at=lesson.ends_at,
        )
        self.assertTrue(conflicts)
        self.client.force_login(self.teacher)
        blocked = self.client.post(
            "/api/cabinet/schedule/events/create/",
            {
                "title": "Университет",
                "event_type": "personal",
                "timezone": "Europe/Moscow",
                "starts_at": f"{self.day.isoformat()}T17:00:00",
                "ends_at": f"{self.day.isoformat()}T18:00:00",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.json()["code"], "schedule_conflict")
        lesson.refresh_from_db()
        self.assertEqual(lesson.status, ScheduleEvent.Status.PLANNED)

        forced = self.client.post(
            "/api/cabinet/schedule/events/create/",
            {
                "title": "Университет",
                "event_type": "personal",
                "timezone": "Europe/Moscow",
                "starts_at": f"{self.day.isoformat()}T17:00:00",
                "ends_at": f"{self.day.isoformat()}T18:00:00",
                "notify_participants": False,
                "force": True,
            },
            format="json",
        )
        self.assertEqual(forced.status_code, 201, forced.content)
        times = self._day_slots()
        self.assertNotIn("17:00", times)

    def test_recurring_personal_event_blocks_matching_weekdays(self):
        until = self.day + timedelta(days=21)
        create_series(
            teacher=self.teacher,
            series_data={
                "title": "Университет",
                "event_type": "personal",
                "timezone": "Europe/Moscow",
                "start_date": self.day,
                "start_time": datetime.strptime("16:00", "%H:%M").time(),
                "end_time": datetime.strptime("17:00", "%H:%M").time(),
                "recurrence_type": "weekly",
                "recurrence_until": until,
                "travel_before_minutes": 0,
                "travel_after_minutes": 0,
                "visibility": "private",
                "notify_participants": False,
            },
            notify=False,
        )
        later = self.day + timedelta(days=7)
        later_slots = compute_available_slots(
            teacher=self.teacher,
            date_from=later,
            date_to=later,
        )
        later_times = {slot["start_time"] for slot in later_slots if slot["date"] == later.isoformat()}
        self.assertNotIn("16:00", later_times)
        self.assertIn("15:00", later_times)
        self.assertEqual(
            ScheduleEvent.objects.filter(owner=self.teacher, event_type="personal").count() > 1,
            True,
        )
