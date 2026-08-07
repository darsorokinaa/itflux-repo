"""Агрегация критериев: legacy single-карточки и многоосевые рубрики (говорение)."""

from __future__ import annotations

from collections import OrderedDict
from typing import Any, Iterable, Optional


def build_criteria_payload(
    rows: Iterable[dict],
    *,
    max_score: int = 1,
) -> dict[str, Any]:
    """
    rows: dicts with id, criteria_text, criteria_score, axis_code, axis_title,
          axis_order, axis_max, is_gate.
    """
    flat = []
    axes_map: OrderedDict[str, dict] = OrderedDict()
    has_axes = False

    for raw in rows:
        row = {
            "id": raw["id"],
            "criteria_text": raw.get("criteria_text") or "",
            "criteria_score": int(raw.get("criteria_score") or 0),
            "axis_code": (raw.get("axis_code") or "").strip(),
            "axis_title": (raw.get("axis_title") or "").strip(),
            "axis_order": int(raw.get("axis_order") or 0),
            "axis_max": int(raw.get("axis_max") or 0),
            "is_gate": bool(raw.get("is_gate")),
        }
        flat.append(row)
        code = row["axis_code"]
        if not code:
            continue
        has_axes = True
        if code not in axes_map:
            axes_map[code] = {
                "code": code,
                "title": row["axis_title"] or code,
                "order": row["axis_order"],
                "max_score": row["axis_max"] or 0,
                "is_gate": row["is_gate"],
                "levels": [],
            }
        axis = axes_map[code]
        if row["axis_title"] and not axis["title"]:
            axis["title"] = row["axis_title"]
        if row["axis_order"] and (not axis["order"] or row["axis_order"] < axis["order"]):
            axis["order"] = row["axis_order"]
        if row["is_gate"]:
            axis["is_gate"] = True
        if row["axis_max"] and row["axis_max"] > axis["max_score"]:
            axis["max_score"] = row["axis_max"]
        axis["levels"].append(
            {
                "id": row["id"],
                "criteria_score": row["criteria_score"],
                "criteria_text": row["criteria_text"],
            }
        )

    axes = list(axes_map.values())
    for axis in axes:
        axis["levels"].sort(key=lambda lv: (-lv["criteria_score"], lv["id"]))
        if not axis["max_score"] and axis["levels"]:
            axis["max_score"] = max(lv["criteria_score"] for lv in axis["levels"])
    axes.sort(key=lambda a: (a["order"], a["code"]))

    return {
        "scoring_mode": "axes" if has_axes else "single",
        "max_score": int(max_score if max_score is not None else 1),
        "axes": axes,
        "criteria": [
            {
                "id": r["id"],
                "criteria_text": r["criteria_text"],
                "criteria_score": r["criteria_score"],
                "axis_code": r["axis_code"],
                "axis_title": r["axis_title"],
                "axis_order": r["axis_order"],
                "axis_max": r["axis_max"],
                "is_gate": r["is_gate"],
            }
            for r in flat
        ],
    }


def compute_axes_task_score(
    axes: Iterable[dict],
    selected: dict[str, Optional[int]],
) -> dict[str, Any]:
    """
    selected: {axis_code: score or None}.
    Сумма по осям без gate-обнуления (правило из КИМ остаётся в тексте критерия).
    """
    total = 0
    per_axis: dict[str, int] = {}
    complete = True
    for axis in axes:
        code = axis["code"]
        raw = selected.get(code)
        if raw is None:
            complete = False
            continue
        score = max(0, min(int(raw), int(axis.get("max_score") or 0) or int(raw)))
        per_axis[code] = score
        total += score
    return {
        "total": total,
        "per_axis": per_axis,
        "gated": False,
        "complete": complete and bool(list(axes)),
    }
