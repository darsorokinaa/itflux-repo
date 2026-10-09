"""Тексты TaskPreview для скачиваемого варианта: обложка и блоки частей."""

import html
import re

from django.utils.html import strip_tags

from .models import TaskPreview


def preview_plain_text(raw: str) -> str:
    text = re.sub(r"(?i)<\s*br\s*/?>", "\n", raw or "")
    text = re.sub(r"(?i)</\s*p\s*>", "\n", text)
    text = strip_tags(text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = [" ".join(line.split()) for line in text.splitlines()]
    return " ".join(line for line in lines if line).strip()


def exam_part_key(part) -> str | None:
    """Ключ шаблона: 1 — краткий ответ, 2 — развёрнутый ответ и говорение."""
    if part is None:
        return None
    title = str(getattr(part, "part_title", "") or "").strip().lower()
    if any(key in title for key in ("говорен", "устн", "speaking", "oral")):
        return "2"
    if title in {"2", "3"}:
        return "2"
    if title == "1":
        return "1"
    if "часть" not in title:
        return None
    if "12" in title or "21" in title:
        return None
    if "3" in title or "2" in title:
        return "2"
    if "1" in title:
        return "1"
    return None


def instructions_from_previews(previews) -> dict:
    part_instructions: dict[str, str] = {}
    cover: list[str] = []
    for preview in previews:
        text = preview_plain_text(getattr(preview, "task_preview_text", "") or "")
        if not text:
            continue
        preview_type = getattr(preview, "preview_type", None)
        type_text = str(getattr(preview_type, "preview_type_text", "") or "").lower()
        if "напоминание" in type_text:
            continue
        key = exam_part_key(getattr(preview, "part", None))
        if key:
            previous = part_instructions.get(key, "")
            part_instructions[key] = f"{previous} {text}".strip() if previous else text
            continue
        if getattr(preview, "part_id", None) is None:
            cover.append(text)
    return {"part_instructions": part_instructions, "cover_paragraphs": cover}


def instructions_for_variant(variant) -> dict:
    previews = TaskPreview.objects.filter(
        subject_id=variant.var_subject_id,
        level_id=variant.level_id,
    ).select_related("part", "preview_type")
    return instructions_from_previews(previews)
