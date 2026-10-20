"""r90: учёт пользователей, заходящих через cdn.itflux-academy.ru.

Не чаще одной строки на пользователя за CDN_USERS_THROTTLE_SECONDS (кэш Django).
В лог не пишем логины/почты — только id, роль, IP и короткий UA.
"""
from __future__ import annotations

import logging
import os
import re
import threading
from datetime import datetime, timezone

from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)

CDN_HOSTS = {"cdn.itflux-academy.ru", "www.cdn.itflux-academy.ru"}
DEFAULT_LOG = "/var/log/itflux/cdn-users.log"
_lock = threading.Lock()


def log_path() -> str:
    return getattr(settings, "CDN_USERS_LOG", DEFAULT_LOG)


def throttle_seconds() -> int:
    return int(getattr(settings, "CDN_USERS_THROTTLE_SECONDS", 600))


def client_ip(request) -> str:
    meta = request.META
    ip = (meta.get("HTTP_X_REAL_IP") or "").strip()
    if not ip:
        xff = (meta.get("HTTP_X_FORWARDED_FOR") or "").strip()
        ip = xff.split(",")[0].strip() if xff else ""
    if not ip:
        ip = meta.get("REMOTE_ADDR") or ""
    return re.sub(r"[^0-9a-fA-F:.]", "", ip)[:45] or "-"


_UA_RULES = [
    (r"YaBrowser/(\d+)", "YaBrowser"),
    (r"Edg/(\d+)", "Edge"),
    (r"OPR/(\d+)", "Opera"),
    (r"Firefox/(\d+)", "Firefox"),
    (r"Chrome/(\d+)", "Chrome"),
    (r"Version/(\d+).*Safari", "Safari"),
]
_OS_RULES = [
    ("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iOS"), ("Windows", "Windows"),
    ("Mac OS X", "macOS"), ("CrOS", "ChromeOS"), ("Linux", "Linux"),
]


def short_ua(ua: str) -> str:
    ua = ua or ""
    br = "other"
    for rx, name in _UA_RULES:
        m = re.search(rx, ua)
        if m:
            br = f"{name}/{m.group(1)}"
            break
    os_ = next((n for k, n in _OS_RULES if k in ua), "?")
    return f"{br} {os_}" if ua else "-"


def user_role(user) -> str:
    role = getattr(getattr(user, "profile", None), "role", None)
    if role in ("teacher", "student", "parent"):
        return role
    try:
        from Cabinet.models import Profile
        role = str(Profile.objects.filter(user=user).values_list("role", flat=True).first() or "")
    except Exception:
        role = ""
    return re.sub(r"[^a-z_]", "", role.lower())[:20] or "-"


def is_cdn(request) -> bool:
    # Только классификация: берём Host как есть (get_host() бросает DisallowedHost вне ALLOWED_HOSTS).
    host = request.META.get("HTTP_HOST") or ""
    return host.split(",")[0].strip().split(":")[0].lower() in CDN_HOSTS


def record(request) -> bool:
    user = getattr(request, "user", None)
    if not user or not getattr(user, "is_authenticated", False):
        return False
    key = f"r90:cdnu:{user.pk}"
    if not cache.add(key, 1, throttle_seconds()):
        return False
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = (f"{ts} uid={user.pk} role={user_role(user)} ip={client_ip(request)} "
            f"ua=\"{short_ua(request.META.get('HTTP_USER_AGENT', ''))}\"\n")
    try:
        with _lock, open(log_path(), "a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError as exc:
        log.warning("cdn-users log write failed: %s", exc)
        return False
    return True


class CdnUsersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if is_cdn(request):
            try:
                record(request)
            except Exception:  # учёт никогда не ломает запрос
                log.exception("cdn-users record failed")
        return response


_LINE = re.compile(r"^(\S+) uid=(\d+) role=(\S+) ip=(\S+) ua=\"([^\"]*)\"")


def parse_line(line: str):
    m = _LINE.match(line.strip())
    if not m:
        return None
    try:
        ts = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return {"ts": ts, "uid": int(m.group(2)), "role": m.group(3), "ip": m.group(4), "ua": m.group(5)}


def _mask_part(s: str) -> str:
    if not s:
        return "***"
    return s[:2] + "***" if len(s) > 2 else s[:1] + "***"


def mask_login(login: str) -> str:
    login = (login or "").strip()
    if "@" in login:
        local, _, domain = login.partition("@")
        name, dot, tld = domain.rpartition(".")
        dom = (domain[:1] + "***" + dot + tld) if dot else _mask_part(domain)
        return f"{_mask_part(local)}@{dom}"
    return _mask_part(login)
