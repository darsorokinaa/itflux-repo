"""Программная проверка условия. Ограничение «не менять числа» не живёт только в промпте."""

from __future__ import annotations

import ast
import re
from collections import Counter

from .textutil import plain_text

NUMBER_RE = re.compile(r"(?<!\d)(-?\d+(?:[.,]\d+)?)(?!\d)")
LATEX_RE = re.compile(r"\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$\$[\s\S]+?\$\$|\$[^$\n]+\$")
PLAIN_FORMULA_RE = re.compile(
    r"\d+(?:[.,]\d+)?\s*[a-zA-Zа-яА-ЯёЁ](?:\s*(?:\^|\*\*)\s*\d+|[²³⁴])?"
    r"(?:\s*[+\-−–=]\s*\d+(?:[.,]\d+)?\s*[a-zA-Zа-яА-ЯёЁ]?(?:\s*(?:\^|\*\*)\s*\d+|[²³⁴])?)+"
    r"|[a-zA-Zа-яА-ЯёЁ](?:\s*(?:\^|\*\*)\s*\d+|[²³⁴])"
)
ARITH_RE = re.compile(
    r"(?<!\w)(\d+(?:[.,]\d+)?(?:\s*[\+\-\*\/\^]\s*\d+(?:[.,]\d+)?)+)(?!\w)"
)

# Длинные шаблоны раньше коротких, чтобы «кг» не распадалось на «г».
UNIT_PATTERNS = [
    ("км/ч", r"км/ч"),
    ("м/с", r"м/с"),
    ("см2", r"см(?:²|\^2)"),
    ("м2", r"(?<![а-яё])м(?:²|\^2)"),
    ("м3", r"(?<![а-яё])м(?:³|\^3)"),
    ("кг", r"килограмм(?:а|ов)?|кг"),
    ("мг", r"миллиграмм(?:а|ов)?|мг"),
    ("мл", r"миллилитр(?:а|ов)?|мл"),
    ("см", r"сантиметр(?:а|ов)?|(?<![а-яё])см(?![а-яё])"),
    ("мм", r"миллиметр(?:а|ов)?|(?<![а-яё])мм(?![а-яё])"),
    ("км", r"километр(?:а|ов)?|(?<![а-яё])км(?![а-яё])"),
    ("мин", r"минут(?:а|ы)?|(?<![а-яё])мин(?![а-яё])"),
    ("сек", r"секунд(?:а|ы)?|(?<![а-яё])сек(?![а-яё])"),
    ("г", r"грамм(?:а|ов)?|(?<![а-яё])г(?![а-яё])"),
    ("л", r"литр(?:а|ов)?|(?<![а-яё])л(?![а-яё])"),
    ("м", r"метр(?:а|ов)?|(?<![а-яё])м(?![а-яё])"),
    ("%", r"%|процент(?:а|ов)?"),
]

NON_THEMABLE_HINTS = (
    "упростите",
    "упростить выражение",
    "решите уравнение",
    "решите неравенство",
    "постройте график",
    "на графике",
    "таблица истинности",
    "докажите",
    "координатн",
)
NON_THEMABLE_TYPES = {"function_graph", "coordinate_plane", "table", "expression"}
AMBIGUOUS_ANSWERS = {"зависит", "нельзя определить", "много ответов", "любое", "неоднозначно"}


def _submultiset(need, have) -> bool:
    needed, owned = Counter(need), Counter(have)
    return all(owned[key] >= count for key, count in needed.items())


def _normalize_number(raw: str) -> str:
    return raw.replace(",", ".").lstrip("+")


def extract_numbers(text: str) -> list[str]:
    return [_normalize_number(item) for item in NUMBER_RE.findall(plain_text(text))]


def extract_units(text: str) -> list[str]:
    remaining = plain_text(text).lower().replace("ё", "е")
    found = []
    for canonical, pattern in UNIT_PATTERNS:
        regex = re.compile(pattern, re.IGNORECASE)
        matches = list(regex.finditer(remaining))
        if not matches:
            continue
        found.extend([canonical] * len(matches))
        remaining = regex.sub(" ", remaining)
    return found


def _normalize_formula(raw: str) -> str:
    text = plain_text(raw).lower().replace("ё", "е")
    text = text.replace("\\(", "").replace("\\)", "").replace("\\[", "").replace("\\]", "")
    text = text.strip("$")
    text = text.replace("−", "-").replace("–", "-").replace("—", "-")
    text = text.replace("²", "^2").replace("³", "^3").replace("⁴", "^4")
    text = text.replace("**", "^")
    text = re.sub(r"\s+", "", text)
    return text


def extract_formulas(text: str) -> list[str]:
    source = plain_text(text)
    found = []

    def take(match):
        found.append(_normalize_formula(match.group(0)))
        return " "

    rest = LATEX_RE.sub(take, source)
    for match in PLAIN_FORMULA_RE.finditer(rest):
        found.append(_normalize_formula(match.group(0)))
    return [item for item in found if item]


