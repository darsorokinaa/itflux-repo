"""
Замена логических операторов (∧ ∨ ¬ и LaTeX \\land \\lor …) на слова «И», «ИЛИ», «НЕ» в HTML-текстах заданий.

Слова оборачиваются в <span class="logic-connective-ru">…</span>, чтобы на странице не наследовать курсив из формул.
"""

from __future__ import annotations

import re

_LOGIC_SPAN_OPEN = '<span class="logic-connective-ru">'
_LOGIC_SPAN_CLOSE = "</span>"

_SPAN_AND = f" {_LOGIC_SPAN_OPEN}И{_LOGIC_SPAN_CLOSE} "
_SPAN_OR = f" {_LOGIC_SPAN_OPEN}ИЛИ{_LOGIC_SPAN_CLOSE} "
_SPAN_NOT = f" {_LOGIC_SPAN_OPEN}НЕ{_LOGIC_SPAN_CLOSE} "

# Длиннее / специфичнее — раньше (чтобы не задеть \\ldots и т.п.)
_LATEX: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\\land\b"), _SPAN_AND),
    (re.compile(r"\\wedge\b"), _SPAN_AND),
    (re.compile(r"\\lor\b"), _SPAN_OR),
    (re.compile(r"\\vee\b"), _SPAN_OR),
    (re.compile(r"\\lnot\b"), _SPAN_NOT),
    (re.compile(r"\\neg\b"), _SPAN_NOT),
)

_UNICODE_REPLACE: tuple[tuple[str, str], ...] = (
    ("\u2227", _SPAN_AND),  # ∧
    ("\u2228", _SPAN_OR),  # ∨
    ("\u00ac", _SPAN_NOT),  # ¬
    ("\u00AC", _SPAN_NOT),
)

_ENTITY: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"&#x2227;", re.IGNORECASE), _SPAN_AND),
    (re.compile(r"&#8743;"), _SPAN_AND),
    (re.compile(r"&#x2228;", re.IGNORECASE), _SPAN_OR),
    (re.compile(r"&#8744;"), _SPAN_OR),
    (re.compile(r"&#x00ac;", re.IGNORECASE), _SPAN_NOT),
    (re.compile(r"&#172;"), _SPAN_NOT),
    (re.compile(r"&#not;"), _SPAN_NOT),
)


def replace_logic_connectives_with_words(html: str) -> str:
    """Подставляет русские союзы вместо символов и стандартных LaTeX-команд."""
    if not html:
        return html
    s = html
    for rx, repl in _LATEX:
        s = rx.sub(repl, s)
    for ch, repl in _UNICODE_REPLACE:
        s = s.replace(ch, repl)
    for rx, repl in _ENTITY:
        s = rx.sub(repl, s)
    return s


_LW = r"(?<![А-Яа-яЁёA-Za-z0-9_])"
_RW = r"(?![А-Яа-яЁёA-Za-z0-9_])"


def wrap_plain_ru_logic_words(html: str) -> str:
    """
    Оборачивает уже вставленные И / ИЛИ / НЕ (без класса) в span.logic-connective-ru.
    Не трогает фрагменты внутри существующих span.logic-connective-ru.
    """
    if not html:
        return html

    out: list[str] = []
    i = 0
    while i < len(html):
        j = html.find(_LOGIC_SPAN_OPEN, i)
        if j == -1:
            out.append(_wrap_plain_ru_in_plain_segment(html[i:]))
            break
        out.append(_wrap_plain_ru_in_plain_segment(html[i:j]))
        k = html.find(_LOGIC_SPAN_CLOSE, j)
        if k == -1:
            out.append(html[j:])
            break
        out.append(html[j : k + len(_LOGIC_SPAN_CLOSE)])
        i = k + len(_LOGIC_SPAN_CLOSE)
    return "".join(out)


def _wrap_plain_ru_in_plain_segment(segment: str) -> str:
    s = segment
    for w in ("ИЛИ", "НЕ", "И"):
        pat = re.compile(_LW + re.escape(w) + _RW)
        s = pat.sub(lambda m, op=_LOGIC_SPAN_OPEN, cl=_LOGIC_SPAN_CLOSE: f"{op}{m.group(0)}{cl}", s)
    return s
