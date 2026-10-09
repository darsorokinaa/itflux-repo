"""План, календарь и журнал — одна цепочка занятия."""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import PlanItemStatus, PlanStatus
from Cabinet.journal_models import JournalStatus, LessonJournal, StudentLessonRecord
from Cabinet.journal_service import complete_journal, get_or_create_journal
from Cabinet.lesson_lifecycle import (
    LessonLifecycleError,
    materialize_plan_calendar,
    reopen_conducted_lesson,
    restore_event,
    skip_event,
)
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Profile,
    ScheduleEvent,
    ScheduleEventChangeLog,
    ScheduleEventSeries,
    Student,
)
from Cabinet.plan_dates import generate_plan_dates, weekday_label
from Cabinet.plan_schedule import event_local_date
from Cabinet.schedule_service import (
    cancel_event,
    create_series,
    create_single_event,
    move_event,
    move_event_with_scope,
)


class LessonLifecycleTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="life_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "timezone"])
        self.other = User.objects.create_user(username="life_other", password="pass")
        self.other.profile.role = Profile.Role.TEACHER
        self.other.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Иван",
            last_name="Петров",
            status="active",
        )
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Алгебра",
            subject="math",
            status=PlanStatus.PUBLISHED,
        )
        self.items = [
            LessonPlanItem.objects.create(
                plan=self.plan,
                order=index,
                title=f"Урок {index}",
                topic=topic,
                homework_description=f"№ {index}",
            )
            for index, topic in enumerate(
                ["Линейные уравнения", "Квадратные уравнения", "Системы"],
                start=1,
            )
        ]
        self.enrollment = LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=self.plan,
            student=self.student,
            format="individual",
            status="active",
            start_date=date(2026, 10, 5),
        )
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _event(self, item, day, *, hour=16, status="planned"):
        zone = ZoneInfo("Europe/Moscow")
        starts = timezone.make_aware(datetime(day.year, day.month, day.day, hour, 0), zone)
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": item.title,
                "topic": item.topic,
                "homework_description": item.homework_description,
                "starts_at": starts,
                "ends_at": starts + timedelta(minutes=60),
                "event_type": "individual_lesson",
                "lesson_plan_item": item.pk,
                "timezone": "Europe/Moscow",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        event.homework_description = item.homework_description
        event.save(update_fields=["homework_description"])
        if status != "planned":
            event.status = status
            event.save(update_fields=["status", "updated_at"])
        event.refresh_from_db()
        return event

    def test_weekdays_monday_and_wednesday_across_months_and_year(self):
        dates = generate_plan_dates(date(2026, 10, 5), 8, "weekdays", weekdays=[0, 2])
        self.assertEqual(dates[:4], [
            date(2026, 10, 5),
            date(2026, 10, 7),
            date(2026, 10, 12),
            date(2026, 10, 14),
        ])
        self.assertTrue(all(day.weekday() in (0, 2) for day in dates))
        year_cross = generate_plan_dates(date(2026, 12, 28), 3, "weekdays", weekdays=[0])
        self.assertEqual(year_cross, [
            date(2026, 12, 28),
            date(2027, 1, 4),
            date(2027, 1, 11),
        ])
        self.assertEqual(weekday_label(date(2026, 10, 21)), "среда")

    def test_fill_dates_by_weekdays_keeps_existing_until_overwrite(self):
        self.items[0].scheduled_date = date(2026, 9, 1)
        self.items[0].save(update_fields=["scheduled_date"])
        response = self.client.post(
            f"/api/cabinet/lesson-plans/{self.plan.pk}/fill-dates/",
            {"start_date": "2026-10-05", "weekdays": [0, 2]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.items[0].refresh_from_db()
        self.assertEqual(self.items[0].scheduled_date, date(2026, 9, 1))
        overwrite = self.client.post(
            f"/api/cabinet/lesson-plans/{self.plan.pk}/fill-dates/",
            {"start_date": "2026-10-05", "weekdays": [0, 2], "overwrite": True},
            format="json",
        )
        self.assertEqual(overwrite.status_code, 200, overwrite.content)
        dates = list(self.plan.items.order_by("order").values_list("scheduled_date", flat=True))
        self.assertEqual(dates, [date(2026, 10, 5), date(2026, 10, 7), date(2026, 10, 12)])

    def test_repeat_move_keeps_topic_homework_and_single_event(self):
        event = self._event(self.items[0], date(2026, 10, 5))
        homework = Homework.objects.create(
            teacher=self.teacher,
            title="№ 125",
            student=self.student,
            lesson_plan_item=self.items[0],
        )
        event.homework = homework
        event.save(update_fields=["homework"])
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            answer_text="решение",
        )
        first = move_event(
            event,
            starts_at=event.starts_at + timedelta(days=2),
            ends_at=event.ends_at + timedelta(days=2),
            changed_by=self.teacher,
            notify=False,
        )
        second = move_event(
            first,
            starts_at=first.starts_at + timedelta(days=7),
            ends_at=first.ends_at + timedelta(days=7),
            changed_by=self.teacher,
            notify=False,
        )
        second.refresh_from_db()
        self.items[0].refresh_from_db()
        self.items[1].refresh_from_db()
        self.assertEqual(ScheduleEvent.objects.filter(owner=self.teacher).count(), 1)
        self.assertEqual(second.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(second.topic, "Линейные уравнения")
        self.assertEqual(second.homework_id, homework.id)
        self.assertEqual(second.homework_description, "№ 1")
        self.assertEqual(self.items[0].topic, "Линейные уравнения")
        self.assertEqual(self.items[0].homework_description, "№ 1")
        self.assertEqual(self.items[0].scheduled_date, event_local_date(second))
        self.assertEqual(self.items[1].scheduled_date, None)
        self.assertEqual(HomeworkSubmission.objects.get(pk=submission.pk).answer_text, "решение")
        again = move_event(
            second,
            starts_at=second.starts_at,
            ends_at=second.ends_at,
            changed_by=self.teacher,
            notify=False,
        )
        self.assertEqual(again.pk, second.pk)
        self.assertEqual(
            ScheduleEventChangeLog.objects.filter(event=second, change_type="moved").count(),
            2,
        )

    def test_cancel_restore_skip_and_move_skipped(self):
        event = self._event(self.items[0], date(2026, 10, 5))
        cancel_event(event, changed_by=self.teacher, notify=False, reason="болезнь")
        event.refresh_from_db()
        self.assertEqual(event.status, ScheduleEvent.Status.CANCELLED)
        self.assertEqual(event.status_reason, "болезнь")
        restored = restore_event(event, changed_by=self.teacher, reason="")
        self.assertEqual(restored.status, ScheduleEvent.Status.PLANNED)
        self.assertEqual(restored.lesson_plan_item_id, self.items[0].id)
        skipped = skip_event(restored, changed_by=self.teacher, reason="не пришёл")
        self.assertEqual(skipped.status, ScheduleEvent.Status.SKIPPED)
        self.items[0].refresh_from_db()
        self.assertEqual(self.items[0].status, PlanItemStatus.SKIPPED)
        self.assertEqual(self.items[0].homework_description, "№ 1")
        moved = move_event(
            skipped,
            starts_at=skipped.starts_at + timedelta(days=3),
            ends_at=skipped.ends_at + timedelta(days=3),
            changed_by=self.teacher,
            notify=False,
        )
        moved.refresh_from_db()
        self.items[0].refresh_from_db()
        self.assertEqual(moved.status, ScheduleEvent.Status.SKIPPED)
        self.assertEqual(moved.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(self.items[0].status, PlanItemStatus.SKIPPED)
        self.assertEqual(self.items[0].scheduled_date, event_local_date(moved))

    def test_series_change_keeps_conducted_journal_date(self):
        series, events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Алгебра",
                "timezone": "Europe/Moscow",
                "start_date": date(2026, 10, 5),
                "start_time": datetime(2026, 10, 5, 16, 0).time(),
                "end_time": datetime(2026, 10, 5, 17, 0).time(),
                "recurrence_type": "weekly",
                "recurrence_count": 3,
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertEqual(len(events), 3)
        conducted = events[0]
        journal = get_or_create_journal(conducted, self.teacher)
        record = StudentLessonRecord.objects.get(journal=journal, student=self.student)
        record.attendance_status = "present"
        record.overall_score = 5
        record.save(update_fields=["attendance_status", "overall_score", "updated_at"])
        journal.actual_topic = "Разобрали линейные"
        journal.save(update_fields=["actual_topic", "updated_at"])
        complete_journal(journal, self.teacher, force=True)
        journal.refresh_from_db()
        original_date = journal.lesson_date
        conducted_start = conducted.starts_at
        future = events[1]
        future_start = future.starts_at
        move_event_with_scope(
            future,
            starts_at=future.starts_at + timedelta(hours=2),
            ends_at=future.ends_at + timedelta(hours=2),
            changed_by=self.teacher,
            scope="following",
            notify=False,
        )
        conducted.refresh_from_db()
        journal.refresh_from_db()
        record.refresh_from_db()
        self.assertEqual(journal.lesson_date, original_date)
        self.assertEqual(journal.lesson_date, date(2026, 10, 5))
        self.assertEqual(journal.status, JournalStatus.COMPLETED)
        self.assertEqual(record.overall_score, 5)
        self.assertEqual(conducted.starts_at, conducted_start)
        future.refresh_from_db()
        self.assertNotEqual(future.starts_at, future_start)
        self.assertEqual(series.events.exclude(status="cancelled").count(), 3)

    def test_reopen_conducted_keeps_results(self):
        event = self._event(self.items[1], date(2026, 10, 5))
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get(student=self.student)
        record.overall_score = 4
        record.teacher_comment = "хорошо"
        record.attendance_status = "present"
        record.save()
        complete_journal(journal, self.teacher, force=True)
        reopen_conducted_lesson(event, changed_by=self.teacher, reason="ошибочно")
        event.refresh_from_db()
        journal.refresh_from_db()
        record.refresh_from_db()
        self.items[1].refresh_from_db()
        self.assertEqual(event.status, ScheduleEvent.Status.PLANNED)
        self.assertEqual(journal.status, JournalStatus.REOPENED)
        self.assertEqual(record.overall_score, 4)
        self.assertEqual(record.teacher_comment, "хорошо")
        self.assertEqual(self.items[1].topic, "Квадратные уравнения")
        self.assertEqual(LessonJournal.objects.filter(schedule_event=event).count(), 1)

    def test_calendar_patch_updates_plan_date_and_rejects_other_teacher(self):
        event = self._event(self.items[2], date(2026, 10, 12))
        response = self.client.patch(
            f"/api/cabinet/schedule/events/local-{event.pk}/",
            {
                "starts_at": "2026-10-14T16:00:00",
                "ends_at": "2026-10-14T17:00:00",
                "notify_participants": False,
                "expected_updated_at": event.updated_at.isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        event.refresh_from_db()
        self.items[2].refresh_from_db()
        self.assertEqual(self.items[2].scheduled_date, date(2026, 10, 14))
        self.assertEqual(self.items[2].topic, "Системы")
        self.assertEqual(event.lesson_plan_item_id, self.items[2].id)
        other = APIClient()
        other.force_login(self.other)
        denied = other.patch(
            f"/api/cabinet/schedule/events/local-{event.pk}/",
            {"status": "cancelled"},
            format="json",
        )
        self.assertEqual(denied.status_code, 404)
        event.refresh_from_db()
        self.assertNotEqual(event.status, ScheduleEvent.Status.CANCELLED)

    def test_materialize_is_idempotent_and_reports_conflict(self):
        for item, day in zip(self.items, (date(2026, 10, 5), date(2026, 10, 7), date(2026, 10, 12))):
            item.scheduled_date = day
            item.status = PlanItemStatus.PLANNED
            item.save(update_fields=["scheduled_date", "status"])
        self.enrollment.weekday_slots = [
            {"weekday": 0, "start_time": "16:00", "duration_minutes": 60},
            {"weekday": 2, "start_time": "17:30", "duration_minutes": 90},
        ]
        self.enrollment.save(update_fields=["weekday_slots"])
        zone = ZoneInfo("Europe/Moscow")
        busy_start = timezone.make_aware(datetime(2026, 10, 5, 16, 0), zone)
        ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Уже занято",
            starts_at=busy_start,
            ends_at=busy_start + timedelta(minutes=60),
            student=self.student,
            timezone="Europe/Moscow",
            status=ScheduleEvent.Status.PLANNED,
        )
        first = materialize_plan_calendar(self.plan, teacher=self.teacher)
        second = materialize_plan_calendar(self.plan, teacher=self.teacher)
        self.assertTrue(first["ok"])
        self.assertGreaterEqual(len(first["created"]), 1)
        self.assertEqual(second["created"], [])
        self.assertEqual(ScheduleEvent.objects.filter(lesson_plan_item__plan=self.plan).count(), 2)
        self.assertEqual(ScheduleEvent.objects.filter(owner=self.teacher).count(), 3)
        self.assertTrue(any(row["item_id"] == self.items[0].id for row in first["conflicts"]))
        self.items[1].refresh_from_db()
        wednesday = self.items[1].scheduled_event
        self.assertIsNotNone(wednesday)
        local = wednesday.starts_at.astimezone(ZoneInfo("Europe/Moscow"))
        self.assertEqual((local.hour, local.minute), (17, 30))
        self.assertEqual(int((wednesday.ends_at - wednesday.starts_at).total_seconds() // 60), 90)
        self.assertEqual(self.items[1].homework_description, "№ 2")
        wednesday.refresh_from_db()
        self.items[2].refresh_from_db()
        monday = self.items[2].scheduled_event
        self.assertEqual(list(wednesday.series.recurrence_weekdays), [2])
        self.assertEqual(wednesday.series.start_time.hour, 17)
        self.assertEqual(wednesday.series.start_time.minute, 30)
        self.assertEqual(list(monday.series.recurrence_weekdays), [0])
        self.assertNotEqual(monday.series_id, wednesday.series_id)

    @override_settings(TIME_ZONE="UTC")
    def test_weekday_uses_event_timezone_across_midnight(self):
        starts = datetime(2026, 1, 15, 0, 30, tzinfo=ZoneInfo("Europe/Berlin"))
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Полночь",
            starts_at=starts,
            ends_at=starts + timedelta(minutes=60),
            timezone="Europe/Berlin",
            status=ScheduleEvent.Status.PLANNED,
        )
        event.refresh_from_db()
        self.assertEqual(event.starts_at.astimezone(ZoneInfo("UTC")).date(), date(2026, 1, 14))
        self.assertEqual(event_local_date(event), date(2026, 1, 15))
        self.assertEqual(weekday_label(event_local_date(event)), "четверг")

    def test_filling_dates_does_not_move_topics(self):
        from Cabinet.plan_dates import apply_plan_item_dates

        first = self._event(self.items[0], date(2026, 10, 5))
        second = self._event(self.items[1], date(2026, 10, 7))
        apply_plan_item_dates(self.plan, date(2026, 11, 2), "weekly")
        first.refresh_from_db()
        second.refresh_from_db()
        self.items[0].refresh_from_db()
        self.items[1].refresh_from_db()
        self.assertEqual(first.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(second.lesson_plan_item_id, self.items[1].id)
        self.assertEqual(first.topic, "Линейные уравнения")
        self.assertEqual(second.topic, "Квадратные уравнения")
        self.assertEqual(first.homework_description, "№ 1")
        self.assertEqual(self.items[0].homework_description, "№ 1")

    def test_series_time_change_skips_individual_date_exception(self):
        series, events = create_series(
            teacher=self.teacher,
            series_data={
                "title": "Серия",
                "timezone": "Europe/Moscow",
                "start_date": date(2026, 10, 5),
                "start_time": datetime(2026, 10, 5, 16, 0).time(),
                "end_time": datetime(2026, 10, 5, 17, 0).time(),
                "recurrence_type": "weekly",
                "recurrence_count": 3,
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        exception = events[1]
        moved = move_event_with_scope(
            exception,
            starts_at=exception.starts_at + timedelta(days=1),
            ends_at=exception.ends_at + timedelta(days=1),
            changed_by=self.teacher,
            scope="single",
            notify=False,
        )
        exception_start = moved.starts_at
        anchor = events[0]
        move_event_with_scope(
            anchor,
            starts_at=anchor.starts_at + timedelta(hours=1),
            ends_at=anchor.ends_at + timedelta(hours=1),
            changed_by=self.teacher,
            scope="following",
            notify=False,
        )
        moved.refresh_from_db()
        anchor.refresh_from_db()
        events[2].refresh_from_db()
        self.assertEqual(moved.starts_at, exception_start)
        self.assertEqual(moved.starts_at.astimezone(ZoneInfo("Europe/Moscow")).hour, 16)
        self.assertEqual(anchor.starts_at.astimezone(ZoneInfo("Europe/Moscow")).hour, 17)
        self.assertEqual(events[2].starts_at.astimezone(ZoneInfo("Europe/Moscow")).hour, 17)
        self.assertEqual(series.events.count(), 3)

    def test_stale_calendar_write_returns_saved_event(self):
        event = self._event(self.items[0], date(2026, 10, 5))
        stale = (event.updated_at - timedelta(minutes=5)).isoformat()
        response = self.client.patch(
            f"/api/cabinet/schedule/events/local-{event.pk}/",
            {
                "starts_at": "2026-10-06T16:00:00",
                "ends_at": "2026-10-06T17:00:00",
                "expected_updated_at": stale,
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "stale_write")
        self.assertIn("event", response.json())
        event.refresh_from_db()
        self.assertEqual(event_local_date(event), date(2026, 10, 5))
        self.assertEqual(event.lesson_plan_item_id, self.items[0].id)

    def test_calendar_patch_without_version_is_rejected(self):
        event = self._event(self.items[0], date(2026, 10, 5))
        response = self.client.patch(
            f"/api/cabinet/schedule/events/local-{event.pk}/",
            {
                "starts_at": "2026-10-06T16:00:00",
                "ends_at": "2026-10-06T17:00:00",
                "notify_participants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "stale_write")
        event.refresh_from_db()
        self.assertEqual(event_local_date(event), date(2026, 10, 5))

    def test_cancel_frees_slot_and_restore_detects_new_lesson(self):
        from Cabinet.lesson_lifecycle import LessonLifecycleError
        from Cabinet.schedule_service import check_conflicts

        day = date(2026, 10, 20)
        original = self._event(self.items[0], day)
        topic = original.topic
        homework = original.homework_description
        item_id = original.lesson_plan_item_id
        cancel_event(original, changed_by=self.teacher, notify=False, plan_cancel_action="keep")
        original.refresh_from_db()
        self.assertEqual(original.status, ScheduleEvent.Status.CANCELLED)
        self.assertEqual(LessonJournal.objects.filter(schedule_event=original).count(), 0)
        self.assertEqual(check_conflicts(
            teacher=self.teacher,
            starts_at=original.starts_at,
            ends_at=original.ends_at,
            student_id=self.student.pk,
            exclude_event_id=original.pk,
        ), [])

        other = Student.objects.create(
            teacher=self.teacher,
            first_name="Мария",
            last_name="Свободная",
            status="active",
        )
        replacement = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Новый урок",
                "topic": "Другая тема",
                "homework_description": "Другое задание",
                "starts_at": original.starts_at,
                "ends_at": original.ends_at,
                "event_type": "individual_lesson",
                "timezone": "Europe/Moscow",
                "notify_participants": False,
            },
            student_ids=[other.pk],
            notify=False,
        )
        self.assertNotEqual(replacement.pk, original.pk)
        self.assertEqual(replacement.topic, "Другая тема")
        self.assertNotEqual(replacement.lesson_plan_item_id, item_id)
        self.assertFalse(LessonJournal.objects.filter(schedule_event=replacement).exists())

        with self.assertRaises(LessonLifecycleError) as caught:
            restore_event(original, changed_by=self.teacher)
        self.assertEqual(caught.exception.code, "schedule_conflict")
        original.refresh_from_db()
        replacement.refresh_from_db()
        self.assertEqual(original.status, ScheduleEvent.Status.CANCELLED)
        self.assertEqual(original.topic, topic)
        self.assertEqual(original.homework_description, homework)
        self.assertEqual(original.lesson_plan_item_id, item_id)
        self.assertEqual(replacement.topic, "Другая тема")
        self.assertEqual(replacement.starts_at, original.starts_at)

        moved = move_event(
            original,
            starts_at=original.starts_at + timedelta(days=1),
            ends_at=original.ends_at + timedelta(days=1),
            changed_by=self.teacher,
            notify=False,
        )
        self.assertEqual(moved.pk, original.pk)
        self.assertEqual(moved.status, ScheduleEvent.Status.CANCELLED)
        restored = restore_event(moved, changed_by=self.teacher)
        restored.refresh_from_db()
        replacement.refresh_from_db()
        self.assertEqual(restored.pk, original.pk)
        self.assertEqual(restored.status, ScheduleEvent.Status.PLANNED)
        self.assertEqual(restored.topic, topic)
        self.assertEqual(restored.homework_description, homework)
        self.assertEqual(restored.lesson_plan_item_id, item_id)
        self.assertEqual(replacement.status, ScheduleEvent.Status.PLANNED)
        self.assertEqual(replacement.topic, "Другая тема")
        self.assertEqual(LessonJournal.objects.filter(schedule_event=restored).count(), 0)

        skipped = self._event(self.items[1], date(2026, 10, 22))
        skip_event(skipped, changed_by=self.teacher)
        skipped.refresh_from_db()
        self.assertEqual(check_conflicts(
            teacher=self.teacher,
            starts_at=skipped.starts_at,
            ends_at=skipped.ends_at,
            exclude_event_id=skipped.pk,
        ), [])

    def test_restore_with_new_time_is_one_transaction(self):
        day = date(2026, 10, 20)
        original = self._event(self.items[0], day)
        journal = get_or_create_journal(original, self.teacher)
        record = StudentLessonRecord.objects.get(journal=journal, student=self.student)
        record.overall_score = 4
        record.save(update_fields=["overall_score", "updated_at"])
        cancel_event(original, changed_by=self.teacher, notify=False, plan_cancel_action="keep")
        original.refresh_from_db()
        taken_start = original.starts_at + timedelta(days=2)
        taken_end = original.ends_at + timedelta(days=2)
        blocker = self._event(self.items[1], date(2026, 10, 22))
        blocker.starts_at = taken_start
        blocker.ends_at = taken_end
        blocker.save(update_fields=["starts_at", "ends_at", "updated_at"])
        before_start = original.starts_at
        with self.assertRaises(LessonLifecycleError) as caught:
            restore_event(
                original,
                changed_by=self.teacher,
                starts_at=taken_start,
                ends_at=taken_end,
            )
        self.assertEqual(caught.exception.code, "schedule_conflict")
        original.refresh_from_db()
        self.assertEqual(original.status, ScheduleEvent.Status.CANCELLED)
        self.assertEqual(original.starts_at, before_start)
        self.assertEqual(original.lesson_plan_item_id, self.items[0].id)
        free_start = original.starts_at + timedelta(days=3)
        free_end = original.ends_at + timedelta(days=3)
        restored = restore_event(
            original,
            changed_by=self.teacher,
            starts_at=free_start,
            ends_at=free_end,
        )
        restored.refresh_from_db()
        self.items[0].refresh_from_db()
        record.refresh_from_db()
        self.assertEqual(restored.pk, original.pk)
        self.assertEqual(restored.status, ScheduleEvent.Status.PLANNED)
        self.assertEqual(restored.starts_at, free_start)
        self.assertEqual(restored.topic, "Линейные уравнения")
        self.assertEqual(restored.homework_description, "№ 1")
        self.assertEqual(restored.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(self.items[0].scheduled_event_id, restored.pk)
        self.assertEqual(record.overall_score, 4)
        self.assertEqual(LessonJournal.objects.filter(schedule_event=restored).count(), 1)

    def test_diagnose_reports_split_link_without_rewriting(self):
        from Cabinet.lesson_lifecycle import diagnose_plan_calendar_links

        first = self._event(self.items[0], date(2026, 10, 5))
        second = self._event(self.items[1], date(2026, 10, 7))
        self.items[0].scheduled_event = second
        self.items[0].save(update_fields=["scheduled_event", "updated_at"])
        before = ScheduleEvent.objects.count()
        report = diagnose_plan_calendar_links(plan_id=self.plan.pk)
        self.items[0].refresh_from_db()
        first.refresh_from_db()
        self.assertEqual(ScheduleEvent.objects.count(), before)
        self.assertTrue(any(row["code"] == "split_link" for row in report["issues"]))
        self.assertEqual(first.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(self.items[0].scheduled_event_id, second.pk)
        self.assertEqual(first.topic, "Линейные уравнения")

    def test_topic_order_preview_does_not_change_links(self):
        first = self._event(self.items[0], date(2026, 10, 5))
        second = self._event(self.items[1], date(2026, 10, 7))
        response = self.client.post(
            "/api/cabinet/lesson-plan-items/reorder/",
            {
                "preview": True,
                "items": [
                    {"id": self.items[0].pk, "order": 2},
                    {"id": self.items[1].pk, "order": 1},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.items[0].refresh_from_db()
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(self.items[0].order, 1)
        self.assertEqual(first.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(second.lesson_plan_item_id, self.items[1].id)
        self.assertEqual(first.topic, "Линейные уравнения")
        preview = {row["id"]: row for row in response.json()["preview"]}
        self.assertEqual(preview[self.items[0].pk]["event_id"], first.pk)
        self.assertEqual(preview[self.items[0].pk]["order"], 2)

    def test_free_events_receive_topics_in_order_without_duplicates(self):
        from Cabinet.plan_sync import PlanSyncService

        zone = ZoneInfo("Europe/Moscow")
        start_day = timezone.localdate() + timedelta(days=2)
        events = []
        for offset, hour in ((0, 16), (2, 17), (7, 16)):
            day = start_day + timedelta(days=offset)
            starts = timezone.make_aware(datetime(day.year, day.month, day.day, hour, 0), zone)
            events.append(ScheduleEvent.objects.create(
                owner=self.teacher,
                title="Свободное",
                starts_at=starts,
                ends_at=starts + timedelta(minutes=60),
                student=self.student,
                timezone="Europe/Moscow",
                status=ScheduleEvent.Status.PLANNED,
                event_type="individual_lesson",
            ))
        PlanSyncService.realign_enrollment_topics(self.enrollment)
        PlanSyncService.realign_enrollment_topics(self.enrollment)
        for event in events:
            event.refresh_from_db()
        linked = [event.lesson_plan_item_id for event in events]
        self.assertEqual(linked, [self.items[0].id, self.items[1].id, self.items[2].id])
        self.assertEqual(len(set(linked)), 3)
        self.assertEqual(events[0].topic, "Линейные уравнения")
        self.assertEqual(events[1].topic, "Квадратные уравнения")
        self.assertEqual(ScheduleEvent.objects.filter(lesson_plan_item_id=self.items[0].id).count(), 1)
        self.assertEqual(ScheduleEvent.objects.filter(owner=self.teacher).count(), 3)

    def test_weekday_series_edit_keeps_other_day_exception_and_journal(self):
        extra = LessonPlanItem.objects.create(
            plan=self.plan,
            order=4,
            title="Дроби",
            topic="Дроби",
            homework_description="№ 4",
            scheduled_date=date(2026, 10, 14),
            status=PlanItemStatus.PLANNED,
        )
        for item, day in zip(
            self.items,
            (date(2026, 10, 5), date(2026, 10, 7), date(2026, 10, 12)),
        ):
            item.scheduled_date = day
            item.status = PlanItemStatus.PLANNED
            item.homework_description = f"ДЗ {item.order}"
            item.save(update_fields=["scheduled_date", "status", "homework_description"])
        self.enrollment.weekday_slots = [
            {"weekday": 0, "start_time": "16:00", "duration_minutes": 60},
            {"weekday": 2, "start_time": "17:30", "duration_minutes": 90},
        ]
        self.enrollment.save(update_fields=["weekday_slots"])
        created = materialize_plan_calendar(self.plan, teacher=self.teacher)
        self.assertEqual(len(created["created"]), 4, created)
        self.items[1].refresh_from_db()
        wednesday = self.items[1].scheduled_event
        journal = get_or_create_journal(wednesday, self.teacher)
        record = journal.student_records.get(student=self.student)
        record.attendance_status = "present"
        record.overall_score = 5
        record.save(update_fields=["attendance_status", "overall_score", "updated_at"])
        complete_journal(journal, self.teacher, force=True)
        journal.refresh_from_db()
        conducted_date = journal.lesson_date
        homework = Homework.objects.create(
            teacher=self.teacher,
            title="Квадратные",
            student=self.student,
            lesson_plan_item=self.items[1],
        )
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            answer_text="x=2",
            score=5,
        )
        self.items[2].refresh_from_db()
        moved = move_event(
            self.items[2].scheduled_event,
            starts_at=self.items[2].scheduled_event.starts_at + timedelta(days=1),
            ends_at=self.items[2].scheduled_event.ends_at + timedelta(days=1),
            changed_by=self.teacher,
            notify=False,
            as_exception=True,
        )
        moved_start = moved.starts_at
        self.enrollment.weekday_slots = [
            {"weekday": 0, "start_time": "18:00", "duration_minutes": 45},
            {"weekday": 2, "start_time": "17:30", "duration_minutes": 90},
        ]
        self.enrollment.save(update_fields=["weekday_slots"])
        materialize_plan_calendar(self.plan, teacher=self.teacher, slots=self.enrollment.weekday_slots)
        self.items[0].refresh_from_db()
        self.items[1].refresh_from_db()
        moved.refresh_from_db()
        wednesday.refresh_from_db()
        journal.refresh_from_db()
        record.refresh_from_db()
        submission.refresh_from_db()
        monday = self.items[0].scheduled_event
        monday_local = monday.starts_at.astimezone(ZoneInfo("Europe/Moscow"))
        wednesday_local = wednesday.starts_at.astimezone(ZoneInfo("Europe/Moscow"))
        self.assertEqual((monday_local.hour, monday_local.minute), (18, 0))
        self.assertEqual(int((monday.ends_at - monday.starts_at).total_seconds() // 60), 45)
        self.assertEqual((wednesday_local.hour, wednesday_local.minute), (17, 30))
        self.assertEqual(moved.starts_at, moved_start)
        self.assertEqual(journal.lesson_date, conducted_date)
        self.assertEqual(record.overall_score, 5)
        self.assertEqual(record.attendance_status, "present")
        self.assertEqual(submission.answer_text, "x=2")
        self.assertEqual(submission.score, 5)
        self.assertEqual(self.items[1].topic, "Квадратные уравнения")
        self.assertEqual(wednesday.lesson_plan_item_id, self.items[1].id)
        self.assertNotEqual(monday.series_id, wednesday.series_id)
        self.enrollment.weekday_slots = [
            {"weekday": 0, "start_time": "18:15", "duration_minutes": 50},
            {"weekday": 2, "start_time": "19:00", "duration_minutes": 30},
        ]
        self.enrollment.save(update_fields=["weekday_slots"])
        materialize_plan_calendar(self.plan, teacher=self.teacher, slots=self.enrollment.weekday_slots)
        monday.refresh_from_db()
        wednesday.refresh_from_db()
        moved.refresh_from_db()
        extra.refresh_from_db()
        journal.refresh_from_db()
        record.refresh_from_db()
        later = extra.scheduled_event
        later_local = later.starts_at.astimezone(ZoneInfo("Europe/Moscow"))
        monday_local = monday.starts_at.astimezone(ZoneInfo("Europe/Moscow"))
        wednesday_local = wednesday.starts_at.astimezone(ZoneInfo("Europe/Moscow"))
        self.assertEqual((monday_local.hour, monday_local.minute), (18, 15))
        self.assertEqual((later_local.hour, later_local.minute), (19, 0))
        self.assertEqual(int((later.ends_at - later.starts_at).total_seconds() // 60), 30)
        self.assertEqual((wednesday_local.hour, wednesday_local.minute), (17, 30))
        self.assertEqual(moved.starts_at, moved_start)
        self.assertEqual(journal.lesson_date, conducted_date)
        self.assertEqual(record.overall_score, 5)
        self.assertEqual(later.lesson_plan_item_id, extra.id)
        self.assertEqual(later.topic, "Дроби")
