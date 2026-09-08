"""Correctness regressions after calendar/student list N+1 fixes.

These tests do not chase query-count cosmetics. They lock JSON contract,
prefetch order, subject-catalog freshness, range boundaries, and realign GET.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.apps import apps
from django.contrib.auth.models import User
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import (
    ParticipantRole,
    ParticipantStatus,
    ScheduleMaterialSource,
    StudentSubjectStatus,
)
from Cabinet.models import (
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Material,
    NotificationPreference,
    Profile,
    ScheduleEvent,
    ScheduleEventMaterial,
    ScheduleEventParticipant,
    Student,
    StudentGroup,
    StudentSubject,
)
from Cabinet.plan_subjects import (
    clear_plan_subject_options_cache,
    get_plan_subject_label,
    get_plan_subject_options,
)
from Cabinet.plan_sync import PlanSyncService
from Cabinet.schedule_events import list_schedule_events, schedule_event_to_json
from Cabinet.serializers import StudentListSerializer


JSON_CONTRACT_KEYS = {
    "id",
    "title",
    "topic",
    "startsAt",
    "endsAt",
    "startTime",
    "endTime",
    "type",
    "audience",
    "status",
    "studentId",
    "groupId",
    "studentSubjectId",
    "studentSubjectLabel",
    "participants",
    "participantStudentIds",
    "planItem",
    "planItems",
    "eventMaterials",
    "planMaterials",
    "manualMaterials",
    "homeworkMaterials",
    "videoMeeting",
    "hasPlan",
    "lessonPlanItemId",
    "selfBooked",
}


class PrefetchAndCatalogRegressionTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="reg_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Istanbul"
        self.teacher.profile.save(update_fields=["role", "timezone"])
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def test_subject_catalog_refreshes_on_next_request(self):
        Subject = apps.get_model("Generator", "Subject")
        row = Subject.objects.create(subject_short="audit_sub", subject_name="Старое имя")
        clear_plan_subject_options_cache()
        self.assertEqual(get_plan_subject_label("audit_sub"), "Старое имя")

        row.subject_name = "Новое имя"
        row.save(update_fields=["subject_name"])
        # Process-level cache would still return the old label here.
        self.assertEqual(get_plan_subject_label("audit_sub"), "Старое имя")

        self.client.get("/api/cabinet/students/?status=active")
        self.assertEqual(get_plan_subject_label("audit_sub"), "Новое имя")

    def test_student_list_prefetch_matches_filter_semantics_and_order(self):
        zero = Student.objects.create(
            teacher=self.teacher, first_name="Аня", last_name="Ааа", status="active",
        )
        one_g = Student.objects.create(
            teacher=self.teacher, first_name="Боря", last_name="Ббб", status="active",
        )
        many = Student.objects.create(
            teacher=self.teacher, first_name="Вика", last_name="Ввв", status="active",
        )
        g_beta = StudentGroup.objects.create(teacher=self.teacher, title="Бета", status="active")
        g_alpha = StudentGroup.objects.create(teacher=self.teacher, title="Альфа", status="active")
        g_arch = StudentGroup.objects.create(teacher=self.teacher, title="Архив", status="archived")
        one_g.groups.add(g_beta)
        many.groups.add(g_beta, g_alpha, g_arch)

        StudentSubject.objects.create(
            student=one_g, subject="math", title="ОГЭ", status=StudentSubjectStatus.ACTIVE,
        )
        StudentSubject.objects.create(
            student=many, subject="prog", title="Python", status=StudentSubjectStatus.ACTIVE,
        )
        StudentSubject.objects.create(
            student=many, subject="inf", title="ЕГЭ", status=StudentSubjectStatus.ACTIVE,
        )
        StudentSubject.objects.create(
            student=many, subject="rus", title="скрытый", status=StudentSubjectStatus.ARCHIVED,
        )

        qs = Student.objects.filter(
            teacher=self.teacher, status="active",
        ).prefetch_related("groups", "subjects").order_by("last_name", "first_name")
        prefetched = StudentListSerializer(list(qs), many=True).data
        plain = StudentListSerializer(
            list(Student.objects.filter(teacher=self.teacher, status="active").order_by("last_name", "first_name")),
            many=True,
        ).data
        self.assertEqual([row["id"] for row in prefetched], [row["id"] for row in plain])
        self.assertEqual([row["id"] for row in prefetched], [zero.id, one_g.id, many.id])
        for left, right in zip(prefetched, plain):
            self.assertEqual(left["group_ids"], right["group_ids"])
            self.assertEqual(left["subjects_count"], right["subjects_count"])
            self.assertEqual(left["subjects_preview"], right["subjects_preview"])
            self.assertEqual(left["status"], right["status"])
            self.assertEqual(left["full_name"], right["full_name"])

        by_id = {row["id"]: row for row in prefetched}
        self.assertEqual(by_id[zero.id]["group_ids"], [])
        self.assertEqual(by_id[zero.id]["subjects_count"], 0)
        self.assertEqual(by_id[one_g.id]["group_ids"], [g_beta.id])
        self.assertEqual(by_id[one_g.id]["subjects_count"], 1)
        self.assertEqual(by_id[many.id]["group_ids"], [g_alpha.id, g_beta.id])
        self.assertEqual(by_id[many.id]["subjects_count"], 2)
        self.assertEqual(
            [item["subject"] for item in by_id[many.id]["subjects_preview"]],
            ["inf", "prog"],
        )
        self.assertNotIn("скрытый", str(by_id[many.id]["subjects_preview"]))

    def test_calendar_json_contract_and_prefetch_order(self):
        student_a = Student.objects.create(
            teacher=self.teacher, first_name="Аня", last_name="Первая", status="active",
        )
        student_b = Student.objects.create(
            teacher=self.teacher, first_name="Боря", last_name="Вторая", status="active",
        )
        starts = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=1)
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Контрольная по кодированию",
            topic="Кодирование",
            starts_at=starts,
            ends_at=starts + timedelta(minutes=45),
            event_type="individual_lesson",
            student=student_a,
            status=ScheduleEvent.Status.PLANNED,
        )
        ScheduleEventParticipant.objects.create(
            event=event,
            student=student_b,
            role=ParticipantRole.STUDENT,
            display_name="Боря Вторая",
            status=ParticipantStatus.INVITED,
        )
        ScheduleEventParticipant.objects.create(
            event=event,
            student=student_a,
            role=ParticipantRole.STUDENT,
            display_name="Аня Первая",
            status=ParticipantStatus.INVITED,
        )
        ScheduleEventParticipant.objects.create(
            event=event,
            student=student_b,
            role=ParticipantRole.STUDENT,
            display_name="Удалённый",
            status=ParticipantStatus.REMOVED,
        )
        mat_b = Material.objects.create(teacher=self.teacher, title="Файл B")
        mat_a = Material.objects.create(teacher=self.teacher, title="Файл A")
        ScheduleEventMaterial.objects.create(
            event=event, material=mat_b, source=ScheduleMaterialSource.LESSON_MANUAL, order=1,
        )
        ScheduleEventMaterial.objects.create(
            event=event, material=mat_a, source=ScheduleMaterialSource.LESSON_MANUAL, order=0,
        )

        listed = list_schedule_events(
            user=self.teacher,
            date_from=timezone.localdate(),
            date_to=timezone.localdate() + timedelta(days=5),
        )
        self.assertEqual(len(listed), 1)
        payload = listed[0]
        missing = JSON_CONTRACT_KEYS - payload.keys()
        self.assertFalse(missing, f"calendar JSON lost keys: {missing}")
        self.assertEqual(payload["title"], "Контрольная по кодированию")
        self.assertEqual(payload["studentId"], student_a.id)
        self.assertEqual(
            [row["name"] for row in payload["participants"]],
            ["Аня Первая", "Боря Вторая"],
        )
        self.assertEqual(
            [row["title"] for row in payload["eventMaterials"]],
            ["Файл A", "Файл B"],
        )

        bare = ScheduleEvent.objects.get(pk=event.pk)
        uncached = schedule_event_to_json(bare)
        self.assertEqual(payload["participants"], uncached["participants"])
        self.assertEqual(payload["eventMaterials"], uncached["eventMaterials"])
        self.assertEqual(payload["title"], uncached["title"])
        self.assertEqual(payload["studentId"], uncached["studentId"])
        self.assertEqual(payload["status"], uncached["status"])

    def test_range_includes_start_and_end_boundaries(self):
        tz = ZoneInfo("Europe/Moscow")
        day = timezone.localdate() + timedelta(days=2)
        start_edge = datetime(day.year, day.month, day.day, 0, 0, tzinfo=tz)
        end_edge = datetime(day.year, day.month, day.day, 23, 59, tzinfo=tz)
        ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Полночь",
            starts_at=start_edge,
            ends_at=start_edge + timedelta(minutes=45),
            event_type="individual_lesson",
            status=ScheduleEvent.Status.PLANNED,
        )
        ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Почти полночь",
            starts_at=end_edge.replace(hour=23, minute=14),
            ends_at=end_edge,
            event_type="individual_lesson",
            status=ScheduleEvent.Status.PLANNED,
        )
        titles = {
            row["title"]
            for row in list_schedule_events(user=self.teacher, date_from=day, date_to=day)
        }
        self.assertEqual(titles, {"Полночь", "Почти полночь"})
        empty_prev = list_schedule_events(
            user=self.teacher,
            date_from=day - timedelta(days=1),
            date_to=day - timedelta(days=1),
        )
        self.assertEqual(empty_prev, [])

    def test_realign_second_select_only_when_updated(self):
        student = Student.objects.create(
            teacher=self.teacher, first_name="Миша", last_name="План", status="active",
        )
        starts = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=1)
        event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title=student.full_name,
            starts_at=starts,
            ends_at=starts + timedelta(minutes=45),
            event_type="individual_lesson",
            student=student,
            status=ScheduleEvent.Status.PLANNED,
        )
        without_plan = self._count_list_event_selects(event)
        plan = LessonPlan.objects.create(
            teacher=self.teacher, title="План", direction="oge", status="published",
        )
        item = LessonPlanItem.objects.create(plan=plan, order=1, title="Тема 1", topic="Тема 1")
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher, plan=plan, student=student, status="active",
        )
        first_with_plan, first_writes = self._count_list_event_selects(event, with_writes=True)
        second_with_plan, second_writes = self._count_list_event_selects(event, with_writes=True)
        print(
            "\nREALIGN LIST SELECTS "
            f"no_plan={without_plan} first_plan={first_with_plan}/{first_writes} "
            f"second_plan={second_with_plan}/{second_writes}"
        )
        self.assertEqual(without_plan, 1)
        self.assertLessEqual(first_with_plan, 2)
        self.assertLessEqual(second_with_plan, 2)
        event.refresh_from_db()
        self.assertEqual(event.lesson_plan_item_id, item.id)

    def _count_list_event_selects(self, event, with_writes=False):
        day = timezone.localtime(event.starts_at).date()
        with CaptureQueriesContext(connection) as ctx:
            list_schedule_events(user=self.teacher, date_from=day, date_to=day)
        list_selects = 0
        writes = 0
        for q in ctx.captured_queries:
            sql = q["sql"]
            upper = sql.lstrip().upper()
            if upper.startswith(("UPDATE", "INSERT", "DELETE")):
                writes += 1
            if (
                'FROM "Cabinet_scheduleevent"' in sql
                and "Cabinet_videomeeting" in sql
                and upper.startswith("SELECT")
            ):
                list_selects += 1
        if with_writes:
            return list_selects, writes
        return list_selects

    def _student_with_telegram(self, username, first_name, last_name, email):
        student_user = User.objects.create_user(username=username, password="pass")
        student_user.profile.role = Profile.Role.STUDENT
        student_user.profile.save(update_fields=["role"])
        student = Student.objects.create(
            teacher=self.teacher,
            user=student_user,
            first_name=first_name,
            last_name=last_name,
            email=email,
            status="active",
        )
        NotificationPreference.objects.update_or_create(
            user=student_user,
            defaults={
                "telegram_enabled": True,
                "telegram_chat_id": "10001",
                "notify_lesson_created": True,
            },
        )
        return student

    def test_notify_true_external_failure_does_not_hang(self):
        student = self._student_with_telegram(
            "st_notify_fail", "Катя", "Уведомление", "notify-audit@example.test",
        )
        start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=4)

        def boom(*args, **kwargs):
            raise TimeoutError("telegram down")

        with patch("Cabinet.telegram_connect.send_telegram_to_user", side_effect=boom):
            t0 = time.perf_counter()
            res = self.client.post(
                "/api/cabinet/schedule/events/create/",
                {
                    "title": "Урок с notify",
                    "starts_at": start.isoformat(),
                    "ends_at": (start + timedelta(minutes=45)).isoformat(),
                    "student_id": student.pk,
                    "format": "offline",
                    "notify_participants": True,
                    "type": "individual_lesson",
                },
                format="json",
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000
        self.assertEqual(res.status_code, 201, res.content)
        self.assertLess(elapsed_ms, 2000, f"notify failure hung save: {elapsed_ms:.0f}ms")

    def test_notify_true_slow_telegram_adds_to_save(self):
        student = self._student_with_telegram(
            "st_notify_slow", "Оля", "Телеграм", "tg-audit@example.test",
        )
        start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=5)

        def slow_ok(*args, **kwargs):
            time.sleep(0.25)
            return True

        with patch("Cabinet.telegram_connect.send_telegram_to_user", side_effect=slow_ok):
            t0 = time.perf_counter()
            res = self.client.post(
                "/api/cabinet/schedule/events/create/",
                {
                    "title": "Урок с медленным TG",
                    "starts_at": start.isoformat(),
                    "ends_at": (start + timedelta(minutes=45)).isoformat(),
                    "student_id": student.pk,
                    "format": "offline",
                    "notify_participants": True,
                    "type": "individual_lesson",
                },
                format="json",
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000
        print(f"\nEVENT CREATE notify=true mocked 250ms telegram: {elapsed_ms:.1f}ms status={res.status_code}")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertGreaterEqual(elapsed_ms, 240)

    def test_calendar_response_sizes(self):
        students = [
            Student.objects.create(
                teacher=self.teacher,
                first_name=f"Имя{i}",
                last_name=f"Фам{i}",
                status="active",
            )
            for i in range(8)
        ]
        start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=1)
        today = timezone.localdate()
        report = {}
        for n in (10, 50, 200):
            ScheduleEvent.objects.filter(owner=self.teacher).delete()
            ScheduleEvent.objects.bulk_create([
                ScheduleEvent(
                    owner=self.teacher,
                    title=f"Урок {i}",
                    starts_at=start + timedelta(hours=i),
                    ends_at=start + timedelta(hours=i, minutes=45),
                    event_type="individual_lesson",
                    student=students[i % len(students)],
                    status=ScheduleEvent.Status.PLANNED,
                )
                for i in range(n)
            ])
            url = (
                f"/api/cabinet/schedule/events/"
                f"?from={today.isoformat()}&to={(today + timedelta(days=40)).isoformat()}"
            )
            res = self.client.get(url)
            self.assertEqual(res.status_code, 200)
            report[n] = len(res.content)
        print(f"\nCALENDAR RESPONSE BYTES {report}")
        self.assertGreater(report[200], report[50])
        self.assertGreater(report[50], report[10])

    def test_students_response_sizes(self):
        report = {}
        for n in (5, 30, 100):
            Student.objects.filter(teacher=self.teacher).delete()
            Student.objects.bulk_create([
                Student(
                    teacher=self.teacher,
                    first_name=f"Имя{i}",
                    last_name=f"Фам{i}",
                    status="active",
                )
                for i in range(n)
            ])
            res = self.client.get("/api/cabinet/students/?status=active")
            self.assertEqual(res.status_code, 200)
            report[n] = len(res.content)
        print(f"\nSTUDENTS RESPONSE BYTES {report}")
        self.assertGreater(report[100], report[30])
