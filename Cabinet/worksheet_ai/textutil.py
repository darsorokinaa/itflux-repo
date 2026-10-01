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


_IMG_RE = re.compile(
    r"<img\b[^>]*?\bsrc\s*=\s*(?P<q>['\"])(?P<src>.*?)(?P=q)",
    re.IGNORECASE | re.DOTALL,
)
_IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp")


def safe_image_src(src: str) -> str:
    value = html.unescape(str(src or "")).replace("\n", "").replace("\r", "").strip()
    if not value or any(char in value for char in (" ", "<", ">", '"', "'")):
        return ""
    lowered = value.lower()
    if lowered.startswith(("javascript:", "data:", "vbscript:")):
        return ""
    if lowered.startswith(("https://", "http://", "/media/", "/static/")):
        return value
    return ""


def _picture_block(source: str, index: int) -> bool:
    lower = source.lower()
    figure = lower.rfind("<figure", 0, index)
    paragraph = lower.rfind("<p", 0, index)
    start = max(figure, paragraph)
    if start < 0:
        return False
    if lower.startswith("<figure", start):
        return lower.find("</figure>", index) >= 0
    end = lower.find("</p>", index)
    if end < 0:
        return False
    text = TAG_RE.sub(" ", source[start:end])
    text = html.unescape(text).replace("\xa0", " ")
    return not SPACE_RE.sub("", text)


def illustration_urls(raw: str) -> list[str]:
    """Рисунки и схемы условия. Формульные фрагменты в строке текста не берём."""
    source = str(raw or "")
    found = []
    seen = set()
    for match in _IMG_RE.finditer(source):
        src = safe_image_src(match.group("src"))
        if not src or src in seen:
            continue
        lowered = src.lower()
        if "innerimg" in lowered:
            continue
        picture = _picture_block(source, match.start())
        uploaded = "/media/tasks/" in lowered or "tasks_images" in lowered
        if "xs3qstsrc" in lowered and not picture:
            continue
        if not picture and not uploaded:
            continue
        seen.add(src)
        found.append(src)
        if len(found) >= 6:
            break
    return found


def pictures_of(task) -> tuple[str, ...]:
    urls = illustration_urls(getattr(task, "task_template", "") or "")
    field = getattr(task, "files", None)
    name = str(getattr(field, "name", "") or "")
    if name.lower().endswith(_IMAGE_EXT):
        try:
            extra = safe_image_src(field.url)
        except ValueError:
            extra = ""
        if extra and extra not in urls:
            urls.append(extra)
    return tuple(urls[:6])


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
