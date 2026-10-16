from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from Cabinet.models import (
    LessonPlan, LessonPlanEnrollment, LessonPlanItem, Notification, Profile, ScheduleEvent, Student,
)
from Cabinet.plan_autolink import fill_topicless
from Cabinet.schedule_service import cancel_event, create_single_event


class PlanAutolinkTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="r42_t", password="x")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(teacher=self.teacher, first_name="Саша", status="active")
        self.plan = LessonPlan.objects.create(teacher=self.teacher, title="P", status="published")
        self.items = [LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"T{n}", topic=f"T{n}")
                      for n in range(1, 6)]
        self.base = timezone.now() + timedelta(days=2)

    def _raw_event(self, day, **kw):
        # Занятие без темы, как после старого бага/импорта.
        return ScheduleEvent.objects.create(
            owner=self.teacher, title="Саша", student=self.student,
            starts_at=self.base + timedelta(days=day), ends_at=self.base + timedelta(days=day, hours=1),
            event_type="individual_lesson", status="planned", **kw,
        )

    def _enroll(self):
        return LessonPlanEnrollment.objects.create(
            teacher=self.teacher, plan=self.plan, student=self.student, status="active")

    def test_backfill_in_date_order_and_idempotent(self):
        e2, e1 = self._raw_event(7), self._raw_event(1)
        past = ScheduleEvent.objects.create(
            owner=self.teacher, title="Саша", student=self.student, starts_at=timezone.now() - timedelta(days=1),
            ends_at=timezone.now() - timedelta(hours=23), event_type="individual_lesson", status="planned")
        manual = self._raw_event(3, topic="Свой разбор", content_source="manual")
        self._enroll()
        n0 = Notification.objects.count()
        dry = fill_topicless(dry_run=True)
        self.assertEqual(len(dry), 2)
        self.assertIsNone(ScheduleEvent.objects.get(pk=e1.pk).lesson_plan_item_id)
        changes = fill_topicless()
        self.assertEqual([c["event_id"] for c in changes], [e1.pk, e2.pk])
        e1.refresh_from_db(); e2.refresh_from_db(); past.refresh_from_db(); manual.refresh_from_db()
        self.assertEqual((e1.lesson_plan_item_id, e2.lesson_plan_item_id), (self.items[0].pk, self.items[1].pk))
        self.assertTrue(e1.plan_item_auto)
        self.assertIsNone(past.lesson_plan_item_id)
        self.assertIsNone(manual.lesson_plan_item_id)
        self.assertEqual(fill_topicless(), [])
        self.assertEqual(Notification.objects.count(), n0)

    def test_enrollment_assignment_triggers_fill_on_commit(self):
        ev = self._raw_event(1)
        with self.captureOnCommitCallbacks(execute=True):
            self._enroll()
        ev.refresh_from_db()
        self.assertEqual(ev.lesson_plan_item_id, self.items[0].pk)

    def test_new_topics_fill_existing_topicless_lessons(self):
        LessonPlanItem.objects.filter(plan=self.plan).delete()
        self._enroll()
        ev = self._raw_event(1)
        with self.captureOnCommitCallbacks(execute=True):
            item = LessonPlanItem.objects.create(plan=self.plan, order=1, title="Новая", topic="Новая")
        ev.refresh_from_db()
        self.assertEqual(ev.lesson_plan_item_id, item.pk)

    def test_cancel_shifts_only_auto_topics(self):
        self._enroll()
        evs = []
        for day in (1, 2, 3):
            evs.append(create_single_event(teacher=self.teacher, data={
                "title": "Саша", "starts_at": self.base + timedelta(days=day),
                "ends_at": self.base + timedelta(days=day, hours=1), "event_type": "individual_lesson",
            }, student_ids=[self.student.pk], notify=False))
        for ev in evs:
            ev.refresh_from_db()
        self.assertEqual([e.lesson_plan_item_id for e in evs], [i.pk for i in self.items[:3]])
        self.assertTrue(all(e.plan_item_auto for e in evs))
        # Третий урок — тема выбрана вручную.
        ScheduleEvent.objects.filter(pk=evs[2].pk).update(plan_item_auto=False)
        cancel_event(evs[0], changed_by=self.teacher, notify=False)
        evs[1].refresh_from_db(); evs[2].refresh_from_db()
        self.assertEqual(evs[1].lesson_plan_item_id, self.items[0].pk)  # тема сдвинулась
        self.assertEqual(evs[2].lesson_plan_item_id, self.items[2].pk)  # ручная — на месте
        self.assertEqual(evs[1].topic, "T1")
