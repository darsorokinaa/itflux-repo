"""r36: вход через Яндекс ID и VK ID (OAuth 2.0 / VK ID OAuth 2.1 + PKCE).

Включается переменными окружения:
  YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET
  VKID_APP_ID, VKID_APP_SECRET (секрет для веб-потока VK ID с PKCE не обязателен)
Пока переменные не заданы — /providers/ отдаёт false и кнопки скрыты.
"""
import base64
import hashlib
import logging
import os
import secrets
from urllib.parse import urlencode

import requests
from django.contrib.auth import get_user_model, login
from django.db import transaction
from django.http import HttpResponseRedirect, JsonResponse
from django.views.decorators.http import require_http_methods

from .models import Profile, SocialAccount

logger = logging.getLogger(__name__)
User = get_user_model()

SITE_ORIGIN = os.environ.get("ITFLUX_OAUTH_ORIGIN", "https://itflux-academy.ru").rstrip("/")
TIMEOUT = 10


def _cfg(provider):
    if provider == "yandex":
        cid, sec = os.environ.get("YANDEX_CLIENT_ID", ""), os.environ.get("YANDEX_CLIENT_SECRET", "")
        return (cid, sec) if cid and sec else None
    if provider == "vk":
        cid = os.environ.get("VKID_APP_ID", "")
        return (cid, os.environ.get("VKID_APP_SECRET", "")) if cid else None
    return None


def redirect_uri(provider):
    return f"{SITE_ORIGIN}/api/cabinet/oauth/{provider}/callback/"


def _safe_next(value):
    v = str(value or "")
    if v.startswith("/") and not v.startswith("//") and "\\" not in v:
        return v[:500]
    return "/cabinet"


def _fail(msg):
    return HttpResponseRedirect("/cabinet/login?" + urlencode({"oauth_error": msg}))


@require_http_methods(["GET"])
def oauth_providers(request):
    return JsonResponse({"yandex": bool(_cfg("yandex")), "vk": bool(_cfg("vk"))})


@require_http_methods(["GET"])
def oauth_start(request, provider):
    cfg = _cfg(provider)
    if not cfg:
        return _fail("Вход через этот сервис пока не настроен")
    # state хранится в сессии — начинать вход нужно на том же домене, что и redirect_uri.
    site_host = SITE_ORIGIN.split("://", 1)[1]
    if request.get_host() != site_host:
        return HttpResponseRedirect(f"{SITE_ORIGIN}{request.get_full_path()}")
    state = secrets.token_urlsafe(24)
    role = request.GET.get("role")
    request.session["oauth_ctx"] = {
        "provider": provider,
        "state": state,
        "next": _safe_next(request.GET.get("next")),
        # r91: роль задаётся только явно (страница регистрации). Без неё новый email -> экран выбора роли.
        "role": role if role in (Profile.Role.TEACHER, Profile.Role.STUDENT) else "",
        # r52: галочки со страницы регистрации (ПД — обязательно, реклама — по желанию).
        "pd": request.GET.get("pd") == "1",
        "mkt": request.GET.get("mkt") == "1",
    }
    if provider == "yandex":
        q = {"response_type": "code", "client_id": cfg[0], "redirect_uri": redirect_uri(provider),
             "state": state, "force_confirm": "no"}
        return HttpResponseRedirect("https://oauth.yandex.ru/authorize?" + urlencode(q))
    verifier = secrets.token_urlsafe(48)
    request.session["oauth_ctx"]["verifier"] = verifier
    request.session.modified = True
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    q = {"response_type": "code", "client_id": cfg[0], "redirect_uri": redirect_uri(provider), "state": state,
         "scope": "email", "code_challenge": challenge, "code_challenge_method": "S256"}
    return HttpResponseRedirect("https://id.vk.com/authorize?" + urlencode(q))


def _yandex_identity(cfg, code):
    tok = requests.post("https://oauth.yandex.ru/token", timeout=TIMEOUT, data={
        "grant_type": "authorization_code", "code": code, "client_id": cfg[0], "client_secret": cfg[1]})
    tok.raise_for_status()
    access = tok.json()["access_token"]
    info = requests.get("https://login.yandex.ru/info", params={"format": "json"}, timeout=TIMEOUT,
                        headers={"Authorization": f"OAuth {access}"})
    info.raise_for_status()
    d = info.json()
    return {"uid": str(d["id"]), "email": (d.get("default_email") or "").lower(),
            "first_name": d.get("first_name") or "", "last_name": d.get("last_name") or ""}


