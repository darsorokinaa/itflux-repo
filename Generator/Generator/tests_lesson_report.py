# -*- coding: utf-8 -*-
"""r79: отчёт после варианта для каталожных уроков (LESSON_DATA.report)."""
import copy
import io
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from unittest import skipUnless

from django.core.files.base import ContentFile
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase, override_settings

from Generator.lesson_report import embed
from Generator.models import Lesson

CONTENT = embed.CONTENT_DIR
SLUG5 = "vhodnaya-diagnostika-po-matematike-5-klass"
SLUG6 = "vhodnaya-diagnostika-po-matematike-6-klass"

APP_JS = """
(() => {
  "use strict";
  const data = window.LESSON_DATA;
  const slideStage = document.querySelector("#slideStage");
  const slideCounter = document.querySelector("#slideCounter");
  const progressBar = document.querySelector("#progressBar");
  const prevBtn = document.querySelector("#prevBtn");
  const nextBtn = document.querySelector("#nextBtn");
  let showingResults = false;
  const state = { selected: {}, checked: {} };
  function activeVariant() { return data.variants[0]; }
  function normalize(v) { return String(v || "").trim().toLowerCase(); }
  function updateImageButtons() {}
  function isAnswerCorrect(task) { return null; }
  function renderResults() {
    showingResults = true;
    slideStage.innerHTML = "<ul class='results-list'></ul>";
  }
})();
"""


def load(slug):
    return json.loads((CONTENT / f"{slug}.report.json").read_text(encoding="utf-8"))


def lesson_data_for(report):
    variants = []
    for vid in report["variants_expected"]:
        tasks = []
        for t in report["tasks"]:
            e = embed.effective_task(t, vid)
            tasks.append({"id": t["task_id"], "title": e["title"], "points": e["max_points"],
                          "answer": {"type": "text", "answers": [f"ok{t['task_id']}"]}})
        variants.append({"id": vid, "name": f"Вариант {vid}", "tasks": tasks})
    return {"meta": {"title": "T", "maxPoints": 14,
                     "grading": {"5": "13–14", "4": "10–12", "3": "7–9", "2": "0–6"}},
            "variants": variants, "tasks": variants[0]["tasks"]}


def lesson_html(data):
    return ("<!DOCTYPE html><html><head><meta charset='utf-8'></head><body><div id='slideStage'></div>\n"
            "<script>\nwindow.LESSON_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n</script>\n"
            "<script>" + APP_JS + "</script>\n</body>\n</html>\n")


