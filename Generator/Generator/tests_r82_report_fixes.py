# -*- coding: utf-8 -*-
"""r82: PDF-отчёт по варианту — строка «Тестовые баллы» и подбор педагогических рекомендаций."""
import json
import re
from unittest import mock

from django.template.loader import render_to_string
from django.test import SimpleTestCase, TestCase

from Generator import report_pedagogy as rp
from Generator.views import report_score_exam_value

# Правило владельца для автоматических текстов: без обещаний результата, сроков и количества занятий.
FORBIDDEN_RE = re.compile(r"\d|заняти|урок|недел|месяц|гарант|обязательно|точно сда|повысит", re.I)


def _summary_rows(html: str) -> dict[str, str]:
    block = html.split('class="summary-table"', 1)[1].split("</table>", 1)[0]
    rows = re.findall(r'<td class="sk">(.*?)</td>\s*<td class="sv">(.*?)</td>', block, re.S)
    return {re.sub(r"\s+", " ", k).strip(): re.sub(r"\s+", " ", v).strip() for k, v in rows}


def _ctx(**over):
    ctx = {
        "student_name": "Ученик", "subject_label": "Информатика", "level_label": "ЕГЭ", "variant_id": 1,
        "total_score": 10, "max_score": 28, "percent": 36, "correct_count": 9, "tasks_count": 26,
        "avg_time_seconds": 50, "is_vpr": False, "is_oge": False, "is_ege": True, "score_exam": 51,
        "score_is_mark": False, "score_note": None, "theme": {}, "vpr_badge": {}, "table_rows": [],
        "weak_topics": [], "next_steps": [], "final_comment": "", "pedagogical_summary": "",
        "hero_score_text": "первичных баллов", "pdf_css": "",
    }
    ctx.update(over)
    return ctx


class SummaryTestScoreRowTests(SimpleTestCase):
    def test_test_scale_shows_converted_score(self):
        rows = _summary_rows(render_to_string("report_template.html", _ctx()))
        self.assertEqual(rows["Первичные баллы"], "10 / 28")
        self.assertEqual(rows["Тестовые баллы"], "51 из 100")
        self.assertNotIn("Вторичные баллы", rows)
        self.assertNotIn("Оценка", rows)

    def test_primary_never_labelled_as_test(self):
        for over in ({}, {"score_exam": None}, {"score_is_mark": True, "score_exam": 4}, {"is_vpr": True}):
            rows = _summary_rows(render_to_string("report_template.html", _ctx(**over)))
            self.assertNotEqual(rows.get("Тестовые баллы"), "10 / 28", over)

    def test_no_scale_hides_row(self):
        rows = _summary_rows(render_to_string("report_template.html", _ctx(score_exam=None)))
        self.assertNotIn("Тестовые баллы", rows)
        self.assertNotIn("Оценка", rows)
        self.assertEqual(rows["Первичные баллы"], "10 / 28")

    def test_mark_scale_shows_grade(self):
        rows = _summary_rows(render_to_string(
            "report_template.html", _ctx(score_is_mark=True, score_exam=4, is_oge=True, is_ege=False)))
        self.assertEqual(rows["Оценка"], "4 из 5")
        self.assertNotIn("Тестовые баллы", rows)

    def test_vpr_has_no_scale_row(self):
        rows = _summary_rows(render_to_string("report_template.html", _ctx(is_vpr=True, score_exam=51)))
        self.assertNotIn("Тестовые баллы", rows)
        self.assertNotIn("Оценка", rows)

    def test_score_exam_value_normalization(self):
        self.assertIsNone(report_score_exam_value(None))
        self.assertIsNone(report_score_exam_value(""))
        self.assertIsNone(report_score_exam_value("  "))
        self.assertIsNone(report_score_exam_value("abc"))
        self.assertIsNone(report_score_exam_value(True))
        self.assertIsNone(report_score_exam_value(-1))
        self.assertIsNone(report_score_exam_value(float("nan")))
        self.assertEqual(report_score_exam_value(51), 51)
        self.assertEqual(report_score_exam_value("51"), 51)
        self.assertEqual(report_score_exam_value(4.0), 4)
        self.assertEqual(report_score_exam_value(0), 0)


class NeutralRecommendationTests(SimpleTestCase):
    def test_uses_subtopic_then_topic(self):
        self.assertEqual(rp.neutral_recommendation("Вычитание", "Арифметика"), "Повторить тему «Вычитание».")
        self.assertEqual(rp.neutral_recommendation("", "Алгоритмы"), "Повторить тему «Алгоритмы».")
        self.assertEqual(rp.neutral_recommendation("Все задачи", "Сравнение чисел"), "Повторить тему «Сравнение чисел».")
        self.assertEqual(rp.neutral_recommendation("", ""), rp.RECOMMENDATION_FALLBACK)

    def test_owner_rule_no_promises(self):
        for text in (rp.neutral_recommendation("Вычитание", ""), rp.RECOMMENDATION_FALLBACK):
            self.assertIsNone(FORBIDDEN_RE.search(text), text)


