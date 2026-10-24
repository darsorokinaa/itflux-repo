"""r105: анонимные замеры загрузки страницы (cdn-релей vs прямой хост).

Фронт шлёт один navigator.sendBeacon на загрузку страницы → POST /api/load-timing/.
Пишем одну строку в LOAD_TIMING_LOG. Без БД. Не пишем IP, логины, URL, query.
Пользователь — только uidh (HMAC от id с SECRET_KEY, 10 hex) или "-".
Rate-limit: LOAD_TIMING_RATE в минуту на ключ (сессия/uid, иначе IP — IP в лог не пишется).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import threading
from datetime import datetime, timezone

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from Generator import cdn_users

log = logging.getLogger(__name__)

DEFAULT_LOG = "/var/log/itflux/load-timing.log"
MAIN_HOSTS = {"itflux-academy.ru", "www.itflux-academy.ru"}
MAX_BODY = 2048
MAX_MS = 600_000
EVENTS = {"ok", "boot_fail", "auto_switch", "hidden"}
_METRICS = ("ttfb", "dcl", "load", "ready")
_lock = threading.Lock()


def log_path() -> str:
    return getattr(settings, "LOAD_TIMING_LOG", DEFAULT_LOG)


def rate_per_min() -> int:
    return int(getattr(settings, "LOAD_TIMING_RATE", 20))


def host_kind(request) -> str:
    if cdn_users.is_cdn(request):
        return "cdn"
    host = (request.META.get("HTTP_HOST") or "").split(",")[0].strip().split(":")[0].lower()
    return "direct" if host in MAIN_HOSTS else "other"


def uid_hash(user) -> str:
    if not user or not getattr(user, "is_authenticated", False):
        return "-"
    key = str(settings.SECRET_KEY).encode()
    return hmac.new(key, f"lt:{user.pk}".encode(), hashlib.sha256).hexdigest()[:10]


def _ms(v):
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return None
    return n if 0 <= n <= MAX_MS else None


def _token(v, n=16) -> str:
    return re.sub(r"[^a-z0-9_]", "", str(v or "").lower())[:n] or "-"


def _rate_key(request) -> str:
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        ident = f"u{user.pk}"
    else:
        ident = "ip" + hashlib.sha256(cdn_users.client_ip(request).encode()).hexdigest()[:16]
    return f"r105:lt:{ident}:{int(datetime.now(timezone.utc).timestamp() // 60)}"


def allow(request) -> bool:
    key = _rate_key(request)
    cache.add(key, 0, 70)
    try:
        n = cache.incr(key)
    except ValueError:
        cache.set(key, 1, 70)
        n = 1
    return n <= rate_per_min()


def build_line(request, data: dict) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ev = _token(data.get("ev"))
    if ev not in EVENTS:
        ev = "ok"
    parts = [ts, f"host={host_kind(request)}", f"ev={ev}"]
    for k in _METRICS:
        v = _ms(data.get(k))
        parts.append(f"{k}={'-' if v is None else v}")
    nav = _token(data.get("nav"), 12)
    parts.append(f"nav={nav}")
    parts.append(f"sw={'1' if data.get('sw') in (1, True, '1') else '0'}")
    parts.append(f"uidh={uid_hash(getattr(request, 'user', None))}")
    ua = cdn_users.short_ua(request.META.get("HTTP_USER_AGENT", "")).replace('"', "")
    parts.append(f'ua="{ua}"')
    vis = _token(data.get("vis"), 10)
    parts.append(f"vis={vis if vis in ('visible', 'hidden', 'prerender') else '-'}")
    return " ".join(parts) + "\n"


@csrf_exempt  # sendBeacon не несёт CSRF-заголовок; эндпоинт только дописывает обезличенную строку
@require_POST
def api_load_timing(request):
    if len(request.body or b"") > MAX_BODY:
        return HttpResponse(status=413)
    try:
        data = json.loads(request.body or b"{}")
        if not isinstance(data, dict):
            raise ValueError
    except (ValueError, UnicodeDecodeError):
        return HttpResponse(status=400)
    if host_kind(request) == "other":
        return HttpResponse(status=204)
    if not allow(request):
        return HttpResponse(status=429)
    try:
        line = build_line(request, data)
        with _lock, open(log_path(), "a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError as exc:
        log.warning("load-timing log write failed: %s", exc)
    return HttpResponse(status=204)


_LINE = re.compile(
    r"^(\S+) host=(\w+) ev=(\w+) ttfb=(\S+) dcl=(\S+) load=(\S+) ready=(\S+) nav=(\S+) sw=(\d) uidh=(\S+) ua=\"([^\"]*)\""
)


def parse_line(line: str):
    m = _LINE.match(line.strip())
    if not m:
        return None
    try:
        ts = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    num = lambda s: None if s == "-" else int(s)  # noqa: E731
    return {"ts": ts, "host": m.group(2), "ev": m.group(3), "ttfb": num(m.group(4)), "dcl": num(m.group(5)),
            "load": num(m.group(6)), "ready": num(m.group(7)), "nav": m.group(8), "sw": m.group(9) == "1",
            "uidh": m.group(10), "ua": m.group(11)}
