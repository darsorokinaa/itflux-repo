"""Файл отчёта в журнале совпадает с PDF после «Завершить вариант»."""

import json
from email.header import decode_header
from unittest import mock

from django.template.loader import render_to_string

from Cabinet.lesson_variant_report import build_finish_variant_report_data
from Cabinet.lesson_variant_results import lesson_variant_marker
from Cabinet.models import Homework, HomeworkSubmission
from Cabinet.tests_journal import JournalTestBase
from Generator.models import Level, Subject, Variant
from Generator.report_download import finish_variant_report_filename


class _FakeHTML:
    def __init__(self, *args, **kwargs):
        pass

    def write_pdf(self):
        return b"%PDF-1.4 finish-variant"


def _header_text(value):
    parts = []
    for chunk, encoding in decode_header(value):
        parts.append(chunk.decode(encoding or "utf-8") if isinstance(chunk, bytes) else chunk)
    return "".join(parts)


def _scoring(*, earned, maximum, review="final", pending=0, tasks=None):
    return {
        "scoring": {
            "review_status": review,
            "percentage": None if review != "final" else (0 if not maximum else round(earned * 100 / maximum, 2)),
            "earned_points": earned,
            "max_points": maximum,
            "pending_review_count": pending,
            "tasks": tasks or [],
        }
    }


