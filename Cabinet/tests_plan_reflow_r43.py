from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from Cabinet.lesson_lifecycle import restore_event
from Cabinet.models import LessonPlan, LessonPlanEnrollment, LessonPlanItem, Notification, Profile, ScheduleEvent, Student
from Cabinet.plan_autolink import reflow_all
from Cabinet.schedule_service import cancel_event, create_single_event, move_event


class PlanReflowTests(TestCase):
    """r43: темы будущих автоуроков всегда идут по порядку плана по датам."""

    def setUp(self):
        self.teacher = User.objects.create_user(username="r43_t", password="x")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(teacher=self.teacher, first_name="Саша", status="active")
        self.plan = LessonPlan.objects.create(teacher=self.teacher, title="P", status="published")
        self.items = [LessonPlanItem.objects.create(plan=self.plan, order=n, title=f"T{n}", topic=f"T{n}")
                      for n in range(1, 7)]
        LessonPlanEnrollment.objects.create(teacher=self.teacher, plan=self.plan, student=self.student, status="active")
        self.base = timezone.now() + timedelta(days=2)
        self.n0 = Notification.objects.count()

    def _lesson(self, day):
        with self.captureOnCommitCallbacks(execute=True):
            ev = create_single_event(teacher=self.teacher, data={
                "title": "Саша", "starts_at": self.base + timedelta(days=day),
                "ends_at": self.base + timedelta(days=day, hours=1), "event_type": "individual_lesson",
                "notify_participants": False,
            }, student_ids=[self.student.pk], notify=False)
        return ev

    def _topics(self, evs):
        out = []
        for ev in evs:
            ev.refresh_from_db()
            out.append(ev.topic if ev.status in ("planned", "moved") else f"x:{ev.topic}")
        return out

    def test_cancel_then_restore_in_middle(self):
        a, b, c = self._lesson(1), self._lesson(8), self._lesson(15)
        self.assertEqual(self._topics([a, b, c]), ["T1", "T2", "T3"])
        with self.captureOnCommitCallbacks(execute=True):
            cancel_event(b, changed_by=self.teacher, notify=False)
        self.assertEqual(self._topics([a, c]), ["T1", "T2"])  # сдвиг назад
        b.refresh_from_db()
        with self.captureOnCommitCallbacks(execute=True):
            restore_event(b, changed_by=self.teacher)
        self.assertEqual(self._topics([a, b, c]), ["T1", "T2", "T3"])  # восстановленный — своя позиция
        self.assertEqual(Notification.objects.count(), self.n0)

    def test_add_lesson_in_middle(self):
        a, c = self._lesson(1), self._lesson(15)
        b = self._lesson(8)
        self.assertEqual(self._topics([a, b, c]), ["T1", "T2", "T3"])

    def test_move_earlier_and_later(self):
        a, b, c = self._lesson(1), self._lesson(8), self._lesson(15)
        with self.captureOnCommitCallbacks(execute=True):
            move_event(c, starts_at=self.base + timedelta(hours=-1), ends_at=self.base, changed_by=self.teacher, notify=False)
        self.assertEqual(self._topics([c, a, b]), ["T1", "T2", "T3"])
        with self.captureOnCommitCallbacks(execute=True):
            move_event(c, starts_at=self.base + timedelta(days=20), ends_at=self.base + timedelta(days=20, hours=1),
                       changed_by=self.teacher, notify=False)
        self.assertEqual(self._topics([a, b, c]), ["T1", "T2", "T3"])

    def test_manual_topic_fixed_and_excluded(self):
        a, b, c = self._lesson(1), self._lesson(8), self._lesson(15)
        ScheduleEvent.objects.filter(pk=b.pk).update(plan_item_auto=False)  # T2 выбрана вручную
        with self.captureOnCommitCallbacks(execute=True):
            cancel_event(a, changed_by=self.teacher, notify=False)
        self.assertEqual(self._topics([b, c]), ["T2", "T1"])
        self.assertEqual(reflow_all(), [])  # идемпотентно

    def test_plan_reorder_and_remove_topic(self):
        a, b = self._lesson(1), self._lesson(8)
        with self.captureOnCommitCallbacks(execute=True):
            self.items[0].delete()
        self.assertEqual(self._topics([a, b]), ["T2", "T3"])
        with self.captureOnCommitCallbacks(execute=True):
            new = LessonPlanItem.objects.create(plan=self.plan, order=0, title="T0", topic="T0")
        self.assertEqual(self._topics([a, b]), ["T0", "T2"])
        self.assertEqual(ScheduleEvent.objects.get(pk=a.pk).lesson_plan_item_id, new.pk)
