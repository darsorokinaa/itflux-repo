from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from Cabinet.choices import PlanItemStatus
from Cabinet.journal_models import LessonJournal
from Cabinet.models import (
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Profile,
    ScheduleEvent,
    Student,
)
from Cabinet.plan_sync import PlanSyncService
from Cabinet.schedule_events import schedule_event_to_json
from Cabinet.schedule_service import cancel_event_with_scope, create_single_event, move_event


class PlanLifecycleTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="pl_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Миша",
            last_name="Ученик",
            status="active",
        )
        self.plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Информатика 9",
            direction="oge",
            status="published",
        )
        self.items = [
            LessonPlanItem.objects.create(
                plan=self.plan, order=n, title=title, topic=title,
            )
            for n, title in enumerate(
                [
                    "Информация и информационные процессы",
                    "Кодирование информации",
                    "Системы счисления",
                    "Логика",
                    "Алгоритмы",
                ],
                start=1,
            )
        ]
        self.enrollment = LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=self.plan,
            student=self.student,
            status="active",
        )
        self.base = timezone.now().replace(hour=15, minute=0, second=0, microsecond=0)

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

    def test_complete_advances_plan_and_does_not_repeat_topic(self):
        e1 = self._event(1)
        e2 = self._event(8)
        PlanSyncService.mark_event_completed(e1)
        self.items[0].refresh_from_db()
        self.items[1].refresh_from_db()
        self.assertEqual(self.items[0].status, PlanItemStatus.COMPLETED)
        self.assertNotEqual(self.items[1].status, PlanItemStatus.COMPLETED)
        next_item = PlanSyncService.get_next_plan_item(self.enrollment)
        self.assertEqual(next_item.id, self.items[2].id)

        payload2 = schedule_event_to_json(e2)
        self.assertEqual(payload2["planItem"]["id"], self.items[1].id)
        self.assertNotEqual(payload2["planItem"]["id"], self.items[0].id)

        PlanSyncService.mark_event_completed(e1)
        self.assertEqual(
            LessonPlanItem.objects.filter(plan=self.plan, status=PlanItemStatus.COMPLETED).count(),
            1,
        )
        self.assertEqual(LessonJournal.objects.filter(schedule_event=e1).count(), 1)

    def test_reschedule_does_not_complete_plan_item(self):
        event = self._event(1, lesson_plan_item=self.items[0].id)
        move_event(
            event,
            starts_at=event.starts_at + timedelta(days=1),
            ends_at=event.ends_at + timedelta(days=1),
            changed_by=self.teacher,
            notify=False,
        )
        self.items[0].refresh_from_db()
        self.assertNotEqual(self.items[0].status, PlanItemStatus.COMPLETED)
        event.refresh_from_db()
        self.assertEqual(event.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(event.status, ScheduleEvent.Status.MOVED)

    def test_cancel_does_not_complete_and_allows_reschedule(self):
        event = self._event(1, lesson_plan_item=self.items[0].id)
        cancel_event_with_scope(
            event, changed_by=self.teacher, notify=False, plan_cancel_action="shift"
        )
        self.items[0].refresh_from_db()
        self.assertNotEqual(self.items[0].status, PlanItemStatus.COMPLETED)
        next_item = PlanSyncService.get_next_plan_item(self.enrollment)
        self.assertEqual(next_item.id, self.items[0].id)

    def test_unplanned_lesson_does_not_break_sequence(self):
        planned = self._event(1)
        extra = self._event(2, skip_plan=True, topic="Разбор пробника")
        PlanSyncService.mark_event_completed(extra)
        self.items[0].refresh_from_db()
        self.assertNotEqual(self.items[0].status, PlanItemStatus.COMPLETED)
        next_item = PlanSyncService.get_next_plan_item(self.enrollment)
        self.assertEqual(next_item.id, self.items[1].id)
        payload = schedule_event_to_json(planned)
        self.assertEqual(payload["planItem"]["id"], self.items[0].id)

    def test_actual_topic_does_not_overwrite_plan(self):
        event = self._event(1, lesson_plan_item=self.items[2].id, topic="Системы счисления. Перевод")
        PlanSyncService.mark_event_completed(event)
        self.items[2].refresh_from_db()
        self.assertEqual(self.items[2].topic, "Системы счисления")
        journal = LessonJournal.objects.get(schedule_event=event)
        self.assertEqual(journal.planned_topic, "Системы счисления")
        self.assertEqual(journal.actual_topic, "Системы счисления. Перевод")

    def test_double_complete_does_not_duplicate_journal(self):
        event = self._event(1, lesson_plan_item=self.items[0].id)
        PlanSyncService.mark_event_completed(event)
        PlanSyncService.mark_event_completed(event)
        self.assertEqual(LessonJournal.objects.filter(schedule_event=event).count(), 1)
        self.assertEqual(
            LessonPlanItem.objects.filter(plan=self.plan, status=PlanItemStatus.COMPLETED).count(),
            1,
        )

    def test_plan_does_not_restart_after_last_item(self):
        for index, item in enumerate(self.items):
            event = self._event(index + 1)
            self.assertEqual(event.lesson_plan_item_id, item.id)
            PlanSyncService.mark_event_completed(event)
        extra = self._event(20)
        extra.refresh_from_db()
        self.assertIsNone(extra.lesson_plan_item_id)
        self.assertNotEqual((extra.topic or "").strip(), self.items[0].topic)
        next_item = PlanSyncService.get_next_plan_item(self.enrollment)
        self.assertIsNone(next_item)

    def test_same_titles_sync_by_id_not_text(self):
        from Cabinet.lesson_plan_content_sync import LessonLearningPlanSyncService

        self.items[0].topic = "Повторение"
        self.items[0].title = "Повторение"
        self.items[0].save(update_fields=["topic", "title"])
        self.items[1].topic = "Повторение"
        self.items[1].title = "Повторение"
        self.items[1].save(update_fields=["topic", "title"])
        e1 = self._event(1)
        e2 = self._event(2)
        self.assertEqual(e1.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(e2.lesson_plan_item_id, self.items[1].id)
        LessonLearningPlanSyncService.apply_lesson_edit(
            e1, {"topic": "Повторение: кодирование"}, teacher=self.teacher,
            sync_action="lesson_and_plan",
        )
        self.items[0].refresh_from_db()
        self.items[1].refresh_from_db()
        e2.refresh_from_db()
        self.assertEqual(self.items[0].topic, "Повторение: кодирование")
        self.assertEqual(self.items[1].topic, "Повторение")
        self.assertEqual(e2.topic, "Повторение")

    def test_edit_plan_item_updates_linked_future_event(self):
        from Cabinet.lesson_plan_content_sync import LessonLearningPlanSyncService

        event = self._event(3)
        self.assertEqual(event.lesson_plan_item_id, self.items[0].id)
        self.items[0].topic = "Теорема Виета"
        self.items[0].save(update_fields=["topic", "updated_at"])
        LessonLearningPlanSyncService.sync_plan_item_to_lessons(
            self.items[0], teacher=self.teacher, update_source="plan",
        )
        event.refresh_from_db()
        self.assertEqual(event.topic, "Теорема Виета")

    def test_duplicate_enrollment_is_rejected(self):
        from rest_framework.test import APIClient

        client = APIClient()
        client.force_login(self.teacher)
        response = client.post(
            "/api/cabinet/lesson-plan-enrollments/",
            {"plan": self.plan.pk, "student": self.student.pk, "format": "individual"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data.get("id"), self.enrollment.pk)
        self.assertEqual(
            LessonPlanEnrollment.objects.filter(
                teacher=self.teacher, student=self.student, status="active",
            ).count(),
            1,
        )

    def test_progress_warns_before_plan_ends(self):
        progress = PlanSyncService.get_enrollment_progress(self.enrollment)
        self.assertEqual(progress["remaining"], 5)
        self.assertEqual(progress["warning_level"], "info")
        for index in range(4):
            event = self._event(index + 1)
            PlanSyncService.mark_event_completed(event)
        progress = PlanSyncService.get_enrollment_progress(self.enrollment)
        self.assertEqual(progress["remaining"], 1)
        self.assertEqual(progress["warning_level"], "last")
        self.assertIn("последняя тема", progress["warning_message"])

    def test_last_plan_item_card_does_not_count_earlier_unfinished_topics(self):
        """На последней теме плана подсказка не говорит «осталось 2», даже если раньше не закрыли занятия."""
        for index in range(3):
            PlanSyncService.mark_event_completed(self._event(index + 1))
        fourth = self._event(10)
        last = self._event(11)
        extra = self._event(12, skip_plan=True)

        self.assertEqual(fourth.lesson_plan_item_id, self.items[3].id)
        self.assertEqual(last.lesson_plan_item_id, self.items[-1].id)
        self.assertIsNone(extra.lesson_plan_item_id)

        payload = schedule_event_to_json(last)
        self.assertEqual(payload["planLessonNumber"], 5)
        self.assertEqual(payload["planProgress"]["total"], 5)
        self.assertEqual(payload["planProgress"]["remaining"], 2)
        self.assertEqual(payload["planWarningLevel"], "last")
        self.assertIn("последняя тема", payload["planWarningMessage"])
        self.assertNotIn("осталось", payload["planWarningMessage"])
        self.assertIn("1 занятия", payload["planWarningMessage"])

        enrollment_progress = PlanSyncService.get_enrollment_progress(self.enrollment)
        self.assertEqual(enrollment_progress["remaining"], 2)
        self.assertEqual(enrollment_progress["remaining_unassigned"], 0)
        self.assertEqual(enrollment_progress["warning_level"], "overbooked")
        self.assertIn("уже назначены", enrollment_progress["warning_message"])

    def test_delete_linked_plan_item_requires_force(self):
        from rest_framework.test import APIClient

        event = self._event(1)
        self.assertEqual(event.lesson_plan_item_id, self.items[0].id)
        client = APIClient()
        client.force_login(self.teacher)
        url = f"/api/cabinet/lesson-plan-items/{self.items[0].pk}/"
        blocked = client.delete(url)
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(blocked.data.get("code"), "item_in_use")
        forced = client.delete(f"{url}?force=1")
        self.assertEqual(forced.status_code, 204)
        event.refresh_from_db()
        self.assertIsNone(event.lesson_plan_item_id)
        self.assertFalse(LessonPlanItem.objects.filter(pk=self.items[0].pk).exists())

    def _complete_with_attendance(self, event, attendance):
        from Cabinet.journal_service import complete_journal, get_or_create_journal

        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get(student=self.student)
        record.attendance_status = attendance
        record.save(update_fields=["attendance_status", "updated_at"])
        complete_journal(journal, self.teacher, force=True)
        event.refresh_from_db()

    def test_cancel_shift_moves_topic_to_next_lesson(self):
        first = self._event(1)
        second = self._event(8)
        third = self._event(15)
        self.assertEqual(first.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(second.lesson_plan_item_id, self.items[1].id)
        self.assertEqual(third.lesson_plan_item_id, self.items[2].id)

        cancel_event_with_scope(
            first, changed_by=self.teacher, notify=False, plan_cancel_action="shift",
        )
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual(second.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(second.topic, self.items[0].topic)
        self.assertEqual(third.lesson_plan_item_id, self.items[1].id)
        self.assertEqual(third.topic, self.items[1].topic)

    def test_conducted_attendance_consumes_topic_and_shifts_remaining(self):
        from Cabinet.journal_models import AttendanceStatus

        first = self._event(1)
        second = self._event(8)
        third = self._event(15)
        self._complete_with_attendance(first, AttendanceStatus.LATE)
        self.items[0].refresh_from_db()
        second.refresh_from_db()
        third.refresh_from_db()
        self.assertEqual(self.items[0].status, PlanItemStatus.COMPLETED)
        self.assertEqual(second.lesson_plan_item_id, self.items[1].id)
        self.assertEqual(third.lesson_plan_item_id, self.items[2].id)

        self._complete_with_attendance(second, AttendanceStatus.TECHNICAL_ISSUE)
        self.items[1].refresh_from_db()
        third.refresh_from_db()
        self.assertEqual(self.items[1].status, PlanItemStatus.COMPLETED)
        self.assertEqual(third.lesson_plan_item_id, self.items[2].id)
        self.assertEqual(third.topic, self.items[2].topic)

        leftover = self._event(22)
        leftover.refresh_from_db()
        self.assertEqual(leftover.lesson_plan_item_id, self.items[3].id)

        fourth_event = self._event(29)
        self._complete_with_attendance(third, AttendanceStatus.LEFT_EARLY)
        leftover.refresh_from_db()
        fourth_event.refresh_from_db()
        self.items[2].refresh_from_db()
        self.assertEqual(self.items[2].status, PlanItemStatus.COMPLETED)
        self.assertEqual(leftover.lesson_plan_item_id, self.items[3].id)
        self.assertEqual(fourth_event.lesson_plan_item_id, self.items[4].id)

    def test_absent_does_not_consume_plan_topic(self):
        from Cabinet.journal_models import AttendanceStatus

        first = self._event(1)
        second = self._event(8)
        self._complete_with_attendance(first, AttendanceStatus.ABSENT_UNEXCUSED)
        self.items[0].refresh_from_db()
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertNotEqual(self.items[0].status, PlanItemStatus.COMPLETED)
        self.assertIsNone(first.lesson_plan_item_id)
        self.assertEqual(second.lesson_plan_item_id, self.items[0].id)
        self.assertEqual(second.topic, self.items[0].topic)
