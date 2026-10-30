"""r120: баллы второй части, выставленные учителем на видеоуроке.

Балл сохраняется один раз и дальше не меняется: ключ LOCK_KEY в result_payload
хранит зафиксированные значения, и любые последующие правки payload
(черновик ученика, повторная сдача, проверка ДЗ) возвращают их обратно.
"""
from __future__ import annotations

LOCK_KEY = "lesson_locked_scores"


def _import(name):
    try:
        mod = __import__("Generator.variant_scoring", fromlist=[name])
    except Exception:
        mod = __import__("Generator.Generator.variant_scoring", fromlist=[name])
    return getattr(mod, name)


def locked_scores(payload) -> dict:
    if not isinstance(payload, dict):
        return {}
    raw = payload.get(LOCK_KEY)
    return raw if isinstance(raw, dict) else {}


def reapply_locked_scores(payload, previous=None):
    """Вернуть зафиксированные баллы в payload["scores"]. Источник замков — previous или сам payload."""
    if not isinstance(payload, dict):
        return payload
    locks = dict(locked_scores(previous) if previous is not None else {})
    locks.update(locked_scores(payload))
    if not locks:
        return payload
    payload[LOCK_KEY] = locks
    scores = payload.get("scores") if isinstance(payload.get("scores"), dict) else {}
    scores = dict(scores)
    for tid, row in locks.items():
        value = row.get("score") if isinstance(row, dict) else row
        scores[str(tid)] = value
    payload["scores"] = scores
    return payload


def grading_tasks(variant_id) -> list[dict]:
    """Задания варианта с частью, максимумом и критериями (только для учителя)."""
    if not variant_id:
        return []
    load = _import("load_variant_tasks_for_scoring")
    logical_exam_part = _import("logical_exam_part")
    task_max_points = _import("task_max_points")
    variant_level_subject = _import("variant_level_subject")
    level, subject = variant_level_subject(variant_id)
    rows = load(variant_id)
    out = []
    for row in rows:
        out.append(
            {
                "id": row["id"],
                "part": logical_exam_part(row, level, subject),
                "maxScore": task_max_points(row),
            }
        )
    part2_ids = [r["id"] for r in out if r["part"] == 2]
    if part2_ids:
        _attach_criteria(out, part2_ids)
    return out


def _attach_criteria(rows, task_ids):
    from django.apps import apps

    Task = apps.get_model("Generator", "Task")
    Criteria = apps.get_model("Generator", "Criteria")
    try:
        from Generator.latex_utils import process_latex
        from Generator.criteria_scoring import build_criteria_payload
    except Exception:
        from Generator.Generator.latex_utils import process_latex
        from Generator.Generator.criteria_scoring import build_criteria_payload
    tl_by_task = dict(Task.objects.filter(pk__in=task_ids).values_list("pk", "task_id"))
    tl_ids = {v for v in tl_by_task.values() if v}
    crit_by_tl: dict = {}
    for c in (
        Criteria.objects.filter(task_number_id__in=tl_ids)
        .order_by("axis_order", "-criteria_score", "id")
        .values("id", "task_number_id", "criteria_text", "criteria_score", "axis_code",
                "axis_title", "axis_order", "axis_max", "is_gate")
    ):
        tl = c.pop("task_number_id")
        try:
            c["criteria_text"] = process_latex(str(c.get("criteria_text") or ""), for_browser=True)
        except Exception:
            c["criteria_text"] = str(c.get("criteria_text") or "")
        crit_by_tl.setdefault(tl, []).append(c)
    for row in rows:
        if row["id"] not in task_ids:
            continue
        crit = crit_by_tl.get(tl_by_task.get(row["id"]), [])
        try:
            row["criteria"] = build_criteria_payload(crit, max_score=row["maxScore"])
        except Exception:
            row["criteria"] = {"scoring_mode": "single", "criteria": crit, "axes": [], "max_score": row["maxScore"]}
