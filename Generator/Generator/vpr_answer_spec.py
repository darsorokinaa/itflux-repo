"""Спецификация и проверка авторских аналогов ВПР-2026 (математика, база).

Пакет не загружается. Функции ниже только описывают, как сохранить запись
без потерь и как сверить ответ, когда спецификация уже есть у задачи.
Старые задачи без answer_spec сюда не попадают.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from typing import Any

from .answer_check import _decimal_key, normalize_answer

# Ключи, которые остаются в answer_spec. condition собирается в task_template.
_TEXT_ONLY_KEYS = frozenset({"condition"})

# Все пять базовых пакетов (1580). inf8 v1 не входит: у него ложный OK по рисункам.
# inf8 v2 допущен после независимой сверки 40 SVG №12 с field.json.
APPLY_READY_PACKS = frozenset({"ma7", "ma8", "ma10", "inf7", "inf8"})
HOLD_PACKS = frozenset()

_GRAPHIC_OR_KEY_MANUAL = frozenset({
    "mark_point_on_line",
    "mark_point_in_region",
    "coordinate_pair",
    "interval_union",
    "any_of_programs",
    "document_file",
    "program_file",
    "two_parts: series; roots",
    "two_parts: graph_points; parameter",
})
# Короткий ключ при максимуме 2 — это «обоснованно», не автобалл.
_JUSTIFIED_SHORT = frozenset({
    "number",
    "number_or_fraction",
    "number_or_radical",
    "number_list",
    "vertex_label",
    "single_choice",
    "matching_sequence",
    "number_pairs",
    "word",
    "sequence",
    "number_in_base",
    "two_numbers",
})
_AUTO_SHORT = _JUSTIFIED_SHORT | frozenset({"multiple_choice_set"})
_MANUAL_FORMATS = _GRAPHIC_OR_KEY_MANUAL
_FRACTION_RE = re.compile(r"^([-+]?\d+)/([-+]?\d+)$")
_NUMBER_RE = re.compile(r"[-−]?\d+(?:[.,]\d+)?")
_PART_MARK_RE = re.compile(r"(\d+)\s*\)")


def check_mode(answer_format: str, *, max_score: int = 1) -> str:
    """auto — баллы считает диспетчер; manual — только учитель; mixed — часть баллов и ручной остаток.

    document_file / program_file / any_of_programs не исполняют check14, check15 и КуМир:
    это предпроверка или ограниченный интерпретатор, итог ставит учитель.
    truth_table_column — столбец 0/1 из answer_data, не виджет таблицы истинности сайта.
    """
    fmt = str(answer_format or "").strip()
    if fmt.startswith("extended:"):
        return "manual"
    if fmt in _MANUAL_FORMATS:
        return "manual"
    if fmt == "two_parts: number; graph_points":
        return "mixed"
    if fmt.startswith("two_parts:"):
        return "auto"
    if fmt == "truth_table_column":
        return "auto"
    if fmt == "multiple_choice_set":
        return "auto"
    if fmt in _JUSTIFIED_SHORT and int(max_score or 1) >= 2:
        return "manual"
    if fmt in _AUTO_SHORT:
        return "auto"
    return "manual"


def numeric_max_score(item: dict) -> int:
    """Целый максимум для TaskList. Строка вида «2 (12.1) / 4 (12.2)» берётся из критериев."""
    raw = item.get("max_score")
    if isinstance(raw, int) and not isinstance(raw, bool):
        return raw
    if isinstance(raw, str) and raw.strip().isdigit():
        return int(raw.strip())
    scores = [
        row[0]
        for row in (item.get("criteria") or [])
        if isinstance(row, (list, tuple)) and row and isinstance(row[0], int)
    ]
    return max(scores) if scores else 1


def describe_check(spec: dict | None, *, max_score: int = 1) -> dict | None:
    if not isinstance(spec, dict) or not spec.get("answer_format"):
        return None
    return {
        "mode": check_mode(spec.get("answer_format"), max_score=max_score),
        "format": str(spec.get("answer_format") or ""),
    }


def scoring_spec(spec: dict | None) -> dict | None:
    """Спека для снимка попытки: без SVG и внутренних полей генератора."""
    if not isinstance(spec, dict) or not spec.get("answer_format"):
        return None
    return {
        "answer_format": spec.get("answer_format"),
        "answer_data": spec.get("answer_data") if isinstance(spec.get("answer_data"), dict) else {},
    }


def storage_from_item(item: dict) -> dict:
    """Поля задачи и список, в которые пакет ложится без потерь. В базу не пишет."""
    if not isinstance(item, dict):
        raise TypeError("item must be a dict")
    spec = {key: value for key, value in item.items() if key not in _TEXT_ONLY_KEYS}
    condition = str(item.get("condition") or "")
    svg = str(item.get("svg") or "")
    svg_html = str(item.get("svg_html") or "")
    solution = str(item.get("solution") or "")
    solution_image = str(item.get("solution_image") or "")
    template_parts = [condition]
    if svg and svg not in condition:
        template_parts.append(svg)
    if svg_html and svg_html not in condition:
        template_parts.append(svg_html)
    solution_parts = [solution]
    if solution_image and solution_image not in solution:
        solution_parts.append(solution_image)
    return {
        "source_key": str(item.get("id") or "").strip() or None,
        "answer": str(item.get("answer") or ""),
        "solution": "\n".join(part for part in solution_parts if part),
        "task_template": "\n".join(part for part in template_parts if part),
        "answer_spec": spec,
        "max_score": numeric_max_score(item),
        "vpr_class": int(item["grade"]) if item.get("grade") is not None else None,
        "author": str(item.get("author") or ""),
        "criteria": item.get("criteria") or [],
        "task_number": int(item.get("number") or 0),
        "subject_short": _subject_short(item.get("subject")),
        "answer_check": describe_check(spec, max_score=numeric_max_score(item)),
    }


def _subject_short(subject) -> str:
    name = str(subject or "").strip().casefold()
    if name in {"математика", "math"}:
        return "math"
    if name in {"информатика", "inf", "информатика"}:
        return "inf"
    return ""


def storage_losses(item: dict, stored: dict | None = None) -> list[str]:
    """Пустой список — исходные поля восстанавливаются из answer_spec и текстов."""
    stored = stored or storage_from_item(item)
    spec = stored.get("answer_spec") or {}
    losses = []
    for key, value in item.items():
        if key == "condition":
            if str(value or "") not in str(stored.get("task_template") or ""):
                losses.append("condition")
            continue
        if spec.get(key) != value:
            losses.append(key)
    if stored.get("answer") != str(item.get("answer") or ""):
        losses.append("answer")
    if str(item.get("solution") or "") not in str(stored.get("solution") or ""):
        losses.append("solution_text")
    svg = str(item.get("svg") or "")
    if svg and svg not in str(stored.get("task_template") or ""):
        losses.append("svg_in_template")
    svg_html = str(item.get("svg_html") or "")
    if svg_html and svg_html not in str(stored.get("task_template") or ""):
        losses.append("svg_html_in_template")
    image = str(item.get("solution_image") or "")
    if image and image not in str(stored.get("solution") or ""):
        losses.append("solution_image_in_solution")
    return losses


def _fraction(norm: str) -> Fraction | None:
    match = _FRACTION_RE.fullmatch(norm or "")
    if not match:
        return None
    denominator = int(match.group(2))
    if denominator == 0:
        return None
    return Fraction(int(match.group(1)), denominator)


def values_equal(expected, actual) -> bool:
    """Текст, десятичная запятая или точная дробь. Корни и дроби к float не приводятся."""
    left = normalize_answer(expected)
    right = normalize_answer(actual)
    if not left or not right:
        return False
    left_fraction = _fraction(left)
    right_fraction = _fraction(right)
    if left_fraction is not None or right_fraction is not None:
        return left_fraction is not None and left_fraction == right_fraction
    if "√" in left or "√" in right:
        return left == right
    return _decimal_key(left) == _decimal_key(right)


def _tokens(text: str, pattern: str) -> list[str]:
    return [part.strip() for part in re.split(pattern, str(text or "")) if part.strip()]


def _canon(token: str) -> str:
    norm = normalize_answer(token)
    fraction = _fraction(norm)
    if fraction is not None:
        return f"f:{fraction.numerator}/{fraction.denominator}"
    if "√" in norm:
        return f"r:{norm}"
    return f"d:{_decimal_key(norm)}"


def _numbered_parts(text: str) -> dict[str, str]:
    marks = list(_PART_MARK_RE.finditer(str(text or "")))
    if not marks:
        return {}
    out = {}
    for index, mark in enumerate(marks):
        start = mark.end()
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        out[mark.group(1)] = str(text)[start:end].strip(" ;,\n")
    return out


def _two_part_chunks(text: str) -> tuple[str, str]:
    numbered = _numbered_parts(text)
    if "1" in numbered or "2" in numbered:
        return numbered.get("1", ""), numbered.get("2", "")
    raw = str(text or "").strip()
    if ";" in raw:
        left, right = raw.split(";", 1)
        return left.strip(), right.strip()
    return raw.strip(), ""


def _list_equal(expected, actual_text: str) -> bool:
    if isinstance(expected, list):
        wanted = [str(part) for part in expected]
    else:
        wanted = _tokens(str(expected), r"[;]")
    got = _tokens(actual_text, r"[;]")
    if len(wanted) != len(got):
        return False
    return all(values_equal(left, right) for left, right in zip(wanted, got))


def _set_equal(expected: list, actual_text: str, *, all_required: bool = True) -> bool:
    wanted = {_canon(part) for part in expected}
    got = {_canon(part) for part in _tokens(actual_text, r"[,;]")}
    if not wanted or not got:
        return False
    if all_required:
        return got == wanted
    return got.issubset(wanted)


def _parse_pairs(text: str) -> list[tuple[str, str]] | None:
    chunks = re.split(r"\s+или\s+", str(text or "").strip(), flags=re.IGNORECASE)
    pairs = []
    for chunk in chunks:
        chunk = re.sub(r"^\d+\s*\)\s*", "", chunk.strip())
        bits = re.split(r"\s+и\s+", chunk, flags=re.IGNORECASE)
        if len(bits) != 2:
            return None
        pairs.append((bits[0].strip(), bits[1].strip()))
    return pairs or None


def _pairs_equal(expected: list, actual_text: str, *, all_required: bool = True) -> bool:
    parsed = _parse_pairs(actual_text)
    if not parsed:
        return False
    wanted = {_canon(pair[0]) + "|" + _canon(pair[1]) for pair in expected}
    got = {_canon(pair[0]) + "|" + _canon(pair[1]) for pair in parsed}
    if all_required:
        return got == wanted
    return bool(got) and got.issubset(wanted)


def _decimal_token(text: str) -> Decimal | None:
    numbers = _NUMBER_RE.findall(str(text or ""))
    if len(numbers) != 1:
        return None
    try:
        return Decimal(numbers[0].replace("−", "-").replace(",", "."))
    except InvalidOperation:
        return None


def _interval_contains(spec: dict, actual_text: str) -> bool:
    interval = spec.get("interval") if isinstance(spec.get("interval"), dict) else {}
    try:
        lo = Decimal(str(interval.get("lo")).replace(",", "."))
        hi = Decimal(str(interval.get("hi")).replace(",", "."))
    except (InvalidOperation, TypeError):
        return False
    value = _decimal_token(actual_text)
    if value is None:
        return False
    if interval.get("lo_included", True):
        if value < lo:
            return False
    elif value <= lo:
        return False
    if interval.get("hi_included", True):
        return value <= hi
    return value < hi


def _part_score(part: dict, actual_text: str) -> int:
    if not isinstance(part, dict):
        return 0
    weight = int(part.get("score") or 0)
    if weight <= 0 or not str(actual_text or "").strip():
        return 0
    if "years" in part:
        years = part.get("years") or []
        return weight if _set_equal(years, actual_text, all_required=bool(part.get("all_required", True))) else 0
    if "interval" in part:
        return weight if _interval_contains(part, actual_text) else 0
    if "value" in part:
        value = part.get("value")
        ok = _list_equal(value, actual_text) if isinstance(value, list) else values_equal(value, actual_text)
        return weight if ok else 0
    return 0


def _choice_points(data: dict, text: str, maximum: int) -> int:
    """Набор цифр. «без разделителей» — склейка. При максимуме 2 одна лишняя или пропущенная цифра даёт 1."""
    from collections import Counter

    choices = [str(part) for part in (data.get("choices") or [])]
    order = str(data.get("order") or "")
    glued = "без разделител" in order
    if glued and choices and all(len(part) == 1 for part in choices):
        got = list(normalize_answer(text))
    else:
        got = _tokens(text, r"[,;]")
    if not got or not choices:
        return 0
    ascending = "ascending" in order or "возраст" in order
    if Counter(got) == Counter(choices):
        if not ascending or got == choices:
            return maximum
        return 0
    extra = sum((Counter(got) - Counter(choices)).values())
    missing = sum((Counter(choices) - Counter(got)).values())
    if maximum >= 2 and extra + missing == 1 and not (extra and missing):
        if ascending and got != sorted(got):
            return 0
        return 1
    return 0


def _truth_column_points(data: dict, text: str, maximum: int) -> int:
    """Столбец F из answer_data. Не виджет таблицы истинности и не исполнение программы."""
    rows = data.get("rows") if isinstance(data.get("rows"), list) else []
    expected = "".join(str(row.get("F")) for row in rows if isinstance(row, dict))
    width = len(expected)
    if width == 0:
        return 0
    parts = re.findall(r"[01]+", str(text or ""))
    singles = [part for part in parts if len(part) == 1]
    if len(singles) == width:
        got = "".join(singles)
    elif len("".join(parts)) == width:
        got = "".join(parts)
    else:
        return 0
    wrong = sum(left != right for left, right in zip(got, expected))
    if wrong == 0:
        return maximum
    if maximum >= 2 and wrong == 1:
        return 1
    return 0


def _auto_match(fmt: str, data: dict, text: str) -> bool:
    if fmt == "number" or fmt in {"number_or_fraction", "number_or_radical"}:
        return values_equal(data.get("value"), text)
    if fmt == "number_in_base":
        return normalize_answer(data.get("value")) == normalize_answer(text)
    if fmt == "word":
        return normalize_answer(data.get("value")) == normalize_answer(text)
    if fmt == "sequence":
        expected = "".join(str(part) for part in (data.get("sequence") or []))
        return normalize_answer(expected) == normalize_answer(text)
    if fmt == "two_numbers":
        wanted = [data.get("files_in_folder"), data.get("km")]
        got = _tokens(text, r"[;]")
        return len(got) == 2 and all(values_equal(left, right) for left, right in zip(wanted, got))
    if fmt == "number_list":
        return _list_equal(data.get("roots") or [], text)
    if fmt == "multiple_choice_set":
        return _set_equal(data.get("choices") or [], text, all_required=True)
    if fmt == "single_choice":
        return values_equal(data.get("choice"), text) or normalize_answer(data.get("choice")) == normalize_answer(text)
    if fmt == "vertex_label":
        return normalize_answer(data.get("vertex")).strip(".") == normalize_answer(text).strip(".")
    if fmt == "matching_sequence":
        expected = "".join(str(part) for part in (data.get("sequence") or []))
        return normalize_answer(expected) == normalize_answer(text)
    if fmt == "number_pairs":
        return _pairs_equal(
            data.get("pairs") or [],
            text,
            all_required=bool(data.get("all_required", True)),
        )
    if fmt == "coordinate_pair":
        raw = str(text or "")
        match = re.search(r"\(\s*([^;()]+)\s*;\s*([^;()]+)\s*\)", raw) or re.search(
            r"^\s*([^;]+)\s*;\s*([^;]+)\s*$", raw
        )
        if not match:
            return False
        return values_equal(data.get("x"), match.group(1)) and values_equal(data.get("y"), match.group(2))
    return False


def _status(points: int, maximum: int, *, pending: bool, answered: bool) -> str:
    if not answered:
        return "unanswered"
    if pending:
        return "pending_review"
    if maximum > 0 and points >= maximum:
        return "correct"
    if points > 0:
        return "partial"
    return "incorrect"


def score_vpr_spec(
    spec: dict | None,
    student_answer,
    *,
    max_score: int = 1,
    explicit: float | None = None,
    answered: bool | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    """Балл по формату v2.

    Графика и задания с обоснованием не становятся «неверно» и не получают
    полный балл за непустой ответ или за один ключ. Составные автоформаты
    отдают сумму баллов частей.
    """
    maximum = max(0, int(max_score or 0))
    text = str(student_answer or "").strip()
    has_answer = bool(text) if answered is None else bool(answered)
    fmt = str((spec or {}).get("answer_format") or "")
    resolved = mode or (check_mode(fmt, max_score=maximum) if fmt else (mode or ""))
    data = (spec or {}).get("answer_data") if isinstance((spec or {}).get("answer_data"), dict) else {}

    if resolved in {"manual", "mixed"} and explicit is not None:
        try:
            points = int(explicit) if float(explicit) == int(explicit) else float(explicit)
        except (TypeError, ValueError):
            points = 0
        points = max(0, min(points, maximum))
        return {
            "mode": resolved or "manual",
            "status": _status(points, maximum, pending=False, answered=True),
            "points": points,
            "max_points": maximum,
        }

    if not fmt and resolved == "manual":
        return {
            "mode": "manual",
            "status": _status(0, maximum, pending=has_answer, answered=has_answer),
            "points": 0,
            "max_points": maximum,
        }

    if resolved == "manual" or fmt in _MANUAL_FORMATS:
        return {
            "mode": "manual",
            "status": _status(0, maximum, pending=has_answer, answered=has_answer),
            "points": 0,
            "max_points": maximum,
        }

    if fmt == "two_parts: number; graph_points":
        part = data.get("9.1") if isinstance(data.get("9.1"), dict) else {}
        left, _right = _two_part_chunks(text)
        probe = left or text
        points = _part_score(part, probe) if has_answer else 0
        # Вторая часть — график. Даже верное число не закрывает задание.
        return {
            "mode": "mixed",
            "status": _status(points, maximum, pending=has_answer, answered=has_answer),
            "points": points if has_answer else 0,
            "max_points": maximum,
        }

    if fmt.startswith("two_parts:"):
        left, right = _two_part_chunks(text)
        points = 0
        if has_answer:
            numbered = [data.get(key) for key in sorted(data) if isinstance(data.get(key), dict)]
            if right:
                chunks = [left, right]
                if len(numbered) == 1:
                    chunks = [left or text]
                for part, chunk in zip(numbered, chunks):
                    points += _part_score(part, chunk)
            elif len(numbered) == 2:
                only = left or text
                first = _part_score(numbered[0], only)
                second = _part_score(numbered[1], only)
                points = first + (second if first == 0 else 0)
            elif numbered:
                points = _part_score(numbered[0], left or text)
        points = min(points, maximum)
        return {
            "mode": "auto",
            "status": _status(points, maximum, pending=False, answered=has_answer),
            "points": points,
            "max_points": maximum,
        }

    if fmt == "truth_table_column":
        points = _truth_column_points(data, text, maximum) if has_answer else 0
        return {
            "mode": "auto",
            "status": _status(points, maximum, pending=False, answered=has_answer),
            "points": points,
            "max_points": maximum,
        }

    if fmt == "multiple_choice_set":
        points = _choice_points(data, text, maximum) if has_answer else 0
        return {
            "mode": "auto",
            "status": _status(points, maximum, pending=False, answered=has_answer),
            "points": points,
            "max_points": maximum,
        }

    if fmt in _AUTO_SHORT:
        matched = bool(has_answer and _auto_match(fmt, data, text))
        points = maximum if matched else 0
        return {
            "mode": "auto",
            "status": _status(points, maximum, pending=False, answered=has_answer),
            "points": points,
            "max_points": maximum,
        }

    return {
        "mode": resolved or "manual",
        "status": _status(0, maximum, pending=has_answer, answered=has_answer),
        "points": 0,
        "max_points": maximum,
    }


def dry_run_items(items: list[dict]) -> dict[str, Any]:
    """Проверка пакета в памяти. Ничего не записывает."""
    errors = []
    ids = []
    by_number: dict[tuple, set] = {}
    modes: dict[str, int] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"{index}: не объект")
            continue
        source = str(item.get("id") or "")
        ids.append(source)
        if not source:
            errors.append(f"{index}: пустой id")
        stored = storage_from_item(item)
        losses = storage_losses(item, stored)
        if losses:
            errors.append(f"{source}: потери {', '.join(losses)}")
        if stored["answer"] != str(item.get("answer") or ""):
            errors.append(f"{source}: answer изменён")
        if isinstance(item.get("max_score"), str):
            if stored["answer_spec"].get("max_score") != item.get("max_score"):
                errors.append(f"{source}: исходный max_score не сохранён")
            if item.get("answer_format") == "program_file" and stored["max_score"] != 4:
                errors.append(f"{source}: числовой максимум программы должен быть 4")
        if not str(item.get("svg") or "") and "<svg" in str(item.get("condition") or "").lower():
            if "<svg" not in str(stored.get("task_template") or "").lower():
                errors.append(f"{source}: inline SVG условия потерян")
        key = (item.get("grade"), item.get("number"))
        by_number.setdefault(key, set()).add(json.dumps(item.get("criteria"), ensure_ascii=False, sort_keys=True))
        mode = (stored.get("answer_check") or {}).get("mode") or "?"
        modes[mode] = modes.get(mode, 0) + 1
        if item.get("answer_format") == "two_parts: list; interval":
            part = (item.get("answer_data") or {}).get("14.2") or {}
            interval = part.get("interval") or {}
            try:
                exact = Decimal(str(part.get("exact_reading")).replace(",", "."))
                tol = Decimal(str(part.get("tolerance")).replace(",", "."))
                lo = Decimal(str(interval.get("lo")).replace(",", "."))
                hi = Decimal(str(interval.get("hi")).replace(",", "."))
            except (InvalidOperation, TypeError):
                errors.append(f"{source}: интервал не читается")
            else:
                if lo != exact - tol or hi != exact + tol:
                    errors.append(f"{source}: границы не равны exact±tolerance")
                if not interval.get("lo_included") or not interval.get("hi_included"):
                    errors.append(f"{source}: концы интервала должны быть включены")
    duplicates = sorted({value for value in ids if value and ids.count(value) > 1})
    for value in duplicates:
        errors.append(f"повтор id {value}")
    for key, variants in by_number.items():
        if len(variants) > 1:
            errors.append(f"критерии расходятся внутри номера {key}")
    return {
        "count": len(items),
        "ids": len(ids),
        "unique_ids": len(set(ids)),
        "modes": modes,
        "errors": errors,
        "ok": not errors and len(ids) == len(set(ids)),
    }


def _obsolete_inf8_v1(archive) -> bool:
    """v1 помечает отсутствующие рисунки как OK и перечисляет id. v2 оставляет пустой список."""
    try:
        text = archive.read("packs/inf8/verify_report.txt").decode("utf-8", "replace")
    except KeyError:
        return False
    return "inf8-b-12-01" in text and "рисунок" in text


def dry_run_zip(path: str) -> dict[str, Any]:
    import zipfile

    from .vpr_pack_files import audit_zip_files

    archive = zipfile.ZipFile(path)
    names = [name for name in archive.namelist() if name.endswith("_bank.json") and "packs/" in name.replace("\\", "/")]
    if not names:
        return {"ok": False, "errors": ["в архиве нет *_bank.json"], "count": 0, "files": [], "applied": False}
    reports = []
    for name in names:
        payload = json.loads(archive.read(name))
        items = payload.get("items") if isinstance(payload, dict) else None
        pack = str((payload or {}).get("pack") or "")
        if not isinstance(items, list):
            reports.append({"file": name, "pack": pack, "ok": False, "errors": ["нет items"], "count": 0})
            continue
        report = dry_run_items(items)
        report["file"] = name
        report["pack"] = pack
        report["declared_count"] = payload.get("count")
        report["apply_ready"] = pack in APPLY_READY_PACKS and pack not in HOLD_PACKS
        report["hold"] = pack in HOLD_PACKS
        report["obsolete"] = pack == "inf8" and _obsolete_inf8_v1(archive)
        if report["obsolete"]:
            report["errors"].append("это inf8 v1: ложный OK по рисункам, пакет исключён")
            report["apply_ready"] = False
        if payload.get("count") not in (None, len(items)):
            report["errors"].append("count не совпал с числом items")
        file_errors = audit_zip_files(archive, items)
        report["errors"].extend(file_errors)
        report["ok"] = not report["errors"] and report["unique_ids"] == report["count"]
        reports.append(report)
    return {
        "ok": bool(reports) and all(item.get("ok") for item in reports),
        "files": reports,
        "count": sum(item.get("count") or 0 for item in reports),
        "apply_ready": bool(reports) and all(item.get("apply_ready") and item.get("ok") for item in reports),
        "applied": False,
        "errors": [f"{item.get('file')}: {err}" for item in reports for err in item.get("errors") or []],
    }
