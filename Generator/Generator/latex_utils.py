"""LaTeX → HTML converter for TipTap math, CKEditor 5, and WeasyPrint."""
import html as html_lib
import json
import logging
import os
import re
from pathlib import Path
import shutil
import subprocess
from functools import lru_cache

from django.conf import settings as django_settings

logger = logging.getLogger(__name__)

MATH_SYMBOLS = {
    r'\times': '×', r'\div': '÷', r'\pm': '±', r'\mp': '∓',
    r'\cdot': '·', r'\neq': '≠', r'\leq': '≤', r'\geq': '≥',
    r'\approx': '≈', r'\sim': '∼', r'\simeq': '≃', r'\cong': '≅',
    r'\equiv': '≡', r'\infty': '∞',
    r'\partial': '∂', r'\nabla': '∇', r'\exists': '∃', r'\forall': '∀',
    r'\in': '∈', r'\notin': '∉', r'\subset': '⊂', r'\supset': '⊃',
    r'\subseteq': '⊆', r'\supseteq': '⊇',
    r'\cup': '∪', r'\cap': '∩', r'\emptyset': '∅',
    r'\rightarrow': '→', r'\leftarrow': '←', r'\to': '→',
    r'\Rightarrow': '⇒', r'\Leftarrow': '⇐', r'\leftrightarrow': '↔',
    r'\land': '∧', r'\lor': '∨', r'\neg': '¬', r'\lnot': '¬',
    r'\oplus': '⊕', r'\otimes': '⊗', r'\ne': '≠', r'\le': '≤', r'\ge': '≥',
    r'\leqslant': '≤', r'\geqslant': '≥',
    r'\alpha': 'α', r'\beta': 'β', r'\gamma': 'γ', r'\delta': 'δ',
    r'\epsilon': 'ε', r'\zeta': 'ζ', r'\eta': 'η', r'\theta': 'θ',
    r'\lambda': 'λ', r'\mu': 'μ', r'\nu': 'ν', r'\xi': 'ξ',
    r'\pi': 'π', r'\rho': 'ρ', r'\sigma': 'σ', r'\tau': 'τ',
    r'\phi': 'φ', r'\chi': 'χ', r'\psi': 'ψ', r'\omega': 'ω',
    r'\Gamma': 'Γ', r'\Delta': 'Δ', r'\Theta': 'Θ', r'\Lambda': 'Λ',
    r'\Pi': 'Π', r'\Sigma': 'Σ', r'\Phi': 'Φ', r'\Psi': 'Ψ', r'\Omega': 'Ω',
    r'\circ': '∘', r'\bullet': '•', r'\ldots': '…', r'\cdots': '⋯',
    r'\qquad': '\u00a0\u00a0', r'\quad': '\u00a0',
    r'\ ': ' ', r'\,': '\u2009', r'\;': '\u2004',
}

MATH_FUNCTIONS = (
    'arcsin', 'arccos', 'arctan', 'arccot',
    'sinh', 'cosh', 'tanh', 'coth',
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'ln', 'log', 'lg', 'exp',
    'lim', 'max', 'min', 'sup', 'inf',
    'gcd', 'lcm', 'det', 'dim', 'ker', 'tr',
)

BRACKET_MAP = {
    r'\left(': '(', r'\right)': ')',
    r'\left[': '[', r'\right]': ']',
    r'\left\{': '{', r'\right\}': '}',
    r'\left|': '|', r'\right|': '|',
    r'\lbrace': '{', r'\rbrace': '}',
    r'\langle': '⟨', r'\rangle': '⟩',
}

