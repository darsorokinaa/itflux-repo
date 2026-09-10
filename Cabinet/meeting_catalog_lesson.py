"""Каталожный HTML-урок в комнате: сразу контент, без карточки «Открыть урок»."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

from django.db.models import Q

_SLUG_RE = re.compile(r"^[A-Za-z0-9][-A-Za-z0-9_]{0,119}$")


def catalog_lesson_slug_from_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    parts = urlsplit(raw if "://" in raw else f"https://local.invalid{raw}")
    preview = (parse_qs(parts.query).get("preview") or [""])[0].strip()
    if _SLUG_RE.match(preview):
        return preview
    segments = [seg for seg in (parts.path or "").split("/") if seg]
    if "lessons" not in segments:
        return ""
    idx = segments.index("lessons")
    if idx + 1 >= len(segments):
        return ""
    slug = segments[idx + 1]
    if slug in {"view", "archive", "demo", "purchase", "purchases"}:
        return ""
    return slug if _SLUG_RE.match(slug) else ""


def meeting_lesson_content_url(url: str) -> str:
    """Карточка каталога → HTML урока для iframe комнаты."""
    raw = (url or "").strip()
    slug = catalog_lesson_slug_from_url(raw)
    if not slug:
        return raw
    return f"/api/lessons/{slug}/view/"


def url_refers_to_catalog_lesson(url: str, slug: str) -> bool:
    if not slug or not _SLUG_RE.match(slug):
        return False
    return catalog_lesson_slug_from_url(url) == slug


def user_can_view_lesson_in_live_meeting(user, lesson) -> bool:
    """Участник живого урока видит показанный каталожный материал без покупки."""
    if user is None or not getattr(user, "is_authenticated", False) or lesson is None:
        return False
    slug = getattr(lesson, "slug", "") or ""
    if not _SLUG_RE.match(slug):
        return False
    try:
        from .meeting_material_models import MeetingMaterialSession
        from .models import VideoMeeting
        from .video_meeting_service import resolve_access
    except Exception:
        return False

    sessions = (
        MeetingMaterialSession.objects.filter(
            is_active=True,
            meeting__status=VideoMeeting.Status.LIVE,
        )
        .filter(Q(open_url__icontains=slug) | Q(material__external_url__icontains=slug))
        .select_related("meeting", "meeting__schedule_event", "material")[:12]
    )
    for session in sessions:
        material_url = ""
        if session.material_id:
            material_url = getattr(session.material, "external_url", "") or ""
        if not (
            url_refers_to_catalog_lesson(session.open_url, slug)
            or url_refers_to_catalog_lesson(material_url, slug)
        ):
            continue
        access = resolve_access(user, session.meeting.schedule_event)
        if access.allowed:
            return True
    return False