class ReportContentTests(SimpleTestCase):
    def test_bundled_reports_valid_and_match_structure(self):
        for slug in (SLUG5, SLUG6):
            r = load(slug)
            v = embed.validate_report(r)
            self.assertEqual(v.errors, [], slug)
            c = embed.cross_check(r, lesson_data_for(r), slug=slug)
            self.assertEqual(c.errors, [], slug)
            self.assertEqual(c.warnings, [], slug)

    # Задание 9, 6 кл. по HTML урока 54: (вариант, угол, тип, число, что найти, верный ответ)
    G6_T9 = [(1, 180, "diff", 40, "big", 110), (2, 180, "diff", 30, "small", 75), (3, 180, "times", 2, "big", 120),
             (4, 90, "diff", 20, "big", 55), (5, 180, "diff", 50, "big", 115), (6, 180, "times", 3, "small", 45),
             (7, 90, "times", 2, "big", 60), (8, 180, "diff", 70, "small", 55), (9, 180, "times", 4, "big", 144),
             (10, 90, "diff", 30, "small", 30), (11, 180, "diff", 24, "big", 102), (12, 180, "times", 5, "small", 30)]

    @staticmethod
    def _angles(total, kind, n):
        if kind == "diff":
            return (total + n) / 2, (total - n) / 2
        small = total / (n + 1)
        return small * n, small

    def test_grade6_task9_typical_errors_match_variant(self):
        """Ответы в typical_errors задания 9 (6 кл.) пересчитаны по условию каждого варианта."""
        t9 = [t for t in load(SLUG6)["tasks"] if t["task_id"] == 9][0]
        checked = 0
        for vid, total, kind, n, ask, correct in self.G6_T9:
            big, small = self._angles(total, kind, n)
            self.assertEqual(big if ask == "big" else small, correct)
            ob, osm = self._angles(270 - total, kind, n)
            for e in embed.effective_task(t9, vid).get("typical_errors", []):
                if not e.get("answer"):
                    continue
                ans, c = float(e["answer"]), e["comment"]
                self.assertNotEqual(ans, correct, f"v{vid}: ошибка совпала с верным ответом")
                if c.startswith("Перепутаны виды углов"):
                    exp = ob if ask == "big" else osm
                elif c.startswith("Найден"):
                    exp = small if ask == "big" else big
                elif c.startswith("Из градусной меры"):
                    exp = total - n
                else:  # «… разделено на k, а нужно на k+1»
                    exp = total / n
                self.assertEqual(ans, exp, f"v{vid}: {c[:40]}")
                checked += 1
        self.assertGreaterEqual(checked, 30)

    # Правило владельца (2026-10-19.4): в рекомендациях нет сроков, количества/частоты занятий
    # и обещаний результата — только что повторить и как себя проверить.
    FORBIDDEN = re.compile(
        r"недел|\bсут(ки|ок) подряд|ежедневн|еженедельн|раз\w* в (день|недел|месяц)|месяц|в течение"
        r"|через\s+(\d|недел|месяц|день|год)|\d+\s*[–-]\s*\d+\s*(заняти|урок|минут|час)|\d+\s*(заняти|урок)"
        r"|четверт(и|ью)\b|занятия? в|занятий"
        r"|помож|помога|полезн|закреп|получится|сможешь|станет|станешь|улучш|повыс|гарант|достаточн"
        r"|обязательно получ|результат будет|будет (выше|лучше)",
        re.I,
    )
    # Поля с содержанием задач (условия, ошибки, планируемые результаты) не проверяем:
    # там «минуты», «часы», «путь первого дня» — это математика, а не сроки.
    SKIP_KEYS = {"typical_errors", "planned_result", "topic", "subtopic", "title"}

    def _advice_texts(self, x, path=""):
        if isinstance(x, dict):
            for k, v in x.items():
                if k not in self.SKIP_KEYS:
                    yield from self._advice_texts(v, f"{path}/{k}")
        elif isinstance(x, list):
            for i, v in enumerate(x):
                yield from self._advice_texts(v, f"{path}/{i}")
        elif isinstance(x, str):
            yield path, x

    def test_bundled_texts_have_no_timeframes_lesson_counts_or_promises(self):
        for slug in (SLUG5, SLUG6):
            bad = [(p, m.group(0)) for p, t in self._advice_texts(load(slug)) for m in [self.FORBIDDEN.search(t)] if m]
            self.assertEqual(bad, [], slug)

    def test_forbidden_rule_catches_old_wording(self):
        for t in ("2–3 коротких занятия в неделю будет достаточно", "Через 3–4 недели выполни мини-диагностику",
                  "устный счёт 5–7 минут", "повторение 1–2 урока", "это поможет подготовиться",
                  "в следующий раз результат будет выше", "Стоит закрепить"):
            self.assertTrue(self.FORBIDDEN.search(t), t)
        for t in ("В часе 60 минут, а не 100.", "Не учтён путь второго дня.", "это четверть книги",
                  "Для самопроверки реши другой вариант", "После повторения тем рекомендуется повторная проверка"):
            self.assertFalse(self.FORBIDDEN.search(t), t)

    def test_grade5_task12_overrides_and_points(self):
        r = load(SLUG5)
        t12 = [t for t in r["tasks"] if t["task_id"] == 12][0]
        for vid in (3, 5, 7, 9):
            self.assertIn("Площадь фигуры", embed.effective_task(t12, vid)["title"])
        for vid in (1, 2, 4, 6, 8, 10):
            self.assertIn("Перебор вариантов", embed.effective_task(t12, vid)["title"])
        for tid in (11, 12):
            t = [x for x in r["tasks"] if x["task_id"] == tid][0]
            self.assertEqual((t["max_points"], t["check"]), (2, "teacher"))
        self.assertEqual(r["max_points"], 14)

    def test_validate_rejects_html_placeholders_and_conditions(self):
        r = load(SLUG6)
        r["tasks"][0]["short_recommendation"] = "<b>жирно</b>"
        r["tasks"][1]["student_hint"] = "Привет, {student_name}"
        r["next_steps"]["sometimes"] = ["x"]
        r["result_bands"][0]["summary"] = "{unknown}"
        errs = "\n".join(embed.validate_report(r).errors)
        self.assertIn("HTML-теги запрещены", errs)
        self.assertIn("разрешён только в result_bands", errs)
        self.assertIn("неизвестное условие", errs)
        self.assertIn("неизвестный плейсхолдер", errs)

    def test_cross_check_catches_mapping_errors(self):
        r = load(SLUG5)
        data = lesson_data_for(r)
        bad = copy.deepcopy(data)
        bad["variants"][2]["tasks"][11]["title"] = "Перебор вариантов (развёрнутый ответ)"
        bad["variants"][0]["tasks"][10]["points"] = 1
        bad["variants"].pop()
        errs = "\n".join(embed.cross_check(r, bad, slug=SLUG5).errors)
        self.assertIn("вариант 3 №12: title", errs)
        self.assertIn("max_points 2 != points 1", errs)
        self.assertIn("variants_expected", errs)
        r2 = copy.deepcopy(r)
        r2["result_bands"] = [b for b in r2["result_bands"] if b["code"] != "mark_3"]
        self.assertIn("не покрыты баллы [7, 8, 9]", "\n".join(embed.cross_check(r2, data).errors))
        r3 = copy.deepcopy(r)
        r3["tasks"][1]["variant_overrides"]["1"]["typical_errors"] = [{"answer": "OK2", "comment": "x"}]
        self.assertIn("совпадает с верным ответом", "\n".join(embed.cross_check(r3, data).errors))

    def test_embed_idempotent_and_reversible(self):
        r = load(SLUG5)
        html = lesson_html(lesson_data_for(r))
        new = embed.embed_report(html, r)
        self.assertNotEqual(new, html)
        self.assertEqual(embed.embed_report(new, r), new)
        self.assertEqual(embed.strip_report(new), html)
        self.assertEqual(new.count(embed.HOOK_MARK), 1)
        self.assertEqual(new.count("itflux-lesson-report:start"), 1)
        self.assertEqual(embed.extract_lesson_data(new)["meta"]["maxPoints"], 14)
        self.assertEqual(embed.block_meta(new)["content_version"], r["content_version"])
        r2 = copy.deepcopy(r)
        r2["content_version"] = "2026-10-20.1"
        newer = embed.embed_report(new, r2)
        self.assertEqual(newer.count("itflux-lesson-report:start"), 1)
        self.assertEqual(embed.block_meta(newer)["content_version"], "2026-10-20.1")

    def test_script_json_cannot_break_out(self):
        s = embed._script_json({"a": "</script><script>alert(1)</script><!--"})
        self.assertNotIn("</script", s)
        self.assertNotIn("<!--", s)

    def test_hook_refuses_unknown_app(self):
        with self.assertRaises(embed.LessonReportError):
            embed.patch_hook("<script>window.LESSON_DATA = {\"variants\": [{}]};</script>")

    @skipUnless(shutil.which("node"), "node не установлен")
    def test_runtime_node_suite(self):
        p = subprocess.run(["node", "--test", str(embed.BASE_DIR / "runtime.test.js")],
                           capture_output=True, text=True, timeout=120)
        self.assertEqual(p.returncode, 0, p.stdout[-3000:] + p.stderr[-2000:])


