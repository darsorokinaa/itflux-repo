"""Проверка таблицы истинности по клеткам (ВПР информатика, задание на заполнение).

Приоритет операций: НЕ, затем И, ⊕, ИЛИ, →, ≡. Скобки меняют порядок.
Эталон формулы считается на каждом наборе входов и сверяется с ответом в банке.
Пустая обязательная клетка, чужой столбец и числовой «1» вместо «0001» не засчитываются.
"""

from __future__ import annotations

import html
import re

_TAG_RE = re.compile(r"<[^>]+>")
_FILL_RE = re.compile(r"заполните\s+таблиц[а-яё]*\s+истинност", re.IGNORECASE)
_FORMULA_RE = re.compile(
    r"\\lnot|\\neg|\\land|\\lor|\\wedge|\\vee|\\equiv|\\rightarrow|\\leftrightarrow|\\oplus|\\to\b|"
    r"[¬∧∨→≡⊕]|/\\|\\/|"
    r"(?<![A-Za-zА-Яа-яЁё0-9_])(?:ИЛИ|НЕ|XOR|AND|OR|NOT|И)(?![A-Za-zА-Яа-яЁё0-9_])",
    re.IGNORECASE,
)
_ASSIGN_RE = re.compile(r"([A-Za-z])\s*(?:\{=\}\s*|=)\s*[01]")
_HEX_ENT_RE = re.compile(r"&#x([0-9a-f]+);", re.IGNORECASE)
_DEC_ENT_RE = re.compile(r"&#(\d+);")
_PREC = {"!": 6, "&": 5, "^": 4, "|": 3, ">": 2, "=": 1}
_PRETTY = {"!": "¬", "&": "∧", "^": "⊕", "|": "∨", ">": "→", "=": "≡"}


def _decode(value) -> str:
    text = _TAG_RE.sub(" ", str(value or ""))
    text = _HEX_ENT_RE.sub(lambda m: chr(int(m.group(1), 16)), text)
    text = _DEC_ENT_RE.sub(lambda m: chr(int(m.group(1), 10)), text)
    return html.unescape(text)


def _latex_blocks(text: str) -> list[str]:
    out = []
    i = 0
    while True:
        start = text.find("\\(", i)
        if start < 0:
            break
        end = text.find("\\)", start + 2)
        if end < 0:
            break
        out.append(text[start + 2 : end])
        i = end + 2
    return out


def _looks_like_logic(block: str) -> bool:
    return _FORMULA_RE.search(block) is not None


def _extract_expression(text: str) -> str:
    for block in _latex_blocks(text):
        if re.search(r"\{=\}|=[01]", block):
            continue
        if _looks_like_logic(block):
            return block
    plain = text.replace("\\(", " ").replace("\\)", " ")
    if len(plain) <= 240 and _looks_like_logic(plain) and not re.search(r"\{=\}|=[01]", plain):
        return plain
    return ""


def _variable_order(text: str, fallback: list[str]) -> list[str]:
    found: list[str] = []
    for match in _ASSIGN_RE.finditer(text):
        name = match.group(1)
        if name in found:
            break
        found.append(name)
    if not found or any(name not in found for name in fallback):
        return fallback
    return found


