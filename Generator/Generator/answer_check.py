"""Нормализация и сравнение ответов (регистронезависимо, без HTML)."""

from __future__ import annotations

import html
import re
import unicodedata

from django.utils.html import strip_tags

_SUBJECTS_WITH_OR = frozenset({"math", "math_base", "chem", "history"})
_ZERO_WIDTH_RE = re.compile(r"[\u200b-\u200d\ufeff\u00ad]")
_WS_RE = re.compile(r"\s+")
_OR_SPLIT_RE = re.compile(r"\s+или\s+", re.IGNORECASE)


def normalize_answer(value) -> str:
    text = html.unescape(strip_tags(str(value or "")))
    text = unicodedata.normalize("NFC", text)
    text = _ZERO_WIDTH_RE.sub("", text)
    text = text.replace("\xa0", " ").replace("&nbsp;", " ")
    text = _WS_RE.sub("", text)
    return text.casefold().strip()


def answers_equal(student_answer, expected_answer, *, subject: str = "") -> bool:
    """True, если ответы совпадают после нормализации (или по альтернативам «или»)."""
    user_norm = normalize_answer(student_answer)
    expected_raw = html.unescape(strip_tags(str(expected_answer or "")))
    expected_raw = expected_raw.replace("\xa0", " ")
    expected_norm = normalize_answer(expected_raw)
    if not user_norm or not expected_norm:
        return False

    subj = str(subject or "").strip().lower()
    if subj in _SUBJECTS_WITH_OR and _OR_SPLIT_RE.search(expected_raw):
        alternatives = [normalize_answer(part) for part in _OR_SPLIT_RE.split(expected_raw)]
        alternatives = [a for a in alternatives if a]
        if alternatives:
            return user_norm in alternatives

    return user_norm == expected_norm


def expected_answer_for_variant_task(variant_id: int, task_id: int | None = None, task_number_key: str = "") -> str:
    """Эталон из VariantContent: по task_id или по номеру банка / order / ключу t<id>."""
    if not variant_id:
        return ""
    from django.apps import apps

    VariantContent = apps.get_model("Generator", "VariantContent")
    if task_id:
        vc = (
            VariantContent.objects.select_related("task")
            .filter(variant_id=variant_id, task_id=int(task_id))
            .first()
        )
        if vc and vc.task:
            return str(getattr(vc.task, "answer", "") or "")

    key = str(task_number_key or "").strip()
    if not key:
        return ""
    if len(key) >= 2 and key[0] == "t" and key[1:].isdigit():
        tid = int(key[1:])
        vc = (
            VariantContent.objects.select_related("task")
            .filter(variant_id=variant_id, task_id=tid)
            .first()
        )
        if vc and vc.task:
            return str(getattr(vc.task, "answer", "") or "")
        return ""
    if key.isdigit():
        tn = int(key)
        vc = (
            VariantContent.objects.select_related("task")
            .filter(variant_id=variant_id, task__task__task_number=tn)
            .first()
        )
        if vc and vc.task:
            return str(getattr(vc.task, "answer", "") or "")
        if 1 <= tn <= 500:
            vc2 = (
                VariantContent.objects.select_related("task")
                .filter(variant_id=variant_id, order=tn)
                .first()
            )
            if vc2 and vc2.task:
                return str(getattr(vc2.task, "answer", "") or "")
    return ""