class PickRecommendationTests(TestCase):
    """Рекомендации из сида 0051 (Информатика ВПР) + свои строки."""

    def setUp(self):
        from Generator.models import PedagogicalRecommendation as PR

        self.PR = PR
        PR.objects.create(subject="Математика", exam_level="OGE", topic="Треугольник",
                          short_recommendation="ТЕМА-ТРЕУГОЛЬНИК", priority=1)
        PR.objects.create(subject="Математика", exam_level="OGE", topic="Треугольник", subtopic="Прямоугольный треугольник",
                          short_recommendation="ПОДТЕМА-ПРЯМОУГОЛЬНЫЙ", priority=2)
        PR.objects.create(subject="Математика", exam_level="OGE", topic="Окружность", subtopic="Касательная",
                          short_recommendation="ПОДТЕМА-КАСАТЕЛЬНАЯ", priority=3)
        PR.objects.create(subject="Математика", exam_level="OGE", subtopic="Неравенства",
                          short_recommendation="ПОДТЕМА-НЕРАВЕНСТВА", priority=4)
        PR.objects.create(subject="Математика", exam_level="OGE", topic="Выключенная",
                          short_recommendation="ВЫКЛ", is_active=False, priority=0)

    def pick(self, subtopic, topic, subject="Математика", level="OGE"):
        r = rp._pick_recommendation(subject, level, subtopic, topic, "")
        return r.short_recommendation if r else None

    def test_exact_subtopic(self):
        self.assertEqual(self.pick("Прямоугольный треугольник", "Треугольник"), "ПОДТЕМА-ПРЯМОУГОЛЬНЫЙ")
        self.assertEqual(self.pick("прямоугольный треугольник ", "треугольник"), "ПОДТЕМА-ПРЯМОУГОЛЬНЫЙ")
        self.assertEqual(self.pick("Неравенства", "Сравнение чисел"), "ПОДТЕМА-НЕРАВЕНСТВА")

    def test_subtopic_with_other_topic_not_used(self):
        # «Касательная» привязана к теме «Окружность» — для задания другой темы не подходит.
        self.assertIsNone(self.pick("Касательная", "Треугольник общего вида"))

    def test_topic_level_record(self):
        self.assertEqual(self.pick("Равнобедренный треугольник", "Треугольник"), "ТЕМА-ТРЕУГОЛЬНИК")
        self.assertEqual(self.pick("", "Треугольник"), "ТЕМА-ТРЕУГОЛЬНИК")

    def test_subtopic_record_not_used_as_topic_match(self):
        self.PR.objects.filter(short_recommendation="ТЕМА-ТРЕУГОЛЬНИК").delete()
        self.assertIsNone(self.pick("Равнобедренный треугольник", "Треугольник"))

    def test_no_match_returns_none_not_first_record(self):
        self.assertIsNone(self.pick("Обыкновенные дроби", "Числа и вычисления"))
        self.assertIsNone(self.pick("", ""))
        self.assertIsNone(self.pick("Прямоугольный треугольник", "Треугольник", subject="Физика"))
        self.assertIsNone(self.pick("Прямоугольный треугольник", "Треугольник", level="EGE"))
        self.assertIsNone(self.pick("", "Выключенная"))

    def test_placeholder_subtopic_falls_to_topic(self):
        self.assertEqual(self.pick("Все задачи", "Треугольник"), "ТЕМА-ТРЕУГОЛЬНИК")

    def test_seed_inf_vpr_no_foreign_recommendation(self):
        """Регресс r82: ранее любое несовпадение получало «Перевод в десятичную систему…» (id=1 сида)."""
        if not self.PR.objects.filter(subject="Информатика", exam_level="VPR").exists():
            self.PR.objects.create(subject="Информатика", exam_level="VPR", subtopic="Перевод в десятичную систему",
                                   short_recommendation="Разобрать алгоритм перевода числа в десятичную систему.", priority=10)
        for subtopic, topic in [
            ("Все задачи", "Сравнение чисел в разных системах счисления"),
            ("Перевод из десятичной системы", "Перевод между системами счисления"),
            ("", "Алгоритмы с условным оператором"),
            ("Сложение", "Арифметические операции в двоичной системе счисления"),
        ]:
            r = rp._pick_recommendation("Информатика", "VPR", subtopic, topic, "")
            self.assertTrue(r is None or "десятичную" not in r.short_recommendation, (subtopic, topic))
        r = rp._pick_recommendation("Информатика", "VPR", "Перевод в десятичную систему", "Перевод между системами счисления", "")
        self.assertIsNotNone(r)
        self.assertIn("десятичную", r.short_recommendation)


