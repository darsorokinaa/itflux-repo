import logging
import re
import time
import uuid
import xml.sax.saxutils
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import requests
from django.conf import settings
from django.utils import timezone as dj_timezone

from .telemost import is_telemost_meeting_url, normalize_telemost_url, resolve_telemost_oauth_token

logger = logging.getLogger(__name__)

YANDEX_LOGIN_INFO_URL = "https://login.yandex.ru/info"
CALDAV_BASE_URL = "https://caldav.yandex.ru"
TELEMOST_URL_RE = re.compile(
    r"https://telemost(?:\.360)?\.yandex\.(ru|com)/j/[A-Za-z0-9_-]+/?(\?[^\s]*)?",
    re.IGNORECASE,
)

CALENDAR_QUERY_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="{start}" end="{end}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>"""

YANDEX_CALENDAR_EMBED_BASE = "https://calendar.yandex.ru"
YANDEX_CALENDAR_VIEW_PATHS = {
    "day": "day",
    "week": "week",
    "month": "month",
    "list": "week",
}
_LAYER_IDS_RE = re.compile(r"layer_ids=([^&\"'\s>]+)")


def calendar_integration_enabled():
    return bool(getattr(settings, "YANDEX_CALENDAR_ENABLED", False))


def calendar_authorize_url():
    if not calendar_integration_enabled():
        return None
    from .telemost import telemost_authorize_code_url

    return telemost_authorize_code_url()


def calendar_is_configured():
    if not calendar_integration_enabled():
        return False
    return bool(resolve_telemost_oauth_token()[0])


def profile_yandex_calendar_active(profile):
    if not calendar_integration_enabled():
        return False
    return bool(profile and (profile.yandex_oauth_token or "").strip())


def _oauth_headers(token):
    return {"Authorization": f"OAuth {token}"}


def _resolve_calendar_token():
    return resolve_telemost_oauth_token()


def _fetch_yandex_email(token):
    try:
        response = requests.get(
            YANDEX_LOGIN_INFO_URL,
            params={"format": "json"},
            headers=_oauth_headers(token),
            timeout=15,
        )
    except requests.RequestException as exc:
        logger.exception("Yandex login info request failed")
        return None, f"Не удалось получить email аккаунта Яндекса: {exc}"

    if response.ok:
        data = response.json()
        email = (data.get("default_email") or "").strip()
        login = (data.get("login") or "").strip()
        if not email and login:
            email = f"{login}@yandex.ru"
        if email:
            return email, None

    explicit = (
        getattr(settings, "YANDEX_ACCOUNT_EMAIL", "")
        or getattr(settings, "YANDEX_TELEMOST_COHOST_EMAIL", "")
        or ""
    ).strip()
    if explicit:
        return explicit, None

    if not response.ok:
        return None, "OAuth-токен не даёт доступ к профилю Яндекса. Получите токен заново."

    return None, "Не удалось определить email для Яндекс Календаря."


def resolve_yandex_account_email(token=None):
    """Email аккаунта Яндекса для календаря и Телемоста."""
    if token:
        email, _ = _fetch_yandex_email(token)
        if email:
            return email

    explicit = (
        getattr(settings, "YANDEX_ACCOUNT_EMAIL", "")
        or getattr(settings, "YANDEX_TELEMOST_COHOST_EMAIL", "")
        or ""
    ).strip()
    return explicit or None


def _calendar_layer_ids():
    explicit = (getattr(settings, "YANDEX_CALENDAR_LAYER_IDS", "") or "").strip()
    if explicit:
        return explicit

    embed_url = (getattr(settings, "YANDEX_CALENDAR_EMBED_URL", "") or "").strip()
    if embed_url:
        match = _LAYER_IDS_RE.search(embed_url)
        if match:
            return match.group(1)
    return ""


def calendar_embed_enabled():
    if not calendar_integration_enabled():
        return False
    if _calendar_layer_ids():
        return True
    return bool((getattr(settings, "YANDEX_CALENDAR_EMBED_URL", "") or "").strip())


