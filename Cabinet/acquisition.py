"""Первый источник визита: utm и ref, без почты и полного URL."""

from __future__ import annotations

import re

_SAFE = re.compile(r"^[A-Za-z0-9._:-]+$")
ACQUISITION_KEYS = ("utm_source", "utm_medium", "utm_campaign", "utm_content", "ref")
_LIMITS = {
    "utm_source": 32,
    "utm_medium": 32,
    "utm_campaign": 64,
    "utm_content": 64,
    "ref": 64,
}


def clean_acquisition_token(value, *, limit: int = 64) -> str:
    text = str(value or "").strip()[:limit]
    if not text or not _SAFE.match(text):
        return ""
    return text


def acquisition_payload(data) -> dict:
    """Оставляет только utm_* и ref. Пустые и небезопасные значения отбрасывает.

    source_ref — то же поле, что ref, но не путается с реферальным кодом регистрации.
    """
    source = dict(data) if isinstance(data, dict) else {}
    if not source.get("ref") and source.get("source_ref"):
        source["ref"] = source.get("source_ref")
    payload = {}
    for key in ACQUISITION_KEYS:
        payload[key] = clean_acquisition_token(source.get(key), limit=_LIMITS[key])
    return payload


def acquisition_has_signal(payload: dict | None) -> bool:
    return bool(payload) and any(str(payload.get(key) or "") for key in ACQUISITION_KEYS)


def merge_first_touch(primary: dict | None, fallback: dict | None) -> dict:
    """Берёт непустые поля из primary, недостающие — из fallback."""
    first = acquisition_payload(primary)
    second = acquisition_payload(fallback)
    merged = {}
    for key in ACQUISITION_KEYS:
        merged[key] = first.get(key) or second.get(key) or ""
    if not acquisition_has_signal(merged):
        return {}
    return merged


def profile_touch(profile) -> dict:
    raw = getattr(profile, "acquisition_touch", None)
    if not isinstance(raw, dict):
        return {}
    return acquisition_payload(raw)