def _tokenize(formula: str) -> list[str] | None:
    s = str(formula or "")
    reps = (
        (r"\\leftrightarrow\b", " = "),
        (r"\\rightarrow\b", " > "),
        (r"\\implies\b", " > "),
        (r"\\equiv\b", " = "),
        (r"\\oplus\b", " ^ "),
        (r"\\lnot\b", " ! "),
        (r"\\neg\b", " ! "),
        (r"\\land\b", " & "),
        (r"\\wedge\b", " & "),
        (r"\\lor\b", " | "),
        (r"\\vee\b", " | "),
        (r"\\to\b", " > "),
        (r"<=>", " = "),
        (r"<->", " = "),
        (r"→|⇒", " > "),
        (r"≡", " = "),
        (r"⊕", " ^ "),
        (r"∧", " & "),
        (r"∨", " | "),
        (r"¬", " ! "),
        (r"/\\", " & "),
        (r"\\/", " | "),
        (r"&&", " & "),
        (r"\|\|", " | "),
        (r"(?<![A-Za-zА-Яа-яЁё0-9_])ИЛИ(?![A-Za-zА-Яа-яЁё0-9_])", " | "),
        (r"(?<![A-Za-zА-Яа-яЁё0-9_])НЕ(?![A-Za-zА-Яа-яЁё0-9_])", " ! "),
        (r"(?<![A-Za-zА-Яа-яЁё0-9_])XOR(?![A-Za-zА-Яа-яЁё0-9_])", " ^ "),
        (r"(?<![A-Za-zА-Яа-яЁё0-9_])AND(?![A-Za-zА-Яа-яЁё0-9_])", " & "),
        (r"(?<![A-Za-zА-Яа-яЁё0-9_])OR(?![A-Za-zА-Яа-яЁё0-9_])", " | "),
        (r"(?<![A-Za-zА-Яа-яЁё0-9_])NOT(?![A-Za-zА-Яа-яЁё0-9_])", " ! "),
        (r"(?<![A-Za-zА-Яа-яЁё0-9_])И(?![A-Za-zА-Яа-яЁё0-9_])", " & "),
    )
    for pattern, repl in reps:
        s = re.sub(pattern, repl, s, flags=re.IGNORECASE)
    s = re.sub(r"\\left|\\right|\\bigl|\\bigr|\\Bigl|\\Bigr", "", s)
    s = re.sub(r"\\[,;:!\s]", " ", s)
    s = s.replace("~", " ! ")
    raw = re.findall(r"[A-Za-z]+|&&|\|\||[=&>^!&|()]", s)
    if not raw:
        return None
    tokens = []
    for token in raw:
        if token == "&&":
            tokens.append("&")
        elif token == "||":
            tokens.append("|")
        elif re.fullmatch(r"[A-Za-z]+", token):
            if len(token) != 1:
                return None
            tokens.append(token)
        else:
            tokens.append(token)
    return tokens


def _parse(formula: str):
    tokens = _tokenize(formula)
    if not tokens:
        return None
    index = 0

    def peek():
        return tokens[index] if index < len(tokens) else ""

    def eat(op: str) -> bool:
        nonlocal index
        if peek() != op:
            return False
        index += 1
        return True

    def parse_equiv():
        node = parse_impl()
        if node is None:
            return None
        while eat("="):
            right = parse_impl()
            if right is None:
                return None
            node = ("=", node, right)
        return node

    def parse_impl():
        left = parse_or()
        if left is None or peek() != ">":
            return left
        eat(">")
        right = parse_impl()
        if right is None:
            return None
        return (">", left, right)

    def parse_or():
        node = parse_xor()
        if node is None:
            return None
        while eat("|"):
            right = parse_xor()
            if right is None:
                return None
            node = ("|", node, right)
        return node

    def parse_xor():
        node = parse_and()
        if node is None:
            return None
        while eat("^"):
            right = parse_and()
            if right is None:
                return None
            node = ("^", node, right)
        return node

    def parse_and():
        node = parse_not()
        if node is None:
            return None
        while eat("&"):
            right = parse_not()
            if right is None:
                return None
            node = ("&", node, right)
        return node

    def parse_not():
        if eat("!"):
            arg = parse_not()
            if arg is None:
                return None
            return ("!", arg)
        return parse_primary()

    def parse_primary():
        nonlocal index
        if eat("("):
            inner = parse_equiv()
            if inner is None or not eat(")"):
                return None
            return inner
        token = peek()
        if re.fullmatch(r"[A-Za-z]", token or ""):
            index += 1
            return ("var", token)
        return None

    ast = parse_equiv()
    if ast is None or index != len(tokens):
        return None
    return ast


def _steps(ast) -> list:
    found = []

    def walk(node):
        if not node or node[0] == "var":
            return
        if node[0] == "!":
            walk(node[1])
        else:
            walk(node[1])
            walk(node[2])
        found.append(node)

    walk(ast)
    return found


def _vars(ast) -> list[str]:
    names: list[str] = []

    def walk(node):
        if not node:
            return
        if node[0] == "var":
            if node[1] not in names:
                names.append(node[1])
            return
        walk(node[1])
        if node[0] != "!":
            walk(node[2])

    walk(ast)
    return names