def build_calendar_embed_url(view="week"):
    explicit_url = (getattr(settings, "YANDEX_CALENDAR_EMBED_URL", "") or "").strip()
    layer_ids = _calendar_layer_ids()
    tz_id = (getattr(settings, "YANDEX_CALENDAR_TZ_ID", "") or "Europe/Moscow").strip()
    path = YANDEX_CALENDAR_VIEW_PATHS.get(view, "week")

    if layer_ids:
        return (
            f"{YANDEX_CALENDAR_EMBED_BASE}/{path}"
            f"?embed&layer_ids={quote(layer_ids, safe=',')}"
            f"&tz_id={quote(tz_id, safe='/')}"
        )

    if explicit_url:
        return re.sub(
            r"/(day|week|month)(\?|$)",
            f"/{path}\\2",
            explicit_url,
            count=1,
        )

    return None


def calendar_embed_config():
    layer_ids = _calendar_layer_ids()
    tz_id = (getattr(settings, "YANDEX_CALENDAR_TZ_ID", "") or "Europe/Moscow").strip()
    enabled = calendar_embed_enabled()
    return {
        "enabled": enabled,
        "layer_ids": layer_ids,
        "tz_id": tz_id,
        "embed_url": build_calendar_embed_url("week") if enabled else None,
        "help_url": "https://yandex.ru/support/yandex-360/customers/calendar/web/ru/widget",
        "display_mode": "yandex_embed" if enabled else "caldav",
    }


def _caldav_calendar_url(email):
    encoded = quote(email, safe="")
    return f"{CALDAV_BASE_URL}/calendars/{encoded}/events-default/"


