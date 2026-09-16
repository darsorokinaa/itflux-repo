"""Учитель вводит время урока в своём поясе, ученик видит его в своём."""

from datetime import datetime
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from Cabinet.models import Profile, ScheduleEvent, Student


class StudentLessonTimezoneTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="tz_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "timezone"])

        self.student_user = User.objects.create_user(username="tz_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.timezone = "Asia/Yekaterinburg"
        self.student_user.profile.save(update_fields=["role", "timezone"])

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Аня",
            last_name="Ученица",
            status="active",
        )
        moscow = ZoneInfo("Europe/Moscow")
        self.starts = datetime(2026, 9, 16, 15, 0, tzinfo=moscow)
        self.ends = datetime(2026, 9, 16, 15, 45, tzinfo=moscow)
        self.event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Информатика",
            topic="Кодирование",
            starts_at=self.starts,
            ends_at=self.ends,
            event_type="individual_lesson",
            student=self.student,
            timezone="Europe/Moscow",
            status=ScheduleEvent.Status.PLANNED,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.student_user)

    def test_schedule_detail_uses_student_timezone(self):
        response = self.client.get(f"/api/cabinet/student/schedule/{self.event.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["startTime"], "17:00")
        self.assertEqual(data["endTime"], "17:45")
        self.assertEqual(data["viewer_timezone"], "Asia/Yekaterinburg")
        self.assertEqual(data["viewer_timezone_label"], "Екатеринбург")

    def test_schedule_list_includes_viewer_timezone(self):
        response = self.client.get("/api/cabinet/student/schedule/")
        self.assertEqual(response.status_code, 200, response.content)
        items = response.json()["items"]
        self.assertTrue(items)
        self.assertEqual(items[0]["viewer_timezone"], "Asia/Yekaterinburg")

    def test_profile_returns_and_updates_timezone(self):
        got = self.client.get("/api/cabinet/student/profile/")
        self.assertEqual(got.status_code, 200, got.content)
        self.assertEqual(got.json()["timezone"], "Asia/Yekaterinburg")

        patched = self.client.patch(
            "/api/cabinet/student/profile/",
            {"timezone": "Asia/Vladivostok"},
            format="json",
        )
        self.assertEqual(patched.status_code, 200, patched.content)
        self.assertEqual(patched.json()["timezone"], "Asia/Vladivostok")
        self.student_user.profile.refresh_from_db()
        self.assertEqual(self.student_user.profile.timezone, "Asia/Vladivostok")

        bad = self.client.patch(
            "/api/cabinet/student/profile/",
            {"timezone": "Not/AZone"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)

    def test_teacher_student_list_includes_timezone(self):
        teacher_client = APIClient()
        teacher_client.force_authenticate(user=self.teacher)
        response = teacher_client.get("/api/cabinet/students/?status=active")
        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json()
        by_id = {row["id"]: row for row in rows}
        self.assertEqual(by_id[self.student.id]["timezone"], "Asia/Yekaterinburg")
        self.assertEqual(by_id[self.student.id]["timezone_label"], "Екатеринбург")
