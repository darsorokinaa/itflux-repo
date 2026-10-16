from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from Cabinet.models import LessonPlan, LessonPlanEnrollment, LessonPlanItem, Profile, ScheduleEvent, Student
from Cabinet.plan_sync import PlanSyncService


class NextItemAfterCancelledLessonTests(TestCase):
    """r41: темы отменённых занятий должны доставаться новой серии."""

    def test_cancelled_event_topic_is_free_again(self):
        teacher = User.objects.create_user(username="r41_t", password="x")
        teacher.profile.role = Profile.Role.TEACHER
        teacher.profile.save(update_fields=["role"])
        student = Student.objects.create(teacher=teacher, first_name="Саша", status="active")
        plan = LessonPlan.objects.create(teacher=teacher, title="P", status="published")
        enr = LessonPlanEnrollment.objects.create(teacher=teacher, plan=plan, student=student, status="active")
        start = timezone.now() + timedelta(days=3)
        items = []
        for n in range(1, 4):
            item = LessonPlanItem.objects.create(plan=plan, order=n, title=f"T{n}", topic=f"T{n}", status="planned")
            ev = ScheduleEvent.objects.create(
                owner=teacher, title="Саша", student=student, starts_at=start + timedelta(days=n),
                ends_at=start + timedelta(days=n, hours=1), event_type="individual_lesson",
                status=ScheduleEvent.Status.CANCELLED if n > 1 else ScheduleEvent.Status.PLANNED,
                lesson_plan_item=item,
            )
            item.scheduled_event = ev
            item.save(update_fields=["scheduled_event"])
            items.append(item)
        self.assertEqual(PlanSyncService.get_next_plan_item(enr), items[1])
