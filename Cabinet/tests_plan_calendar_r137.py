from datetime import timedelta
from io import StringIO

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from Cabinet.lesson_lifecycle import materialize_plan_calendar
from Cabinet.models import LessonPlan, LessonPlanEnrollment, LessonPlanItem, Notification, Profile, ScheduleEvent, Student
from Cabinet.plan_schedule import event_local_date
from Cabinet.plan_sync import PlanSyncService
from Cabinet.schedule_service import cancel_event, create_single_event


class PlanCalendarR137Tests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="r137_t", password="x")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(teacher=self.teacher, first_name="Ученик", status="active")
        self.plan = LessonPlan.objects.create(teacher=self.teacher, title="P", status="published")
        self.items = [LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"T{n}", topic=f"T{n}")
                      for n in range(1, 5)]
        LessonPlanEnrollment.objects.create(teacher=self.teacher, plan=self.plan, student=self.student, status="active")
        self.base = timezone.now() + timedelta(days=2)
        self.n0 = Notification.objects.count()

    def _lesson(self, day):
        with self.captureOnCommitCallbacks(execute=True):
            return create_single_event(teacher=self.teacher, data={
                "title": "L", "starts_at": self.base + timedelta(days=day),
                "ends_at": self.base + timedelta(days=day, hours=1), "event_type": "individual_lesson",
                "notify_participants": False,
            }, student_ids=[self.student.pk], notify=False)

    def _item_of(self, ev):
        ev.refresh_from_db()
        return LessonPlanItem.objects.get(pk=ev.lesson_plan_item_id)

    def test_autolink_sets_plan_date(self):
        ev = self._lesson(3)
        item = self._item_of(ev)
        self.assertEqual(item.scheduled_event_id, ev.pk)
        self.assertEqual(item.scheduled_date, event_local_date(ev))

    def test_link_event_to_plan_sets_date(self):
        ev = self._lesson(3)
        other = self.items[3]
        PlanSyncService.link_event_to_plan(ev, other, force=True)
        other.refresh_from_db()
        self.assertEqual(other.scheduled_date, event_local_date(ev))

    def test_plain_save_of_starts_at_syncs_date(self):
        ev = self._lesson(3)
        ev.refresh_from_db()
        ev.starts_at += timedelta(days=5)
        ev.ends_at += timedelta(days=5)
        with self.captureOnCommitCallbacks(execute=True):
            ev.save()
        item = LessonPlanItem.objects.get(scheduled_event_id=ev.pk)
        self.assertEqual(item.scheduled_date, event_local_date(ev))
        self.assertEqual(Notification.objects.count(), self.n0)

    def test_moving_cancelled_lesson_does_not_steal_topic(self):
        a = self._lesson(3)
        item = self._item_of(a)
        b = self._lesson(5)
        ScheduleEvent.objects.filter(pk=b.pk).update(status="cancelled", lesson_plan_item=item)
        b.refresh_from_db()
        b.starts_at += timedelta(days=1)
        b.ends_at += timedelta(days=1)
        b.save()
        item.refresh_from_db()
        self.assertEqual(item.scheduled_event_id, a.pk)
        self.assertEqual(item.scheduled_date, event_local_date(a))

    def test_audit_dry_run_and_apply(self):
        ev = self._lesson(3)
        item = self._item_of(ev)
        LessonPlanItem.objects.filter(pk=item.pk).update(scheduled_date=timezone.localdate() + timedelta(days=40))
        stale = self.items[3]
        cancelled = self._lesson(10)
        ScheduleEvent.objects.filter(pk=cancelled.pk).update(status="cancelled")
        LessonPlanItem.objects.filter(pk=stale.pk).update(scheduled_event=cancelled)
        out = StringIO()
        call_command("plan_calendar_audit", "--dry-run", "--teacher", self.teacher.pk, stdout=out)
        self.assertIn('"date_mismatch": 1', out.getvalue())
        self.assertIn('"linked_to_inactive": 2', out.getvalue())
        item.refresh_from_db()
        self.assertNotEqual(item.scheduled_date, event_local_date(ev))
        call_command("plan_calendar_audit", "--teacher", self.teacher.pk, "--unlink-cancelled", stdout=StringIO())
        item.refresh_from_db()
        stale.refresh_from_db()
        self.assertEqual(item.scheduled_date, event_local_date(ev))
        self.assertIsNone(stale.scheduled_event_id)
        self.assertEqual(Notification.objects.count(), self.n0)

    def test_create_missing_lessons_only_future_without_lesson(self):
        future = self.items[2]
        past = self.items[3]
        LessonPlanItem.objects.filter(pk=future.pk).update(scheduled_date=timezone.localdate() + timedelta(days=9))
        LessonPlanItem.objects.filter(pk=past.pk).update(scheduled_date=timezone.localdate() - timedelta(days=9))
        res = materialize_plan_calendar(self.plan, teacher=self.teacher, only_missing=True)
        self.assertTrue(res["ok"])
        self.assertEqual(len(res["created"]), 1)
        self.assertEqual(ScheduleEvent.objects.get(pk=res["created"][0]).lesson_plan_item_id, future.pk)
        self.assertFalse(ScheduleEvent.objects.filter(lesson_plan_item_id=past.pk).exists())
        self.assertEqual(Notification.objects.count(), self.n0)
