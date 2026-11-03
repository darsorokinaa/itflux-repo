"""r140: даты плана не ломают календарь — без переноса в прошлое и без смены времени по слоту."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.test import TestCase
from django.utils import timezone

from Cabinet.lesson_lifecycle import materialize_plan_calendar, sync_plan_item_date_to_event
from Cabinet.models import ScheduleEvent
from Cabinet.plan_schedule import event_local_date
from Cabinet.schedule_service import create_single_event
from Cabinet import tests_lesson_lifecycle as _ll

MSK = ZoneInfo("Europe/Moscow")


class PlanCalendarR140Tests(TestCase):
    setUp = _ll.LessonLifecycleTests.setUp
    _event = _ll.LessonLifecycleTests._event

    def _link(self, item, event, day):
        item.scheduled_event = event
        item.scheduled_date = day
        item.save(update_fields=["scheduled_event", "scheduled_date"])

    def test_past_plan_date_does_not_drag_future_lesson_back(self):
        future = timezone.localdate() + timedelta(days=20)
        event = self._event(self.items[0], future, hour=17)
        self._link(self.items[0], event, future)
        self.items[0].scheduled_date = timezone.localdate() - timedelta(days=10)
        result = sync_plan_item_date_to_event(self.items[0], changed_by=self.teacher)
        self.assertFalse(result["moved"])
        self.assertEqual(result["code"], "past_kept")
        event.refresh_from_db()
        self.assertEqual(event_local_date(event), future)

    def test_materialize_keeps_lesson_time_and_skips_conflicting_default_slot(self):
        today = timezone.localdate()
        old_day = today + timedelta(days=30)
        new_day = today + timedelta(days=9)
        event = self._event(self.items[0], old_day, hour=17)
        self._link(self.items[0], event, old_day)
        # другой урок преподавателя в слот по умолчанию 16:00 на новую дату
        busy = timezone.make_aware(datetime.combine(new_day, datetime.min.time()).replace(hour=16), MSK)
        ScheduleEvent.objects.create(
            owner=self.teacher, title="Другой", starts_at=busy, ends_at=busy + timedelta(hours=1),
            status=ScheduleEvent.Status.PLANNED, timezone="Europe/Moscow",
        )
        self.enrollment.weekday_slots = [{"weekday": new_day.weekday(), "start_time": "16:00", "duration_minutes": 60}]
        self.enrollment.save(update_fields=["weekday_slots"])
        type(self.items[0]).objects.filter(pk=self.items[0].pk).update(scheduled_date=new_day)
        result = materialize_plan_calendar(self.plan, teacher=self.teacher, notify=False)
        self.assertEqual(result["conflicts"], [])
        event.refresh_from_db()
        local = event.starts_at.astimezone(MSK)
        self.assertEqual(local.date(), new_day)
        self.assertEqual(local.hour, 17)

    def test_materialize_does_not_move_future_lesson_into_past(self):
        future = timezone.localdate() + timedelta(days=15)
        event = self._event(self.items[0], future, hour=17)
        self._link(self.items[0], event, future)
        type(self.items[0]).objects.filter(pk=self.items[0].pk).update(
            scheduled_date=timezone.localdate() - timedelta(days=7),
        )
        result = materialize_plan_calendar(self.plan, teacher=self.teacher, notify=False)
        self.assertIn(event.pk, result["kept"])
        event.refresh_from_db()
        self.assertEqual(event_local_date(event), future)