_RE_HTML_TAGS = re.compile(r'<[^>]+>')
_RE_NEWLINES = re.compile(r'[\r\n]+')
_RE_MULTI_SPACE = re.compile(r'  +')
_RE_DISPLAY = re.compile(r'\\\[(.*?)\\\]', re.DOTALL)
_RE_DISPLAY_DOUBLE = re.compile(r'\$\$(.+?)\$\$', re.DOTALL)
_RE_INLINE_PAREN = re.compile(r'\\\((.*?)\\\)', re.DOTALL)
_RE_INLINE_DOLLAR = re.compile(r'\$(.+?)\$')
_RE_ENV = re.compile(
    r'\\begin\{(aligned|align\*?|cases|gather\*?|equation\*?|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix)\}(.*?)\\end\{\1\}',
    re.DOTALL,
)
_RE_ARRAY = re.compile(r'\\begin\{array\}\{[^}]*\}(.*?)\\end\{array\}', re.DOTALL)
_RE_TABULAR = re.compile(r'\\begin\{tabular\}\{[^}]*\}(.*?)\\end\{tabular\}', re.DOTALL)
_RE_NAKED_ENV_BLOCK = re.compile(
    r'\\begin\{(tabular|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases|aligned|align\*?|gather\*?|equation\*?)\}(?:\{[^}]*\})?(.*?)\\end\{\1\}',
    re.DOTALL,
)
# MathJax (браузер и Node) не поддерживает tabular/array — только наш HTML-конвертер
_RE_HAS_TABULAR_OR_ARRAY = re.compile(
    r'\\begin\s*\{(?:tabular|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix)\}',
    re.IGNORECASE | re.DOTALL,
)
_RE_VERBATIM = re.compile(r'\\begin\{verbatim\}(.*?)\\end\{verbatim\}', re.DOTALL)
_RE_POWER_GROUP = re.compile(r'\^\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}')
_RE_INDEX_GROUP = re.compile(r'_\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}')
_RE_POWER_SINGLE = re.compile(r'\^([0-9a-zA-Zα-ωΑ-Ω])')
_RE_INDEX_SINGLE = re.compile(r'_([0-9a-zA-Zα-ωΑ-Ω])')
_RE_TEXTBF = re.compile(r'\\textbf\{([^{}]+)\}')
_RE_TEXTIT = re.compile(r'\\textit\{([^{}]+)\}')
_RE_TEXTTT = re.compile(r'\\texttt\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}')
_RE_TEXT = re.compile(r'\\(?:text|mathrm)\{([^{}]+)\}')
_RE_MATHBF = re.compile(r'\\mathbf\{([^{}]+)\}')
_RE_MATHIT = re.compile(r'\\mathit\{([^{}]+)\}')
_RE_OVERLINE = re.compile(r'\\overline\{([^{}]+)\}')
_RE_UNDERLINE = re.compile(r'\\underline\{([^{}]+)\}')
_RE_SPACING = re.compile(r'\\[,;!: ]|\\(?:thinspace|medspace|thickspace)')
_RE_STYLE = re.compile(r'\\(?:displaystyle|textstyle|scriptstyle|limits)\b')
_RE_UNKNOWN_CMD = re.compile(r'\\[a-zA-Z]+')
_RE_BRACES = re.compile(r'[{}]')
_RE_FUNC = re.compile(
    r'\\(' + '|'.join(sorted(MATH_FUNCTIONS, key=len, reverse=True)) + r')\b'
)
# TipTap/ProseMirror: data-type="math" + data-latex (any attribute order)
_RE_MATH_SPAN = re.compile(
    r'<span[^>]*(?:data-type=["\']math["\'][^>]*data-latex=["\']([^"\']+)["\']|data-latex=["\']([^"\']+)["\'][^>]*data-type=["\']math["\'])[^>]*>.*?</span>',
    re.DOTALL | re.IGNORECASE,
)
# CKEditor 5 / MathType: math-tex class + data-latex
_RE_MATH_TEX_SPAN = re.compile(
    r'<span[^>]*class=["\'][^"\']*math-tex[^"\']*["\'][^>]*data-latex=["\']([^"\']+)["\'][^>]*>.*?</span>',
    re.DOTALL | re.IGNORECASE,
)
# CKEditor 5: math-tex with data-formula (alternative attribute)
_RE_MATH_FORMULA_SPAN = re.compile(
    r'<span[^>]*class=["\'][^"\']*math-tex[^"\']*["\'][^>]*data-formula=["\']([^"\']+)["\'][^>]*>.*?</span>',
    re.DOTALL | re.IGNORECASE,
)
# CKEditor / pasted LaTeX: math-tex span with LaTeX in body (no data-latex/data-formula)
_RE_MATH_TEX_BODY = re.compile(
    r'<span[^>]*class=["\'][^"\']*math-tex[^"\']*["\'][^>]*>(.*?)</span>',
    re.DOTALL | re.IGNORECASE,
)
# Naked LaTeX in text (no $, no span): e.g. "уравнения 5^{x-4}=\frac{1}{125}."
# Negative lookbehind: skip if inside our output (&#92;( = \( in entities)
_RE_NAKED_INLINE = re.compile(
    r'(?<!&#92;\()([^\s<>]*(?:\\frac\{[^}]*\}\{[^}]*\}|\^\{[^}]*\}|_\{[^}]*\}|\\sqrt(?:\[[^\]]*\])?\{[^}]*\})[^\s<>]*?)(?=[.,;:\s<>]|$|&#41;)',
)
# LaTeX с \infty, \cup, \cap и др. (интервалы, множества): (−∞;4)∪(4;5]
_RE_NAKED_LATEX_SYMBOLS = re.compile(
    r'(?<!&#92;\()([^\s<>]*(?:\\infty|\\cup|\\cap|\\leq|\\geq|\\wedge|\\vee|\\neg|\\exists|\\forall|\\in|\\notin)[^\s<>]*)(?=[.,;:\s<>]|$|&#41;)',
)