class ReportContextTests(TestCase):
    def setUp(self):
        from Generator.models import PedagogicalRecommendation as PR

        PR.objects.create(subject="Информатика", exam_level="EGE", subtopic="Графы",
                          short_recommendation="РЕК-ГРАФЫ", priority=1)

    def _build(self, tasks, scores, times):
        return rp.build_pedagogical_report_context(
            student_name="Ученик", subject_label="Информатика", level_val="ege", level_label="ЕГЭ",
            variant_id=1, date_solution="", time_start="", time_end="", total_time_formatted="",
            total_score=sum(scores.values()), max_score=len(tasks), score_exam=None, score_comment="",
            mark_level=None, is_vpr=False, tasks_payload=tasks, scores=scores, task_times=times,
            subtopic_by_task_id={}, topic_by_task_id={},
        )

    def test_rows(self):
        tasks = [
            {"id": 1, "number": 1, "task_title": "Анализ информационных моделей", "max_score": 1, "subtopic_title": "Графы"},
            {"id": 2, "number": 2, "task_title": "Таблицы истинности", "max_score": 1, "subtopic_title": "Все задачи"},
            {"id": 3, "number": 3, "task_title": "Базы данных", "max_score": 1, "subtopic_title": ""},
            {"id": 4, "number": 4, "task_title": "Кодирование", "max_score": 1, "subtopic_title": "Условие Фано"},
        ]
        ctx = self._build(tasks, {"1": 0, "2": 0, "3": 0, "4": 1}, {"1": 30, "2": 30, "3": 0, "4": 30})
        recs = {r["number"]: r["recommendation"] for r in ctx["table_rows"]}
        self.assertEqual(recs[1], "РЕК-ГРАФЫ")
        self.assertEqual(recs[2], "Повторить тему «Таблицы истинности».")
        self.assertEqual(recs[3], "Повторить тему «Базы данных».")
        self.assertEqual(recs[4], rp.CORRECT_TASK_HINT)
        self.assertEqual(ctx["weak_topics"], ["Графы", "Таблицы истинности", "Базы данных"])
        self.assertNotIn("Все задачи", ctx["weak_topics_str"])


class ReportPdfViewTests(TestCase):
    def setUp(self):
        from Generator.models import Level, Subject, Variant

        s, _ = Subject.objects.get_or_create(subject_short="inf", defaults={"subject_name": "Информатика"})
        lv, _ = Level.objects.get_or_create(level="ege", defaults={"level_rus": "ЕГЭ"})
        lo, _ = Level.objects.get_or_create(level="oge", defaults={"level_rus": "ОГЭ"})
        self.v = Variant.objects.create(var_subject=s, level=lv)
        self.vo = Variant.objects.create(var_subject=s, level=lo)

    def _post(self, variant, level, score_exam):
        captured = {}
        real = render_to_string

        def capture(name, ctx=None, *a, **kw):
            html = real(name, ctx, *a, **kw)
            captured["html"] = html
            return html

        class FakeHTML:
            def __init__(self, *a, **kw):
                pass

            def write_pdf(self):
                return b"%PDF-1.4 fake"

        body = {"variantId": variant.id, "studentName": "Ученик", "tasks": [
            {"id": 1, "number": 1, "task_title": "Т1", "max_score": 1}], "scores": {"1": 1},
            "taskTimes": {"1": 10}, "totalScore": 1, "maxScore": 1, "scoreExam": score_exam}
        with mock.patch("Generator.views.render_to_string", side_effect=capture), \
                mock.patch("Generator.views.WeasyHTML", FakeHTML), mock.patch("Generator.views._WEASYPRINT_OK", True):
            resp = self.client.post(f"/api/{level}/inf/report-pdf/", data=json.dumps(body), content_type="application/json")
        self.assertEqual(resp.status_code, 200)
        return _summary_rows(captured["html"])

    def test_ege_test_score(self):
        rows = self._post(self.v, "ege", 7)
        self.assertEqual(rows["Тестовые баллы"], "7 из 100")
        self.assertEqual(rows["Первичные баллы"], "1 / 1")

    def test_ege_without_scale(self):
        for raw in (None, ""):
            rows = self._post(self.v, "ege", raw)
            self.assertNotIn("Тестовые баллы", rows)

    def test_oge_mark(self):
        rows = self._post(self.vo, "oge", 5)
        self.assertEqual(rows["Оценка"], "5 из 5")
        self.assertNotIn("Тестовые баллы", rows)