def _vk_identity(cfg, code, device_id, state, verifier):
    data = {"grant_type": "authorization_code", "code": code, "code_verifier": verifier, "client_id": cfg[0],
            "device_id": device_id, "redirect_uri": redirect_uri("vk"), "state": state}
    if cfg[1]:
        data["client_secret"] = cfg[1]
    tok = requests.post("https://id.vk.com/oauth2/auth", data=data, timeout=TIMEOUT)
    tok.raise_for_status()
    t = tok.json()
    if "access_token" not in t:
        raise ValueError(f"vk token error: {t.get('error')}")
    info = requests.post("https://id.vk.com/oauth2/user_info", timeout=TIMEOUT,
                         data={"client_id": cfg[0], "access_token": t["access_token"]})
    info.raise_for_status()
    u = info.json().get("user") or {}
    return {"uid": str(u.get("user_id") or t.get("user_id")), "email": (u.get("email") or t.get("email") or "").lower(),
            "first_name": u.get("first_name") or "", "last_name": u.get("last_name") or ""}


def _unique_username(base):
    base = "".join(ch for ch in (base or "user") if ch.isalnum() or ch in "._-")[:30] or "user"
    name, i = base, 1
    while User.objects.filter(username__iexact=name).exists():
        name = f"{base}{i}"
        i += 1
    return name


@require_http_methods(["GET"])
def oauth_callback(request, provider):
    cfg = _cfg(provider)
    ctx = request.session.pop("oauth_ctx", None) or {}
    if not cfg or ctx.get("provider") != provider:
        return _fail("Сессия входа устарела, попробуйте ещё раз")
    if request.GET.get("error"):
        return _fail("Вход отменён")
    if not secrets.compare_digest(str(request.GET.get("state") or ""), str(ctx.get("state") or "")):
        return _fail("Неверный параметр state, попробуйте ещё раз")
    code = request.GET.get("code") or ""
    try:
        if provider == "yandex":
            ident = _yandex_identity(cfg, code)
        else:
            ident = _vk_identity(cfg, code, request.GET.get("device_id") or "", ctx["state"], ctx.get("verifier") or "")
    except Exception:
        logger.exception("oauth %s exchange failed", provider)
        return _fail("Не удалось получить данные от сервиса входа")
    if not ident.get("uid") or ident["uid"] == "None":
        return _fail("Сервис входа не вернул идентификатор пользователя")

    with transaction.atomic():
        acc = SocialAccount.objects.select_related("user").filter(provider=provider, uid=ident["uid"]).first()
        if acc:
            user = acc.user
        else:
            user = User.objects.filter(email__iexact=ident["email"]).first() if ident["email"] else None
            if user is None:
                role = ctx.get("role") or ""
                if role not in (Profile.Role.TEACHER, Profile.Role.STUDENT):
                    # r91: не создаём молча аккаунт учителя — сначала выбор «ученик / преподаватель».
                    from .r91_oauth import stash_pending

                    stash_pending(request, provider, ident, ctx)
                    return HttpResponseRedirect("/cabinet/oauth/role?" + urlencode({"next": ctx.get("next") or "/cabinet"}))
                user = create_oauth_user(provider, ident, role, request)
            SocialAccount.objects.create(user=user, provider=provider, uid=ident["uid"], email=ident["email"])

    err = finish_login(request, user, provider, ctx)
    if err:
        return _fail(err)
    return HttpResponseRedirect(ctx.get("next") or "/cabinet")


def create_oauth_user(provider, ident, role, request):
    user = User.objects.create_user(
        username=_unique_username((ident["email"].split("@")[0] if ident["email"] else f"{provider}{ident['uid']}")),
        email=ident["email"],
    )
    user.set_unusable_password()
    user.save(update_fields=["password"])
    profile = user.profile
    profile.name = (ident.get("first_name") or "")[:100]
    profile.surname = (ident.get("last_name") or "")[:100]
    profile.role = role
    profile.save(update_fields=["name", "surname", "role"])
    if profile.role == Profile.Role.TEACHER:
        try:
            from .activation_events import TEACHER_REGISTERED, record_event
            record_event(TEACHER_REGISTERED, user, source=f"oauth_{provider}", request=request)
        except Exception:
            pass
    return user


def finish_login(request, user, provider, ctx):
    """Проверки профиля + login + согласия. Возвращает текст ошибки или None."""
    try:
        profile = user.profile
    except Profile.DoesNotExist:
        return "У этой учётной записи нет профиля кабинета"
    if profile.account_blocked:
        return "Аккаунт заблокирован"
    if not profile.account_active:
        return "Аккаунт неактивен"
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    logger.info("oauth login provider=%s user=%s", provider, user.id)
    try:
        from .r52_consent import grant_marketing, grant_pd, has_pd_consent, has_promo_consent

        if ctx.get("pd") and not has_pd_consent(user):
            grant_pd(user, source=f"registration_{provider}", request=request)
        if ctx.get("mkt") and not has_promo_consent(user, "email_marketing"):
            grant_marketing(user, "email_marketing", source=f"registration_{provider}", request=request)
    except Exception:
        logger.exception("r52 oauth consent failed user=%s", user.id)
    return None
