"""Снимок цены и причины, по которым AI-изменение не попало в лист."""

from __future__ import annotations

SNAPSHOT_KEYS = {
    "base_worksheet_generation": "base",
    "task_theme_adaptation": "adaptations",
    "task_rewrite": "rewrite",
    "ai_new_task": "new_tasks",
    "ai_design": "ai_design",
    "theory_block": "theory",
    "task_from_bank": "bank",
}

REASON_FROM_TEXT = {
    "пустой ответ": "json_error",
    "пустое условие": "json_error",
    "нет однозначного ответа": "invalid_answer",
    "не соответствует теме": "semantic_mismatch",
    "сложность": "semantic_mismatch",
    "дубликат": "duplicate",
}


def reason_code(reason: str) -> str:
    text = (reason or "").strip()
    if text in REASON_FROM_TEXT:
        return REASON_FROM_TEXT[text]
    if "не совпадает" in text:
        return "invalid_answer"
    if "json" in text.lower():
        return "json_error"
    return "semantic_mismatch"


def adapt_reason(check: dict, row: dict) -> str:
    if not row:
        return "json_error"
    if not check.get("numbers_preserved", True):
        return "number_changed"
    if not check.get("units_preserved", True):
        return "unit_changed"
    if not check.get("formulas_preserved", True):
        return "formula_changed"
    return "semantic_mismatch"


def _line_map(detail: list[dict]) -> dict:
    lines = {name: 0 for name in SNAPSHOT_KEYS.values()}
    for row in detail or []:
        name = SNAPSHOT_KEYS.get(row.get("key"))
        if name:
            lines[name] = int(row.get("amount") or 0)
    return lines


def pricing_snapshot(detail: list[dict], *, charged: int, quoted: int, quoted_detail: list[dict] | None = None) -> dict:
    lines = _line_map(detail)
    units = {}
    quantities = {}
    for row in detail or []:
        name = SNAPSHOT_KEYS.get(row.get("key"))
        if not name:
            continue
        units[name] = int(row.get("unit") or 0)
        quantities[name] = int(row.get("quantity") or 0)
    lines["total"] = int(charged)
    quoted_lines = _line_map(quoted_detail or [])
    quoted_lines["total"] = int(quoted)
    return {
        "charged": int(charged),
        "quoted": int(quoted),
        "lines": lines,
        "quoted_lines": quoted_lines,
        "units": units,
        "quantities": quantities,
    }


def _rate(accepted: int, proposed: int):
    if not proposed:
        return None
    return round(accepted / proposed, 4)


def quality_payload(
    *,
    bank_tasks: int,
    adaptations_planned: int,
    adaptations_accepted: int,
    adaptations_proposed: int,
    fallbacks: int,
    new_proposed: int,
    new_accepted: int,
    design_proposed: int,
    design_accepted: int,
    rejections: list[dict],
    baseline: list[dict],
) -> dict:
    return {
        "bank_tasks": int(bank_tasks),
        "ai_tasks_created": int(new_accepted),
        "adaptations_planned": int(adaptations_planned),
        "adaptations_accepted": int(adaptations_accepted),
        "fallbacks": int(fallbacks),
        "teacher_edits": 0,
        "acceptance": {
            "adaptation": {
                "proposed": int(adaptations_proposed),
                "accepted": int(adaptations_accepted),
                "rate": _rate(adaptations_accepted, adaptations_proposed),
            },
            "new_tasks": {
                "proposed": int(new_proposed),
                "accepted": int(new_accepted),
                "rate": _rate(new_accepted, new_proposed),
            },
            "design": {
                "proposed": int(design_proposed),
                "accepted": int(design_accepted),
                "rate": _rate(design_accepted, design_proposed),
            },
        },
        "rejections": list(rejections),
        "baseline_tasks": baseline,
    }


def task_baseline(blocks: list) -> list[dict]:
    items = []
    for block in blocks or []:
        if not isinstance(block, dict) or block.get("type") != "task":
            continue
        task = block.get("task") or {}
        text = task.get("question") or task.get("q") or ""
        items.append({
            "id": str(block.get("id") or ""),
            "text": str(text),
        })
    return items


def count_teacher_edits(baseline: list[dict], blocks: list) -> tuple[int, list[str]]:
    if not baseline:
        return 0, []
    current = {item["id"]: item["text"].strip() for item in task_baseline(blocks) if item["id"]}
    previous = {item["id"]: str(item.get("text") or "").strip() for item in baseline or [] if item.get("id")}
    changed = []
    for key, text in previous.items():
        if current.get(key) != text:
            changed.append(key)
    for key in current:
        if key not in previous:
            changed.append(key)
    return len(changed), changed


def record_teacher_edits(generation, blocks: list) -> int:
    quality = dict(generation.quality or {})
    baseline = quality.get("baseline_tasks") or []
    count, changed = count_teacher_edits(baseline, blocks)
    kept = [item for item in quality.get("rejections") or [] if item.get("reason") != "teacher_replaced"]
    kept.extend(
        {"area": "teacher", "reason": "teacher_replaced", "task_id": task_id}
        for task_id in changed
    )
    quality["teacher_edits"] = count
    quality["rejections"] = kept
    generation.quality = quality
    generation.save(update_fields=["quality"])
    return count


def aggregate_quality(generations) -> dict:
    areas = {
        "adaptation": {"proposed": 0, "accepted": 0},
        "new_tasks": {"proposed": 0, "accepted": 0},
        "design": {"proposed": 0, "accepted": 0},
    }
    reasons = {}
    totals = {
        "generations": 0,
        "bank_tasks": 0,
        "ai_tasks_created": 0,
        "adaptations_planned": 0,
        "adaptations_accepted": 0,
        "fallbacks": 0,
        "teacher_edits": 0,
        "provider_cost": 0,
    }
    for generation in generations:
        if generation.status == "running":
            continue
        totals["generations"] += 1
        quality = generation.quality or {}
        totals["bank_tasks"] += int(quality.get("bank_tasks") or 0)
        totals["ai_tasks_created"] += int(quality.get("ai_tasks_created") or 0)
        totals["adaptations_planned"] += int(quality.get("adaptations_planned") or 0)
        totals["adaptations_accepted"] += int(quality.get("adaptations_accepted") or 0)
        totals["fallbacks"] += int(quality.get("fallbacks") or 0)
        totals["teacher_edits"] += int(quality.get("teacher_edits") or 0)
        totals["provider_cost"] = float(totals["provider_cost"]) + float(generation.provider_cost or 0)
        acceptance = quality.get("acceptance") or {}
        for name in areas:
            part = acceptance.get(name) or {}
            areas[name]["proposed"] += int(part.get("proposed") or 0)
            areas[name]["accepted"] += int(part.get("accepted") or 0)
        for item in quality.get("rejections") or []:
            code = item.get("reason") or ""
            if code:
                reasons[code] = reasons.get(code, 0) + 1
    report = {"totals": totals, "acceptance": {}, "rejections": reasons}
    for name, part in areas.items():
        report["acceptance"][name] = {**part, "rate": _rate(part["accepted"], part["proposed"])}
    return report
