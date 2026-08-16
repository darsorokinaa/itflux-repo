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
        self.assertEqual(next_item.id, self.items[1].id)

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
        self.assertEqual(next_item.id, self.items[0].id)
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
