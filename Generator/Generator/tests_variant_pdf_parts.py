# -*- coding: utf-8 -*-
"""PDF варианта: ВПР без Part не падает, ЕГЭ сохраняет части и картинки.

Отчёт ученику и родителю (report_template) по-прежнему без решения,
файлов учителя и ключа ответов.
"""
import base64
import json
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.template.loader import render_to_string
from django.test import RequestFactory, TestCase

from Generator.models import Level, Part, Subject, Task, TaskList, Variant, VariantContent
from Generator.pdf_utils import build_pdf_context

_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_SVG = (
    '<p>На рисунке изображены графики.</p>'
    '<div class="fig"><svg id="vpr-inline-diagram" xmlns="http://www.w3.org/2000/svg" '
    'viewBox="0 0 120 40" width="120" height="40">'
    '<path d="M0 30 L40 10 L80 28" fill="none" stroke="#111" stroke-width="2"/>'
    "</svg></div>"
)
_WIDGET_ANSWER = "10 00 11 00"
_SOLUTION = "СЕКРЕТ_РЕШЕНИЯ_УЧИТЕЛЯ: эталон в ref14.docx"
_TEACHER_FILE = "ref14.docx"


class VariantPdfPartTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.inf, _ = Subject.objects.get_or_create(
            subject_short="inf", defaults={"subject_name": "Информатика"}
        )
        self.vpr, _ = Level.objects.get_or_create(level="vpr", defaults={"level_rus": "ВПР"})
        self.ege, _ = Level.objects.get_or_create(level="ege", defaults={"level_rus": "ЕГЭ"})
        self.part1 = Part.objects.create(part_title="Часть 1")
        self.part2 = Part.objects.create(part_title="Часть 2")
        self.media_rel = "pdf_test/ege-dot.png"
        self.media_path = Path(settings.MEDIA_ROOT) / self.media_rel
        self.media_path.parent.mkdir(parents=True, exist_ok=True)
        self.media_path.write_bytes(_PNG)

        diagram = self._task(
            self.vpr,
            number=1,
            title="Графики",
            part=None,
            template=_SVG,
            answer="7",
            exam_part=None,
        )
        widget = self._task(
            self.vpr,
            number=6,
            title="Таблица истинности",
            part=None,
            template="<p>Заполните таблицу истинности выражения.</p>",
            answer=_WIDGET_ANSWER,
            exam_part=None,
            truth_table_enabled=True,
            answer_spec={
                "answer_format": "truth_table_column",
                "answer_data": {
                    "rows": [
                        {"inputs": [0, 0], "F": 1},
                        {"inputs": [0, 1], "F": 0},
                        {"inputs": [1, 0], "F": 0},
                        {"inputs": [1, 1], "F": 0},
                    ]
                },
                "files": [
                    {"name": _TEACHER_FILE, "path": "files/inf8/ref14.docx", "role": "для учителя"}
                ],
            },
        )
        self.vpr_variant = Variant.objects.create(var_subject=self.inf, level=self.vpr)
        VariantContent.objects.create(variant=self.vpr_variant, task=diagram, order=1)
        VariantContent.objects.create(variant=self.vpr_variant, task=widget, order=6)

        graph = self._task(
            self.ege,
            number=1,
            title="График функции",
            part=self.part1,
            template=f'<p>На рисунке изображён график.</p><img src="/media/{self.media_rel}" alt="ege-graph">',
            answer="42",
            exam_part=1,
        )
        written = self._task(
            self.ege,
            number=13,
            title="Развёрнутый ответ",
            part=self.part2,
            template="<p>Решите задачу и запишите рассуждение.</p>",
            answer="15",
            exam_part=2,
            max_score=2,
        )
        self.ege_variant = Variant.objects.create(var_subject=self.inf, level=self.ege)
        VariantContent.objects.create(variant=self.ege_variant, task=graph, order=1)
        VariantContent.objects.create(variant=self.ege_variant, task=written, order=13)
        self.diagram = diagram
        self.widget = widget

    def tearDown(self):
        if self.media_path.exists():
            self.media_path.unlink()

    def _task(self, level, *, number, title, part, template, answer, exam_part, max_score=1, **extra):
        task_list = TaskList.objects.create(
            subject=self.inf,
            level=level,
            part=part,
            task_number=number,
            task_title=title,
            max_score=max_score,
            vpr_class=8 if level.level == "vpr" else None,
        )
        return Task.objects.create(
            task=task_list,
            task_template=template,
            answer=answer,
            solution=_SOLUTION,
            max_score=max_score,
            exam_part=exam_part,
            is_active=True,
            vpr_class=8 if level.level == "vpr" else None,
            **extra,
        )

    def _request(self, level, variant):
        return self.factory.get(f"/api/{level}/inf/variant/{variant.id}/pdf/")

    def _pdf(self, level, variant):
        captured = {}
        real = render_to_string

        def grab(name, ctx=None, *args, **kwargs):
            html = real(name, ctx, *args, **kwargs)
            captured.setdefault("pages", []).append({"template": name, "html": html, "context": ctx})
            return html

        with mock.patch("Generator.views.render_to_string", side_effect=grab):
            response = self.client.get(f"/api/{level}/inf/variant/{variant.id}/pdf/")
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response.content.startswith(b"%PDF"))
        page = captured["pages"][0]
        self.assertEqual(page["template"], "pdf_template.html")
        return page["html"], page["context"]

    def test_vpr_without_part_builds_one_section_with_svg_and_widget_answer(self):
        ctx = build_pdf_context(self._request("vpr", self.vpr_variant), self.vpr_variant, "inf")
        tasks = [item for item in ctx["tasks_content"] if item.get("type") == "task"]
        self.assertEqual([item["order"] for item in tasks], [1, 6])
        self.assertEqual([item["task_number"] for item in tasks], [1, 6])
        self.assertTrue(all(item["part"] is None for item in tasks))
        self.assertEqual(len(ctx["answers_parts"]), 1)
        section = ctx["answers_parts"][0]
        self.assertEqual(section["part"], "Без части")
        self.assertEqual([item["order"] for item in section["items"]], [1, 6])
        self.assertIn("vpr-inline-diagram", str(tasks[0]["text"]))
        self.assertIn("M0 30 L40 10 L80 28", str(tasks[0]["text"]))
        self.assertIn(_WIDGET_ANSWER, str(tasks[1]["answer"]))
        self.assertNotIn(_SOLUTION, str(tasks[0]["text"]))
        self.assertNotIn(_TEACHER_FILE, str(tasks[0]["text"]) + str(tasks[1]["text"]) + str(tasks[1]["answer"]))

        html, _view_ctx = self._pdf("vpr", self.vpr_variant)
        statement, _, key = html.partition('class="answers-page"')
        body = statement.split('class="variant-body"', 1)[1]
        self.assertIn('id="vpr-inline-diagram"', body)
        self.assertIn("M0 30 L40 10 L80 28", body)
        self.assertIn("Заполните таблицу истинности", body)
        self.assertNotIn("section-title", body)
        self.assertNotIn("Часть 1", html)
        self.assertNotIn("Без части", html)
        self.assertIn(_WIDGET_ANSWER, key)
        self.assertNotIn(_WIDGET_ANSWER, statement)
        self.assertNotIn(_SOLUTION, html)
        self.assertNotIn(_TEACHER_FILE, html)
        self.assertNotIn("answer_format", html)
        self.assertIn("Вариант №", html)

    def test_ege_keeps_parts_images_and_answer_key(self):
        ctx = build_pdf_context(self._request("ege", self.ege_variant), self.ege_variant, "inf")
        tasks = [item for item in ctx["tasks_content"] if item.get("type") == "task"]
        self.assertEqual([item["part"] for item in tasks], ["Часть 1", "Часть 2"])
        self.assertEqual([section["part"] for section in ctx["answers_parts"]], ["Часть 1", "Часть 2"])
        self.assertEqual([item["order"] for item in ctx["answers_parts"][0]["items"]], [1])
        self.assertEqual([item["order"] for item in ctx["answers_parts"][1]["items"]], [13])
        self.assertNotIn("Без части", [section["part"] for section in ctx["answers_parts"]])
        self.assertFalse(tasks[0].get("start_new_page"))
        self.assertTrue(tasks[1].get("start_new_page"))
        self.assertIn("ege-dot.png", str(tasks[0]["text"]))
        self.assertIn("file://", str(tasks[0]["text"]))
        self.assertIn('alt="ege-graph"', str(tasks[0]["text"]))

        html, _view_ctx = self._pdf("ege", self.ege_variant)
        self.assertIn("Часть 1", html)
        self.assertIn("Часть 2", html)
        self.assertIn("ege-dot.png", html)
        self.assertIn('alt="ege-graph"', html)
        self.assertIn("file://", html)
        statement, _, key = html.partition('class="answers-page"')
        self.assertIn("42", key)
        self.assertIn("15", key)
        self.assertNotIn(_SOLUTION, html)
        self.assertNotIn(_TEACHER_FILE, html)
        body = statement.split('class="variant-body"', 1)[1]
        part1_at = body.find("Часть 1")
        part2_at = body.find("Часть 2")
        self.assertGreaterEqual(part1_at, 0)
        self.assertLess(part1_at, part2_at)
        self.assertIn("break-before", body[part2_at:])
        self.assertNotIn("break-before", body[part1_at:part2_at])

    def test_student_parent_report_omits_teacher_only_data(self):
        captured = {}
        real = render_to_string

        def grab(name, ctx=None, *args, **kwargs):
            html = real(name, ctx, *args, **kwargs)
            captured["html"] = html
            captured["template"] = name
            return html

        body = {
            "variantId": self.vpr_variant.id,
            "studentName": "Мария Соколова",
            "tasks": [
                {
                    "id": self.diagram.id,
                    "number": 1,
                    "task_title": "Графики",
                    "max_score": 1,
                    "answer": "7",
                    "solution": _SOLUTION,
                    "text": _SVG,
                },
                {
                    "id": self.widget.id,
                    "number": 6,
                    "task_title": "Таблица истинности",
                    "max_score": 1,
                    "answer": _WIDGET_ANSWER,
                    "solution": _SOLUTION,
                    "answer_spec": {"files": [{"name": _TEACHER_FILE}]},
                },
            ],
            "scores": {str(self.diagram.id): 1, str(self.widget.id): 0},
            "taskTimes": {str(self.diagram.id): 20, str(self.widget.id): 40},
            "totalScore": 1,
            "maxScore": 2,
        }
        with mock.patch("Generator.views.render_to_string", side_effect=grab):
            response = self.client.post(
                "/api/vpr/inf/report-pdf/",
                data=json.dumps(body),
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response.content.startswith(b"%PDF"))
        self.assertEqual(captured["template"], "report_template.html")
        html = captured["html"]
        self.assertIn("Мария Соколова", html)
        self.assertIn("Для родителя", html)
        self.assertIn("Для ученика", html)
        self.assertIn("1 / 2", html)
        self.assertNotIn(_SOLUTION, html)
        self.assertNotIn(_TEACHER_FILE, html)
        self.assertNotIn(_WIDGET_ANSWER, html)
        self.assertNotIn("vpr-inline-diagram", html)
        self.assertNotIn("answer_format", html)
        self.assertNotIn("Тестовые баллы", html)