class JournalVariantReportFileTests(JournalTestBase):
    def setUp(self):
        super().setUp()
        subject, _ = Subject.objects.get_or_create(subject_short="inf", defaults={"subject_name": "Информатика"})
        level, _ = Level.objects.get_or_create(level="ege", defaults={"level_rus": "ЕГЭ"})
        self.variant = Variant.objects.create(var_subject=subject, level=level, title="Дроби")
        self.other = Variant.objects.create(var_subject=subject, level=level, title="Проценты")
        self.event = self._group_event()
        self.hw = self._homework(self.event, self.variant.id)
        self.hw_other = self._homework(self.event, self.other.id)
        self.sub = HomeworkSubmission.objects.create(
            homework=self.hw,
            student=self.student,
            status="checked",
            result_payload=_scoring(
                earned=1,
                maximum=1,
                tasks=[{"id": 11, "number": 1, "status": "correct", "points": 1, "max_points": 1}],
            ),
        )
        HomeworkSubmission.objects.create(
            homework=self.hw,
            student=self.student2,
            status="checked",
            result_payload=_scoring(
                earned=9,
                maximum=9,
                tasks=[{"id": 21, "number": 1, "status": "correct", "points": 9, "max_points": 9}],
            ),
        )
        HomeworkSubmission.objects.create(
            homework=self.hw_other,
            student=self.student,
            status="submitted",
            result_payload=_scoring(
                earned=0,
                maximum=5,
                review="pending_review",
                pending=1,
                tasks=[{"id": 31, "number": 13, "status": "pending_review", "points": 0, "max_points": 5}],
            ),
        )

    def _homework(self, event, variant_id):
        return Homework.objects.create(
            teacher=self.teacher,
            group=event.group,
            title=f"Вариант №{variant_id}",
            description=f"{lesson_variant_marker(event.pk)}{variant_id}\nПоказан на уроке",
            status="assigned",
        )

    def _url(self, event, variant, student):
        return (
            f"/api/cabinet/journal/lessons/{event.pk}/variants/{variant}/report/"
            f"?student_id={student.pk}"
        )

    def _capture(self, call):
        captured = {}
        real = render_to_string

        def grab(name, ctx=None, *args, **kwargs):
            html = real(name, ctx, *args, **kwargs)
            captured["html"] = html
            captured["template"] = name
            return html

        with mock.patch("Generator.views.render_to_string", side_effect=grab), mock.patch(
            "Generator.views.WeasyHTML", _FakeHTML
        ), mock.patch("Generator.views._WEASYPRINT_OK", True):
            response = call()
        return response, captured

    def test_journal_file_matches_finish_variant_pdf(self):
        data = build_finish_variant_report_data(
            student_name="Анна Иванова",
            submission=self.sub,
            variant_id=self.variant.id,
            lesson_date=self.event.starts_at.date(),
        )
        journal, journal_html = self._capture(
            lambda: self.client.get(self._url(self.event, self.variant.id, self.student))
        )
        direct, direct_html = self._capture(
            lambda: self.client.post(
                "/api/ege/inf/report-pdf/",
                data=json.dumps(data),
                content_type="application/json",
            )
        )
        filename = finish_variant_report_filename("Анна Иванова")
        self.assertEqual(filename, "report-Анна Иванова.pdf")
        for response in (journal, direct):
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], "application/pdf")
            self.assertIn(filename, _header_text(response["Content-Disposition"]))
            self.assertTrue(response.content.startswith(b"%PDF-1.4"))
        self.assertEqual(journal["Content-Disposition"], direct["Content-Disposition"])
        self.assertEqual(journal_html["template"], "report_template.html")
        self.assertEqual(journal_html["html"], direct_html["html"])
        self.assertIn("1 / 1", journal_html["html"])
        self.assertNotIn("9 / 9", journal_html["html"])
        self.assertNotIn("секрет учителя", journal_html["html"])

    def test_other_student_gets_only_their_submission(self):
        response, captured = self._capture(
            lambda: self.client.get(self._url(self.event, self.variant.id, self.student2))
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("9 / 9", captured["html"])
        self.assertNotIn("1 / 1", captured["html"])
        self.assertIn("report-Борис Петров.pdf", _header_text(response["Content-Disposition"]))

    def test_pending_is_not_a_zero_pdf_and_final_zero_is(self):
        pending, _ = self._capture(
            lambda: self.client.get(self._url(self.event, self.other.id, self.student))
        )
        self.assertEqual(pending.status_code, 409)
        self.assertIn("application/json", pending["Content-Type"])
        self.assertEqual(pending.json()["code"], "report_not_ready")
        self.assertFalse(pending.content.startswith(b"%PDF"))

        zero_variant = Variant.objects.create(var_subject=self.variant.var_subject, level=self.variant.level)
        zero_hw = self._homework(self.event, zero_variant.id)
        HomeworkSubmission.objects.create(
            homework=zero_hw,
            student=self.student,
            status="checked",
            result_payload=_scoring(
                earned=0,
                maximum=5,
                tasks=[{"id": 41, "number": 2, "status": "incorrect", "points": 0, "max_points": 5}],
            ),
        )
        response, captured = self._capture(
            lambda: self.client.get(self._url(self.event, zero_variant.id, self.student))
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertIn("0 / 5", captured["html"])

    def test_permissions_and_other_lesson(self):
        self.client.force_login(self.student_user)
        own, _ = self._capture(lambda: self.client.get(self._url(self.event, self.variant.id, self.student)))
        self.assertEqual(own.status_code, 200)
        denied = self.client.get(self._url(self.event, self.variant.id, self.student2))
        self.assertEqual(denied.status_code, 403)

        self.client.force_login(self.other_teacher)
        foreign = self.client.get(self._url(self.event, self.variant.id, self.student))
        self.assertEqual(foreign.status_code, 403)

        self.client.force_login(self.teacher)
        other_event = self._individual_event()
        missing = self.client.get(self._url(other_event, self.variant.id, self.student))
        self.assertEqual(missing.status_code, 404)

    def test_list_exposes_file_only_for_checked_variant(self):
        from Cabinet.journal_service import get_or_create_journal
        from Cabinet.lesson_variant_results import lesson_variant_results_for_record

        journal = get_or_create_journal(self.event, self.teacher)
        record = journal.student_records.get(student=self.student)
        record.private_note = "секрет учителя"
        record.save(update_fields=["private_note"])
        rows = {item["variant_id"]: item for item in lesson_variant_results_for_record(record)}
        self.assertTrue(rows[self.variant.id]["report_ready"])
        self.assertIn(f"/variants/{self.variant.id}/report/", rows[self.variant.id]["report_url"])
        self.assertIn(f"student_id={self.student.id}", rows[self.variant.id]["report_url"])
        self.assertEqual(rows[self.variant.id]["report_filename"], "report-Анна Иванова.pdf")
        self.assertFalse(rows[self.other.id]["report_ready"])
        self.assertIsNone(rows[self.other.id]["report_url"])
