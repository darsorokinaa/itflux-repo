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


def _external_referrer(request, stored: str) -> str:
    text = str(stored or "").strip()[:200]
    if text:
        return text
    if request is None:
        return ""
    raw = str(request.META.get("HTTP_REFERER") or "").strip()[:200]
    if not raw:
        return ""
    from urllib.parse import urlparse

    try:
        ref_host = (urlparse(raw).netloc or "").split(":")[0].lower()
    except ValueError:
        return ""
    own = ""
    try:
        own = (request.get_host() or "").split(":")[0].lower()
    except Exception:
        own = ""
    if not ref_host or ref_host == own or (own and ref_host.endswith("." + own)):
        return ""
    if ref_host in {"oauth.yandex.ru", "oauth.yandex.com", "login.yandex.ru", "id.vk.com", "oauth.vk.com"}:
        return ""
    return raw


def acquisition_from_request(request) -> dict:
    """UTM из query и cookie первого визита. Referrer остаётся отдельно для классификации."""
    import json
    from urllib.parse import unquote

    parsed = {}
    raw = ""
    if request is not None:
        raw = request.COOKIES.get("itflux_acq") or ""
    if raw:
        try:
            loaded = json.loads(unquote(raw))
            if isinstance(loaded, dict):
                parsed = loaded
        except (TypeError, ValueError):
            parsed = {}
    query = {}
    if request is not None:
        query = {key: request.GET.get(key) for key in ACQUISITION_KEYS}
        query["source_ref"] = request.GET.get("source_ref")
    touch = merge_first_touch(parsed, query)
    referrer = _external_referrer(request, parsed.get("referrer") or "")
    if referrer:
        touch = {**touch, "referrer": referrer}
    return touch


def apply_teacher_acquisition(profile, request=None, stored=None) -> list:
    """Пишет источник учителя: UTM первого визита и referrer, без полного URL в профиле оплаты."""
    from .activation_events import classify_acquisition

    stored = stored if isinstance(stored, dict) else {}
    incoming = acquisition_from_request(request)
    touch = merge_first_touch(stored, incoming)
    referrer = str(stored.get("referrer") or incoming.get("referrer") or "")[:200]
    src, medium, campaign = classify_acquisition(
        utm_source=touch.get("utm_source") or "",
        utm_medium=touch.get("utm_medium") or "",
        utm_campaign=touch.get("utm_campaign") or "",
        referrer=referrer,
    )
    profile.acquisition_source = src
    profile.acquisition_medium = medium
    profile.acquisition_campaign = campaign
    fields = ["acquisition_source", "acquisition_medium", "acquisition_campaign"]
    if acquisition_has_signal(touch):
        profile.acquisition_touch = touch
        fields.append("acquisition_touch")
    return fields


def profile_touch(profile) -> dict:
    raw = getattr(profile, "acquisition_touch", None)
    if not isinstance(raw, dict):
        return {}
    return acquisition_payload(raw)