class ImportLessonReportCommandTests(TestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp(prefix="r79-media-")
        self.addCleanup(shutil.rmtree, self.media, True)
        self.override = override_settings(MEDIA_ROOT=self.media)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.report = load(SLUG5)
        self.html = lesson_html(lesson_data_for(self.report))
        self.lesson = Lesson.objects.create(title="Входная диагностика 5", slug=SLUG5, subject="Математика", grade=5,
                                            status="published")
        self.lesson.file.save("x.html", ContentFile(self.html.encode("utf-8")), save=True)
        self.other = Lesson.objects.create(title="8 класс", slug="vhodnaya-kontrolnaya-rabota-8-klass",
                                           subject="Математика", grade=8, status="published")
        self.other.file.save("y.html", ContentFile(b"<html><body>old</body></html>"), save=True)
        self.path = Path(self.media) / f"{SLUG5}.report.json"
        self.path.write_text(json.dumps(self.report, ensure_ascii=False), encoding="utf-8")

    def _call(self, *args):
        out = io.StringIO()
        call_command("import_lesson_report", str(self.path), *args, stdout=out, stderr=io.StringIO())
        return out.getvalue()

    def _read(self, lesson):
        lesson.refresh_from_db()
        with lesson.file.open("rb") as f:
            return f.read().decode("utf-8")

    def test_dry_run_changes_nothing(self):
        before = self.lesson.file.name
        out = self._call("--dry-run")
        self.assertIn("[would_change]", out)
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.file.name, before)
        self.assertEqual(self._read(self.lesson), self.html)

    def test_apply_is_idempotent_and_keeps_old_file(self):
        old_name = self.lesson.file.name
        out = self._call()
        self.assertIn("[changed]", out)
        new_html = self._read(self.lesson)
        self.assertNotEqual(self.lesson.file.name, old_name)
        self.assertIn("itflux-lesson-report:start", new_html)
        self.assertTrue((Path(self.media) / old_name).exists(), "старый файл остаётся для отката")
        name2 = self.lesson.file.name
        self.assertIn("[unchanged]", self._call())
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.file.name, name2)
        self.assertEqual(self._read(self.other), "<html><body>old</body></html>")

    def test_remove_restores_original(self):
        self._call()
        self._call("--remove")
        self.assertEqual(self._read(self.lesson), self.html)

    def test_mismatch_aborts_without_writing(self):
        bad = copy.deepcopy(self.report)
        bad["tasks"][11]["max_points"] = 1
        for o in bad["tasks"][11]["variant_overrides"].values():
            o.pop("max_points", None)
        self.path.write_text(json.dumps(bad, ensure_ascii=False), encoding="utf-8")
        before = self.lesson.file.name
        with self.assertRaises(CommandError):
            self._call()
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.file.name, before)

    def test_unknown_slug_and_archive_lesson(self):
        r = copy.deepcopy(self.report)
        r["lesson_slug"] = "net-takogo-uroka"
        self.path.write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(CommandError):
            self._call("--dry-run")
        self.lesson.file = None
        self.lesson.save()
        self.path.write_text(json.dumps(self.report, ensure_ascii=False), encoding="utf-8")
        with self.assertRaises(CommandError):
            self._call("--dry-run")
