"""P1-08 / P1-09: статусы занятий, timezone, серия, план."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings
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
from Cabinet.plan_sync import PlanSyncService
from Cabinet.plan_schedule import resolve_plan_item_for_event
from Cabinet.schedule_events import schedule_event_to_json
from Cabinet.schedule_service import (
    cancel_event,
    cancel_event_with_scope,
    coerce_schedule_datetime,
    create_series,
    create_single_event,
    events_for_edit_scope,
    move_event,
    move_event_with_scope,
)


class ScheduleSeriesScopeTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="p108_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "timezone"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Аня",
            last_name="Серия",
            status="active",
        )
        start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=2)
        self.series, self.events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Серия P1",
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "start_date": start.date(),
                "start_time": start.time(),
                "end_time": (start + timedelta(minutes=45)).time(),
                "recurrence_type": "weekly",
                "recurrence_count": 3,
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertEqual(len(self.events), 3)

    def test_series_cancel_does_not_touch_completed_or_done(self):
        first, second, third = self.events
        first.status = ScheduleEvent.Status.COMPLETED
        first.save(update_fields=["status"])
        second.status = ScheduleEvent.Status.DONE
        second.save(update_fields=["status"])

        cancel_event_with_scope(third, changed_by=self.teacher, scope="series", notify=False)

        first.refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual(first.status, ScheduleEvent.Status.COMPLETED)
        self.assertEqual(second.status, ScheduleEvent.Status.DONE)
        self.assertEqual(third.status, ScheduleEvent.Status.CANCELLED)
        self.assertEqual(first.starts_at, self.events[0].starts_at)

    def test_following_cancel_skips_past_conducted(self):
        first, second, third = self.events
        first.status = ScheduleEvent.Status.COMPLETED
        first.save(update_fields=["status"])
        cancel_event_with_scope(second, changed_by=self.teacher, scope="following", notify=False)
        first.refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual(first.status, ScheduleEvent.Status.COMPLETED)
        self.assertEqual(second.status, ScheduleEvent.Status.CANCELLED)
        self.assertEqual(third.status, ScheduleEvent.Status.CANCELLED)

    def test_series_move_does_not_move_completed(self):
        first, second, third = self.events
        original = first.starts_at
        first.status = ScheduleEvent.Status.DONE
        first.save(update_fields=["status"])
        delta = timedelta(hours=2)
        move_event_with_scope(
            second,
            starts_at=second.starts_at + delta,
            ends_at=second.ends_at + delta,
            changed_by=self.teacher,
            scope="series",
            notify=False,
        )
        first.refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual(first.status, ScheduleEvent.Status.DONE)
        self.assertEqual(first.starts_at, original)
        self.assertEqual(second.status, ScheduleEvent.Status.MOVED)
        self.assertEqual(third.status, ScheduleEvent.Status.MOVED)
        self.assertEqual(
            list(events_for_edit_scope(second, "series").values_list("id", flat=True)),
            [second.id, third.id],
        )

    def test_this_event_only_cancel_leaves_siblings(self):
        first, second, third = self.events
        cancel_event_with_scope(second, changed_by=self.teacher, scope="single", notify=False)
        first.refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual(first.status, ScheduleEvent.Status.PLANNED)
        self.assertEqual(second.status, ScheduleEvent.Status.CANCELLED)
        self.assertEqual(third.status, ScheduleEvent.Status.PLANNED)

    def test_cancel_retry_is_idempotent(self):
        event = self.events[0]
        cancel_event(event, changed_by=self.teacher, notify=False, plan_cancel_action="shift")
        cancel_event(event, changed_by=self.teacher, notify=False, plan_cancel_action="skip")
        event.refresh_from_db()
        self.assertEqual(event.status, ScheduleEvent.Status.CANCELLED)
        self.assertNotEqual(event.plan_cancel_action, "skip")

    def test_moved_stays_active_not_tombstone(self):
        event = self.events[2]
        old_start = event.starts_at
        move_event(
            event,
            starts_at=event.starts_at + timedelta(days=1),
            ends_at=event.ends_at + timedelta(days=1),
            changed_by=self.teacher,
            notify=False,
        )
        event.refresh_from_db()
        self.assertEqual(event.status, ScheduleEvent.Status.MOVED)
        self.assertEqual(event.original_start_at, old_start)
        self.assertGreater(event.starts_at, old_start)
        upcoming = ScheduleEvent.objects.filter(
            status__in=[ScheduleEvent.Status.PLANNED, ScheduleEvent.Status.MOVED],
            starts_at__gt=timezone.now(),
        )
        self.assertIn(event, upcoming)

    def test_cancelled_not_in_reminder_queryset(self):
        event = self.events[0]
        event.starts_at = timezone.now() + timedelta(hours=1)
        event.ends_at = event.starts_at + timedelta(minutes=45)
        event.save(update_fields=["starts_at", "ends_at"])
        cancel_event(event, changed_by=self.teacher, notify=False)
        reminder_qs = ScheduleEvent.objects.filter(
            status__in=[ScheduleEvent.Status.PLANNED, ScheduleEvent.Status.MOVED],
            starts_at__gt=timezone.now(),
            starts_at__lte=timezone.now() + timedelta(hours=25),
        )
        self.assertNotIn(event, reminder_qs)


class ScheduleTimezoneTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="p108_tz", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "timezone"])

    @override_settings(TIME_ZONE="UTC")
    def test_naive_input_uses_event_timezone_not_server(self):
        naive = "2026-01-15T18:00:00"
        parsed = coerce_schedule_datetime(naive, tz_name="Europe/Moscow")
        self.assertTrue(timezone.is_aware(parsed))
        self.assertEqual(parsed.utcoffset(), timedelta(hours=3))
        self.assertEqual(parsed.hour, 18)
        utc = parsed.astimezone(ZoneInfo("UTC"))
        self.assertEqual(utc.hour, 15)
        serverish = coerce_schedule_datetime(naive, tz_name="UTC")
        self.assertNotEqual(parsed, serverish)

    @override_settings(TIME_ZONE="UTC")
    def test_moscow_create_api(self):
        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            "/api/cabinet/schedule/events/create/",
            {
                "title": "Москва",
                "timezone": "Europe/Moscow",
                "starts_at": "2026-01-15T18:00:00",
                "ends_at": "2026-01-15T18:45:00",
                "event_type": "group_lesson",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        event = ScheduleEvent.objects.get(pk=int(response.json()["event"]["id"].replace("local-", "")))
        self.assertEqual(event.timezone, "Europe/Moscow")
        utc = event.starts_at.astimezone(ZoneInfo("UTC"))
        self.assertEqual(utc.hour, 15)

    @override_settings(TIME_ZONE="UTC")
    def test_istanbul_create_and_iso(self):
        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            "/api/cabinet/schedule/events/create/",
            {
                "title": "Стамбул",
                "timezone": "Europe/Istanbul",
                "starts_at": "2026-07-15T18:00:00",
                "ends_at": "2026-07-15T18:45:00",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        payload = response.json()["event"]
        self.assertIn("+03:00", payload["startsAt"])
        self.assertTrue(payload["startsAt"].startswith("2026-07-15T18:00:00"))
        event = ScheduleEvent.objects.get(pk=int(payload["id"].replace("local-", "")))
        self.assertEqual(event.starts_at.astimezone(ZoneInfo("UTC")).hour, 15)

    @override_settings(TIME_ZONE="UTC")
    def test_berlin_dst_before_and_after(self):
        before = coerce_schedule_datetime("2026-03-28T10:00:00", tz_name="Europe/Berlin")
        after = coerce_schedule_datetime("2026-03-30T10:00:00", tz_name="Europe/Berlin")
        self.assertEqual(before.astimezone(ZoneInfo("UTC")).hour, 9)
        self.assertEqual(after.astimezone(ZoneInfo("UTC")).hour, 8)

    @override_settings(TIME_ZONE="UTC")
    def test_move_keeps_event_timezone(self):
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Перенос TZ",
                "timezone": "Europe/Berlin",
                "starts_at": "2026-03-28T10:00:00",
                "ends_at": "2026-03-28T10:45:00",
                "notify_participants": False,
            },
            notify=False,
        )
        moved = move_event(
            event,
            starts_at="2026-03-30T10:00:00",
            ends_at="2026-03-30T10:45:00",
            changed_by=self.teacher,
            notify=False,
        )
        self.assertEqual(moved.status, ScheduleEvent.Status.MOVED)
        self.assertEqual(moved.starts_at.astimezone(ZoneInfo("UTC")).hour, 8)

    @override_settings(TIME_ZONE="UTC")
    def test_recurring_series_uses_series_timezone(self):
        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            "/api/cabinet/schedule/events/create/",
            {
                "title": "Серия Берлин",
                "timezone": "Europe/Berlin",
                "starts_at": "2026-03-28T10:00:00",
                "ends_at": "2026-03-28T10:45:00",
                "recurrence_type": "weekly",
                "recurrence_count": 2,
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        events = list(ScheduleEvent.objects.filter(title="Серия Берлин").order_by("starts_at"))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].starts_at.astimezone(ZoneInfo("UTC")).hour, 9)
        self.assertEqual(events[1].timezone, "Europe/Berlin")

    def test_aware_iso_is_kept(self):
        parsed = coerce_schedule_datetime("2026-01-15T18:00:00+03:00", tz_name="UTC")
        self.assertEqual(parsed.utcoffset(), timedelta(hours=3))


class LessonPlanCancelAndLinkTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="p109_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Миша",
            last_name="План",
            status="active",
        )
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="План P1-09",
            direction="oge",
            status="published",
        )
        self.items = [
            LessonPlanItem.objects.create(plan=self.plan, order=n, title=title, topic=title)
            for n, title in enumerate(["Тема A", "Тема B", "Тема C"], start=1)
        ]
        self.enrollment = LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=self.plan,
            student=self.student,
            status="active",
        )
        self.base = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)

    def _event(self, day, **kwargs):
        data = {
            "title": self.student.full_name,
            "starts_at": self.base + timedelta(days=day),
            "ends_at": self.base + timedelta(days=day, minutes=45),
            "event_type": "individual_lesson",
            "notify_participants": False,
        }
        data.update(kwargs)
        return create_single_event(
            teacher=self.teacher,
            data=data,
            student_ids=[self.student.pk],
            notify=False,
        )

    def test_drf_cancel_honors_plan_cancel_action_skip(self):
        event = self._event(1)
        item, _ = resolve_plan_item_for_event(event)
        self.assertEqual(item.id, self.items[0].id)
        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/schedule/{event.pk}/cancel/",
            {"plan_cancel_action": "skip", "notify_participants": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.items[0].refresh_from_db()
        self.assertEqual(self.items[0].status, PlanItemStatus.SKIPPED)
        next_item = PlanSyncService.get_next_plan_item(self.enrollment)
        self.assertEqual(next_item.id, self.items[1].id)

    def test_drf_cancel_shift_returns_topic(self):
        event = self._event(1)
        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            f"/api/cabinet/schedule/{event.pk}/cancel/",
            {"plan_cancel_action": "shift", "notify_participants": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.items[0].refresh_from_db()
        self.assertNotEqual(self.items[0].status, PlanItemStatus.SKIPPED)
        next_item = PlanSyncService.get_next_plan_item(self.enrollment)
        self.assertEqual(next_item.id, self.items[0].id)

    def test_complete_retry_does_not_duplicate(self):
        event = self._event(1)
        PlanSyncService.mark_event_completed(event)
        PlanSyncService.mark_event_completed(event)
        event.refresh_from_db()
        self.assertEqual(event.status, ScheduleEvent.Status.COMPLETED)
        self.assertEqual(
            LessonPlanItem.objects.filter(plan=self.plan, status=PlanItemStatus.COMPLETED).count(),
            1,
        )

    def test_does_not_double_assign_plan_item(self):
        first = self._event(1)
        PlanSyncService.link_event_to_plan(first, self.items[0], copy_topic=False)
        first.refresh_from_db()
        second = self._event(8, skip_plan=True)
        PlanSyncService.link_event_to_plan(second, self.items[0], copy_topic=False)
        second.refresh_from_db()
        first.refresh_from_db()
        self.assertEqual(first.lesson_plan_item_id, self.items[0].id)
        self.assertNotEqual(second.lesson_plan_item_id, self.items[0].id)

    def test_series_assigns_distinct_items(self):
        start = self.base
        series, events = create_series(
            teacher=self.teacher,
            series_data={
                "title": self.student.full_name,
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "start_date": start.date(),
                "start_time": start.time(),
                "end_time": (start + timedelta(minutes=45)).time(),
                "recurrence_type": "weekly",
                "recurrence_count": 3,
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        for ev in events:
            ev.refresh_from_db()
        resolved = [resolve_plan_item_for_event(ev)[0] for ev in events]
        self.assertTrue(all(resolved))
        item_ids = [item.id for item in resolved]
        self.assertEqual(item_ids, [self.items[0].id, self.items[1].id, self.items[2].id])

    def test_move_keeps_plan_item(self):
        event = self._event(1)
        PlanSyncService.link_event_to_plan(event, self.items[0], copy_topic=False)
        event.refresh_from_db()
        item_id = event.lesson_plan_item_id
        move_event(
            event,
            starts_at=event.starts_at + timedelta(days=1),
            ends_at=event.ends_at + timedelta(days=1),
            changed_by=self.teacher,
            notify=False,
        )
        event.refresh_from_db()
        self.assertEqual(event.lesson_plan_item_id, item_id)
        self.assertEqual(event.status, ScheduleEvent.Status.MOVED)

    def test_json_iso_uses_event_timezone(self):
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": self.student.full_name,
                "timezone": "Europe/Istanbul",
                "starts_at": "2026-02-01T18:00:00",
                "ends_at": "2026-02-01T18:45:00",
                "event_type": "individual_lesson",
                "notify_participants": False,
                "skip_plan": True,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        payload = schedule_event_to_json(event)
        self.assertTrue(payload["startsAt"].startswith("2026-02-01T18:00:00"))
        self.assertIn("+03:00", payload["startsAt"])


class LessonPlanLinkConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="p109_race", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Кира",
            last_name="Гонка",
            status="active",
        )
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Гонка плана",
            direction="oge",
            status="published",
        )
        self.items = [
            LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"Тема {n}", topic=f"Тема {n}")
            for n in range(1, 4)
        ]
        self.enrollment = LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=self.plan,
            student=self.student,
            status="active",
        )
        base = timezone.now() + timedelta(days=4)
        self.events = [
            create_single_event(
                teacher=self.teacher,
                data={
                    "title": self.student.full_name,
                    "starts_at": base + timedelta(days=n * 7),
                    "ends_at": base + timedelta(days=n * 7, minutes=45),
                    "event_type": "individual_lesson",
                    "notify_participants": False,
                    "skip_plan": True,
                },
                student_ids=[self.student.pk],
                notify=False,
            )
            for n in range(2)
        ]

    def test_parallel_link_next_does_not_share_item(self):
        event_ids = [ev.pk for ev in self.events]

        def worker(event_id):
            close_old_connections()
            event = ScheduleEvent.objects.get(pk=event_id)
            PlanSyncService.link_next_plan_item(event)
            close_old_connections()
            event.refresh_from_db()
            return event.lesson_plan_item_id

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result() for future in as_completed([
                pool.submit(worker, event_ids[0]),
                pool.submit(worker, event_ids[1]),
            ])]

        self.assertTrue(all(results))
        self.assertEqual(len(set(results)), 2)
