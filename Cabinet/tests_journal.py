"""Тесты электронного журнала успеваемости."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.billing_models import DeliveryStatus
from Cabinet.journal_models import (
    AttendanceStatus,
    JournalAuditLog,
    JournalStatus,
    LessonJournal,
    PreviousHomeworkStatus,
    RecordPublishStatus,
    StudentCriterionScore,
    StudentLessonRecord,
)
from Cabinet.journal_service import (
    JournalError,
    attendance_report,
    attendance_to_delivery_status,
    complete_journal,
    compute_overall_score,
    get_or_create_journal,
    publish_record,
    update_journal,
    update_lesson_topics,
)
from Cabinet.choices import (
    Direction,
    EnrollmentStatus,
    ExamType,
    PlanFormat,
    PlanStatus,
    PlanSubject,
    SubmissionStatus,
)
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    LessonPlan,
    LessonPlanEnrollment,
    LessonPlanItem,
    Profile,
    ScheduleEvent,
    Student,
    StudentGroup,
)


class JournalTestBase(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username="j_teacher", email="jt@test.ru", password="StrongPass123!"
        )
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.other_teacher = User.objects.create_user(
            username="j_other", email="jo@test.ru", password="StrongPass123!"
        )
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()

        self.student_user = User.objects.create_user(
            username="j_student", email="js@test.ru", password="StrongPass123!"
        )
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Анна",
            last_name="Иванова",
            direction="oge",
        )
        self.student2 = Student.objects.create(
            teacher=self.teacher,
            first_name="Борис",
            last_name="Петров",
            direction="oge",
        )
        self.group = StudentGroup.objects.create(teacher=self.teacher, title="ОГЭ-1")
        self.group.students.add(self.student, self.student2)

        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _individual_event(self, **kwargs):
        starts = timezone.now() - timedelta(hours=1)
        ends = starts + timedelta(minutes=60)
        return ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Индивидуальный урок",
            topic="Системы счисления",
            starts_at=starts,
            ends_at=ends,
            student=self.student,
            event_type=ScheduleEvent.EventType.INDIVIDUAL_LESSON,
            status=ScheduleEvent.Status.PLANNED,
            **kwargs,
        )

    def _group_event(self, **kwargs):
        starts = timezone.now() - timedelta(hours=1)
        ends = starts + timedelta(minutes=90)
        return ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Групповой урок",
            topic="Алгоритмы",
            starts_at=starts,
            ends_at=ends,
            group=self.group,
            event_type=ScheduleEvent.EventType.GROUP_LESSON,
            status=ScheduleEvent.Status.PLANNED,
            **kwargs,
        )


class JournalModelTests(JournalTestBase):
    def test_create_individual_journal(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        self.assertEqual(journal.planned_topic, "Системы счисления")
        self.assertEqual(journal.student_records.count(), 1)
        self.assertEqual(journal.status, JournalStatus.DRAFT)

    def test_create_group_journal(self):
        event = self._group_event()
        journal = get_or_create_journal(event, self.teacher)
        self.assertEqual(journal.student_records.count(), 2)
        self.assertTrue(journal.group_id)

    def test_unique_student_per_journal(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        with self.assertRaises(IntegrityError):
            StudentLessonRecord.objects.create(
                journal=journal,
                student=self.student,
                attendance_status=AttendanceStatus.PRESENT,
            )

    def test_mark_present_late_partial_absent(self):
        event = self._group_event()
        journal = get_or_create_journal(event, self.teacher)
        r1 = journal.student_records.get(student=self.student)
        r2 = journal.student_records.get(student=self.student2)
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": r1.id,
                        "attendance_status": AttendanceStatus.LATE,
                        "late_minutes": 10,
                    },
                    {
                        "id": r2.id,
                        "attendance_status": AttendanceStatus.ABSENT_UNEXCUSED,
                    },
                ]
            },
        )
        r1.refresh_from_db()
        r2.refresh_from_db()
        self.assertEqual(r1.attendance_status, AttendanceStatus.LATE)
        self.assertEqual(r1.late_minutes, 10)
        self.assertEqual(r2.attendance_status, AttendanceStatus.ABSENT_UNEXCUSED)
        for sc in r2.criterion_scores.all():
            self.assertTrue(sc.is_not_applicable)

    def test_criterion_score_and_out_of_range(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get()
        crit = record.criterion_scores.first().criterion
        with self.assertRaises(JournalError):
            update_journal(
                journal,
                self.teacher,
                {
                    "student_records": [
                        {
                            "id": record.id,
                            "attendance_status": AttendanceStatus.PRESENT,
                            "criterion_scores": [
                                {"criterion_id": crit.id, "value": "99"}
                            ],
                        }
                    ]
                },
            )
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": record.id,
                        "attendance_status": AttendanceStatus.PRESENT,
                        "criterion_scores": [
                            {"criterion_id": crit.id, "value": "4"}
                        ],
                    }
                ]
            },
        )
        score = StudentCriterionScore.objects.get(student_record=record, criterion=crit)
        self.assertEqual(score.value, Decimal("4"))

    def test_not_applicable_criterion(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get()
        crit = record.criterion_scores.first().criterion
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": record.id,
                        "criterion_scores": [
                            {
                                "criterion_id": crit.id,
                                "is_not_applicable": True,
                                "value": "5",
                            }
                        ],
                    }
                ]
            },
        )
        score = StudentCriterionScore.objects.get(student_record=record, criterion=crit)
        self.assertTrue(score.is_not_applicable)
        self.assertIsNone(score.value)

    def test_public_and_private_comments(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get()
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": record.id,
                        "teacher_comment": "Публичный",
                        "private_note": "Секрет",
                    }
                ]
            },
        )
        record.refresh_from_db()
        self.assertEqual(record.teacher_comment, "Публичный")
        self.assertEqual(record.private_note, "Секрет")

    def test_student_cannot_see_private_note(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get()
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": record.id,
                        "attendance_status": AttendanceStatus.PRESENT,
                        "teacher_comment": "Ок",
                        "private_note": "Секрет",
                    }
                ]
            },
        )
        complete_journal(journal, self.teacher, force=True)
        publish_record(record, self.teacher, notify=False)
        student_client = APIClient()
        student_client.force_login(self.student_user)
        resp = student_client.get(f"/api/cabinet/student/results/{record.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("private_note", resp.data)
        self.assertEqual(resp.data["teacher_comment"], "Ок")

    def test_draft_complete_publish_edit(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        self.assertEqual(journal.status, JournalStatus.DRAFT)
        record = journal.student_records.get()
        update_journal(
            journal,
            self.teacher,
            {
                "actual_topic": "Перевод чисел",
                "student_records": [
                    {"id": record.id, "attendance_status": AttendanceStatus.PRESENT}
                ],
            },
        )
        journal = complete_journal(journal, self.teacher)
        self.assertEqual(journal.status, JournalStatus.COMPLETED)
        publish_record(record, self.teacher, notify=False)
        record.refresh_from_db()
        self.assertEqual(record.publish_status, RecordPublishStatus.PUBLISHED)
        update_journal(
            journal,
            self.teacher,
            {
                "version": journal.version,
                "student_records": [
                    {"id": record.id, "teacher_comment": "Обновлено"}
                ],
            },
        )
        record.refresh_from_db()
        self.assertEqual(record.publish_status, RecordPublishStatus.EDITED_AFTER_PUBLISH)

    def test_homework_link(self):
        hw = Homework.objects.create(teacher=self.teacher, title="ДЗ1", student=self.student)
        event = self._individual_event(homework=hw)
        journal = get_or_create_journal(event, self.teacher)
        self.assertEqual(journal.homework_id, hw.id)

    def test_attendance_maps_to_billing_delivery(self):
        self.assertEqual(
            attendance_to_delivery_status(AttendanceStatus.PRESENT),
            DeliveryStatus.CONDUCTED,
        )
        self.assertEqual(
            attendance_to_delivery_status(AttendanceStatus.ABSENT_UNEXCUSED),
            DeliveryStatus.NO_SHOW,
        )

    def test_group_with_absent_student(self):
        event = self._group_event()
        journal = get_or_create_journal(event, self.teacher)
        r1 = journal.student_records.get(student=self.student)
        r2 = journal.student_records.get(student=self.student2)
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {"id": r1.id, "attendance_status": AttendanceStatus.PRESENT},
                    {"id": r2.id, "attendance_status": AttendanceStatus.ABSENT_EXCUSED},
                ]
            },
        )
        self.assertEqual(journal.student_records.count(), 2)

    def test_other_teacher_forbidden(self):
        event = self._individual_event()
        other_client = APIClient()
        other_client.force_login(self.other_teacher)
        resp = other_client.get(f"/api/cabinet/journal/lessons/{event.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_student_cannot_edit(self):
        event = self._individual_event()
        student_client = APIClient()
        student_client.force_login(self.student_user)
        resp = student_client.patch(
            f"/api/cabinet/journal/lessons/{event.id}/",
            {"actual_topic": "Хак"},
            format="json",
        )
        self.assertIn(resp.status_code, {403, 404})

    def test_attendance_report(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get()
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": record.id,
                        "attendance_status": AttendanceStatus.LATE,
                        "late_minutes": 5,
                    }
                ]
            },
        )
        report = attendance_report(self.teacher, student_id=self.student.id)
        self.assertEqual(report["late"], 1)
        self.assertEqual(report["total_late_minutes"], 5)

    def test_auto_overall_score(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get()
        scores_payload = []
        for sc in record.criterion_scores.all()[:3]:
            scores_payload.append({"criterion_id": sc.criterion_id, "value": "4"})
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": record.id,
                        "attendance_status": AttendanceStatus.PRESENT,
                        "criterion_scores": scores_payload,
                        "overall_score_manual": False,
                    }
                ]
            },
        )
        record.refresh_from_db()
        self.assertIsNotNone(record.overall_score)
        # Критерии 1–5 со значением 4 → 75%
        self.assertEqual(float(record.overall_score), 75.0)
        self.assertIn("Среднее", record.overall_score_explanation)
        self.assertIn("%", record.overall_score_explanation)

    def test_double_create_idempotent(self):
        event = self._individual_event()
        j1 = get_or_create_journal(event, self.teacher)
        j2 = get_or_create_journal(event, self.teacher)
        self.assertEqual(j1.id, j2.id)
        self.assertEqual(LessonJournal.objects.filter(schedule_event=event).count(), 1)

    def test_audit_log(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get()
        update_journal(
            journal,
            self.teacher,
            {
                "actual_topic": "Новая тема",
                "student_records": [
                    {"id": record.id, "attendance_status": AttendanceStatus.PRESENT}
                ],
            },
        )
        self.assertTrue(
            JournalAuditLog.objects.filter(journal=journal, action="update").exists()
        )

    @patch("Cabinet.journal_notifications.send_telegram_to_user", return_value=True)
    def test_telegram_on_publish_not_on_autosave(self, mock_tg):
        from Cabinet.notifications import get_or_create_preferences

        prefs = get_or_create_preferences(self.student_user)
        prefs.telegram_enabled = True
        prefs.telegram_chat_id = "123456"
        prefs.notify_journal_results = True
        prefs.save()

        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get()
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": record.id,
                        "attendance_status": AttendanceStatus.PRESENT,
                        "teacher_comment": "Хорошо",
                    }
                ]
            },
        )
        mock_tg.assert_not_called()
        complete_journal(journal, self.teacher, force=True)
        publish_record(record, self.teacher, notify=True)
        mock_tg.assert_called()
        # повторное автосохранение не шлёт
        mock_tg.reset_mock()
        update_journal(
            journal,
            self.teacher,
            {
                "version": LessonJournal.objects.get(pk=journal.pk).version,
                "student_records": [
                    {"id": record.id, "teacher_comment": "Правка без notify"}
                ],
            },
        )
        mock_tg.assert_not_called()

    def test_api_create_and_complete(self):
        event = self._individual_event()
        resp = self.client.get(f"/api/cabinet/journal/lessons/{event.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["planned_topic"], "Системы счисления")
        record_id = resp.data["student_records"][0]["id"]
        resp = self.client.patch(
            f"/api/cabinet/journal/lessons/{event.id}/",
            {
                "actual_topic": "Перевод чисел",
                "version": resp.data["version"],
                "student_records": [
                    {
                        "id": record_id,
                        "attendance_status": AttendanceStatus.PRESENT,
                        "teacher_comment": "Отлично",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        resp = self.client.post(
            f"/api/cabinet/journal/lessons/{event.id}/complete/",
            {},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], JournalStatus.COMPLETED)

    def test_analytics_insufficient_data(self):
        resp = self.client.get(
            f"/api/cabinet/journal/analytics/?student_id={self.student.id}"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["enough_data"])

    def test_student_journal_includes_performance_summary(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        record = journal.student_records.get(student=self.student)
        update_journal(
            journal,
            self.teacher,
            {
                "previous_homework_status": "full",
                "student_records": [
                    {
                        "id": record.id,
                        "attendance_status": AttendanceStatus.PRESENT,
                        "overall_score": "90",
                        "overall_score_manual": True,
                        "variant_result": {
                            "score_percent": 80,
                            "tasks": [{"ok": True}, {"ok": False}],
                        },
                    }
                ],
            },
        )
        resp = self.client.get(f"/api/cabinet/journal/students/{self.student.id}/")
        self.assertEqual(resp.status_code, 200)
        summary = resp.data.get("summary") or {}
        self.assertEqual(summary.get("scope"), "student")
        self.assertIsNotNone(summary.get("lesson_work", {}).get("avg_score"))
        self.assertIn("homework", summary)
        self.assertIn("attendance", summary)
        self.assertIn("score_series", summary)
        criteria = summary.get("criteria") or []
        self.assertTrue(criteria)
        self.assertTrue(any((c.get("description") or "").strip() for c in criteria))

    def test_performance_summary_counts_homework_score_and_variant(self):
        prev_hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ для сводки",
            description="Задачи",
        )
        HomeworkSubmission.objects.create(
            homework=prev_hw,
            student=self.student,
            submitted_at=timezone.now() - timedelta(days=1),
            status=SubmissionStatus.CHECKED,
            score=75,
            result_payload={"checked": {"1": True}},
        )
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        journal.previous_homework = prev_hw
        # Устаревший статус в журнале — сводка должна взять актуальный из сдачи.
        journal.previous_homework_status = PreviousHomeworkStatus.NOT_REVIEWED
        journal.save(
            update_fields=["previous_homework", "previous_homework_status", "updated_at"]
        )
        record = journal.student_records.get(student=self.student)
        record.attendance_status = AttendanceStatus.PRESENT
        record.variant_result = {
            "score_percent": 90,
            "tasks": [{"ok": True}, {"ok": True}],
        }
        record.save(update_fields=["attendance_status", "variant_result", "updated_at"])

        resp = self.client.get(f"/api/cabinet/journal/students/{self.student.id}/")
        self.assertEqual(resp.status_code, 200)
        summary = resp.data.get("summary") or {}
        lesson = summary.get("lesson_work") or {}
        homework = summary.get("homework") or {}
        self.assertEqual(lesson.get("avg_variant_score"), 90.0)
        self.assertEqual(lesson.get("avg_score"), 90.0)
        self.assertEqual(homework.get("avg_score"), 75.0)
        self.assertIsNotNone(summary.get("composite_index"))
        self.assertGreater(summary["composite_index"], 0)

    def test_gradebook_matrix_group(self):
        event = self._group_event()
        journal = get_or_create_journal(event, self.teacher)
        r1 = journal.student_records.get(student=self.student)
        r2 = journal.student_records.get(student=self.student2)
        update_journal(
            journal,
            self.teacher,
            {
                "student_records": [
                    {
                        "id": r1.id,
                        "attendance_status": AttendanceStatus.PRESENT,
                        "overall_score": "85",
                        "overall_score_manual": True,
                    },
                    {
                        "id": r2.id,
                        "attendance_status": AttendanceStatus.ABSENT_UNEXCUSED,
                    },
                ]
            },
        )
        resp = self.client.get(
            f"/api/cabinet/journal/gradebook/?group_id={self.group.id}"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["scope"]["type"], "group")
        self.assertGreaterEqual(len(resp.data["students"]), 2)
        self.assertEqual(len(resp.data["columns"]), 1)
        col = resp.data["columns"][0]
        self.assertEqual(col["cells"][str(self.student.id)]["display"], "85%")
        self.assertEqual(col["cells"][str(self.student2.id)]["display"], "н")


class JournalHomeworkResultTests(JournalTestBase):
    def test_journal_and_student_results_include_homework_result(self):
        prev_hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ к прошлому уроку",
            description="Решите задачи",
        )
        HomeworkSubmission.objects.create(
            homework=prev_hw,
            student=self.student,
            submitted_at=timezone.now() - timedelta(days=1),
            status=SubmissionStatus.CHECKED,
            score=88,
            teacher_comment="Хорошо",
            answer_text="Ответ ученика",
            result_payload={
                "checked": {"101": True, "102": False},
                "by_task_id": {"101": "1", "102": "0"},
            },
        )
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        journal.previous_homework = prev_hw
        journal.previous_homework_status = "full"
        journal.lesson_summary = "Разобрали системы счисления"
        journal.save(
            update_fields=[
                "previous_homework",
                "previous_homework_status",
                "lesson_summary",
                "updated_at",
            ]
        )
        record = journal.student_records.get(student=self.student)
        publish_record(record, self.teacher)

        resp = self.client.get(f"/api/cabinet/journal/lessons/{event.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["previous_homework"]["id"], prev_hw.id)
        hw_result = resp.data["student_records"][0]["homework_result"]
        self.assertIsNotNone(hw_result)
        self.assertEqual(hw_result["homework_id"], prev_hw.id)
        self.assertEqual(hw_result["status"], "checked")
        self.assertEqual(float(hw_result["score_percent"]), 88.0)
        self.assertEqual(hw_result["teacher_comment"], "Хорошо")
        self.assertEqual(hw_result["answer_text"], "Ответ ученика")

        self.client.force_login(self.student_user)
        list_resp = self.client.get("/api/cabinet/student/results/")
        self.assertEqual(list_resp.status_code, 200)
        items = list_resp.data["results"]
        self.assertTrue(items)
        item = next(i for i in items if i["id"] == record.id)
        self.assertEqual(item["homework_result"]["homework_id"], prev_hw.id)
        self.assertEqual(float(item["homework_result"]["score_percent"]), 88.0)
        for task in item["homework_result"].get("tasks") or []:
            self.assertNotIn("correct_answer", task)

        detail_resp = self.client.get(f"/api/cabinet/student/results/{record.id}/")
        self.assertEqual(detail_resp.status_code, 200)
        self.assertEqual(detail_resp.data["lesson_summary"], "Разобрали системы счисления")
        self.assertEqual(detail_resp.data["homework_result"]["title"], "ДЗ к прошлому уроку")
        self.assertEqual(detail_resp.data["previous_homework_status"], "full")


class JournalTopicsSyncTests(JournalTestBase):
    def test_planned_topic_resolves_plan_slot_without_explicit_link(self):
        """Журнал должен видеть ту же тему, что и календарь (slot-резолвинг),
        даже если event.topic пуст и нет явной FK lesson_plan_item."""
        plan = LessonPlan.objects.create(
            teacher=self.teacher, title="План", direction=Direction.OGE,
            subject=PlanSubject.INFORMATICS, exam_type=ExamType.OGE, status=PlanStatus.PUBLISHED,
        )
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher, plan=plan, student=self.student,
            format=PlanFormat.INDIVIDUAL, status=EnrollmentStatus.ACTIVE,
        )
        LessonPlanItem.objects.create(plan=plan, order=1, title="Слот 1", topic="Тема из слота плана")
        event = self._individual_event()
        event.topic = ""
        event.save(update_fields=["topic"])

        journal = get_or_create_journal(event, self.teacher)
        self.assertEqual(journal.planned_topic, "Тема из слота плана")

    def test_calendar_topic_edit_syncs_existing_draft_journal(self):
        """Правка темы в карточке урока (lesson_and_plan) не должна замораживать
        journal.planned_topic на моменте создания записи журнала."""
        from Cabinet.lesson_plan_content_sync import LessonLearningPlanSyncService

        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        self.assertEqual(journal.planned_topic, "Системы счисления")

        LessonLearningPlanSyncService.apply_lesson_edit(
            event, {"topic": "Новая тема из календаря"},
            teacher=self.teacher, sync_action="lesson_and_plan",
        )
        journal.refresh_from_db()
        self.assertEqual(journal.planned_topic, "Новая тема из календаря")

    def test_finalized_journal_not_overwritten_by_calendar_edit(self):
        """Если факт по теме уже проставлен (или журнал завершён), календарь
        больше не должен молча переписывать журнал."""
        from Cabinet.lesson_plan_content_sync import LessonLearningPlanSyncService

        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        journal.actual_topic = "Уже проведено по факту"
        journal.save(update_fields=["actual_topic"])

        LessonLearningPlanSyncService.apply_lesson_edit(
            event, {"topic": "Попытка переписать после факта"},
            teacher=self.teacher, sync_action="lesson_and_plan",
        )
        journal.refresh_from_db()
        self.assertEqual(journal.planned_topic, "Системы счисления")
        self.assertEqual(journal.actual_topic, "Уже проведено по факту")

    def test_create_journal_keeps_actual_topic_empty(self):
        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        self.assertEqual(journal.planned_topic, "Системы счисления")
        self.assertEqual(journal.actual_topic, "")

    def test_update_planned_topic_syncs_event_and_plan_item(self):
        plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="План",
            direction=Direction.OGE,
            subject=PlanSubject.INFORMATICS,
            exam_type=ExamType.OGE,
            status=PlanStatus.PUBLISHED,
        )
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=plan,
            student=self.student,
            format=PlanFormat.INDIVIDUAL,
            status=EnrollmentStatus.ACTIVE,
        )
        item = LessonPlanItem.objects.create(
            plan=plan,
            order=1,
            title="Старая тема",
            topic="Старая тема",
        )
        event = self._individual_event(lesson_plan_item=item)
        item.scheduled_event = event
        item.save(update_fields=["scheduled_event", "updated_at"])
        journal = get_or_create_journal(event, self.teacher)

        journal = update_lesson_topics(
            journal,
            self.teacher,
            {"planned_topic": "Перевод чисел"},
        )
        event.refresh_from_db()
        item.refresh_from_db()
        journal.refresh_from_db()

        self.assertEqual(journal.planned_topic, "Перевод чисел")
        self.assertEqual(journal.actual_topic, "")
        self.assertEqual(event.topic, "Перевод чисел")
        self.assertEqual(item.topic, "Перевод чисел")

    def test_actual_topic_does_not_change_plan(self):
        plan = LessonPlan.objects.create(
            teacher=self.teacher,
            title="План",
            direction=Direction.OGE,
            subject=PlanSubject.INFORMATICS,
            exam_type=ExamType.OGE,
            status=PlanStatus.PUBLISHED,
        )
        LessonPlanEnrollment.objects.create(
            teacher=self.teacher,
            plan=plan,
            student=self.student,
            format=PlanFormat.INDIVIDUAL,
            status=EnrollmentStatus.ACTIVE,
        )
        item = LessonPlanItem.objects.create(
            plan=plan,
            order=1,
            title="Системы счисления",
            topic="Системы счисления",
        )
        event = self._individual_event(lesson_plan_item=item)
        journal = get_or_create_journal(event, self.teacher)

        update_lesson_topics(
            journal,
            self.teacher,
            {"actual_topic": "Практика ОГЭ по переводу"},
        )
        event.refresh_from_db()
        item.refresh_from_db()
        journal.refresh_from_db()

        self.assertEqual(journal.planned_topic, "Системы счисления")
        self.assertEqual(journal.actual_topic, "Практика ОГЭ по переводу")
        self.assertEqual(event.topic, "Системы счисления")
        self.assertEqual(item.topic, "Системы счисления")

    def test_topics_api_partial_update_keeps_both_fields(self):
        from rest_framework.test import APIRequestFactory, force_authenticate
        from Cabinet.journal_api import JournalLessonTopicsView
        from Cabinet.journal_service import serialize_journal

        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        self.assertEqual(journal.planned_topic, "Системы счисления")
        self.assertEqual(journal.actual_topic, "")

        factory = APIRequestFactory()
        req = factory.patch(
            f"/api/cabinet/journal/lessons/{event.id}/topics/",
            {
                "planned_topic": "Системы счисления. Перевод чисел",
                "actual_topic": "Перевод из десятичной в двоичную",
                "version": journal.version,
            },
            format="json",
        )
        force_authenticate(req, user=self.teacher)
        resp = JournalLessonTopicsView.as_view()(req, lesson_id=event.id)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["planned_topic"], "Системы счисления. Перевод чисел")
        self.assertEqual(resp.data["actual_topic"], "Перевод из десятичной в двоичную")

        req2 = factory.patch(
            f"/api/cabinet/journal/lessons/{event.id}/topics/",
            {"actual_topic": "Только практика ОГЭ"},
            format="json",
        )
        force_authenticate(req2, user=self.teacher)
        resp2 = JournalLessonTopicsView.as_view()(req2, lesson_id=event.id)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.data["planned_topic"], "Системы счисления. Перевод чисел")
        self.assertEqual(resp2.data["actual_topic"], "Только практика ОГЭ")

        # serialize_journal отдаёт оба поля раздельно
        data = serialize_journal(
            LessonJournal.objects.select_related("schedule_event").prefetch_related(
                "student_records"
            ).get(pk=journal.pk)
        )
        self.assertEqual(data["planned_topic"], "Системы счисления. Перевод чисел")
        self.assertEqual(data["actual_topic"], "Только практика ОГЭ")

    def test_student_journal_list_exposes_both_topics(self):
        from rest_framework.test import APIRequestFactory, force_authenticate
        from Cabinet.journal_api import JournalStudentView

        event = self._individual_event()
        journal = get_or_create_journal(event, self.teacher)
        update_lesson_topics(
            journal,
            self.teacher,
            {
                "planned_topic": "План А",
                "actual_topic": "Факт Б",
            },
        )
        factory = APIRequestFactory()
        req = factory.get(f"/api/cabinet/journal/students/{self.student.id}/")
        force_authenticate(req, user=self.teacher)
        resp = JournalStudentView.as_view()(req, student_id=self.student.id)
        self.assertEqual(resp.status_code, 200)
        lesson = resp.data["lessons"][0]
        self.assertEqual(lesson["planned_topic"], "План А")
        self.assertEqual(lesson["actual_topic"], "Факт Б")
