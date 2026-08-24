from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta

from Cabinet.choices import EnrollmentStatus, PlanStatus
from Cabinet.models import (
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Profile,
    ScheduleEvent,
    Student,
)
from Cabinet.plan_dedupe import merge_duplicate_student_plans
from Cabinet.plan_schedule import AUTO_MATERIALS_PLAN_DESCRIPTION


class MergeDuplicateStudentPlansTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="merge_t", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Александр",
            last_name="Федоров",
            status="active",
        )

    def _auto_plan(self, suffix=""):
        title = "План: Александр Федоров — Информатика"
        if suffix:
            title = f"{title}{suffix}"
        return LessonPlan.objects.create(
            teacher=self.teacher,
            title=title,
            subject="informatics",
            status=PlanStatus.PUBLISHED,
        )

    def _item(self, plan, order, topic):
        return LessonPlanItem.objects.create(
            plan=plan, order=order, title=topic, topic=topic,
        )

    def _enroll(self, plan, status=EnrollmentStatus.ACTIVE, student=None):
        return LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=plan,
            student=student or self.student,
            status=status,
        )

    def test_dry_run_does_not_change_data(self):
        a = self._auto_plan()
        b = self._auto_plan()
        self._item(a, 1, "Тема A")
        self._item(b, 1, "Тема B")
        self._enroll(a)
        self._enroll(b, status=EnrollmentStatus.CANCELLED)
        report = merge_duplicate_student_plans(apply=False)
        self.assertEqual(report["archived_plans"], 1)
        self.assertEqual(report["moved_items"], 1)
        a.refresh_from_db()
        b.refresh_from_db()
        self.assertEqual(a.status, PlanStatus.PUBLISHED)
        self.assertEqual(b.status, PlanStatus.PUBLISHED)
        self.assertEqual(b.items.count(), 1)

    def test_merge_same_auto_title_keeps_events(self):
        a = self._auto_plan()
        b = self._auto_plan()
        item_a = self._item(a, 1, "Кодирование")
        item_b = self._item(b, 1, "Системы счисления")
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title=self.student.full_name,
            topic="Системы счисления",
            starts_at=timezone.now() + timedelta(days=1),
            ends_at=timezone.now() + timedelta(days=1, minutes=45),
            student=self.student,
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            lesson_plan_item=item_b,
        )
        item_b.scheduled_event = event
        item_b.save(update_fields=["scheduled_event"])
        self._enroll(a)
        self._enroll(b, status=EnrollmentStatus.CANCELLED)

        report = merge_duplicate_student_plans(apply=True)
        self.assertEqual(report["archived_plans"], 1)
        canonical_id = report["groups"][0]["canonical_id"]
        archived_id = report["groups"][0]["duplicate_ids"][0]
        item_b.refresh_from_db()
        event.refresh_from_db()
        archived = LessonPlan.objects.get(pk=archived_id)
        self.assertEqual(item_b.plan_id, canonical_id)
        self.assertEqual(event.lesson_plan_item_id, item_b.id)
        self.assertEqual(archived.status, PlanStatus.ARCHIVED)
        self.assertEqual(
            LessonPlanItem.objects.filter(plan_id=canonical_id).count(),
            2,
        )
        self.assertEqual(
            LessonPlan.objects.filter(
                teacher=self.teacher, status=PlanStatus.PUBLISHED,
            ).exclude(description=AUTO_MATERIALS_PLAN_DESCRIPTION).count(),
            1,
        )

    def test_merge_auto_into_named_personal_plan(self):
        named = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Индивидуальный план - подготовка к ЕГЭ",
            subject="informatics",
            status=PlanStatus.PUBLISHED,
        )
        auto = self._auto_plan()
        self._item(named, 1, "Информация")
        self._item(auto, 1, "Кодирование")
        self._enroll(named)
        self._enroll(auto, status=EnrollmentStatus.CANCELLED)

        report = merge_duplicate_student_plans(apply=True)
        auto.refresh_from_db()
        self.assertEqual(auto.status, PlanStatus.ARCHIVED)
        self.assertEqual(named.items.count(), 2)
        self.assertEqual(report["groups"][0]["canonical_id"], named.pk)

    def test_does_not_merge_auto_into_shared_template(self):
        other = Student.objects.create(
            teacher=self.teacher,
            first_name="Алиса",
            last_name="Смирнова",
            status="active",
        )
        template = LessonPlan.objects.create(
            teacher=self.teacher,
            title="ОГЭ-2026",
            subject="informatics",
            status=PlanStatus.PUBLISHED,
        )
        auto = self._auto_plan()
        self._item(template, 1, "Логика")
        self._item(auto, 1, "Автотема")
        self._enroll(template)
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=template,
            student=other,
            status=EnrollmentStatus.ACTIVE,
        )
        self._enroll(auto, status=EnrollmentStatus.CANCELLED)

        merge_duplicate_student_plans(apply=True)
        auto.refresh_from_db()
        template.refresh_from_db()
        self.assertEqual(auto.status, PlanStatus.PUBLISHED)
        self.assertEqual(template.items.count(), 1)
        self.assertEqual(auto.items.count(), 1)