def _eval(node, env: dict[str, int]) -> int:
    if not node:
        return 0
    if node[0] == "var":
        return 1 if env.get(node[1]) else 0
    if node[0] == "!":
        return 0 if _eval(node[1], env) else 1
    left = _eval(node[1], env)
    right = _eval(node[2], env)
    if node[0] == "&":
        return 1 if left and right else 0
    if node[0] == "|":
        return 1 if left or right else 0
    if node[0] == "^":
        return 1 if left != right else 0
    if node[0] == ">":
        return 1 if (not left) or right else 0
    if node[0] == "=":
        return 1 if left == right else 0
    return 0


def _fmt(node) -> str:
    if not node:
        return ""
    if node[0] == "var":
        return node[1]
    if node[0] == "!":
        inner = _fmt(node[1])
        if node[1][0] not in ("var", "!"):
            return f"¬({inner})"
        return f"¬{inner}"
    prec = _PREC[node[0]]

    def side(child, is_right: bool) -> str:
        text = _fmt(child)
        if child[0] in ("var", "!"):
            return text
        child_prec = _PREC.get(child[0], 0)
        wrap = (
            child_prec < prec
            or (child_prec == prec and node[0] == ">" and not is_right)
            or (child_prec == prec and node[0] != ">" and is_right)
        )
        return f"({text})" if wrap else text

    return f"{side(node[1], False)} {_PRETTY[node[0]]} {side(node[2], True)}"


def _combinations(variables: list[str]) -> list[list[int]]:
    n = len(variables)
    rows = []
    for i in range(1 << n):
        rows.append([((i >> (n - 1 - j)) & 1) for j in range(n)])
    return rows


_HINT_P_RE = re.compile(r"<p\b[^>]*>\s*В ответе запишите[\s\S]*?</p>", re.IGNORECASE)
_HINT_PLAIN_RE = re.compile(r"(^|[\n\r])\s*В ответе запишите[\s\S]*$", re.IGNORECASE)


def strip_truth_table_answer_hint(html: str) -> str:
    """Убирает «В ответе запишите N цифр…». Формулу и «Заполните таблицу» не трогает."""
    raw = str(html or "")
    if not re.search(r"истинност", raw, flags=re.IGNORECASE):
        return raw
    return _HINT_PLAIN_RE.sub(r"\1", _HINT_P_RE.sub("", raw))


def compile_truth_table(prompt: str):
    text = _decode(strip_truth_table_answer_hint(prompt))
    formula = _extract_expression(text)
    if not formula:
        return None
    ast = _parse(formula)
    if ast is None:
        return None
    steps = _steps(ast)
    if not steps:
        return None
    variables = _variable_order(text, _vars(ast))
    if not variables or len(variables) > 8:
        return None
    rows = _combinations(variables)
    columns = []
    for step in steps:
        bits = []
        for row in rows:
            env = {name: row[index] for index, name in enumerate(variables)}
            bits.append(str(_eval(step, env)))
        columns.append("".join(bits))
    return {
        "variables": variables,
        "expression": _fmt(ast),
        "steps": [_fmt(step) for step in steps],
        "columns": columns,
        "rows": len(rows),
    }


def _groups(value: str) -> list[str]:
    cleaned = re.sub(r"[^01.\s]", "", str(value or "")).strip()
    if not cleaned:
        return []
    return [group for group in cleaned.split(" ") if group != ""]


def _empty(num_rows: int, num_cols: int):
    return [["" for _ in range(num_cols)] for _ in range(num_rows)]


def _bit(ch: str) -> str:
    return ch if ch in ("0", "1") else ""


def _place_column(num_rows, num_cols, col, bits: str):
    grid = _empty(num_rows, num_cols)
    for r in range(num_rows):
        grid[r][col] = _bit(bits[r] if r < len(bits) else "")
    return grid


def _place_rows(groups, num_rows, num_cols):
    grid = _empty(num_rows, num_cols)
    for r in range(num_rows):
        group = groups[r] if r < len(groups) else ""
        for c in range(num_cols):
            grid[r][c] = _bit(group[c] if c < len(group) else "")
    return grid


def _grid_key(grid) -> str:
    return "|".join("".join(cell or "." for cell in row) for row in grid)


