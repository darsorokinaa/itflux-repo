from datetime import datetime, timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import PlanItemStatus
from Cabinet.models import (
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Profile,
    ScheduleEvent,
    Student,
)
from Cabinet.plan_weekly_schedule import apply_schedule, build_schedule, normalize_pattern
from Cabinet.schedule_service import cancel_event, move_event

import zoneinfo

MSK = zoneinfo.ZoneInfo("Europe/Moscow")


class PlanWeeklyScheduleTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="ws_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "timezone"])
        self.student = Student.objects.create(teacher=self.teacher, first_name="Таня", status="active")
        self.plan = LessonPlan.objects.create(teacher=self.teacher, title="ЕГЭ", status="published")
        self.items = [
            LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"Тема {n}", topic=f"Тема {n}")
            for n in range(1, 7)
        ]
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher, plan=self.plan, student=self.student, status="active",
        )
        # Понедельник следующей недели
        today = timezone.now().astimezone(MSK).date()
        self.monday = today + timedelta(days=(7 - today.weekday()))
        self.pattern = normalize_pattern({
            "slots": [{"weekday": 0, "time": "18:00"}, {"weekday": 3, "time": "19:30"}],
            "duration_minutes": 60,
            "start_date": self.monday.isoformat(),
        })

    def _events(self):
        return list(ScheduleEvent.objects.filter(owner=self.teacher).order_by("starts_at"))

    def test_preview_writes_nothing_and_orders_topics(self):
        res = build_schedule(self.plan, self.teacher, self.pattern)
        self.assertEqual(res["summary"]["create"], 6)
        self.assertEqual(ScheduleEvent.objects.count(), 0)
        first, second = res["rows"][0], res["rows"][1]
        self.assertEqual(first["topic"], "Тема 1")
        self.assertTrue(first["starts_at"].startswith(f"{self.monday.isoformat()}T18:00"))
        thursday = self.monday + timedelta(days=3)
        self.assertTrue(second["starts_at"].startswith(f"{thursday.isoformat()}T19:30"))

    def test_apply_creates_linked_events_and_is_idempotent(self):
        apply_schedule(self.plan, self.teacher, self.pattern)
        events = self._events()
        self.assertEqual(len(events), 6)
        for ev, item in zip(events, self.items):
            self.assertEqual(ev.lesson_plan_item_id, item.pk)
            self.assertEqual(ev.student_id, self.student.pk)
            self.assertEqual(ev.timezone, "Europe/Moscow")
        again = apply_schedule(self.plan, self.teacher, self.pattern)
        self.assertEqual(again["summary"]["unchanged"], 6)
        self.assertEqual(len(self._events()), 6)

    def test_reschedule_moves_only_untouched_auto_events(self):
        apply_schedule(self.plan, self.teacher, self.pattern)
        events = self._events()
        manual_moved = events[1]
        move_event(manual_moved, starts_at=manual_moved.starts_at + timedelta(hours=2),
                   ends_at=manual_moved.ends_at + timedelta(hours=2), changed_by=self.teacher, notify=False)
        cancelled = events[2]
        cancel_event(cancelled, changed_by=self.teacher, notify=False)
        completed = events[3]
        ScheduleEvent.objects.filter(pk=completed.pk).update(status=ScheduleEvent.Status.COMPLETED)
        snapshot = {ev.pk: (ev.starts_at, ev.status) for ev in ScheduleEvent.objects.filter(
            pk__in=[manual_moved.pk, completed.pk, cancelled.pk])}

        new_pattern = normalize_pattern({**self.pattern, "slots": [{"weekday": 1, "time": "17:00"}]})
        apply_schedule(self.plan, self.teacher, new_pattern)
        for pk, (starts, st) in snapshot.items():
            ev = ScheduleEvent.objects.get(pk=pk)
            self.assertEqual((ev.starts_at, ev.status), (starts, st))
        # Тема отменённого урока получила новое занятие во вторник
        new_for_item = ScheduleEvent.objects.filter(
            lesson_plan_item=cancelled.lesson_plan_item, status=ScheduleEvent.Status.PLANNED,
        ).first()
        self.assertIsNotNone(new_for_item)
        self.assertEqual(new_for_item.starts_at.astimezone(MSK).weekday(), 1)
        self.assertEqual(ScheduleEvent.objects.get(pk=events[0].pk).starts_at.astimezone(MSK).weekday(), 1)

    def test_conflict_slot_is_skipped(self):
        busy_start = timezone.make_aware(datetime.combine(self.monday, datetime.min.time()), MSK) + timedelta(hours=18)
        ScheduleEvent.objects.create(owner=self.teacher, title="Другой", starts_at=busy_start,
                                     ends_at=busy_start + timedelta(hours=1), event_type="individual_lesson",
                                     status="planned")
        res = build_schedule(self.plan, self.teacher, self.pattern)
        self.assertEqual(res["summary"]["skipped_slots"], 1)
        self.assertFalse(res["rows"][0]["starts_at"].startswith(f"{self.monday.isoformat()}T18:00"))
        ignore = build_schedule(self.plan, self.teacher, {**self.pattern, "conflict_mode": "ignore"})
        self.assertTrue(ignore["rows"][0]["conflicts"])

    def test_end_date_and_completed_topics(self):
        LessonPlanItem.objects.filter(pk=self.items[0].pk).update(status=PlanItemStatus.COMPLETED)
        pattern = normalize_pattern({**self.pattern, "end_date": (self.monday + timedelta(days=7)).isoformat(),
                                     "skip_dates": [self.monday.isoformat()]})
        res = build_schedule(self.plan, self.teacher, pattern)
        actions = [r["action"] for r in res["rows"]]
        self.assertEqual(actions[0], "done")
        self.assertEqual(actions.count("create"), 2)  # чт + пн следующей недели
        self.assertIn("no_slot", actions)

    def test_api_preview_and_apply(self):
        client = APIClient()
        client.force_authenticate(self.teacher)
        url = f"/api/cabinet/lesson-plans/{self.plan.pk}/weekly-schedule/"
        got = client.get(url)
        self.assertEqual(got.status_code, 200, got.content)
        self.assertEqual(len(got.json()["enrollments"]), 1)
        pr = client.post(url, {"mode": "preview", "pattern": self.pattern}, format="json")
        self.assertEqual(pr.status_code, 200, pr.content)
        self.assertEqual(ScheduleEvent.objects.count(), 0)
        ap = client.post(url, {"mode": "apply", "pattern": self.pattern}, format="json")
        self.assertEqual(ap.status_code, 200, ap.content)
        self.assertEqual(ScheduleEvent.objects.count(), 6)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.weekly_schedule["pattern"]["slots"][1]["time"], "19:30")
