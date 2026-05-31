# -*- coding: utf-8 -*-
"""Контекст педагогического PDF-отчёта без ИИ: шаблоны и рекомендации из БД."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.db.models import Q

from .models import PedagogicalRecommendation, ReportConclusionTemplate, ReportNextStepTemplate

_BRAND_THEME = {
    "accent": "#1d4ed8",
    "accent_dark": "#1e3a8a",
    "accent_soft": "#eff6ff",
    "accent_border": "#bfdbfe",
}

SUBJECT_THEME = {
    "Информатика": dict(_BRAND_THEME),
    "Математика": dict(_BRAND_THEME),
    "Физика": dict(_BRAND_THEME),
    "Химия": dict(_BRAND_THEME),
}

DEFAULT_SUBJECT_THEME = dict(_BRAND_THEME)

VPR_BADGE = {
    "fg": "#1e3a8a",
    "bg": "#eff6ff",
    "border": "#bfdbfe",
}

RECOMMENDATION_FALLBACK = "Повторить тему и решить несколько похожих заданий."
CORRECT_TASK_HINT = "Тема выполнена верно. Можно переходить к более сложным заданиям."


def subject_theme_for_label(subject_label: str) -> dict[str, str]:
    return SUBJECT_THEME.get((subject_label or "").strip(), DEFAULT_SUBJECT_THEME)


def exam_level_code(level_val: str) -> str:
    l = (level_val or "").lower().strip()
    if l == "vpr":
        return "VPR"
    if l == "oge":
        return "OGE"
    if l == "ege":
        return "EGE"
    return (l or "UNK").upper()[:10]


def _norm(s: str) -> str:
    return (s or "").strip().casefold()


def _fill_template(text: str, ctx: dict[str, Any]) -> str:
    if not text:
        return ""
    out = text
    for k, v in ctx.items():
        out = out.replace("{" + k + "}", str(v))
    return out


def _pick_recommendation(
    subject_label: str,
    exam_level: str,
    subtopic: str,
    topic: str,
    skill_group: str,
) -> PedagogicalRecommendation | None:
    base = PedagogicalRecommendation.objects.filter(
        is_active=True,
        subject=subject_label,
        exam_level=exam_level,
    ).order_by("priority", "id")
    st = _norm(subtopic)
    tp = _norm(topic)
    sg = _norm(skill_group)

    if st:
        rec = base.filter(subtopic__iexact=subtopic.strip()).first()
        if rec:
            return rec
        for r in base:
            if _norm(r.subtopic) == st:
                return r
    if tp:
        rec = base.filter(topic__iexact=topic.strip()).first()
        if rec:
            return rec
        for r in base:
            if _norm(r.topic) == tp:
                return r
    if sg:
        rec = base.filter(skill_group__iexact=skill_group.strip()).first()
        if rec:
            return rec
        for r in base:
            if _norm(r.skill_group) == sg:
                return r
    return base.first()


def _result_level(percent: int) -> str:
    if percent <= 0:
        return "very_low"
    if percent < 40:
        return "low"
    if percent < 70:
        return "medium"
    return "high"


def _pick_conclusion_template(
    subject_label: str,
    exam_level: str,
    result_level: str,
    percent: int,
) -> ReportConclusionTemplate | None:
    qs = (
        ReportConclusionTemplate.objects.filter(
            is_active=True,
            result_level=result_level,
            min_percent__lte=percent,
            max_percent__gte=percent,
        )
        .filter(Q(subject="") | Q(subject=subject_label))
        .filter(Q(exam_level="") | Q(exam_level=exam_level))
    )
    best = None
    best_rank: tuple[int, int, int, int] | None = None
    for t in qs.order_by("priority", "id"):
        sub_m = 0 if (t.subject or "").strip() == subject_label.strip() else 1
        lvl_m = 0 if (t.exam_level or "").strip() == exam_level else 1
        rank = (sub_m, lvl_m, t.priority, t.id)
        if best is None or rank < best_rank:
            best, best_rank = t, rank
    return best


_FALLBACK_CONCLUSION = {
    "very_low": "Работа выполнена на низком уровне: верных ответов нет.",
    "low": "Работа выполнена на низком уровне. Требуется повторение базовых тем.",
    "medium": "Результат средний: часть тем усвоена, но есть устойчивые пробелы.",
    "high": "Результат хороший: большинство заданий выполнено верно.",
}

_NEXT_FALLBACK: dict[str, list[str]] = {
    "many_skipped": [
        "Проверить, почему часть заданий имеет время 0 секунд.",
        "Начать с повторения тем, к которым ученик не приступал.",
        "Дать мини-вариант из 3–4 заданий по слабым темам.",
    ],
    "low_percent": [
        "Разобрать ошибки по каждой теме.",
        "Решить 2–3 похожих задания с пошаговым объяснением.",
        "Повторить мини-вариант после разбора.",
    ],
    "many_errors": [
        "Систематически разобрать ошибки по номерам заданий.",
        "Повторить теорию по слабым подтемам.",
        "Решить короткий тренировочный блок из 4–5 задач.",
    ],
    "high_percent": [
        "Закрепить темы коротким повторением.",
        "Перейти к заданиям повышенной сложности.",
        "Дать новый вариант для контроля устойчивости результата.",
    ],
    "medium_percent": [
        "Усилить темы из списка повторения.",
        "Чередовать разбор теории и практики.",
        "Повторить вариант с фокусом на ошибках.",
    ],
    "slow_first_task": [
        "Разобрать первое задание отдельно: возможно, не хватило вводной или уверенности в формате.",
        "Начать следующую работу с короткой настройки на тип первой задачи.",
        "Дать 1–2 очень простых задания того же типа перед полным вариантом.",
    ],
    "default": [
        "Сверить ошибки с разбором по учебнику или конспекту.",
        "Отработать 2–3 задачи на слабые темы.",
        "Повторить вариант через несколько дней.",
    ],
}


def _resolve_next_condition(
    percent: int,
    tasks_count: int,
    skipped_count: int,
    wrong_count: int,
    slowest_number: Any,
    slowest_seconds: float,
) -> str:
    if tasks_count and skipped_count >= tasks_count / 2:
        return "many_skipped"
    if percent < 40:
        return "low_percent"
    if tasks_count and wrong_count >= tasks_count / 2:
        return "many_errors"
    if percent >= 70:
        return "high_percent"
    if slowest_number == 1 and slowest_seconds > 120:
        return "slow_first_task"
    if 40 <= percent < 70:
        return "medium_percent"
    return "default"


def _load_next_steps(
    subject_label: str,
    exam_level: str,
    condition_type: str,
    limit: int = 5,
) -> list[str]:
    qs = ReportNextStepTemplate.objects.filter(
        is_active=True,
        condition_type=condition_type,
    ).filter(Q(subject="") | Q(subject=subject_label))
    qs = qs.filter(Q(exam_level="") | Q(exam_level=exam_level))
    rows = list(qs.order_by("priority", "id"))

    def sort_key(r: ReportNextStepTemplate):
        sub_m = 0 if (r.subject or "").strip() == subject_label.strip() else 1
        lvl_m = 0 if (r.exam_level or "").strip() == exam_level else 1
        return (sub_m, lvl_m, r.priority, r.id)

    rows.sort(key=sort_key)
    texts = [r.text.strip() for r in rows if (r.text or "").strip()]
    if texts:
        return texts[:limit]
    fb = _NEXT_FALLBACK.get(condition_type) or _NEXT_FALLBACK["default"]
    return fb[:limit]


@dataclass
class TaskReportRow:
    number: Any
    title: str
    subtopic_title: str
    topic_title: str
    score: float
    max_score: float
    time_seconds: float
    time_display: str
    status: str
    recommendation: str


def build_pedagogical_report_context(
    *,
    student_name: str,
    subject_label: str,
    level_val: str,
    level_label: str,
    variant_id: Any,
    date_solution: str,
    time_start: str,
    time_end: str,
    total_time_formatted: str,
    total_score: Any,
    max_score: Any,
    score_exam: Any,
    score_comment: str,
    mark_level: Any,
    is_vpr: bool,
    vpr_grade: int | None = None,
    tasks_payload: list[dict],
    scores: dict,
    task_times: dict,
    subtopic_by_task_id: dict[int, str],
    topic_by_task_id: dict[int, str],
) -> dict[str, Any]:
    exam_level = exam_level_code(level_val)
    level_label_display = level_label
    if is_vpr:
        if vpr_grade is not None:
            try:
                level_label_display = f"ВПР {int(vpr_grade)} класс"
            except (TypeError, ValueError):
                level_label_display = "ВПР"
        else:
            level_label_display = "ВПР"
    safe_total = int(total_score or 0)
    safe_max = int(max_score or 0)
    percent = round((safe_total / safe_max) * 100) if safe_max > 0 else 0

    rows: list[TaskReportRow] = []
    total_time_seconds = 0.0
    slowest_seconds = -1.0
    slowest_number: Any = None
    slowest_title = ""

    for t in tasks_payload:
        tid = str(t.get("id", ""))
        tid_int = int(tid) if tid.isdigit() else None
        num = t.get("number", tid)
        title = (t.get("task_title") or "") if isinstance(t.get("task_title"), str) else ""
        max_s = float(t.get("max_score", 1) or 1)
        sc_raw = scores.get(tid, scores.get(int(tid) if tid.isdigit() else tid, 0))
        try:
            sc = float(sc_raw)
        except (TypeError, ValueError):
            sc = 0.0
        sec_raw = task_times.get(tid, task_times.get(int(tid) if tid.isdigit() else tid, 0))
        try:
            sec = float(sec_raw)
        except (TypeError, ValueError):
            sec = 0.0
        total_time_seconds += sec
        if sec > slowest_seconds:
            slowest_seconds = sec
            slowest_number = num
            slowest_title = title

        st_raw = t.get("subtopic_title")
        subtopic_title = (st_raw or "").strip() if isinstance(st_raw, str) else ""
        if not subtopic_title and tid_int is not None:
            subtopic_title = subtopic_by_task_id.get(tid_int, "")
        topic_title = ""
        if tid_int is not None:
            topic_title = topic_by_task_id.get(tid_int, "")

        if max_s > 0 and sc >= max_s - 1e-9:
            status = "Верно"
        elif sc < max_s and sec <= 0:
            status = "Без ответа"
        else:
            status = "Ошибка"

        if status == "Верно":
            rec = CORRECT_TASK_HINT
        else:
            pr = _pick_recommendation(
                subject_label, exam_level, subtopic_title, topic_title, ""
            )
            rec = (pr.short_recommendation if pr else RECOMMENDATION_FALLBACK).strip()

        rows.append(
            TaskReportRow(
                number=num,
                title=title,
                subtopic_title=subtopic_title,
                topic_title=topic_title,
                score=sc,
                max_score=max_s,
                time_seconds=sec,
                time_display=f"{int(sec)} сек" if sec > 0 else "0 сек",
                status=status,
                recommendation=rec,
            )
        )

    tasks_count = len(rows)
    avg_time = (total_time_seconds / tasks_count) if tasks_count else 0.0

    correct_count = sum(1 for r in rows if r.status == "Верно")
    skipped_count = sum(1 for r in rows if r.status == "Без ответа")
    wrong_count = sum(1 for r in rows if r.status == "Ошибка")

    for r in rows:
        if r.status != "Верно" and r.time_seconds > avg_time * 2 and avg_time > 0:
            suf = " Задание заняло заметно больше среднего времени — разберите решение без спешки."
            if suf not in r.recommendation:
                r.recommendation = (r.recommendation + suf).strip()

    weak_topics: list[str] = []
    seen = set()
    for r in rows:
        if r.status != "Верно" and r.subtopic_title:
            k = r.subtopic_title.strip().casefold()
            if k not in seen:
                seen.add(k)
                weak_topics.append(r.subtopic_title.strip())
        if len(weak_topics) >= 7:
            break
    weak_topics_str = ", ".join(weak_topics) if weak_topics else "—"

    rlv = _result_level(percent)
    tmpl = _pick_conclusion_template(subject_label, exam_level, rlv, percent)
    tpl_ctx = {
        "student_name": student_name,
        "total_score": safe_total,
        "max_score": safe_max,
        "percent": percent,
        "correct_count": correct_count,
        "tasks_count": tasks_count,
        "weak_topics": weak_topics_str,
        "skipped_count": skipped_count,
        "slowest_task_number": slowest_number if slowest_number is not None else "—",
        "slowest_task_name": slowest_title or "—",
    }
    if tmpl:
        pedagogical_summary = _fill_template(tmpl.text_template, tpl_ctx).strip()
    else:
        pedagogical_summary = _FALLBACK_CONCLUSION.get(rlv, _FALLBACK_CONCLUSION["medium"])

    time_notes: list[str] = []
    if tasks_count and skipped_count >= tasks_count / 2:
        time_notes.append(
            "Часть заданий имеет время 0 секунд — возможно, ученик не приступал к ним "
            "или завершил работу без решения."
        )
    if slowest_seconds > 120 and slowest_number is not None:
        time_notes.append(
            f"Больше всего времени заняло задание №{slowest_number}: {slowest_title or '—'}. "
            "Эту тему стоит разобрать отдельно."
        )
    if not time_notes:
        time_notes.append("Время выполнения распределено без выраженных отклонений.")

    if weak_topics:
        time_notes.append(f"Основные зоны повторения: {weak_topics_str}.")

    pedagogical_summary = pedagogical_summary + "\n\n" + " ".join(time_notes)

    cond = _resolve_next_condition(
        percent, tasks_count, skipped_count, wrong_count, slowest_number, slowest_seconds
    )
    next_steps = _load_next_steps(subject_label, exam_level, cond, limit=5)
    if len(next_steps) < 3 and cond != "default":
        next_steps = next_steps + _load_next_steps(subject_label, exam_level, "default", limit=5)
    # unique preserve order
    out_steps = []
    seen_s = set()
    for s in next_steps:
        if s not in seen_s:
            seen_s.add(s)
            out_steps.append(s)
    next_steps = out_steps[:5]

    final_comment = (score_comment or "").strip()
    if not final_comment:
        if percent >= 70:
            final_comment = "Сохраняйте темп: закрепите материал короткими повторениями и новыми вариантами."
        elif percent >= 40:
            final_comment = "Сфокусируйтесь на темах из списка повторения — это даст наибольший прирост."
        else:
            final_comment = "Важно спокойно разобрать базовые темы и вернуться к варианту позже."

    theme = subject_theme_for_label(subject_label)

    table_rows = [
        {
            "number": r.number,
            "title": r.title or "—",
            "subtopic_title": r.subtopic_title or "—",
            "score": int(r.score) if r.score == int(r.score) else r.score,
            "max_score": int(r.max_score) if r.max_score == int(r.max_score) else r.max_score,
            "time": r.time_display,
            "status": r.status,
            "recommendation": r.recommendation,
            "status_class": {
                "Верно": "st-ok",
                "Без ответа": "st-skip",
                "Ошибка": "st-err",
            }.get(r.status, ""),
        }
        for r in rows
    ]

    return {
        "student_name": student_name,
        "subject_label": subject_label,
        "level_label": level_label_display,
        "level_val": level_val,
        "variant_id": variant_id,
        "date_solution": date_solution,
        "time_start": time_start,
        "time_end": time_end,
        "total_time_formatted": total_time_formatted,
        "total_score": safe_total,
        "max_score": safe_max,
        "percent": percent,
        "correct_count": correct_count,
        "wrong_count": wrong_count,
        "skipped_count": skipped_count,
        "tasks_count": tasks_count,
        "avg_time_seconds": int(round(avg_time)),
        "weak_topics": weak_topics,
        "weak_topics_str": weak_topics_str,
        "pedagogical_summary": pedagogical_summary,
        "next_steps": next_steps,
        "final_comment": final_comment,
        "score_exam": score_exam,
        "score_comment": score_comment,
        "is_vpr": is_vpr,
        "is_oge": (level_val or "").lower() == "oge",
        "is_ege": (level_val or "").lower() == "ege",
        "theme": theme,
        "vpr_badge": VPR_BADGE,
        "table_rows": table_rows,
        "primary_score_label": "Первичные баллы",
        "hero_score_text": "первичных баллов",
    }
