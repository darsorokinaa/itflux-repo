"""Нормализация текста заданий. Пользовательский ввод считается недоверенным."""

from __future__ import annotations

import hashlib
import html
import re

TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9]{3,}")
STOP = {
    "для", "или", "как", "что", "это", "при", "от", "до", "не", "на", "по", "из",
    "над", "под", "без", "про", "его", "её", "их", "все", "вся", "the", "and",
}


def plain_text(value) -> str:
    text = TAG_RE.sub(" ", str(value or ""))
    text = html.unescape(text).replace("\xa0", " ").replace("\x00", "")
    return SPACE_RE.sub(" ", text).strip()


def clean_text(value, limit: int) -> str:
    return plain_text(value)[:limit]


def normalize_match(value) -> str:
    text = plain_text(value).lower().replace("ё", "е")
    text = text.replace("−", "-").replace("–", "-").replace("—", "-")
    text = text.replace(",", ".")
    return SPACE_RE.sub("", text)


def text_hash(value) -> str:
    return hashlib.sha256(normalize_match(value).encode("utf-8")).hexdigest()


def tokens(value) -> list[str]:
    found = []
    for raw in TOKEN_RE.findall(plain_text(value).lower().replace("ё", "е")):
        if raw in STOP or len(raw) < 4:
            continue
        found.append(raw)
    return found


def sheet_html(value) -> str:
    """Текст для innerHTML редактора: теги экранированы, формулы \\(...\\) сохранены."""
    text = plain_text(value)
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
