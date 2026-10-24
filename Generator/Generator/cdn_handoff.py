"""r93: одноразовый перенос сессии main -> cdn.itflux-academy.ru при обрывах звонка.

issue  (POST, основной хост, авторизован): токен 256 бит, хранится на сервере (кэш/redis)
       только как sha256, TTL CDN_HANDOFF_TTL (60 с), привязан к uid и UA.
redeem (GET, только cdn-хост): атомарно забирает токен (одноразовый), проверяет uid/UA,
       создаёт обычную HttpOnly-сессию Django на cdn и редиректит на безопасный next.
Пишет строку в cdn-users.log с reason=<reason>. Ставит серверный флаг предпочтения cdn на 7 дней.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model, login
from django.core.cache import cache
from django.utils import timezone as dj_tz
from django.http import HttpResponseRedirect, JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from Generator import cdn_users

log = logging.getLogger(__name__)

CDN_ORIGIN = "https://app.itflux-academy.ru"  # r110: новые переносы на app; cdn продолжает работать
PREF_TTL = 7 * 24 * 3600
ALLOWED_REASONS = {"call_drops", "join_timeout", "pinned", "slow_load"}  # r111 slow_load: index.html
_VERSION_PARAM = re.compile(r"(^|&)_itflux_v=[^&]*")


def ttl() -> int:
    return int(getattr(settings, "CDN_HANDOFF_TTL", 60))


def _key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _ua_hash(request) -> str:
    return hashlib.sha256((request.META.get("HTTP_USER_AGENT") or "").encode()).hexdigest()[:32]


def safe_next(value) -> str:
    """Только относительный путь сайта, без _itflux_v и без вложенных next."""
    if not isinstance(value, str):
        return "/cabinet/"
    v = value.strip()
    if not v.startswith("/") or v.startswith("//") or "\\" in v or "://" in v or len(v) > 1000:
        return "/cabinet/"
    path, _, query = v.partition("?")
    query, _, frag = query.partition("#")
    query = _VERSION_PARAM.sub("", query).lstrip("&")
    query = "&".join(p for p in query.split("&") if p and not p.startswith("itflux_nocdn="))
    return path + ("?" + query if query else "") + ("#" + frag if frag else "")


def set_pref(user, reason: str) -> None:
    from Cabinet.cdn_handoff_models import CdnPreference
    if CdnPreference.objects.filter(user=user, reason="pinned").exists():
        return  # закреплён вручную (pin_cdn_user) — не понижаем до 7 дней
    CdnPreference.objects.update_or_create(
        user=user, defaults={"reason": reason, "until": dj_tz.now() + timedelta(seconds=PREF_TTL)})


def prefers_cdn(user) -> bool:
    if not (user and getattr(user, "is_authenticated", False)):
        return False
    from Cabinet.cdn_handoff_models import CdnPreference
    return CdnPreference.objects.filter(user=user, until__gt=dj_tz.now()).exists()


def log_switch(request, user, reason: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = (f"{ts} uid={user.pk} role={cdn_users.user_role(user)} ip={cdn_users.client_ip(request)} "
            f"ua=\"{cdn_users.short_ua(request.META.get('HTTP_USER_AGENT', ''))}\" reason={reason}\n")
    try:
        with cdn_users._lock, open(cdn_users.log_path(), "a", encoding="utf-8") as fh:
            fh.write(line)
    except OSError as exc:
        log.warning("cdn-users log write failed: %s", exc)


SWITCH_REASONS = {"call_drops", "join_timeout"}


def record_switch(request, user, reason: str, via: str, token: str = ""):
    """r95: серверная запись автоперехода (не для pinned). Ошибка записи не ломает перенос."""
    if reason not in SWITCH_REASONS:
        return None
    from Cabinet.cdn_handoff_models import CdnSwitchEvent
    try:
        return CdnSwitchEvent.objects.create(
            user=user, reason=reason, via=via, route_from="direct", route_to="cdn",
            ua_family=cdn_users.short_ua(request.META.get("HTTP_USER_AGENT", ""))[:40],
            token_hash=_key(token) if token else "")
    except Exception as exc:  # noqa: BLE001
        log.warning("cdn switch event write failed: %s", exc)
        return None


def issue_token(request, user, next_path: str, reason: str) -> str:
    from Cabinet.cdn_handoff_models import CdnHandoffToken
    token = secrets.token_urlsafe(32)
    now = dj_tz.now()
    CdnHandoffToken.objects.filter(expires_at__lt=now - timedelta(hours=1)).delete()  # уборка
    CdnHandoffToken.objects.create(token_hash=_key(token), user=user, ua_hash=_ua_hash(request),
                                   next_path=safe_next(next_path), reason=reason,
                                   expires_at=now + timedelta(seconds=ttl()))
    return token


def consume_token(token: str):
    """Атомарно: значение возвращается ровно одному вызывающему."""
    if not token or len(token) > 100:
        return None
    from Cabinet.cdn_handoff_models import CdnHandoffToken
    now = dj_tz.now()
    # атомарный UPDATE ... WHERE used_at IS NULL: выигрывает ровно один запрос
    won = CdnHandoffToken.objects.filter(token_hash=_key(token), used_at__isnull=True,
                                         expires_at__gt=now).update(used_at=now)
    if won != 1:
        return None
    t = CdnHandoffToken.objects.get(token_hash=_key(token))
    try:
        from Cabinet.cdn_handoff_models import CdnSwitchEvent
        CdnSwitchEvent.objects.filter(token_hash=t.token_hash, redeemed_at__isnull=True).update(redeemed_at=now)
    except Exception as exc:  # noqa: BLE001
        log.warning("cdn switch redeem mark failed: %s", exc)
    return {"uid": t.user_id, "next": t.next_path, "reason": t.reason, "ua": t.ua_hash}


@never_cache
@require_POST
def api_issue(request):
    user = request.user
    if not user.is_authenticated:
        return JsonResponse({"error": "auth"}, status=401)
    if cdn_users.is_cdn(request):
        return JsonResponse({"error": "already_cdn"}, status=400)
    try:
        body = json.loads(request.body or b"{}")
    except ValueError:
        body = {}
    reason = body.get("reason") if body.get("reason") in ALLOWED_REASONS else "call_drops"
    # не больше 5 токенов в минуту на пользователя
    rk = f"r93:cdnh:rate:{user.pk}"
    cache.add(rk, 0, 60)
    try:
        if cache.incr(rk) > 5:
            return JsonResponse({"error": "rate"}, status=429)
    except ValueError:
        pass
    if reason == "pinned" and not prefers_cdn(user):
        return JsonResponse({"error": "not_pinned"}, status=403)
    token = issue_token(request, user, body.get("next") or "/cabinet/", reason)
    if reason not in ("pinned", "slow_load"):
        set_pref(user, reason)
    log_switch(request, user, reason)
    record_switch(request, user, reason, "token", token)
    url = f"{CDN_ORIGIN}/api/cdn-handoff/redeem/?" + urlencode({"t": token})
    return JsonResponse({"url": url, "ttl": ttl()})


def _fail(next_path: str):
    resp = HttpResponseRedirect("/cabinet/login?" + urlencode({"next": safe_next(next_path)}))
    resp["Referrer-Policy"] = "no-referrer"
    return resp


@never_cache
@require_GET
def api_redeem(request):
    if not cdn_users.is_cdn(request):
        return JsonResponse({"error": "cdn_only"}, status=400)
    data = consume_token(request.GET.get("t", ""))
    if not data:
        return _fail("/cabinet/")
    nxt = data.get("next") or "/cabinet/"
    if data.get("ua") != _ua_hash(request):
        return _fail(nxt)
    cur = request.user
    if cur.is_authenticated and cur.pk != data["uid"]:
        return _fail(nxt)  # чужая сессия на cdn — не подменяем
    user = get_user_model().objects.filter(pk=data["uid"], is_active=True).first()
    if user is None:
        return _fail(nxt)
    if not cur.is_authenticated:
        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    sep = "&" if "?" in nxt.split("#")[0] else "?"
    path, hsh, frag = nxt.partition("#")
    resp = HttpResponseRedirect(f"{path}{sep}itflux_cdn={data.get('reason', 'call_drops')}{hsh}{frag}")
    resp["Referrer-Policy"] = "no-referrer"
    return resp


@never_cache
@require_GET
def api_pref(request):
    pref = prefers_cdn(request.user)
    reason = ""
    if pref:
        from Cabinet.cdn_handoff_models import CdnPreference
        reason = CdnPreference.objects.filter(user=request.user).values_list("reason", flat=True).first() or ""
    return JsonResponse({"prefer_cdn": pref, "reason": reason})


@csrf_exempt
@never_cache
@require_POST
def api_event(request):
    """r95: переход без токена (основной хост не ответил) — клиент сообщает с cdn после входа.

    r97: csrf_exempt — на cdn страница с no-referrer, Django отклонял POST «no Referer».
    Безопасно: эндпоинт только пишет одну строку журнала (whitelist reason, 1/мин на юзера),
    требует сессию, только хост cdn, только JSON (не simple-request формы), чужой Origin → 403.
    """
    user = request.user
    if not user.is_authenticated:
        return JsonResponse({"error": "auth"}, status=401)
    if not cdn_users.is_cdn(request):
        return JsonResponse({"error": "cdn_only"}, status=400)
    origin = request.headers.get("Origin")
    if origin and origin.rstrip("/") != f"https://{request.get_host()}":
        return JsonResponse({"error": "origin"}, status=403)
    if not (request.content_type or "").startswith("application/json"):
        return JsonResponse({"error": "content_type"}, status=415)
    try:
        body = json.loads(request.body or b"{}")
    except ValueError:
        body = {}
    reason = body.get("reason") if isinstance(body, dict) else None
    if reason not in SWITCH_REASONS:
        return JsonResponse({"error": "reason"}, status=400)
    rk = f"r95:cdnsw:rate:{user.pk}"
    if not cache.add(rk, 1, 60):  # не больше 1 в минуту
        return JsonResponse({"ok": True, "dedup": True})
    log_switch(request, user, reason + "_fb")
    ev = record_switch(request, user, reason, "fallback")
    return JsonResponse({"ok": bool(ev)})