_fd = getattr(django_settings, 'FRONTEND_DIR', None)
_basedir = getattr(django_settings, 'BASE_DIR', Path(__file__).resolve().parent.parent)
# render_mathjax.cjs lives in frontend/ (parent of frontend/dist when FRONTEND_DIR is set)
_frontend_dir = _fd.parent if _fd else (_basedir / "frontend")
MATHJAX_RENDER_SCRIPT = _frontend_dir / "render_mathjax.cjs"
def _find_node():
    node = shutil.which("node")
    if node:
        return node
    for p in ("/usr/bin/node", "/usr/local/bin/node"):
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return None

MATHJAX_NODE = _find_node()
MATHJAX_AVAILABLE = bool(MATHJAX_NODE and MATHJAX_RENDER_SCRIPT.exists())


def _extract_balanced(text: str, pos: int) -> tuple[str, int]:
    assert text[pos] == '{'
    depth = 0
    start = pos + 1
    for i in range(pos, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return text[start:i], i + 1
    return text[start:], len(text)


def _convert_frac(text: str) -> str:
    result = []
    i = 0
    while i < len(text):
        fi, di = text.find(r'\frac', i), text.find(r'\dfrac', i)
        if fi == -1 and di == -1:
            result.append(text[i:])
            break
        if di != -1 and (fi == -1 or di <= fi):
            m_start, cmd_len = di, len(r'\dfrac')
        else:
            m_start, cmd_len = fi, len(r'\frac')
        result.append(text[i:m_start])
        i = m_start + cmd_len
        while i < len(text) and text[i] == ' ':
            i += 1
        if i >= len(text) or text[i] != '{':
            result.append(text[m_start:i])
            continue
        num, i = _extract_balanced(text, i)
        while i < len(text) and text[i] == ' ':
            i += 1
        if i >= len(text) or text[i] != '{':
            result.append(f'\\frac{{{num}}}')
            continue
        den, i = _extract_balanced(text, i)
        num_html = _convert_frac(num)
        den_html = _convert_frac(den)
        result.append(
            f'<span class="frac"><span class="num">{num_html}</span>'
            f'<span class="den">{den_html}</span></span>'
        )
    return ''.join(result)


def _convert_sqrt(text: str) -> str:
    result = []
    i = 0
    while i < len(text):
        m = text.find(r'\sqrt', i)
        if m == -1:
            result.append(text[i:])
            break
        result.append(text[i:m])
        i = m + len(r'\sqrt')
        degree = ''
        if i < len(text) and text[i] == '[':
            end = text.find(']', i)
            if end != -1:
                degree = text[i + 1:end]
                i = end + 1
        if i < len(text) and text[i] == '{':
            arg, i = _extract_balanced(text, i)
            prefix = f'<sup>{degree}</sup>' if degree else ''
            result.append(f'{prefix}√<span class="sqrt-arg">{arg}</span>')
        else:
            result.append(r'\sqrt')
    return ''.join(result)


def _split_array_row(row: str) -> list[str]:
    """Разбивает строку по &, но не внутри {...} (чтобы \\text{Художник & Баталист} оставался одной ячейкой)."""
    PLACEHOLDER = '\uE000'  # private use
    out = []
    depth = 0
    for c in row:
        if c == '{':
            depth += 1
            out.append(c)
        elif c == '}':
            depth -= 1
            out.append(c)
        elif c == '&':
            out.append(PLACEHOLDER if depth > 0 else c)
        else:
            out.append(c)
    return [cell.strip().replace(PLACEHOLDER, '&') for cell in ''.join(out).split('&')]


def _split_array_rows(body: str) -> list[str]:
    """Разбивает тело array/tabular по \\\\ (конец строки), не внутри {...} (вложенные массивы, \\shortstack)."""
    if not body:
        return []
    rows = []
    buf: list[str] = []
    depth = 0
    i = 0
    n = len(body)
    while i < n:
        c = body[i]
        if c == '{':
            depth += 1
            buf.append(c)
            i += 1
        elif c == '}':
            depth -= 1
            buf.append(c)
            i += 1
        elif depth == 0 and i + 1 < n and c == '\\' and body[i + 1] == '\\':
            row = ''.join(buf).strip()
            row = row.replace(r'\hline', '').strip()
            if row:
                rows.append(row)
            buf = []
            i += 2
        else:
            buf.append(c)
            i += 1
    tail = ''.join(buf).strip()
    tail = tail.replace(r'\hline', '').strip()
    if tail:
        rows.append(tail)
    return rows


def _replace_shortstack_in_cell(cell: str) -> str:
    """\\shortstack{а\\\\б} → многострочная ячейка (<br>); рекурсия не требуется."""
    if r'\shortstack' not in cell:
        return cell
    out: list[str] = []
    i = 0
    key = r'\shortstack'
    while i < len(cell):
        j = cell.find(key, i)
        if j == -1:
            out.append(cell[i:])
            break
        out.append(cell[i:j])
        k = j + len(key)
        while k < len(cell) and cell[k].isspace():
            k += 1
        if k >= len(cell) or cell[k] != '{':
            out.append(key)
            i = j + len(key)
            continue
        inner, end = _extract_balanced(cell, k)
        lines = re.split(r'\\\\', inner)
        parts = [p.strip() for p in lines if p.strip()]
        inner_html = '<br>'.join(parts)
        out.append(inner_html)
        i = end
    return ''.join(out)


def _convert_environments(text: str) -> str:
    def _to_array_table(body: str, *, use_thead: bool) -> str:
        raw_rows = _split_array_rows(body)
        rows_cells: list[list[str]] = []
        for row in raw_rows:
            cells = _split_array_row(row)
            cells = [_replace_shortstack_in_cell(c) for c in cells]
            if not any(cells):
                continue
            rows_cells.append(cells)
        if not rows_cells:
            return ''

        def row_cells_to_tds(cells: list[str], tag: str) -> str:
            if tag == 'th':
                return ''.join(
                    f'<th class="array-cell" scope="col">{cell}</th>' for cell in cells
                )
            return ''.join(f'<td class="array-cell">{cell}</td>' for cell in cells)

        if use_thead and len(rows_cells) >= 1:
            head = rows_cells[0]
            rest = rows_cells[1:]
            thead_html = (
                f'<thead><tr class="array-row">{row_cells_to_tds(head, "th")}</tr></thead>'
            )
            body_rows = ''.join(
                f'<tr class="array-row">{row_cells_to_tds(cells, "td")}</tr>' for cells in rest
            )
            return f'<table class="array-table" role="table">{thead_html}<tbody>{body_rows}</tbody></table>'

        rows_html = ''.join(
            f'<tr class="array-row">{row_cells_to_tds(cells, "td")}</tr>' for cells in rows_cells
        )
        return f'<table class="array-table" role="table"><tbody>{rows_html}</tbody></table>'

    def replace_array(m):
        return _to_array_table(m.group(1), use_thead=True)

    def replace_env(m):
        env_name = m.group(1)
        rows = re.split(r'\\\\', m.group(2))
        cleaned = [row.replace('&', ' ').strip() for row in rows if row.strip()]
        if env_name == 'cases':
            rows_html = ''.join(f'<tr><td class="cases-row">{row}</td></tr>' for row in cleaned)
            return (
                f'<table class="cases-table"><tbody><tr>'
                f'<td class="cases-brace" rowspan="{len(cleaned)}">{{</td>'
                f'<td><table><tbody>{rows_html}</tbody></table></td></tr></tbody></table>'
            )
        if env_name in {'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix'}:
            return _to_array_table(m.group(2), use_thead=False)
        return f'<div class="math-env">' + ''.join(f'<div class="math-row">{row}</div>' for row in cleaned) + '</div>'

    text = _RE_ARRAY.sub(replace_array, text)
    text = _RE_TABULAR.sub(replace_array, text)
    return _RE_ENV.sub(replace_env, text)


def _clean_html(text: str) -> str:
    text = text.replace('<br>', ' ').replace('<br/>', ' ').replace('<br />', ' ')
    text = _RE_HTML_TAGS.sub('', text)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    text = _RE_NEWLINES.sub(' ', text)
    return _RE_MULTI_SPACE.sub(' ', text).strip()


def _convert_math_block(content: str, display: bool = False) -> str:
    content = _clean_html(content)
    content = _convert_environments(content)
    content = _RE_TEXTBF.sub(r'<b>\1</b>', content)
    content = _RE_TEXTIT.sub(r'<i>\1</i>', content)
    content = _RE_TEXTTT.sub(r'<code>\1</code>', content)
    content = _RE_TEXT.sub(r'\1', content)
    content = _RE_MATHBF.sub(r'<b>\1</b>', content)
    content = _RE_MATHIT.sub(r'<i>\1</i>', content)
    content = _RE_OVERLINE.sub(r'<span style="text-decoration:overline">\1</span>', content)
    content = _RE_UNDERLINE.sub(r'<u>\1</u>', content)
    content = _convert_frac(content)
    content = _convert_sqrt(content)
    content = _RE_POWER_GROUP.sub(r'<sup>\1</sup>', content)
    content = _RE_INDEX_GROUP.sub(r'<sub>\1</sub>', content)
    content = _RE_POWER_SINGLE.sub(r'<sup>\1</sup>', content)
    content = _RE_INDEX_SINGLE.sub(r'<sub>\1</sub>', content)
    for latex, sym in MATH_SYMBOLS.items():
        content = content.replace(latex, sym)
    content = _RE_FUNC.sub(lambda m: f'<span class="mf">{m.group(1)}</span>', content)
    for latex, sym in BRACKET_MAP.items():
        content = content.replace(latex, sym)
    content = _RE_SPACING.sub('\u2009', content)
    content = _RE_STYLE.sub('', content)
    content = _RE_UNKNOWN_CMD.sub('', content)
    content = _RE_BRACES.sub('', content)
    content = content.strip()
    tag = 'div class="math-display"' if display else 'span class="math-inline"'
    close = tag.split()[0]
    return f'<{tag}>{content}</{close}>'


# Масштаб SVG MathJax в PDF (условия варианта читаемее крупнее)
PDF_MATH_SCALE = 1.2

_RE_SVG_WIDTH = re.compile(r'(<svg\b[^>]*\s)width="([\d.]+)ex"')
_RE_SVG_HEIGHT = re.compile(r'(<svg\b[^>]*\s)height="([\d.]+)ex"')
_RE_SVG_VALIGN = re.compile(r'vertical-align:\s*(-?[\d.]+)ex')


def _scale_svg(svg_html: str, scale: float) -> str:
    def scale_width(m):
        return f'{m.group(1)}width="{float(m.group(2)) * scale:.3f}ex"'

    def scale_height(m):
        return f'{m.group(1)}height="{float(m.group(2)) * scale:.3f}ex"'

    def scale_valign(m):
        return f'vertical-align: {float(m.group(1)) * scale:.3f}ex'

    svg_html = _RE_SVG_WIDTH.sub(scale_width, svg_html)
    svg_html = _RE_SVG_HEIGHT.sub(scale_height, svg_html)
    svg_html = _RE_SVG_VALIGN.sub(scale_valign, svg_html)
    return svg_html


_svg_cache: dict[tuple, str] = {}


def _svg_cache_key(latex: str, display: bool) -> tuple:
    return (latex, display, PDF_MATH_SCALE)


def _postprocess_svg(svg_html: str) -> str:
    if not svg_html:
        return svg_html
    svg_html = svg_html.replace('fill="currentColor"', 'fill="#000"')
    svg_html = svg_html.replace("fill='currentColor'", "fill='#000'")
    svg_html = svg_html.replace('stroke="currentColor"', 'stroke="#000"')
    svg_html = svg_html.replace("stroke='currentColor'", "stroke='#000'")
    return _scale_svg(svg_html, PDF_MATH_SCALE)


def _render_mathjax_svg(latex: str, display: bool) -> str:
    key = _svg_cache_key(latex, display)
    if key in _svg_cache:
        return _svg_cache[key]
    if not MATHJAX_AVAILABLE:
        raise RuntimeError("MathJax renderer is not available")
    payload = json.dumps({"latex": latex, "display": display})
    result = subprocess.run(
        [MATHJAX_NODE, str(MATHJAX_RENDER_SCRIPT)],
        input=payload,
        text=True,
        capture_output=True,
        check=True,
        timeout=10,
    )
    svg_html = _postprocess_svg(result.stdout.strip())
    _svg_cache[key] = svg_html
    return svg_html


def batch_render_mathjax(formulas: list[tuple[str, bool]]) -> None:
    """Render multiple LaTeX formulas in a single Node.js subprocess call.

    Populates _svg_cache so subsequent _render_mathjax_svg calls are instant.
    """
    if not MATHJAX_AVAILABLE or not formulas:
        return
    to_render = [
        (latex, display)
        for latex, display in formulas
        if _svg_cache_key(latex, display) not in _svg_cache
        and not _RE_HAS_TABULAR_OR_ARRAY.search(latex or "")
    ]
    if not to_render:
        return
    payload = json.dumps([{"latex": latex, "display": display} for latex, display in to_render])
    try:
        result = subprocess.run(
            [MATHJAX_NODE, str(MATHJAX_RENDER_SCRIPT)],
            input=payload,
            text=True,
            capture_output=True,
            check=True,
            timeout=120,
        )
        svgs = json.loads(result.stdout)
        for (latex, display), svg_html in zip(to_render, svgs):
            _svg_cache[_svg_cache_key(latex, display)] = _postprocess_svg(svg_html)
    except Exception:
        logger.exception("Batch MathJax render failed, formulas will be rendered one by one")


def extract_latex_formulas(html_text: str) -> list[tuple[str, bool]]:
    """Extract all LaTeX formulas from HTML text as (latex, is_display) pairs."""
    if not html_text:
        return []
    formulas = []

    def add(latex_raw: str, display: bool, span_html: str = "") -> None:
        latex = _normalize_latex(latex_raw)
        if latex:
            formulas.append((latex, _is_display_math(latex, span_html) if not display else display))

    for m in _RE_MATH_SPAN.finditer(html_text):
        add(m.group(1) or m.group(2) or "", False, m.group(0))
    for m in _RE_MATH_TEX_SPAN.finditer(html_text):
        add(m.group(1) or "", False, m.group(0))
    for m in _RE_MATH_FORMULA_SPAN.finditer(html_text):
        add(m.group(1) or "", False, m.group(0))
    for m in _RE_MATH_TEX_BODY.finditer(html_text):
        body = _clean_html(m.group(1) or "")
        add(body, False, m.group(0))
    for m in _RE_DISPLAY.finditer(html_text):
        add(m.group(1), True)
    for m in _RE_DISPLAY_DOUBLE.finditer(html_text):
        add(m.group(1), True)
    for m in _RE_INLINE_PAREN.finditer(html_text):
        add(m.group(1), False)
    for m in _RE_INLINE_DOLLAR.finditer(html_text):
        add(m.group(1), False)
    for m in _RE_NAKED_INLINE.finditer(html_text):
        latex = _normalize_latex(m.group(1))
        if latex and len(latex) >= 3:
            formulas.append((latex, False))
    return formulas


def _wrap_math_output(html: str, display: bool) -> str:
    if not html:
        return ""
    tag = "div" if display else "span"
    class_name = "math-display" if display else "math-inline"
    return f'<{tag} class="{class_name}">{html}</{tag}>'


def _is_display_math(latex: str, span_html: str = "") -> bool:
    if 'data-display="true"' in span_html or "data-display='true'" in span_html:
        return True
    return any(cmd in latex for cmd in (
        r'\begin', r'\[', r'\dfrac', r'\displaystyle', r'\begin{array}',
    ))


def _render_math_block(latex: str, display: bool, for_pdf: bool = False, for_browser: bool = False) -> str:
    # tabular/array не поддерживаются MathJax — конвертируем в HTML (и для PDF, и для SPA в браузере)
    if latex and _RE_HAS_TABULAR_OR_ARRAY.search(latex):
        return _convert_math_block(latex, display=display)
    if MATHJAX_AVAILABLE and not for_browser:
        try:
            svg = _render_mathjax_svg(latex, display)
            return _wrap_math_output(svg, display)
        except Exception:
            logger.exception("MathJax render failed, falling back to parser")
    if for_pdf:
        return _convert_math_block(latex, display=display)
    # Для веба: LaTeX в сущностях, чтобы последующие regex не перехватывали повторно.
    # &#92; = \, &#123; = {, &#125; = } — браузер декодирует обратно при innerHTML,
    # MathJax видит оригинальный LaTeX, но _RE_NAKED_INLINE и другие regex его не трогают.
    escaped = html_lib.escape(latex).replace('\\', '&#92;').replace('{', '&#123;').replace('}', '&#125;')
    if display:
        return f'<span class="math-display">&#92;[{escaped}&#92;]</span>'
    return f'<span class="math-inline">&#92;({escaped}&#92;&#41;</span>'


def _normalize_latex(s: str) -> str:
    """Normalize LaTeX from HTML: unescape entities, clean BR/newlines so \\frac{1}\\n{125} works."""
    if not s:
        return s
    s = html_lib.unescape(s)
    s = s.replace('<br>', ' ').replace('<br/>', ' ').replace('<br />', ' ')
    s = _RE_NEWLINES.sub(' ', s)
    return s.strip()


def _replace_verbatim(m):
    """Replace \\begin{verbatim}...\\end{verbatim} with HTML (MathJax не поддерживает verbatim)."""
    content = m.group(1)
    content = html_lib.escape(content)
    content = content.replace('\n', '<br>')
    return f'<pre class="latex-verbatim"><code>{content}</code></pre>'


@lru_cache(maxsize=4096)
def process_latex(html_text: str, for_pdf: bool = False, for_browser: bool = False) -> str:
    if not html_text:
        return html_text

    # 0. Verbatim — до обработки math (MathJax не поддерживает verbatim)
    html_text = _RE_VERBATIM.sub(_replace_verbatim, html_text)

    def replace_math_span(m):
        span_html = m.group(0)
        latex = _normalize_latex(m.group(1) or m.group(2) or "")
        if not latex:
            return span_html
        display = _is_display_math(latex, span_html)
        return _render_math_block(latex, display, for_pdf=for_pdf, for_browser=for_browser)

    def replace_math_tex(m):
        latex = _normalize_latex(m.group(1) or "")
        if not latex:
            return m.group(0)
        display = _is_display_math(latex, m.group(0))
        return _render_math_block(latex, display, for_pdf=for_pdf, for_browser=for_browser)

    # 1. TipTap/ProseMirror span
    html_text = _RE_MATH_SPAN.sub(replace_math_span, html_text)
    # 2. CKEditor math-tex with data-latex
    html_text = _RE_MATH_TEX_SPAN.sub(replace_math_tex, html_text)
    # 3. CKEditor math-tex with data-formula
    html_text = _RE_MATH_FORMULA_SPAN.sub(replace_math_tex, html_text)

    def replace_math_tex_body(m):
        """LaTeX in span body (no data-latex): strip HTML, normalize, render."""
        body = _clean_html(m.group(1) or "")
        latex = _normalize_latex(body)
        if not latex:
            return m.group(0)
        display = _is_display_math(latex, m.group(0))
        return _render_math_block(latex, display, for_pdf=for_pdf, for_browser=for_browser)

    # 3b. math-tex span with LaTeX in body (no data-latex) — after 2,3 so we don't double-process
    html_text = _RE_MATH_TEX_BODY.sub(replace_math_tex_body, html_text)

    def replace_display(m):
        content = _normalize_latex(m.group(1))
        if '<pre class="latex-verbatim">' in content:
            return content
        return _render_math_block(content, True, for_pdf=for_pdf, for_browser=for_browser)

    # 4. Display math \[...\] (including with <br> inside)
    html_text = _RE_DISPLAY.sub(replace_display, html_text)
    # 4b. Display math $$...$$
    html_text = _RE_DISPLAY_DOUBLE.sub(replace_display, html_text)
    # 5. Inline \(...\)
    html_text = _RE_INLINE_PAREN.sub(
        lambda m: _render_math_block(_normalize_latex(m.group(1)), False, for_pdf=for_pdf, for_browser=for_browser),
        html_text,
    )
    # 6. Inline $...$
    html_text = _RE_INLINE_DOLLAR.sub(
        lambda m: _render_math_block(_normalize_latex(m.group(1)), False, for_pdf=for_pdf, for_browser=for_browser),
        html_text,
    )
    # 6a. Голые блочные LaTeX-окружения без $...$, \(...\), \[...\]
    # Например: \begin{array}...\end{array} в тексте задачи.
    html_text = _RE_NAKED_ENV_BLOCK.sub(
        lambda m: _render_math_block(_normalize_latex(m.group(0)), True, for_pdf=for_pdf, for_browser=for_browser),
        html_text,
    )
    # 6b. Naked LaTeX in text (no delimiters) — e.g. "5^{x-4}=\frac{1}{125}"
    def replace_naked(m):
        latex = _normalize_latex(m.group(1))
        if not latex or len(latex) < 3:
            return m.group(0)
        return _render_math_block(latex, False, for_pdf=for_pdf, for_browser=for_browser)

    html_text = _RE_NAKED_INLINE.sub(replace_naked, html_text)

    def replace_naked_symbols(m):
        latex = _normalize_latex(m.group(1))
        if not latex or len(latex) < 3:
            return m.group(0)
        return _render_math_block(latex, False, for_pdf=for_pdf, for_browser=for_browser)

    html_text = _RE_NAKED_LATEX_SYMBOLS.sub(replace_naked_symbols, html_text)
    # 7. \texttt{...} в оставшемся plain HTML → моноширинный код (после math, чтобы не трогать data-latex)
    html_text = _RE_TEXTTT.sub(r'<code>\1</code>', html_text)
    # 8. Исправление &аmp; (кириллическая 'а') → & — corruption в некоторых данных
    html_text = html_text.replace("&\u0430mp;", "&")
    return html_text
