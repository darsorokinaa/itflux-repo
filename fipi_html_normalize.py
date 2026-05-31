"""
Нормализация HTML заданий ФИПИ перед записью в task_template (CKEditor / сайт).

- MathJax-разметка <mjx-container> → \\( \\frac{a}{b} \\) (process_latex на сайте)
- Картинки с oge.fipi.ru → /media/task_files/…
- Лишние <span>, assistive MathML, пустые <br>
- Обёрточные <table> (центрирование ФИПИ) → блоки <div>, выравнивание влево
- Таблицы с вариантами 1) 2) … — не разворачиваем (карточки на сайте строятся при показе)
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Callable
from urllib.parse import urlparse

_RE_MJX_CONTAINER = re.compile(r"<mjx-container\b[^>]*>[\s\S]*?</mjx-container>", re.IGNORECASE)
_RE_MJX_ASSISTIVE = re.compile(r"<mjx-assistive-mml\b[^>]*>[\s\S]*?</mjx-assistive-mml>", re.IGNORECASE)
_RE_MJX_C = re.compile(r"<mjx-c>([^<]*)</mjx-c>", re.IGNORECASE)
_RE_IMG_SRC = re.compile(
    r'<img\b([^>]*?)\bsrc=(["\'])([^"\']+)\2([^>]*)>',
    re.IGNORECASE,
)
_RE_EMPTY_SPAN = re.compile(r"<span>\s*</span>", re.IGNORECASE)
_RE_SPAN_WS_ONLY = re.compile(r"<span>\s+</span>", re.IGNORECASE)
_RE_P_BR_ONLY = re.compile(r"<p>\s*(?:<br\s*/?>\s*)*</p>", re.IGNORECASE)
_RE_INNER_TABLE = re.compile(
    r"<table\b[^>]*>((?:(?!<table\b).)*?)</table>",
    re.IGNORECASE | re.DOTALL,
)
_RE_TABLE_ROW = re.compile(r"<tr\b[^>]*>([\s\S]*?)</tr>", re.IGNORECASE)
_RE_TABLE_CELL = re.compile(r"<t[dh]\b[^>]*>([\s\S]*?)</t[dh]>", re.IGNORECASE)
_RE_ALIGN_CENTER_ATTR = re.compile(r'\s+align=(["\'])center\1', re.IGNORECASE)
_RE_CENTER_TAG = re.compile(r"</?center\b[^>]*>", re.IGNORECASE)
_RE_STYLE_ATTR = re.compile(
    r'\sstyle=(["\'])([^"\']*)\1',
    re.IGNORECASE,
)
_RE_TEXT_ALIGN_CENTER = re.compile(r"text-align\s*:\s*center\s*;?", re.IGNORECASE)
_RE_BORDER_IN_STYLE = re.compile(
    r"border(?:-width|-style|-color|-top|-right|-bottom|-left)?\s*:[^;]+;?",
    re.IGNORECASE,
)
_RE_BORDER_ATTR = re.compile(
    r'\s(?:border|frame|rules)=(["\'])[^"\']*\1',
    re.IGNORECASE,
)
_CHOICE_NUM_RE = re.compile(r"^(\d+)\)\s*$")
_CHOICE_NUM_PREFIX_RE = re.compile(r"^(\d+)\)\s+")
_RE_BOLD_CHOICE = re.compile(
    r"<(?:b|strong)\b[^>]*>\s*(\d+)\)\s*</(?:b|strong)>",
    re.IGNORECASE,
)
_RE_CELL_TEXT = re.compile(r"<[^>]+>")


def _mjx_c_digits(fragment: str) -> str:
    return "".join(_RE_MJX_C.findall(fragment))


# ── Маленький DOM-парсер MathJax-дерева → LaTeX ─────────────────────────────
#
# Из Excel ФИПИ условия приходят в виде уже отрендеренного MathJax HTML:
#
#   <mjx-msup>
#     <mjx-mn><mjx-c>5</mjx-c></mjx-mn>            ← основание
#     <mjx-script><mjx-mn><mjx-c>3</mjx-c></mjx-mn></mjx-script>  ← показатель
#   </mjx-msup>
#
# Если просто склеить текст из <mjx-c>, степень теряется (`5^3` → `53`).
# Поэтому строим дерево и для известных тегов выдаём LaTeX-конструкции.

class _MJXNode:
    __slots__ = ("tag", "children", "text")

    def __init__(self, tag: str = "", text: str = "") -> None:
        self.tag = tag
        self.children: list[_MJXNode] = []
        self.text = text


class _MJXParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _MJXNode("__root__")
        self._stack: list[_MJXNode] = [self.root]

    def handle_starttag(self, tag: str, attrs):
        node = _MJXNode(tag.lower())
        self._stack[-1].children.append(node)
        self._stack.append(node)

    def handle_endtag(self, tag: str) -> None:
        if len(self._stack) > 1:
            self._stack.pop()

    def handle_startendtag(self, tag: str, attrs):
        node = _MJXNode(tag.lower())
        self._stack[-1].children.append(node)

    def handle_data(self, data: str) -> None:
        if data:
            self._stack[-1].children.append(_MJXNode("__text__", text=data))


_MJX_TEXT_FIXUPS = {
    "\u2062": "",       # invisible times
    "\u2063": "",       # invisible separator
    "\u2064": "",       # invisible plus
    "\u00a0": "~",      # неразрывный пробел
    "\u2212": "-",      # минус
    "\u22c5": r"\cdot ",
    "\u00b7": r"\cdot ",
    "\u00b0": r"^{\circ}",
    "\u00d7": r"\times ",
    "\u00f7": r"\div ",
}

_MJX_LEAF_TEXT_TAGS = {"mjx-c", "__text__"}
_MJX_WRAPPER_TAGS = {
    "mjx-container",
    "mjx-math",
    "mjx-mstyle",
    "mjx-semantics",
    "mjx-mtext",
    "mjx-mi",
    "mjx-mn",
    "mjx-mo",
    "mjx-box",
    "mjx-dbox",
    "mjx-dtable",
    "mjx-row",
    "mjx-frac",
}


def _mjx_node_text(node: _MJXNode) -> str:
    parts: list[str] = []
    if node.tag in _MJX_LEAF_TEXT_TAGS:
        parts.append(node.text)
    for ch in node.children:
        if ch.tag == "__text__":
            parts.append(ch.text)
        elif ch.tag == "mjx-c":
            parts.append("".join(c.text for c in ch.children if c.tag == "__text__"))
        else:
            parts.append(_mjx_node_text(ch))
    return "".join(parts)


def _mjx_fixup_text(text: str) -> str:
    for src, dst in _MJX_TEXT_FIXUPS.items():
        if src in text:
            text = text.replace(src, dst)
    return text


def _mjx_children_to_latex(children: list[_MJXNode]) -> str:
    return "".join(_mjx_to_latex(ch) for ch in children)


def _find_child(node: _MJXNode, tag: str) -> _MJXNode | None:
    for ch in node.children:
        if ch.tag == tag:
            return ch
    return None


def _find_descendant(node: _MJXNode, tag: str) -> _MJXNode | None:
    for ch in node.children:
        if ch.tag == tag:
            return ch
        found = _find_descendant(ch, tag)
        if found is not None:
            return found
    return None


def _non_script_base(node: _MJXNode) -> _MJXNode | None:
    """Первый ребёнок, отличный от mjx-script (это база mjx-msup/mjx-msub)."""
    for ch in node.children:
        if ch.tag in ("mjx-script", "__text__"):
            continue
        if ch.tag == "mjx-c":
            continue
        return ch
    return None


def _mjx_collect(node: _MJXNode, tag: str, out: list[_MJXNode]) -> None:
    """Рекурсивный сбор всех потомков с указанным тегом."""
    for ch in node.children:
        if ch.tag == tag:
            out.append(ch)
        else:
            _mjx_collect(ch, tag, out)


def _mjx_mtable_rows_tex(node: _MJXNode) -> list[str]:
    """Достать LaTeX-код для каждой строки `<mjx-mtable>` (через mjx-mtr/mjx-mtd)."""
    rows: list[_MJXNode] = []
    _mjx_collect(node, "mjx-mtr", rows)
    out: list[str] = []
    for row in rows:
        cells: list[_MJXNode] = []
        _mjx_collect(row, "mjx-mtd", cells)
        if not cells:
            cells = [row]
        cell_tex = [_mjx_children_to_latex(c.children).strip() for c in cells]
        out.append(" & ".join(cell_tex))
    return out


def _mjx_mrow_to_latex(node: _MJXNode) -> str:
    """`<mjx-mrow>`, при необходимости — с распознаванием системы уравнений (`\\begin{cases}…`)."""
    children = node.children
    # Ищем паттерн: …<mjx-mo>{</mjx-mo>…<mjx-mtable>…
    open_idx = -1
    table_idx = -1
    for i, ch in enumerate(children):
        if ch.tag == "mjx-mo" and _mjx_node_text(ch).strip() == "{":
            open_idx = i
        elif ch.tag == "mjx-mtable" and open_idx != -1:
            table_idx = i
            break

    if open_idx != -1 and table_idx != -1:
        before = children[:open_idx]
        between = children[open_idx + 1 : table_idx]
        after = children[table_idx + 1 :]
        rows = _mjx_mtable_rows_tex(children[table_idx])
        body = " \\\\ ".join(rows) if rows else ""
        # Если между `{` и mtable есть какие-то «невидимые умножения» / пробелы — игнорируем.
        between_tex = _mjx_children_to_latex(between).strip()
        if not between_tex or between_tex in {"\u2062", "~"}:
            mid = rf"\begin{{cases}}{body}\end{{cases}}"
        else:
            mid = rf"{between_tex}\begin{{cases}}{body}\end{{cases}}"
        return _mjx_children_to_latex(before) + mid + _mjx_children_to_latex(after)

    return _mjx_children_to_latex(children)


def _mjx_to_latex(node: _MJXNode) -> str:
    tag = node.tag

    if tag == "__text__":
        return _mjx_fixup_text(node.text or "")

    if tag == "mjx-c":
        return _mjx_fixup_text(_mjx_node_text(node))

    if tag == "mjx-mrow":
        return _mjx_mrow_to_latex(node)

    if tag == "mjx-mtable":
        rows = _mjx_mtable_rows_tex(node)
        body = " \\\\ ".join(rows) if rows else ""
        return rf"\begin{{matrix}}{body}\end{{matrix}}"

    if tag == "mjx-msup" or tag == "mjx-msub":
        base = _non_script_base(node)
        script = _find_child(node, "mjx-script")
        base_tex = _mjx_to_latex(base) if base is not None else ""
        script_tex = _mjx_children_to_latex(script.children) if script is not None else ""
        op = "^" if tag == "mjx-msup" else "_"
        return f"{base_tex}{op}{{{script_tex}}}"

    if tag == "mjx-msqrt":
        # <mjx-msqrt><mjx-sqrt><mjx-surd>√</mjx-surd><mjx-box>содержимое</mjx-box></mjx-sqrt></mjx-msqrt>
        box = _find_descendant(node, "mjx-box")
        if box is not None:
            inner = _mjx_children_to_latex(box.children)
            return rf"\sqrt{{{inner}}}"
        # запасной вариант — берём всё кроме <mjx-surd>
        parts: list[str] = []
        for ch in node.children:
            if ch.tag == "mjx-surd":
                continue
            parts.append(_mjx_to_latex(ch))
        return rf"\sqrt{{{''.join(parts)}}}"

    if tag == "mjx-mfrac":
        num = _find_descendant(node, "mjx-num")
        den = _find_descendant(node, "mjx-den")
        num_tex = _mjx_children_to_latex(num.children) if num is not None else ""
        den_tex = _mjx_children_to_latex(den.children) if den is not None else ""
        return rf"\frac{{{num_tex}}}{{{den_tex}}}"

    if tag in _MJX_WRAPPER_TAGS:
        return _mjx_children_to_latex(node.children)

    # неизвестный тег — просто рекурсивно склеиваем детей
    return _mjx_children_to_latex(node.children)


def _mjx_block_to_latex(block: str) -> str | None:
    parser = _MJXParser()
    parser.feed(block)
    parser.close()
    inner = _mjx_children_to_latex(parser.root.children).strip()
    if not inner:
        return None
    # Чистим типичные артефакты: парные пробелы, пустые группы
    inner = re.sub(r"\s+", " ", inner).strip()
    inner = inner.replace("{}", "")
    return rf"\({inner}\)"


def mjx_containers_to_latex(html: str) -> str:
    """По одному контейнеру (самый внутренний), чтобы не съесть <table> снаружи."""
    if not html or "<mjx-container" not in html.lower():
        return html

    def repl(m: re.Match[str]) -> str:
        latex = _mjx_block_to_latex(m.group(0))
        return latex if latex else ""

    out = _RE_MJX_ASSISTIVE.sub("", html)
    prev = None
    while out != prev and "<mjx-container" in out.lower():
        prev = out
        out = _RE_MJX_CONTAINER.sub(repl, out, count=1)
    return out


def prepare_task_html_for_display(html: str, *, keep_layout_tables: bool = False) -> str:
    """Перед process_latex: mjx → LaTeX, таблицы-обёртки → блоки, без скачивания картинок.

    keep_layout_tables=True — не разворачиваем «обёрточные» таблицы.
    Нужно для заданий, где двух-/многоколоночная таблица из БД — это сама
    структура условия (информационные таблички, описание, и т.п.).
    """
    if not html or not str(html).strip():
        return html or ""
    s = str(html).strip()
    s = mjx_containers_to_latex(s)
    s = unwrap_spans_around_latex(s)
    if keep_layout_tables:
        s = strip_border_markup(s)
        s = strip_center_alignment(s)
        s = strip_trailing_empty_table_rows(s)
        s = strip_border_markup(s)
    else:
        s = flatten_fipi_layout_markup(s)
    return compact_whitespace_in_tags(s)


def unwrap_spans_around_latex(html: str) -> str:
    """<span>\\(\\frac{1}{2}\\)</span> → \\(\\frac{1}{2}\\)"""
    if not html:
        return html
    prev = None
    out = html
    pat = re.compile(
        r"<span\b[^>]*>\s*(\\\([\s\S]*?\\\))\s*</span>",
        re.IGNORECASE,
    )
    while out != prev:
        prev = out
        out = pat.sub(r"\1", out)
    out = _RE_EMPTY_SPAN.sub("", out)
    out = _RE_SPAN_WS_ONLY.sub(" ", out)
    out = re.sub(r"<span>\s*([,;])\s*</span>", r"\1 ", out, flags=re.IGNORECASE)
    return out


def localize_img_src(
    html: str,
    download: Callable[[str], str | None],
    *,
    skip_gif: bool = True,
) -> str:
    if not html or "<img" not in html.lower():
        return html

    def repl(m: re.Match[str]) -> str:
        before, _q, src, after = m.group(1), m.group(2), m.group(3), m.group(4)
        src = src.strip()
        if not src.startswith(("http://", "https://")):
            return m.group(0)
        ext = _url_path_suffix(src)
        if skip_gif and ext == ".gif":
            return m.group(0)
        local = download(src)
        if not local:
            return m.group(0)
        alt = ' alt=""'
        if re.search(r"\balt\s*=", before + after, re.IGNORECASE):
            alt = ""
        return f'<img{before}src="/media/{local}"{alt}{after}>'

    return _RE_IMG_SRC.sub(repl, html)


def _url_path_suffix(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"):
        if path.endswith(ext):
            return ext
    return ""


def compact_whitespace_in_tags(html: str) -> str:
    out = _RE_P_BR_ONLY.sub("", html)
    out = re.sub(r"(\d+\))\s*&nbsp;\s*", r"\1) ", out, flags=re.IGNORECASE)
    return out


def _cell_plain_text(cell_html: str) -> str:
    text = _RE_CELL_TEXT.sub("", cell_html or "")
    return text.replace("\xa0", " ").replace("&nbsp;", " ").strip()


def _row_choice_number(cell_html: str) -> str | None:
    """«1)» в отдельной ячейке, в начале текста ячейки или в <b>/<strong>."""
    plain = _cell_plain_text(cell_html)
    m = _CHOICE_NUM_RE.match(plain)
    if m:
        return m.group(1)
    m = _CHOICE_NUM_PREFIX_RE.match(plain)
    if m:
        return m.group(1)
    bm = _RE_BOLD_CHOICE.search(cell_html or "")
    if bm:
        return bm.group(1)
    return None


def _is_choice_options_table(table_html: str) -> bool:
    """Как на фронте: ≥2 строк с «1)», «2)» … в первой ячейке."""
    numbered = 0
    for row_m in _RE_TABLE_ROW.finditer(table_html):
        cells = _RE_TABLE_CELL.findall(row_m.group(1))
        if not cells:
            continue
        if _row_choice_number(cells[0]) is not None:
            numbered += 1
    return numbered >= 2


def _cell_has_content(inner: str) -> bool:
    s = (inner or "").strip()
    if not s:
        return False
    if re.fullmatch(r"(?:<br\s*/?>\s*|&nbsp;\s*)+", s, re.IGNORECASE):
        return False
    if _cell_plain_text(s):
        return True
    return bool(re.search(r"<(?:img|svg|mjx-container|math)\b", s, re.IGNORECASE))


def _row_is_empty(row_inner: str) -> bool:
    cells = _RE_TABLE_CELL.findall(row_inner)
    if not cells:
        return True
    return all(not _cell_has_content(c) for c in cells)


def strip_trailing_empty_table_rows(html: str) -> str:
    """ФИПИ часто добавляет пустую <tr> в конце таблицы."""
    if not html or "<tr" not in html.lower():
        return html
    out = html
    for _ in range(32):
        changed = False
        for m in _RE_INNER_TABLE.finditer(out):
            tbl = m.group(0)
            rows = list(_RE_TABLE_ROW.finditer(tbl))
            if not rows:
                continue
            last = rows[-1]
            if _row_is_empty(last.group(1)):
                new_tbl = tbl[: last.start()] + tbl[last.end() :]
                out = out[: m.start()] + new_tbl + out[m.end() :]
                changed = True
                break
        if not changed:
            break
    return out


def _unwrap_one_layout_table(table_html: str) -> str:
    if _is_choice_options_table(table_html):
        return table_html
    parts: list[str] = []
    has_any_row = False
    for row_m in _RE_TABLE_ROW.finditer(table_html):
        has_any_row = True
        if _row_is_empty(row_m.group(1)):
            continue
        for cell_m in _RE_TABLE_CELL.finditer(row_m.group(1)):
            inner = cell_m.group(1).strip()
            if _cell_has_content(inner):
                parts.append(inner)
    # Полностью пустая таблица (ФИПИ часто оставляет «заглушку» вариантов ответа)
    # — выпиливаем её целиком, чтобы под заданием не оставалось пустых строк.
    if not has_any_row:
        return ""
    if not parts:
        return ""
    return "".join(f'<div class="task-html-block">{p}</div>' for p in parts)


def unwrap_layout_tables(html: str) -> str:
    """Самые вложенные таблицы первыми; таблицы с вариантами ответа не трогаем."""
    if not html or "<table" not in html.lower():
        return html
    out = html
    for _ in range(64):
        replaced = False
        for m in _RE_INNER_TABLE.finditer(out):
            table_html = m.group(0)
            new_html = _unwrap_one_layout_table(table_html)
            if new_html != table_html:
                out = out[: m.start()] + new_html + out[m.end() :]
                replaced = True
                break
        if not replaced:
            break
    return out


def _clean_style_attr(style: str) -> str:
    s = _RE_TEXT_ALIGN_CENTER.sub("", style)
    s = _RE_BORDER_IN_STYLE.sub("", s)
    s = re.sub(r";\s*;+", ";", s)
    return s.strip(" ;")


def strip_border_markup(html: str) -> str:
    """border= / frame= / rules= и border-* в style."""
    if not html:
        return html
    out = _RE_BORDER_ATTR.sub("", html)

    def style_repl(m: re.Match[str]) -> str:
        quote, body = m.group(1), m.group(2)
        cleaned = _clean_style_attr(body)
        if not cleaned:
            return ""
        return f" style={quote}{cleaned}{quote}"

    return _RE_STYLE_ATTR.sub(style_repl, out)


def strip_center_alignment(html: str) -> str:
    if not html:
        return html
    out = _RE_ALIGN_CENTER_ATTR.sub("", html)
    out = _RE_CENTER_TAG.sub("", out)

    def style_repl(m: re.Match[str]) -> str:
        quote, body = m.group(1), m.group(2)
        cleaned = _clean_style_attr(body)
        if not cleaned:
            return ""
        return f' style={quote}{cleaned}{quote}'

    out = _RE_STYLE_ATTR.sub(style_repl, out)
    return out


_RE_FIPI_FOLDER = re.compile(r"questions/([A-F0-9]+)/", re.IGNORECASE)


def fipi_folder_ids(html: str) -> set[str]:
    """ID папки вопроса на oge.fipi.ru (один вопрос = одна папка innerimg0…4)."""
    return {m.upper() for m in _RE_FIPI_FOLDER.findall(html or "")}


def extract_question_html_without_choices(html: str) -> str:
    """HTML условия: всё, кроме вложенной таблицы вариантов 1) 2) …"""
    if not html or not str(html).strip():
        return ""
    s = str(html)
    for m in list(_RE_INNER_TABLE.finditer(s)):
        if _is_choice_options_table(m.group(0)):
            s = s.replace(m.group(0), "", 1)
            break
    s = strip_trailing_empty_table_rows(s)
    s = strip_border_markup(s)
    s = strip_center_alignment(s)
    s = re.sub(
        r'(?:\s*<div class="task-html-block">\s*(?:&nbsp;|&#160;|\s|<br\s*/?>)*\s*</div>)+$',
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = strip_trailing_filler(s)
    return s.strip()


def choice_options_table_html(html: str) -> str | None:
    """Первая таблица вариантов 1) 2) … или None."""
    if not html:
        return None
    for m in _RE_INNER_TABLE.finditer(html):
        if _is_choice_options_table(m.group(0)):
            return m.group(0)
    return None


def task_uses_image_choices(html: str) -> bool:
    """Варианты ответа — в основном картинки (а не только формулы)."""
    table = choice_options_table_html(html)
    if not table:
        return False
    imgs = len(re.findall(r"<img\b", table, re.IGNORECASE))
    return imgs >= 2


def html_has_choice_options_table(html: str) -> bool:
    """Есть ли в HTML таблица вариантов «1) … 2) …» (в т.ч. вложенная)."""
    if not html or "<table" not in html.lower():
        return False
    for m in _RE_INNER_TABLE.finditer(html):
        if _is_choice_options_table(m.group(0)):
            return True
    return False


def html_has_task_question_text(html: str) -> bool:
    """В HTML есть условие задания, а не только варианты ответа."""
    if not html or not str(html).strip():
        return False
    s = str(html)
    # Убираем только таблицы вариантов 1) 2) …; обёрточную таблицу ФИПИ с условием
    # не трогаем — иначе текст «На координатной прямой…» теряется.
    for m in list(_RE_INNER_TABLE.finditer(s)):
        if _is_choice_options_table(m.group(0)):
            s = s.replace(m.group(0), "", 1)
    plain = _cell_plain_text(s)
    if plain and len(plain) > 3:
        return True
    return bool(re.search(r"<img\b", s, re.IGNORECASE))


def flatten_fipi_layout_markup(html: str) -> str:
    """Убрать табличную вёрстку ФИПИ и центрирование; варианты 1) 2) сохраняются."""
    if not html or not str(html).strip():
        return html or ""
    s = str(html)
    s = strip_border_markup(s)
    s = strip_center_alignment(s)
    s = unwrap_layout_tables(s)
    s = strip_trailing_empty_table_rows(s)
    s = strip_border_markup(s)
    s = re.sub(
        r'(?:\s*<div class="task-html-block">\s*(?:&nbsp;|&#160;|\s|<br\s*/?>)*\s*</div>)+$',
        "",
        s,
        flags=re.IGNORECASE,
    )
    s = strip_trailing_filler(s)
    s = unwrap_outer_plain_div(s)
    s = strip_trailing_filler(s)
    return s


_RE_OUTER_PLAIN_DIV = re.compile(
    r"\A\s*<div\s*>(.+)</div>\s*\Z",
    re.IGNORECASE | re.DOTALL,
)


def unwrap_outer_plain_div(html: str) -> str:
    r"""Снимаем «голый» внешний `<div>` без атрибутов, в который ФИПИ обернул всё условие.

    Делаем безопасно: убираем только если эта пара тегов окружает весь документ
    (`\A`/`\Z`) и `<div>` не имеет атрибутов. Иначе оставляем как есть.
    """
    if not html:
        return html
    out = html
    for _ in range(4):
        m = _RE_OUTER_PLAIN_DIV.match(out)
        if not m:
            break
        inner = m.group(1).strip("\n\r\t ")
        if not inner:
            break
        # Проверяем, что внутри нет «оторванных» открытых div — глубокий unwrap безопасен.
        out = inner
    return out


_RE_TRAILING_FILLER = re.compile(
    r"(?:\s|<br\s*/?>|&nbsp;|&#160;"
    r"|<p\b[^>]*>\s*(?:&nbsp;|&#160;|<br\s*/?>|\s)*\s*</p>"
    r"|<div\b[^>]*>\s*(?:&nbsp;|&#160;|<br\s*/?>|\s)*\s*</div>"
    r")+\Z",
    re.IGNORECASE,
)


def strip_trailing_filler(html: str) -> str:
    """Срезаем пустые хвосты после задания: висячие <br>, &nbsp;, пустые <p>/<div>.

    Также подчищаем пустые `<div> ... </div>`-обёртки, в которых после flatten
    осталось только whitespace (типичный случай — `<div>…</div>` от ФИПИ).
    """
    if not html:
        return html
    out = html
    for _ in range(8):
        new_out = _RE_TRAILING_FILLER.sub("", out)
        # Снимаем пустую внешнюю <div>-обёртку, если её содержимое — пробелы.
        new_out = re.sub(
            r"<div\b[^>]*>\s*</div>\s*\Z",
            "",
            new_out,
            flags=re.IGNORECASE,
        )
        if new_out == out:
            break
        out = new_out
    return out


def normalize_fipi_task_html(
    html: str,
    download: Callable[[str], str | None] | None = None,
) -> str:
    """
    Подготовка HTML из Excel/ФИПИ к хранению в CKEditor5 и показу на сайте.
  """
    if not html or not str(html).strip():
        return html or ""

    s = str(html).strip()
    s = mjx_containers_to_latex(s)
    s = unwrap_spans_around_latex(s)
    if download:
        # Условие ФИПИ часто в innerimg0.gif — без скачивания на сайте пусто.
        s = localize_img_src(s, download, skip_gif=False)
    # Таблицы с вариантами 1) 2) … не разворачиваем в .task-html-block — иначе
    # условие и ответы разъезжаются; фронт (formatOgeMathChoiceTaskHtml) ждёт <table>.
    if html_has_choice_options_table(s):
        s = strip_border_markup(s)
        s = strip_center_alignment(s)
        s = strip_trailing_empty_table_rows(s)
        s = strip_border_markup(s)
        s = strip_trailing_filler(s)
    else:
        s = flatten_fipi_layout_markup(s)
    s = compact_whitespace_in_tags(s)
    return s