def answer_grid_candidates(value, num_rows: int, num_cols: int):
    if num_rows <= 0 or num_cols <= 0:
        return []
    groups = _groups(value)
    if not groups:
        return []
    out = []
    seen = set()

    def push(grid):
        key = _grid_key(grid)
        if key not in seen:
            seen.add(key)
            out.append(grid)

    if len(groups) == num_rows:
        push(_place_rows(groups, num_rows, num_cols))
    if len(groups) == 1:
        raw = groups[0]
        digits = raw.replace(".", "")
        if "." not in raw and len(digits) == num_rows * num_cols:
            push(_place_rows(
                [digits[r * num_cols : (r + 1) * num_cols] for r in range(num_rows)],
                num_rows,
                num_cols,
            ))
        elif num_cols == 1 and "." not in raw and len(digits) == num_rows:
            push(_place_column(num_rows, num_cols, 0, digits))
        elif num_cols == 1 and len(raw) == num_rows:
            push(_place_column(num_rows, num_cols, 0, raw))
    return out


def canonical_row_answer(spec: dict) -> str:
    """Построчная запись всей таблицы, как её сохраняет виджет."""
    lines = []
    for r in range(spec["rows"]):
        lines.append("".join(col[r] for col in spec["columns"]))
    return " ".join(lines)


def _columns_from_rows(groups: list[str], steps: int) -> list[str]:
    return ["".join(group[c] for group in groups) for c in range(steps)]


def _official(expected: str, spec: dict):
    groups = [group for group in _groups(expected) if re.fullmatch(r"[01]+", group)]
    if not groups:
        return None
    rows = spec["rows"]
    steps = len(spec["columns"])
    if len(groups) == rows and all(len(group) == steps for group in groups):
        return {"mode": "grid", "columns": _columns_from_rows(groups, steps)}
    if len(groups) == 1 and len(groups[0]) == rows * steps:
        digits = groups[0]
        row_groups = [digits[r * steps : (r + 1) * steps] for r in range(rows)]
        return {"mode": "grid", "columns": _columns_from_rows(row_groups, steps)}
    if len(groups) == 1 and len(groups[0]) == rows:
        return {"mode": "result", "columns": [groups[0]]}
    if len(groups) == rows and all(len(group) == 1 for group in groups):
        return {"mode": "result", "columns": ["".join(groups)]}
    return None


def _official_agrees(official, spec) -> bool:
    if not official:
        return False
    if official["mode"] == "result":
        return official["columns"][0] == spec["columns"][-1]
    if official["mode"] == "grid" and len(official["columns"]) == len(spec["columns"]):
        return all(col == spec["columns"][index] for index, col in enumerate(official["columns"]))
    return False


def _grid_matches(grid, columns: list[str], required: list[bool]) -> bool:
    rows = len(columns[0]) if columns else 0
    if len(grid) != rows:
        return False
    for c, column in enumerate(columns):
        for r in range(rows):
            got = grid[r][c] if c < len(grid[r]) else ""
            if got not in ("0", "1"):
                if required[c]:
                    return False
                continue
            if got != column[r]:
                return False
    return True


def match_truth_table_answer(student, *, prompt: str = "", expected: str = "", enabled: bool = False):
    """True/False, если ответ относится к заполнению таблицы и эталон совпал с формулой.

    None — обычное сравнение ответа.
    """
    text = _decode(prompt)
    if not enabled and not _FILL_RE.search(text):
        return None
    if not str(expected or "").strip():
        return None
    spec = compile_truth_table(text)
    if spec is None:
        return None
    official = _official(expected, spec)
    if not _official_agrees(official, spec):
        return None
    required = [True for _ in spec["columns"]]
    candidates = answer_grid_candidates(student, spec["rows"], len(spec["columns"]))
    if not candidates:
        return False
    return any(_grid_matches(grid, spec["columns"], required) for grid in candidates)


def answer_matches_model(student, task, *, subject: str = "") -> bool:
    from .answer_check import answers_equal

    graded = match_truth_table_answer(
        student,
        prompt=str(getattr(task, "task_template", "") or ""),
        expected=str(getattr(task, "answer", "") or ""),
        enabled=bool(getattr(task, "truth_table_enabled", False)),
    )
    if graded is not None:
        return bool(graded)
    return answers_equal(student, getattr(task, "answer", ""), subject=subject)