def _ics_to_utc_datetime(value):
    raw = (value or "").strip()
    if not raw:
        return None

    if raw.endswith("Z"):
        try:
            return datetime.strptime(raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            return None

    try:
        if "T" in raw:
            dt = datetime.strptime(raw[:15], "%Y%m%dT%H%M%S")
        else:
            dt = datetime.strptime(raw[:8], "%Y%m%d")
        return dj_timezone.make_aware(dt, dj_timezone.get_current_timezone())
    except ValueError:
        return None


def _unfold_ics(text):
    lines = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if not line:
            continue
        if line.startswith((" ", "\t")) and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    return lines


def _parse_vevents(ics_blob):
    events = []
    current = None
    in_event = False

    for line in _unfold_ics(ics_blob):
        if line == "BEGIN:VEVENT":
            in_event = True
            current = {}
            continue
        if line == "END:VEVENT":
            in_event = False
            if current:
                events.append(current)
            current = None
            continue
        if not in_event or ":" not in line:
            continue

        key_part, value = line.split(":", 1)
        key = key_part.split(";")[0].upper()
        current[key] = value

    return events


def _extract_telemost_link(*values):
    for value in values:
        if not value:
            continue
        match = TELEMOST_URL_RE.search(str(value))
        if match:
            return match.group(0).rstrip(".,;)")
    return None


def _infer_event_type(title, description):
    text = f"{title} {description}".lower()
    if any(word in text for word in ("индивид", "1:1", "1-1")):
        return "individual"
    if any(word in text for word in ("домашн", "дз", "homework")):
        return "homework"
    if any(word in text for word in ("проверк", "разбор работ")):
        return "review"
    return "group"


def _infer_tags(title, description):
    text = f"{title} {description}".lower()
    tags = []
    if "огэ" in text or "oge" in text:
        tags.append("oge")
    if "егэ" in text or "ege" in text:
        tags.append("ege")
    if "python" in text or "питон" in text:
        tags.append("python")
    if "индивид" in text:
        tags.append("individual")
    if "групп" in text:
        tags.append("groups")
    return tags


def _format_hm(dt):
    if dt is None:
        return "00:00"
    local = dj_timezone.localtime(dt)
    return local.strftime("%H:%M")


def _map_vevent(raw):
    uid = (raw.get("UID") or raw.get("URL") or "").strip()
    summary = (raw.get("SUMMARY") or "Событие").strip()
    description = (raw.get("DESCRIPTION") or "").replace("\\n", "\n").replace("\\,", ",").strip()
    location = (raw.get("LOCATION") or "").replace("\\n", "\n").strip()
    status = (raw.get("STATUS") or "").upper()

    start = _ics_to_utc_datetime(raw.get("DTSTART", ""))
    end = _ics_to_utc_datetime(raw.get("DTEND", ""))
    if start and not end:
        end = start + timedelta(hours=1)
    if not start:
        return None

    link = _extract_telemost_link(location, description, raw.get("URL", ""))
    event_type = _infer_event_type(summary, description)
    is_online = bool(link) or "telemost" in f"{location} {description}".lower() or "онлайн" in summary.lower()

    local_start = dj_timezone.localtime(start)
    today = dj_timezone.localdate()
    day_offset = (local_start.date() - today).days

    mapped = {
        "id": uid or f"yc-{local_start.isoformat()}-{summary[:32]}",
        "dayOffset": day_offset,
        "startsAt": dj_timezone.localtime(start).isoformat(),
        "endsAt": dj_timezone.localtime(end).isoformat() if end else None,
        "startTime": _format_hm(start),
        "endTime": _format_hm(end),
        "title": summary,
        "topic": description.split("\n", 1)[0][:120] if description else "",
        "type": event_type,
        "audience": location[:120] if location and not link else "",
        "format": "Онлайн" if is_online else "Офлайн",
        "link": link,
        "materials": description[:500] if description else "",
        "status": "cancelled" if status == "CANCELLED" else "planned",
        "statusLabel": "Отменено" if status == "CANCELLED" else "Из календаря",
        "tags": _infer_tags(summary, description),
        "source": "yandex_calendar",
        "readOnly": True,
    }

    if link and is_telemost_meeting_url(link):
        mapped["format"] = "Онлайн"

    recurrence_id = (raw.get("RECURRENCE-ID") or "").strip()
    if raw.get("RRULE"):
        mapped["seriesId"] = uid.split("@")[0] if uid else mapped["id"]
        mapped["recurrence"] = "scheduled"

    if recurrence_id:
        mapped["id"] = f"{uid}::{recurrence_id}"

    return mapped


def _ics_escape(value):
    text = str(value or "")
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _caldav_time_utc(value):
    if dj_timezone.is_naive(value):
        value = dj_timezone.make_aware(value, dj_timezone.get_current_timezone())
    utc = value.astimezone(timezone.utc)
    return utc.strftime("%Y%m%dT%H%M%SZ")


def _extract_telemost_from_ics(ics_text):
    for line in _unfold_ics(ics_text):
        upper = line.upper()
        if upper.startswith("X-TELEMOST-CONFERENCE:"):
            url = line.split(":", 1)[1].strip()
            if is_telemost_meeting_url(url):
                return url
    return _extract_telemost_link(ics_text)


def create_telemost_link_via_caldav(*, title, starts_at, ends_at, topic=""):
    """
    Создаёт ссылку Телемост через CalDAV (X-TELEMOST-REQUIRED).
    Работает с OAuth-токеном аккаунта организации без прямого Telemost API.
    """
    token, error = resolve_telemost_oauth_token()
    if not token:
        return None, error or "Яндекс OAuth не настроен."

    email, email_error = _fetch_yandex_email(token)
    if email_error:
        return None, email_error

    event_uid = f"{uuid.uuid4()}@itflux"
    event_url = f"{_caldav_calendar_url(email)}{event_uid}.ics"
    now_utc = _caldav_time_utc(dj_timezone.now())
    start_utc = _caldav_time_utc(starts_at)
    end_utc = _caldav_time_utc(ends_at)

    ics = (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//ITFlux//Cabinet//RU\r\n"
        "CALSCALE:GREGORIAN\r\n"
        "BEGIN:VEVENT\r\n"
        f"UID:{event_uid}\r\n"
        f"DTSTAMP:{now_utc}\r\n"
        f"DTSTART:{start_utc}\r\n"
        f"DTEND:{end_utc}\r\n"
        f"SUMMARY:{_ics_escape(title or 'Онлайн-урок')}\r\n"
        f"DESCRIPTION:{_ics_escape(topic)}\r\n"
        "X-TELEMOST-REQUIRED:TRUE\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    )

    headers = {
        **_oauth_headers(token),
        "Content-Type": "text/ics",
    }

    try:
        put_response = requests.put(
            event_url,
            data=ics.encode("utf-8"),
            headers=headers,
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.exception("CalDAV telemost create failed")
        return None, f"Не удалось создать встречу в календаре: {exc}"

    if put_response.status_code not in (200, 201, 204):
        logger.warning("CalDAV telemost PUT %s: %s", put_response.status_code, put_response.text[:500])
        return None, (
            "Яндекс Календарь не создал ссылку Телемост. "
            f"Проверьте OAuth-токен аккаунта ({resolve_yandex_account_email() or 'YANDEX_ACCOUNT_EMAIL'})."
        )

    link = None
    for attempt in range(8):
        if attempt:
            time.sleep(0.35)
        try:
            get_response = requests.get(event_url, headers=_oauth_headers(token), timeout=30)
        except requests.RequestException:
            continue
        if get_response.ok:
            link = _extract_telemost_from_ics(get_response.text)
            if link:
                link = normalize_telemost_url(link)
                break

    try:
        requests.delete(event_url, headers=_oauth_headers(token), timeout=15)
    except requests.RequestException:
        logger.debug("CalDAV cleanup after telemost create failed", exc_info=True)

    if link and is_telemost_meeting_url(link):
        return link, None

    account = resolve_yandex_account_email() or getattr(settings, "YANDEX_ACCOUNT_EMAIL", "")
    return None, (
        "CalDAV не вернул ссылку Телемост. Получите OAuth-токен под аккаунтом "
        f"{account} и подключите приложение в админке Яндекс 360."
    )


def _caldav_time(value):
    if dj_timezone.is_aware(value):
        value = dj_timezone.localtime(value)
    else:
        value = dj_timezone.make_aware(value, dj_timezone.get_current_timezone())
    return value.strftime("%Y%m%dT%H%M%S")


def fetch_calendar_events(*, date_from, date_to):
    token, error = _resolve_calendar_token()
    if not token:
        return None, error or "Яндекс Календарь не настроен."

    email, email_error = _fetch_yandex_email(token)
    if email_error:
        return None, email_error

    if date_from > date_to:
        date_from, date_to = date_to, date_from

    start = _caldav_time(datetime.combine(date_from, datetime.min.time()))
    end = _caldav_time(datetime.combine(date_to + timedelta(days=1), datetime.min.time()))

    body = CALENDAR_QUERY_TEMPLATE.format(
        start=xml.sax.saxutils.escape(start),
        end=xml.sax.saxutils.escape(end),
    )

    calendar_url = _caldav_calendar_url(email)
    try:
        response = requests.request(
            "REPORT",
            calendar_url,
            data=body.encode("utf-8"),
            headers={
                **_oauth_headers(token),
                "Content-Type": "application/xml; charset=utf-8",
                "Depth": "1",
            },
            timeout=30,
        )
    except requests.RequestException as exc:
        logger.exception("CalDAV calendar query failed")
        return None, f"Не удалось загрузить Яндекс Календарь: {exc}"

    if response.status_code in (401, 403):
        return None, (
            "Нет доступа к Яндекс Календарю. Получите новый OAuth-токен с правами calendar "
            "для приложения «Цифровой поток» — старый токен мог быть выдан без календаря."
        )

    if not response.ok:
        logger.warning("CalDAV error %s: %s", response.status_code, response.text[:500])
        return None, f"Яндекс Календарь вернул ошибку (HTTP {response.status_code})."

    ics_chunks = re.findall(
        r"<(?:C:)?calendar-data[^>]*>([\s\S]*?)</(?:C:)?calendar-data>",
        response.text,
        flags=re.IGNORECASE,
    )
    if not ics_chunks:
        ics_chunks = re.findall(
            r"<calendar-data[^>]*>([\s\S]*?)</calendar-data>",
            response.text,
            flags=re.IGNORECASE,
        )

    mapped = []
    seen = set()
    for chunk in ics_chunks:
        decoded = (
            chunk.replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&")
            .replace("&#13;", "")
        )
        for raw in _parse_vevents(decoded):
            item = _map_vevent(raw)
            if not item or item["id"] in seen:
                continue
            seen.add(item["id"])
            mapped.append(item)

    mapped.sort(key=lambda ev: (ev.get("startsAt") or "", ev.get("startTime") or ""))
    return mapped, None
