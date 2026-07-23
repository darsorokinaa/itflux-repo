"""Tests for multi-subject student–teacher links (StudentSubject)."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import EnrollmentStatus, PlanStatus, StudentSubjectStatus
from Cabinet.models import (
    DirectMaterialAssignment,
    Homework,
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Material,
    Profile,
    ScheduleEvent,
    Student,
    StudentSubject,
)
from Cabinet.schedule_service import create_single_event


class StudentSubjectAPITests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="t1", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save(update_fields=["role"])
        self.other_teacher = User.objects.create_user(username="t2", password="pass")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save(update_fields=["role"])

        self.student_user = User.objects.create_user(
            username="s1", password="pass", email="s1@test.ru"
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save(update_fields=["role"])

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Петров",
            status="active",
        )
        self.other_student = Student.objects.create(
            teacher=self.other_teacher,
            first_name="Чужой",
            last_name="Ученик",
            status="active",
        )
        self.other_subject = StudentSubject.objects.create(
            student=self.other_student,
            subject="math",
            title="Школьная",
            direction="school",
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.teacher)

    def test_teacher_adds_one_subject(self):
        resp = self.client.post(
            f"/api/cabinet/students/{self.student.id}/subjects/",
            {"subject": "inf", "title": "ОГЭ", "direction": "oge"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data["subject"], "inf")
        self.assertEqual(resp.data["title"], "ОГЭ")
        self.assertTrue(
            StudentSubject.objects.filter(student=self.student, subject="inf").exists()
        )

    def test_teacher_adds_multiple_subjects(self):
        self.client.post(
            f"/api/cabinet/students/{self.student.id}/subjects/",
            {"subject": "inf", "title": "ОГЭ", "direction": "oge"},
            format="json",
        )
        resp = self.client.post(
            f"/api/cabinet/students/{self.student.id}/subjects/",
            {"subject": "math", "title": "Школьная программа", "direction": "school"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            StudentSubject.objects.filter(
                student=self.student, status=StudentSubjectStatus.ACTIVE
            ).count(),
            2,
        )

    def test_other_teacher_cannot_access_subjects(self):
        ss = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        self.client.force_authenticate(user=self.other_teacher)
        resp = self.client.get(f"/api/cabinet/students/{self.student.id}/subjects/")
        self.assertEqual(resp.status_code, 404)
        resp = self.client.patch(
            f"/api/cabinet/students/{self.student.id}/subjects/{ss.id}/",
            {"title": "Взлом"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)
        ss.refresh_from_db()
        self.assertEqual(ss.title, "ОГЭ")

    def test_student_sees_only_own_subjects(self):
        StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        self.client.force_authenticate(user=self.student_user)
        resp = self.client.get("/api/cabinet/student/subjects/")
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = {item["id"] for item in resp.data["items"]}
        self.assertIn(
            StudentSubject.objects.get(student=self.student, subject="inf").id, ids
        )
        self.assertNotIn(self.other_subject.id, ids)

    def test_lesson_requires_student_subject_of_selected_student(self):
        own = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        starts = timezone.now().replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=1)
        ends = starts + timedelta(minutes=45)
        with self.assertRaises(ValueError):
            create_single_event(
                teacher=self.teacher,
                data={
                    "title": "Урок",
                    "starts_at": starts,
                    "ends_at": ends,
                    "event_type": "individual_lesson",
                    "student_subject_id": self.other_subject.id,
                    "notify_participants": False,
                },
                student_ids=[self.student.pk],
                notify=False,
            )
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Урок",
                "starts_at": starts,
                "ends_at": ends,
                "event_type": "individual_lesson",
                "student_subject_id": own.id,
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertEqual(event.student_subject_id, own.id)

    def test_plan_assigned_to_student_subject(self):
        ss = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="План ОГЭ",
            subject="inf",
            status=PlanStatus.PUBLISHED,
        )
        resp = self.client.post(
            "/api/cabinet/lesson-plan-enrollments/",
            {
                "plan": plan.id,
                "student": self.student.id,
                "student_subject": ss.id,
                "format": "individual",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        enrollment = LessonPlanEnrollment.objects.get(
            plan=plan, student=self.student, student_subject=ss
        )
        self.assertEqual(enrollment.student_subject_id, ss.id)

    def test_materials_filtered_by_subject(self):
        ss_inf = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        ss_math = StudentSubject.objects.create(
            student=self.student, subject="math", title="Алгебра", direction="school"
        )
        m1 = Material.objects.create(teacher=self.teacher, title="Инф материал")
        m2 = Material.objects.create(teacher=self.teacher, title="Мат материал")
        DirectMaterialAssignment.objects.create(
            teacher=self.teacher, material=m1, student=self.student, student_subject=ss_inf
        )
        DirectMaterialAssignment.objects.create(
            teacher=self.teacher, material=m2, student=self.student, student_subject=ss_math
        )
        self.client.force_authenticate(user=self.student_user)
        resp = self.client.get(f"/api/cabinet/student/materials/?student_subject={ss_inf.id}")
        self.assertEqual(resp.status_code, 200)
        titles = {item["title"] for item in resp.data["items"]}
        self.assertIn("Инф материал", titles)
        self.assertNotIn("Мат материал", titles)

    def test_archive_subject_keeps_lessons(self):
        ss = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        starts = timezone.now() + timedelta(days=1)
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Старый урок",
            starts_at=starts,
            ends_at=starts + timedelta(minutes=45),
            student=self.student,
            student_subject=ss,
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
        )
        Homework.objects.create(
            teacher=self.teacher,
            title="ДЗ",
            student=self.student,
            student_subject=ss,
            status="assigned",
        )
        resp = self.client.delete(
            f"/api/cabinet/students/{self.student.id}/subjects/{ss.id}/"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.data.get("archived"))
        ss.refresh_from_db()
        self.assertEqual(ss.status, StudentSubjectStatus.ARCHIVED)
        event.refresh_from_db()
        self.assertEqual(event.student_subject_id, ss.id)
        self.assertTrue(ScheduleEvent.objects.filter(pk=event.pk).exists())

    def test_student_without_subjects_opens(self):
        resp = self.client.get(f"/api/cabinet/students/{self.student.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data.get("subjects_count"), 0)
        self.assertEqual(resp.data.get("subjects"), [])

    def test_old_lesson_without_subject_displays(self):
        starts = timezone.now() + timedelta(days=1)
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Legacy",
            starts_at=starts,
            ends_at=starts + timedelta(minutes=45),
            student=self.student,
            student_subject=None,
        )
        from Cabinet.schedule_events import schedule_event_to_json

        payload = schedule_event_to_json(event)
        self.assertEqual(payload["title"], "Legacy")
        self.assertIsNone(payload.get("studentSubjectId"))
        self.assertEqual(payload.get("studentSubjectLabel"), "")

    def test_cannot_use_foreign_student_subject_id(self):
        resp = self.client.post(
            "/api/cabinet/direct-materials/",
            {
                "material_id": Material.objects.create(
                    teacher=self.teacher, title="X"
                ).id,
                "student_id": self.student.id,
                "student_subject_id": self.other_subject.id,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_single_subject_auto_selected_for_lesson(self):
        ss = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        starts = timezone.now().replace(hour=11, minute=0, second=0, microsecond=0) + timedelta(days=2)
        ends = starts + timedelta(minutes=45)
        event = create_single_event(
            teacher=self.teacher,
            data={
                "title": "Автопредмет",
                "starts_at": starts,
                "ends_at": ends,
                "event_type": "individual_lesson",
                "notify_participants": False,
            },
            student_ids=[self.student.pk],
            notify=False,
        )
        self.assertEqual(event.student_subject_id, ss.id)

    def test_duplicate_active_subject_rejected(self):
        StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        resp = self.client.post(
            f"/api/cabinet/students/{self.student.id}/subjects/",
            {"subject": "inf", "title": "ОГЭ", "direction": "oge"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_plan_subject_mismatch_rejected(self):
        ss = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="Математика",
            subject="math",
            status=PlanStatus.PUBLISHED,
        )
        resp = self.client.post(
            "/api/cabinet/lesson-plan-enrollments/",
            {
                "plan": plan.id,
                "student": self.student.id,
                "student_subject": ss.id,
                "format": "individual",
                "status": EnrollmentStatus.ACTIVE,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_homework_options_and_assign_use_event_subject(self):
        """Из карточки урока ДЗ берётся из плана нужного предмета, не «последнего»."""
        ss_inf = StudentSubject.objects.create(
            student=self.student, subject="inf", title="ОГЭ", direction="oge"
        )
        ss_math = StudentSubject.objects.create(
            student=self.student, subject="math", title="Алгебра", direction="school"
        )
        plan_inf = LessonPlan.objects.create(
            teacher=self.teacher,
            title="План информатики",
            subject="inf",
            status=PlanStatus.PUBLISHED,
        )
        plan_math = LessonPlan.objects.create(
            teacher=self.teacher,
            title="План математики",
            subject="math",
            status=PlanStatus.PUBLISHED,
        )
        item_inf = LessonPlanItem.objects.create(
            plan=plan_inf,
            title="Инф занятие",
            order=1,
            homework_description="ДЗ по информатике",
        )
        item_math = LessonPlanItem.objects.create(
            plan=plan_math,
            title="Мат занятие",
            order=1,
            homework_description="ДЗ по математике",
        )
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=plan_inf,
            student=self.student,
            student_subject=ss_inf,
            status=EnrollmentStatus.ACTIVE,
            format="individual",
        )
        # Более новый enrollment — математика (раньше ломал выдачу ДЗ с урока инф)
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=plan_math,
            student=self.student,
            student_subject=ss_math,
            status=EnrollmentStatus.ACTIVE,
            format="individual",
        )
        starts = timezone.now() + timedelta(days=1)
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Урок информатики",
            starts_at=starts,
            ends_at=starts + timedelta(minutes=45),
            student=self.student,
            student_subject=ss_inf,
            lesson_plan_item=item_inf,
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
        )

        options = self.client.get(
            f"/api/cabinet/students/{self.student.id}/homework-options/"
            f"?schedule_event_id={event.id}"
        )
        self.assertEqual(options.status_code, 200, options.content)
        self.assertEqual(options.data["plan_id"], plan_inf.id)
        item_ids = {item["id"] for item in options.data["items"]}
        self.assertIn(item_inf.id, item_ids)
        self.assertNotIn(item_math.id, item_ids)
        self.assertEqual(options.data.get("preferred_plan_item_id"), item_inf.id)

        assigned = self.client.post(
            f"/api/cabinet/students/{self.student.id}/assign-homework/",
            {
                "plan_item_id": item_inf.id,
                "schedule_event_id": event.id,
                "student_subject_id": ss_inf.id,
            },
            format="json",
        )
        self.assertEqual(assigned.status_code, 201, assigned.content)
        hw = Homework.objects.get(pk=assigned.data["id"])
        self.assertEqual(hw.lesson_plan_item_id, item_inf.id)
        self.assertEqual(hw.student_subject_id, ss_inf.id)
