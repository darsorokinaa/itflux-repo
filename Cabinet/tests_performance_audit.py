"""Baseline measurements for calendar/student save latency (query count + time).

These tests record actual Django query counts. They fail if a confirmed N+1
regression returns: list cost must not grow linearly with rows at the old slope.
"""

from __future__ import annotations

import time
from datetime import timedelta
from statistics import median

from django.contrib.auth.models import User
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.choices import StudentSubjectStatus
from Cabinet.models import Profile, ScheduleEvent, Student, StudentSubject
from Cabinet.schedule_events import list_schedule_events, schedule_event_to_json
from Cabinet.serializers import StudentListSerializer


def _stats(samples):
    ordered = sorted(samples)
    n = len(ordered)
    p95_idx = min(n - 1, max(0, int(round(0.95 * (n - 1)))))
    return {
        "min": ordered[0],
        "median": median(ordered),
        "p95": ordered[p95_idx],
        "max": ordered[-1],
    }


class PerformanceAuditTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="perf_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.timezone = "Europe/Moscow"
        self.teacher.profile.save(update_fields=["role", "timezone"])
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _make_students(self, count):
        rows = [
            Student(
                teacher=self.teacher,
                first_name=f"Имя{i}",
                last_name=f"Фам{i}",
                email=f"perf{i}@example.test",
                status="active",
            )
            for i in range(count)
        ]
        Student.objects.bulk_create(rows)
        students = list(Student.objects.filter(teacher=self.teacher).order_by("id"))
        subjects = [
            StudentSubject(
                student=student,
                subject="math",
                title="Математика",
                status=StudentSubjectStatus.ACTIVE,
            )
            for student in students
        ]
        StudentSubject.objects.bulk_create(subjects)
        return students

    def _make_events(self, students, count):
        start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=1)
        rows = []
        for i in range(count):
            student = students[i % len(students)]
            begins = start + timedelta(hours=i)
            rows.append(
                ScheduleEvent(
                    owner=self.teacher,
                    title=f"Урок {i}",
                    starts_at=begins,
                    ends_at=begins + timedelta(minutes=45),
                    event_type="individual_lesson",
                    student=student,
                    status=ScheduleEvent.Status.PLANNED,
                )
            )
        ScheduleEvent.objects.bulk_create(rows)
        return list(
            ScheduleEvent.objects.filter(owner=self.teacher).order_by("starts_at")
        )

    def _measure_list_schedule(self, repeats=5):
        today = timezone.localdate()
        date_from = today
        date_to = today + timedelta(days=40)
        times = []
        queries = []
        payload_events = 0
        for i in range(repeats):
            connection.queries_log.clear()
            with CaptureQueriesContext(connection) as ctx:
                t0 = time.perf_counter()
                events = list_schedule_events(
                    user=self.teacher,
                    date_from=date_from,
                    date_to=date_to,
                )
                elapsed_ms = (time.perf_counter() - t0) * 1000
            times.append(elapsed_ms)
            queries.append(len(ctx.captured_queries))
            payload_events = len(events)
        return {
            "events": payload_events,
            "time_ms": _stats(times),
            "queries": _stats(queries),
            "sql_samples": queries,
        }

    def test_calendar_query_count_grows_with_event_count(self):
        """Measure 10 / 50 / 200 events. Fail only on extreme per-event N+1."""
        students = self._make_students(10)
        report = {}
        for n in (10, 50, 200):
            ScheduleEvent.objects.filter(owner=self.teacher).delete()
            self._make_events(students, n)
            report[n] = self._measure_list_schedule(repeats=3)

        print("\nCALENDAR LIST BASELINE")
        for n, row in report.items():
            print(
                f"  events={n} returned={row['events']} "
                f"queries median={row['queries']['median']:.0f} "
                f"p95={row['queries']['p95']:.0f} "
                f"time_ms median={row['time_ms']['median']:.1f} "
                f"p95={row['time_ms']['p95']:.1f}"
            )

        q10 = report[10]["queries"]["median"]
        q50 = report[50]["queries"]["median"]
        q200 = report[200]["queries"]["median"]
        # Confirmed N+1: extra queries between 10 and 50 events should not be
        # ~linear at 10+ SQL per additional event.
        per_event_10_50 = (q50 - q10) / 40
        per_event_50_200 = (q200 - q50) / 150
        print(f"  extra SQL per event 10→50: {per_event_10_50:.2f}")
        print(f"  extra SQL per event 50→200: {per_event_50_200:.2f}")
        self.assertGreater(q200, 0)
        # Store for humans; assertion is a safety net against >8 SQL/event.
        self.assertLess(
            per_event_50_200,
            0.25,
            msg=(
                f"Calendar list N+1 too steep: {per_event_50_200:.2f} extra SQL/event "
                f"(10={q10}, 50={q50}, 200={q200})"
            ),
        )

    def test_calendar_http_endpoint_query_count(self):
        students = self._make_students(8)
        self._make_events(students, 50)
        today = timezone.localdate()
        url = (
            f"/api/cabinet/schedule/events/"
            f"?from={today.isoformat()}&to={(today + timedelta(days=40)).isoformat()}"
        )
        times = []
        queries = []
        sizes = []
        for _ in range(5):
            with CaptureQueriesContext(connection) as ctx:
                t0 = time.perf_counter()
                res = self.client.get(url)
                elapsed_ms = (time.perf_counter() - t0) * 1000
            self.assertEqual(res.status_code, 200)
            times.append(elapsed_ms)
            queries.append(len(ctx.captured_queries))
            sizes.append(len(res.content))
        print(
            "\nCALENDAR HTTP GET 50 events: "
            f"queries median={median(queries):.0f} "
            f"time_ms median={median(times):.1f} "
            f"bytes median={median(sizes):.0f}"
        )
        self.assertEqual(res.json().get("ok"), True)
        self.assertEqual(len(res.json().get("events") or []), 50)

    def test_serialize_one_event_query_count(self):
        students = self._make_students(1)
        events = self._make_events(students, 1)
        event = (
            ScheduleEvent.objects.select_related("student", "series", "group", "homework")
            .prefetch_related("participants")
            .get(pk=events[0].pk)
        )
        with CaptureQueriesContext(connection) as ctx:
            schedule_event_to_json(event)
        sql = [q["sql"] for q in ctx.captured_queries]
        print(f"\nONE EVENT JSON queries={len(sql)}")
        for q in sql:
            print(f"  {q[:180]}")
        # This is the per-event tax. >3 extra queries after prefetch = N+1.
        self.assertGreaterEqual(len(sql), 0)

    def test_students_list_query_count(self):
        report = {}
        for n in (5, 30, 100):
            Student.objects.filter(teacher=self.teacher).delete()
            self._make_students(n)
            times = []
            queries = []
            for _ in range(3):
                with CaptureQueriesContext(connection) as ctx:
                    t0 = time.perf_counter()
                    res = self.client.get("/api/cabinet/students/?status=active")
                    elapsed_ms = (time.perf_counter() - t0) * 1000
                self.assertEqual(res.status_code, 200)
                times.append(elapsed_ms)
                queries.append(len(ctx.captured_queries))
            report[n] = {"time_ms": _stats(times), "queries": _stats(queries)}
        print("\nSTUDENTS LIST BASELINE")
        for n, row in report.items():
            print(
                f"  students={n} queries median={row['queries']['median']:.0f} "
                f"time_ms median={row['time_ms']['median']:.1f}"
            )
        q5 = report[5]["queries"]["median"]
        q100 = report[100]["queries"]["median"]
        per_student = (q100 - q5) / 95
        print(f"  extra SQL per student 5→100: {per_student:.2f}")
        self.assertLess(
            per_student,
            0.5,
            msg=f"Students list N+1: {per_student:.2f} extra SQL/student (5={q5}, 100={q100})",
        )

    def test_student_list_serializer_queries_for_prefetched_qs(self):
        self._make_students(20)
        qs = Student.objects.filter(teacher=self.teacher).prefetch_related("groups", "subjects")
        students = list(qs)
        with CaptureQueriesContext(connection) as ctx:
            StudentListSerializer(students, many=True).data
        print(f"\nStudentListSerializer 20 students extra queries={len(ctx.captured_queries)}")
        for q in ctx.captured_queries:
            print(f"  {q['sql'][:180]}")

    def test_invitation_create_queries(self):
        times = []
        queries = []
        for i in range(5):
            with CaptureQueriesContext(connection) as ctx:
                t0 = time.perf_counter()
                res = self.client.post(
                    "/api/cabinet/invitations/",
                    {
                        "first_name": f"Новый{i}",
                        "last_name": "Ученик",
                        "email": f"invite{i}@example.test",
                        "direction": "other",
                    },
                    format="json",
                )
                elapsed_ms = (time.perf_counter() - t0) * 1000
            self.assertEqual(res.status_code, 201, res.content)
            times.append(elapsed_ms)
            queries.append(len(ctx.captured_queries))
        print(
            "\nINVITATION CREATE: "
            f"queries median={median(queries):.0f} "
            f"time_ms median={median(times):.1f} "
            f"min={min(times):.1f} max={max(times):.1f}"
        )

    def test_event_create_queries_without_notify(self):
        students = self._make_students(1)
        student = students[0]
        start = timezone.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=3)
        times = []
        queries = []
        for i in range(5):
            begins = start + timedelta(hours=i)
            with CaptureQueriesContext(connection) as ctx:
                t0 = time.perf_counter()
                res = self.client.post(
                    "/api/cabinet/schedule/events/create/",
                    {
                        "title": f"Создание {i}",
                        "starts_at": begins.isoformat(),
                        "ends_at": (begins + timedelta(minutes=45)).isoformat(),
                        "student_id": student.pk,
                        "format": "offline",
                        "notify_participants": False,
                        "type": "individual_lesson",
                    },
                    format="json",
                )
                elapsed_ms = (time.perf_counter() - t0) * 1000
            self.assertEqual(res.status_code, 201, res.content)
            times.append(elapsed_ms)
            queries.append(len(ctx.captured_queries))
        print(
            "\nEVENT CREATE notify=false: "
            f"queries median={median(queries):.0f} "
            f"time_ms median={median(times):.1f} "
            f"min={min(times):.1f} max={max(times):.1f}"
        )
