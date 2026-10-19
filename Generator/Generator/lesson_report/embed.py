# -*- coding: utf-8 -*-
"""Встраивание методического отчёта в HTML урока (window.LESSON_DATA.report) — r79.

Чистые функции без БД: разбор LESSON_DATA, проверка файла Методиста (формат
itflux.lesson-variant-report v1), сверка с уроком, идемпотентная сборка HTML.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

FORMAT = "itflux.lesson-variant-report"
RUNTIME_VERSION = 1
BASE_DIR = Path(__file__).resolve().parent
CONTENT_DIR = BASE_DIR / "content"

BLOCK_START_RE = re.compile(r"<!--\s*itflux-lesson-report:start[^>]*-->")
BLOCK_RE = re.compile(r"\n?<!--\s*itflux-lesson-report:start[^>]*-->.*?<!--\s*itflux-lesson-report:end\s*-->\n?", re.S)
BLOCK_META_RE = re.compile(r"<!--\s*itflux-lesson-report:start\s+(?P<meta>[^>]*?)\s*-->")
HOOK_MARK = "/*itflux-lesson-report-hook:v1*/"
HOOK_RE = re.compile(r"\n?[ \t]*/\*itflux-lesson-report-hook:v1\*/.*?/\*/itflux-lesson-report-hook\*/", re.S)
RENDER_RESULTS_SIG = "function renderResults() {"
HOOK_REQUIRED = [
    "function activeVariant()", "function isAnswerCorrect(", "function normalize(",
    "function updateImageButtons(", "const slideStage", "const slideCounter", "const progressBar",
    "const prevBtn", "const nextBtn", "let showingResults", "const state",
]
HOOK_JS = (
    HOOK_MARK
    + "\n    if (window.ItfluxLessonReport && data && data.report) {"
    + "\n      try {"
    + "\n        if (window.ItfluxLessonReport.renderInto(slideStage, { data: data, variant: activeVariant(),"
    + " selected: state.selected, isAnswerCorrect: isAnswerCorrect, normalize: normalize })) {"
    + "\n          showingResults = true; updateImageButtons(); slideCounter.textContent = \"Итог\";"
    + "\n          progressBar.style.width = \"100%\"; prevBtn.disabled = false; nextBtn.textContent = \"На главную\";"
    + "\n          return;"
    + "\n        }"
    + "\n      } catch (err) { console.warn(\"lesson report failed, fallback to basic results\", err); }"
    + "\n    }"
    + "\n    /*/itflux-lesson-report-hook*/"
)

CONDITIONS = {"default", "low_percent", "medium_percent", "high_percent", "many_errors", "many_skipped", "slow_first_task"}
PLACEHOLDERS = {"student_name", "total_score", "max_score", "percent", "correct_count", "tasks_count",
                "weak_topics", "skipped_count", "mark"}
TASK_TEXT_LIMITS = {
    "title": 255, "topic": 255, "subtopic": 255, "skill_group": 255, "planned_result": 400,
    "on_correct": 250, "short_recommendation": 250, "detailed_recommendation": 1000,
    "next_lesson_action": 400, "student_hint": 400, "parent_hint": 400, "teacher_hint": 400,
}
BAND_LIMITS = {"code": 32, "title": 120, "summary": 600, "student_text": 400, "parent_text": 400, "teacher_text": 600}
HTML_TAG_RE = re.compile(r"<\s*/?\s*[a-zA-Z!][^>]*>")
PH_RE = re.compile(r"\{(\w+)\}")


class LessonReportError(ValueError):
    pass


@dataclass
class CheckResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


# ---------- LESSON_DATA ----------

def extract_lesson_data(html: str) -> dict:
    m = re.search(r"window\.LESSON_DATA\s*=\s*", html)
    if not m:
        raise LessonReportError("В HTML нет window.LESSON_DATA (поддерживаются только уроки с JSON LESSON_DATA в одном .html)")
    try:
        data, _ = json.JSONDecoder().raw_decode(html, m.end())
    except json.JSONDecodeError as exc:
        raise LessonReportError(f"LESSON_DATA не является JSON: {exc}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("variants"), list) or not data["variants"]:
        raise LessonReportError("LESSON_DATA без variants")
    return data


# ---------- проверка файла Методиста ----------

def _plain(res: CheckResult, path: str, value: Any, limit: int | None, *, allow_ph: bool = False):
    if value is None:
        return
    if not isinstance(value, str):
        res.errors.append(f"{path}: ожидается строка")
        return
    if limit and len(value) > limit:
        res.errors.append(f"{path}: длина {len(value)} > {limit}")
    if HTML_TAG_RE.search(value):
        res.errors.append(f"{path}: HTML-теги запрещены (только plain text)")
    for ph in PH_RE.findall(value):
        if not allow_ph:
            res.errors.append(f"{path}: плейсхолдер {{{ph}}} разрешён только в result_bands[].summary")
        elif ph not in PLACEHOLDERS:
            res.errors.append(f"{path}: неизвестный плейсхолдер {{{ph}}}")


def _task_fields(res: CheckResult, path: str, obj: dict):
    for k, lim in TASK_TEXT_LIMITS.items():
        _plain(res, f"{path}.{k}", obj.get(k), lim)
    te = obj.get("typical_errors")
    if te is not None:
        if not isinstance(te, list) or len(te) > 5:
            res.errors.append(f"{path}.typical_errors: список до 5 элементов")
        else:
            for i, e in enumerate(te):
                if not isinstance(e, dict) or not isinstance(e.get("comment"), str):
                    res.errors.append(f"{path}.typical_errors[{i}]: нужен comment")
                    continue
                _plain(res, f"{path}.typical_errors[{i}].comment", e["comment"], 300)
                if e.get("answer") is not None:
                    _plain(res, f"{path}.typical_errors[{i}].answer", e["answer"], 100)


def validate_report(report: Any) -> CheckResult:
    """Структурная проверка (подмножество variant-report.schema.json, без внешних зависимостей)."""
    res = CheckResult()
    if not isinstance(report, dict):
        res.errors.append("корень: ожидается объект")
        return res
    if report.get("format") != FORMAT:
        res.errors.append(f"format: ожидается {FORMAT}")
    if report.get("format_version") != 1:
        res.errors.append("format_version: ожидается 1")
    slug = report.get("lesson_slug")
    if not isinstance(slug, str) or not re.fullmatch(r"[-a-z0-9_]+", slug or ""):
        res.errors.append("lesson_slug: обязателен, [-a-z0-9_]+")
    cv = report.get("content_version")
    if not isinstance(cv, str) or not cv or len(cv) > 32:
        res.errors.append("content_version: обязателен, до 32 символов")
    for i, b in enumerate(report.get("result_bands") or []):
        p = f"result_bands[{i}]"
        if not isinstance(b, dict):
            res.errors.append(f"{p}: объект")
            continue
        for k in ("min_points", "max_points"):
            if not isinstance(b.get(k), int) or b[k] < 0:
                res.errors.append(f"{p}.{k}: целое >= 0")
        if b.get("result_level") not in (None, "very_low", "low", "medium", "high"):
            res.errors.append(f"{p}.result_level: very_low|low|medium|high")
        if b.get("mark") not in (None, "2", "3", "4", "5"):
            res.errors.append(f"{p}.mark: 2..5")
        if not isinstance(b.get("summary"), str):
            res.errors.append(f"{p}.summary: обязателен")
        for k, lim in BAND_LIMITS.items():
            _plain(res, f"{p}.{k}", b.get(k), lim, allow_ph=(k == "summary"))
    ns = report.get("next_steps") or {}
    if not isinstance(ns, dict):
        res.errors.append("next_steps: объект")
    else:
        for cond, steps in ns.items():
            if cond not in CONDITIONS:
                res.errors.append(f"next_steps.{cond}: неизвестное условие")
            if not isinstance(steps, list) or len(steps) > 5:
                res.errors.append(f"next_steps.{cond}: список до 5 шагов")
                continue
            for j, s in enumerate(steps):
                _plain(res, f"next_steps.{cond}[{j}]", s, 200)
    for i, g in enumerate(report.get("skill_groups") or []):
        if not isinstance(g, dict) or not isinstance(g.get("task_ids"), list) or not g.get("code") or not g.get("title"):
            res.errors.append(f"skill_groups[{i}]: нужны code, title, task_ids")
    tasks = report.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        res.errors.append("tasks: обязательный непустой список")
        tasks = []
    seen = set()
    for i, t in enumerate(tasks):
        p = f"tasks[{i}]"
        if not isinstance(t, dict) or not isinstance(t.get("task_id"), int):
            res.errors.append(f"{p}.task_id: целое")
            continue
        if t["task_id"] in seen:
            res.errors.append(f"{p}: повтор task_id {t['task_id']}")
        seen.add(t["task_id"])
        if not t.get("title") or not t.get("short_recommendation"):
            res.errors.append(f"{p}: обязательны title и short_recommendation")
        if t.get("check") not in (None, "auto", "teacher"):
            res.errors.append(f"{p}.check: auto|teacher")
        _task_fields(res, p, t)
        ov = t.get("variant_overrides") or {}
        if not isinstance(ov, dict):
            res.errors.append(f"{p}.variant_overrides: объект")
            continue
        for vid, o in ov.items():
            if not re.fullmatch(r"[1-9][0-9]*", str(vid)) or not isinstance(o, dict):
                res.errors.append(f"{p}.variant_overrides.{vid}: ключ — номер варианта, значение — объект")
                continue
            _task_fields(res, f"{p}.variant_overrides.{vid}", o)
    _plain(res, "teacher_notes", report.get("teacher_notes"), 2000)
    return res


def _norm_answer(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip().lower())


def effective_task(task: dict, variant_id: int) -> dict:
    out = {k: v for k, v in task.items() if k != "variant_overrides"}
    out.update((task.get("variant_overrides") or {}).get(str(variant_id)) or {})
    return out


def cross_check(report: dict, data: dict, *, slug: str | None = None) -> CheckResult:
    """Сверка с уроком: id вариантов/заданий, названия, баллы, шкала, диапазоны."""
    res = CheckResult()
    if slug and report.get("lesson_slug") != slug:
        res.errors.append(f"lesson_slug {report.get('lesson_slug')} != {slug}")
    variants = data.get("variants") or []
    vids = [v.get("id") for v in variants]
    if report.get("variants_expected") is not None and report["variants_expected"] != vids:
        res.errors.append(f"variants_expected {report['variants_expected']} != варианты урока {vids}")
    tasks_by_id = {t["task_id"]: t for t in report.get("tasks") or [] if isinstance(t, dict) and "task_id" in t}
    meta = data.get("meta") or {}
    for v in variants:
        ids = [t.get("id") for t in v.get("tasks") or []]
        if report.get("tasks_expected") is not None and len(ids) != report["tasks_expected"]:
            res.errors.append(f"вариант {v.get('id')}: заданий {len(ids)} != tasks_expected {report['tasks_expected']}")
        missing = [i for i in ids if i not in tasks_by_id]
        if missing:
            res.errors.append(f"вариант {v.get('id')}: нет контента для заданий {missing}")
        extra = sorted(set(tasks_by_id) - set(ids))
        if extra:
            res.errors.append(f"вариант {v.get('id')}: в отчёте лишние задания {extra}")
        vmax = 0
        for ht in v.get("tasks") or []:
            pts = int(ht.get("points", 1) or 0)
            vmax += pts
            rt = tasks_by_id.get(ht.get("id"))
            if not rt:
                continue
            eff = effective_task(rt, v.get("id"))
            if eff.get("max_points") is not None and eff["max_points"] != pts:
                res.errors.append(f"вариант {v.get('id')} №{ht.get('id')}: max_points {eff['max_points']} != points {pts}")
            if (eff.get("title") or "") != (ht.get("title") or ""):
                res.errors.append(f"вариант {v.get('id')} №{ht.get('id')}: title «{eff.get('title')}» != «{ht.get('title')}» в уроке")
            accepted = {_norm_answer(a) for a in (ht.get("answer") or {}).get("answers") or []}
            for te in eff.get("typical_errors") or []:
                if te.get("answer") is not None and _norm_answer(te["answer"]) in accepted:
                    res.errors.append(f"вариант {v.get('id')} №{ht.get('id')}: типичная ошибка «{te['answer']}» совпадает с верным ответом")
            if pts >= 2 and eff.get("check") != "teacher":
                res.warnings.append(f"вариант {v.get('id')} №{ht.get('id')}: {pts} балла, но check != teacher")
        if meta.get("maxPoints") is not None and vmax != meta["maxPoints"]:
            res.errors.append(f"вариант {v.get('id')}: сумма points {vmax} != meta.maxPoints {meta['maxPoints']}")
        if report.get("max_points") is not None and vmax != report["max_points"]:
            res.errors.append(f"вариант {v.get('id')}: сумма points {vmax} != max_points отчёта {report['max_points']}")
    max_points = report.get("max_points") or meta.get("maxPoints")
    bands = report.get("result_bands") or []
    if bands and max_points:
        covered: dict[int, str] = {}
        for b in bands:
            for p in range(b["min_points"], b["max_points"] + 1):
                if p in covered:
                    res.errors.append(f"result_bands: {p} баллов попадает в {covered[p]} и {b['code']}")
                covered[p] = b["code"]
        gaps = [p for p in range(0, int(max_points) + 1) if p not in covered]
        if gaps:
            res.errors.append(f"result_bands: не покрыты баллы {gaps}")
        grading = meta.get("grading") or {}
        for b in bands:
            if b.get("mark") and b["mark"] in grading:
                m = re.match(r"\s*(\d+)\s*[–—-]\s*(\d+)", str(grading[b["mark"]]))
                if m and not (int(m.group(1)) <= b["min_points"] and b["max_points"] <= int(m.group(2))):
                    res.errors.append(f"result_bands.{b['code']}: {b['min_points']}–{b['max_points']} вне шкалы отметки {b['mark']} ({grading[b['mark']]})")
    for g in report.get("skill_groups") or []:
        unknown = [i for i in g.get("task_ids") or [] if i not in tasks_by_id]
        if unknown:
            res.errors.append(f"skill_groups.{g.get('code')}: неизвестные задания {unknown}")
    codes = {g.get("code") for g in report.get("skill_groups") or []}
    if codes:
        for t in tasks_by_id.values():
            for vid in vids:
                sg = effective_task(t, vid).get("skill_group")
                if sg and sg not in codes:
                    res.errors.append(f"№{t['task_id']} вариант {vid}: skill_group {sg} нет в skill_groups")
                    break
    if any("{student_name}" in (b.get("summary") or "") for b in bands):
        res.warnings.append("{student_name}: в уроке нет имени ученика — подставляется «Ученик»")
    return res


# ---------- сборка HTML ----------

def report_sha(report: dict) -> str:
    raw = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def _script_json(obj: Any) -> str:
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return s.replace("</", "<\\/").replace("<!--", "<\\!--").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def runtime_js() -> str:
    return (BASE_DIR / "runtime.js").read_text(encoding="utf-8")


def runtime_css() -> str:
    return (BASE_DIR / "runtime.css").read_text(encoding="utf-8")


def build_block(report: dict) -> str:
    js = runtime_js().replace("</script", "<\\/script")
    css = runtime_css().replace("</style", "<\\/style")
    meta = f"v={RUNTIME_VERSION} content_version={report.get('content_version')} sha={report_sha(report)}"
    return (
        f"<!-- itflux-lesson-report:start {meta} -->\n"
        f"<style id=\"itflux-lesson-report-css\">\n{css}</style>\n"
        f"<script id=\"itflux-lesson-report-runtime\">\n{js}</script>\n"
        f"<script id=\"itflux-lesson-report-data\">\n"
        f"(function(){{var r={_script_json(report)};if(window.LESSON_DATA){{window.LESSON_DATA.report=r;}}}})();\n"
        f"</script>\n"
        f"<!-- itflux-lesson-report:end -->\n"
    )


def block_meta(html: str) -> dict | None:
    m = BLOCK_META_RE.search(html)
    if not m:
        return None
    return dict(kv.split("=", 1) for kv in m.group("meta").split() if "=" in kv)


def patch_hook(html: str) -> str:
    if HOOK_MARK in html:
        return html
    if html.count(RENDER_RESULTS_SIG) != 1:
        raise LessonReportError("В коде урока не найдена ровно одна function renderResults() — хук не встроить")
    missing = [s for s in HOOK_REQUIRED if s not in html]
    if missing:
        raise LessonReportError(f"Код урока не совместим с хуком: нет {missing}")
    return html.replace(RENDER_RESULTS_SIG, RENDER_RESULTS_SIG + "\n    " + HOOK_JS, 1)


def strip_report(html: str) -> str:
    """Убрать блок отчёта и хук (откат к исходному виду)."""
    html = BLOCK_RE.sub("\n", html, count=1) if BLOCK_START_RE.search(html) else html
    return HOOK_RE.sub("", html, count=1)


def embed_report(html: str, report: dict) -> str:
    base = BLOCK_RE.sub("\n", html, count=1) if BLOCK_START_RE.search(html) else html
    base = patch_hook(base)
    block = build_block(report)
    idx = base.lower().rfind("</body>")
    if idx < 0:
        return base.rstrip("\n") + "\n" + block
    head = base[:idx].rstrip("\n")
    return head + "\n" + block + base[idx:]


def describe_change(old_html: str, new_html: str) -> dict:
    om, nm = block_meta(old_html), block_meta(new_html)
    return {
        "changed": old_html != new_html,
        "hook_before": HOOK_MARK in old_html,
        "hook_after": HOOK_MARK in new_html,
        "report_before": om,
        "report_after": nm,
        "bytes_before": len(old_html.encode("utf-8")),
        "bytes_after": len(new_html.encode("utf-8")),
        "sha_before": hashlib.sha256(old_html.encode("utf-8")).hexdigest()[:16],
        "sha_after": hashlib.sha256(new_html.encode("utf-8")).hexdigest()[:16],
    }


def decode_html(raw: bytes) -> str:
    for enc in ("utf-8", "utf-8-sig"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise LessonReportError("HTML урока не в UTF-8")


def bundled_reports() -> list[Path]:
    return sorted(CONTENT_DIR.glob("*.report.json"))