def is_themable(text: str, task_type: str = "", exam_part=None) -> bool:
    if exam_part:
        return False
    if (task_type or "") in NON_THEMABLE_TYPES:
        return False
    low = plain_text(text).lower().replace("ё", "е")
    if any(hint in low for hint in NON_THEMABLE_HINTS):
        return False
    words = re.findall(r"[а-яёa-z]{4,}", low)
    if len(words) <= 2 and re.search(r"\d", low):
        return False
    return True


def compare_wording(original: str, adapted: str) -> dict:
    original_numbers = extract_numbers(original)
    adapted_numbers = extract_numbers(adapted)
    original_units = extract_units(original)
    adapted_units = extract_units(adapted)
    original_formulas = extract_formulas(original)
    adapted_formulas = extract_formulas(adapted)
    numbers_preserved = _submultiset(original_numbers, adapted_numbers)
    units_preserved = _submultiset(original_units, adapted_units)
    formulas_preserved = Counter(original_formulas) == Counter(adapted_formulas)
    return {
        "numbers_preserved": numbers_preserved,
        "units_preserved": units_preserved,
        "formulas_preserved": formulas_preserved,
        "answer_preserved": True,
        "solution_logic_preserved": numbers_preserved and units_preserved and formulas_preserved,
        "original_numbers": original_numbers,
        "adapted_numbers": adapted_numbers,
        "original_units": original_units,
        "adapted_units": adapted_units,
        "ok": numbers_preserved and units_preserved and formulas_preserved,
    }


def model_integrity_accepts(payload: dict | None) -> bool:
    if not isinstance(payload, dict):
        return True
    flags = (
        "numbers_preserved",
        "units_preserved",
        "formulas_preserved",
        "answer_preserved",
        "solution_logic_preserved",
    )
    return all(payload.get(flag, True) is not False for flag in flags)


def _safe_arith(expr: str):
    tree = ast.parse(expr.replace("^", "**"), mode="eval")

    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = walk(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)):
            left, right = walk(node.left), walk(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            return left ** right
        raise ValueError("unsupported")

    return walk(tree)


def numeric_answer_holds(text: str, answer: str) -> tuple[bool, str]:
    """Если в условии есть арифметика, ответ должен совпасть с вычислением, а не только со словом модели."""
    raw = str(answer or "").strip().replace(",", ".")
    try:
        expected = float(raw)
    except ValueError:
        return True, ""
    plain = plain_text(text)
    if _FUNCTION_HINT.search(plain):
        return True, ""
    expressions = ARITH_RE.findall(plain)
    if not expressions:
        return True, ""
    values = []
    for expr in expressions:
        try:
            values.append(float(_safe_arith(expr)))
        except (ValueError, SyntaxError, ZeroDivisionError, OverflowError):
            continue
    if not values:
        return True, ""
    if any(abs(value - expected) < 1e-6 for value in values):
        return True, ""
    return False, "Ответ не совпадает с вычислением по условию."


def answer_is_unambiguous(answer: str) -> bool:
    text = plain_text(answer).lower()
    if not text:
        return False
    return text not in AMBIGUOUS_ANSWERS


# Длинные окончания раньше коротких: «ами» не должно срезаться как «и».
_RU_ENDINGS = (
    "иями", "ями", "ами", "ого", "ему", "ому", "ыми", "ими",
    "иях", "ах", "ях", "ов", "ев", "ей", "ий", "ый", "ой",
    "ая", "яя", "ое", "ее", "ые", "ие", "ом", "ем", "ам", "ям",
    "ую", "юю", "ия", "ья", "ие", "ье",
    "а", "я", "ы", "и", "е", "о", "у", "ю", "ь",
)
_FUNCTION_HINT = re.compile(
    r"логариф|\\log|(?<![a-zа-яё])log(?![a-z])|(?<![a-zа-яё])ln(?![a-z])|"
    r"\\(?:sin|cos|frac|sqrt)|корен|уравнен|неравен",
    re.IGNORECASE,
)


def _topic_forms(word: str) -> list[str]:
    forms = [word]
    for ending in _RU_ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= 4:
            forms.append(word[: -len(ending)])
            break
    if len(word) >= 6:
        forms.append(word[:5])
    return forms


def topic_mentioned(text: str, topic: str) -> bool:
    """Тема считается упомянутой и в другой форме: «логарифма» подходит к «логарифмы»."""
    from .textutil import tokens

    blob = plain_text(text).lower().replace("ё", "е")
    parts = tokens(topic)
    if not parts:
        short = plain_text(topic).lower().replace("ё", "е")
        return bool(short) and short in blob
    forms = [form for part in parts for form in _topic_forms(part)]
    return any(form and form in blob for form in forms)
