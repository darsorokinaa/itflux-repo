import logging
import re
import time

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TELEMOST_API_URL = "https://cloud-api.yandex.net/v1/telemost-api/conferences"
YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token"
ORG_RESTRICTED_ERROR = "ApiRestrictedToOrganizations"
DEFAULT_REDIRECT_URI = "https://oauth.yandex.ru/verification_code"
TELEMOST_JOIN_URL_RE = re.compile(
    r"^https://telemost(?:\.360)?\.yandex\.(ru|com)/j/[A-Za-z0-9_-]+/?(\?.*)?$",
    re.IGNORECASE,
)
_TELEMOST_360_HOST_RE = re.compile(
    r"^(https://)telemost\.360\.(yandex\.(?:ru|com)/j/)",
    re.IGNORECASE,
)

_ERROR_MESSAGES = {
    "ApiRestrictedToOrganizations": (
        "Автоматическое создание встречи доступно только в Яндекс 360 для бизнеса "
        "(корпоративный домен организации). Получите OAuth-токен под аккаунтом организации "
        "или подключите приложение «Цифровой поток» как сервисное в админке Яндекс 360."
    ),
    "PaymentRequiredToUseLiveStreams": "Трансляция недоступна на вашем тарифе.",
    "NoSuchUserPrincipalsFound": "Указан некорректный email соорганизатора.",
}

_token_cache = {"value": "", "expires_at": 0.0}
_org_api_blocked = False


def telemost_auto_create_enabled():
    return getattr(settings, "YANDEX_TELEMOST_AUTO_CREATE", True)


def telemost_manual_link_hint():
    return "Добавьте ссылку https://telemost.yandex.ru/j/… в карточке урока."


def normalize_telemost_url(url):
    text = str(url or "").strip()
    if not text:
        return text
    return _TELEMOST_360_HOST_RE.sub(r"\1telemost.\2", text)


def is_telemost_meeting_url(url):
    return bool(url and TELEMOST_JOIN_URL_RE.match(str(url).strip()))


def _redirect_uri():
    return (getattr(settings, "YANDEX_TELEMOST_REDIRECT_URI", "") or DEFAULT_REDIRECT_URI).strip()


def _oauth_scope_param():
    """Права из env; в URL Яндекс ждёт список через запятую. Пусто — не передаём scope."""
    raw = (getattr(settings, "YANDEX_OAUTH_SCOPES", "") or "").strip()
    if not raw:
        return ""
    parts = [part.strip() for part in raw.replace(",", " ").split() if part.strip()]
    return ",".join(parts)


def telemost_authorize_code_url():
    client_id = settings.YANDEX_TELEMOST_CLIENT_ID
    if not client_id:
        return None
    redirect_uri = _redirect_uri()
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "force_confirm": "yes",
    }
    scope = _oauth_scope_param()
    if scope:
        params["scope"] = scope
    query = "&".join(f"{key}={requests.utils.quote(str(value), safe='')}" for key, value in params.items())
    return f"https://oauth.yandex.ru/authorize?{query}"


def telemost_authorize_url():
    """Основная ссылка авторизации — через verification_code (как в OAuth-приложении)."""
    return telemost_authorize_code_url()


def _cache_token(token, expires_in=None):
    ttl = int(expires_in or 3600)
    _token_cache["value"] = token
    _token_cache["expires_at"] = time.time() + max(ttl - 60, 60)


def _post_yandex_token(data):
    client_id = settings.YANDEX_TELEMOST_CLIENT_ID
    client_secret = settings.YANDEX_TELEMOST_CLIENT_SECRET
    if not client_id or not client_secret:
        return None, "Не заданы Client ID или Client secret Телемоста."

    try:
        response = requests.post(YANDEX_TOKEN_URL, data=data, timeout=15)
    except requests.RequestException as exc:
        logger.exception("Yandex OAuth token request failed")
        return None, f"Не удалось получить OAuth-токен: {exc}"

    try:
        body = response.json()
    except ValueError:
        body = {}

    if response.ok and body.get("access_token"):
        token = body["access_token"]
        _cache_token(token, body.get("expires_in"))
        return token, None

    error = body.get("error_description") or body.get("error") or f"HTTP {response.status_code}"
    return None, error


def _token_from_auth_code():
    code = (settings.YANDEX_TELEMOST_AUTH_CODE or "").strip()
    if not code:
        return None, None

    return _post_yandex_token({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": settings.YANDEX_TELEMOST_CLIENT_ID,
        "client_secret": settings.YANDEX_TELEMOST_CLIENT_SECRET,
        "redirect_uri": _redirect_uri(),
    })


def _token_from_refresh():
    refresh = (getattr(settings, "YANDEX_TELEMOST_REFRESH_TOKEN", "") or "").strip()
    if not refresh:
        return None, None

    return _post_yandex_token({
        "grant_type": "refresh_token",
        "refresh_token": refresh,
        "client_id": settings.YANDEX_TELEMOST_CLIENT_ID,
        "client_secret": settings.YANDEX_TELEMOST_CLIENT_SECRET,
    })


def _token_from_service_exchange():
    email = (settings.YANDEX_TELEMOST_COHOST_EMAIL or "").strip()
    if not email:
        return None, None

    return _post_yandex_token({
        "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
        "client_id": settings.YANDEX_TELEMOST_CLIENT_ID,
        "client_secret": settings.YANDEX_TELEMOST_CLIENT_SECRET,
        "subject_token": email,
        "subject_token_type": "urn:yandex:params:oauth:token-type:email",
    })


def resolve_telemost_oauth_token(*, force_refresh=False):
    if not force_refresh:
        explicit = (settings.YANDEX_TELEMOST_OAUTH_TOKEN or "").strip()
        if explicit:
            return explicit, None

        if _token_cache["value"] and _token_cache["expires_at"] > time.time():
            return _token_cache["value"], None

    token, error = _token_from_refresh()
    if token:
        return token, None

    token, error = _token_from_auth_code()
    if token:
        return token, None

    token, exchange_error = _token_from_service_exchange()
    if token:
        return token, None

    if not force_refresh:
        explicit = (settings.YANDEX_TELEMOST_OAUTH_TOKEN or "").strip()
        if explicit:
            return explicit, None

    if error or exchange_error:
        hint = (
            "Не удалось автоматически получить OAuth-токен Телемоста. "
            "Откройте ссылку авторизации, скопируйте код в YANDEX_TELEMOST_AUTH_CODE "
            "или access_token в YANDEX_TELEMOST_OAUTH_TOKEN."
        )
        authorize_url = telemost_authorize_code_url()
        if authorize_url:
            hint = f"{hint} {authorize_url}"
        return None, hint

    return None, "Телемост не настроен."


def telemost_is_configured():
    if (settings.YANDEX_TELEMOST_OAUTH_TOKEN or "").strip():
        return True
    if (getattr(settings, "YANDEX_TELEMOST_REFRESH_TOKEN", "") or "").strip():
        return True
    if (settings.YANDEX_TELEMOST_AUTH_CODE or "").strip():
        return True
    return bool(settings.YANDEX_TELEMOST_CLIENT_ID and settings.YANDEX_TELEMOST_CLIENT_SECRET)


def _request_conference(token, payload):
    return requests.post(
        TELEMOST_API_URL,
        headers={
            "Authorization": f"OAuth {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20,
    )


def _parse_api_error(response):
    try:
        body = response.json()
        code = body.get("error") or body.get("message") or ""
    except ValueError:
        body = {}
        code = ""

    message = _ERROR_MESSAGES.get(code)
    if not message:
        if response.status_code in (401, 403) and code != ORG_RESTRICTED_ERROR:
            message = "OAuth-токен Телемоста недействителен или просрочен."
        else:
            message = code or f"Ошибка Телемоста (HTTP {response.status_code})."

    return code, message, body


def create_telemost_conference(*, cohost_email=None):
    global _org_api_blocked

    if _org_api_blocked:
        return None, _ERROR_MESSAGES[ORG_RESTRICTED_ERROR]

    email = (cohost_email or settings.YANDEX_TELEMOST_COHOST_EMAIL or "").strip()
    payloads = [{"waiting_room_level": "PUBLIC"}]
    if email:
        payloads.append({"waiting_room_level": "PUBLIC", "cohosts": [{"email": email}]})

    last_error = "Не удалось создать встречу в Телемосте."
    refreshed = False

    for attempt in range(2):
        token, error = resolve_telemost_oauth_token(force_refresh=refreshed)
        if not token:
            return None, error or "Телемост не настроен."

        for payload in payloads:
            try:
                response = _request_conference(token, payload)
            except requests.RequestException as exc:
                logger.exception("Telemost API request failed")
                return None, f"Не удалось связаться с API Телемоста: {exc}"

            if response.status_code == 201:
                data = response.json()
                join_url = (data.get("join_url") or "").strip()
                if is_telemost_meeting_url(join_url):
                    return {
                        "id": data.get("id"),
                        "join_url": join_url,
                    }, None
                return None, "Телемост не вернул ссылку на встречу."

            code, message, body = _parse_api_error(response)
            last_error = message
            logger.warning(
                "Telemost API error %s (payload=%s): %s",
                response.status_code,
                payload,
                body or response.text,
            )

            if response.status_code in (401, 403) and not refreshed:
                _token_cache["value"] = ""
                _token_cache["expires_at"] = 0.0
                refreshed = True
                break

            if code == "NoSuchUserPrincipalsFound" and "cohosts" in payload:
                continue

            if code == ORG_RESTRICTED_ERROR:
                _org_api_blocked = True
                return None, message

            if response.status_code in (401, 403):
                return None, message
        else:
            continue
        break

    return None, last_error


def create_telemost_link(*, title="", starts_at=None, ends_at=None, topic=""):
    """Создаёт ссылку Телемост: API (Яндекс 360) или CalDAV (X-TELEMOST-REQUIRED)."""
    if not telemost_auto_create_enabled():
        return None, telemost_manual_link_hint()

    platform_email = (
        getattr(settings, "YANDEX_TELEMOST_COHOST_EMAIL", "")
        or getattr(settings, "YANDEX_ACCOUNT_EMAIL", "")
        or ""
    ).strip() or None

    error = None
    if not _org_api_blocked:
        conference, error = create_telemost_conference(cohost_email=platform_email)
        if conference:
            join_url = normalize_telemost_url((conference.get("join_url") or "").strip())
            if is_telemost_meeting_url(join_url):
                return join_url, None

    allow_fallback = getattr(settings, "YANDEX_TELEMOST_ALLOW_WEB_FALLBACK", True)
    if allow_fallback and starts_at and ends_at:
        from .yandex_calendar import create_telemost_link_via_caldav

        link, cal_error = create_telemost_link_via_caldav(
            title=title or "Онлайн-урок",
            starts_at=starts_at,
            ends_at=ends_at,
            topic=topic,
        )
        if link:
            return normalize_telemost_url(link), None
        if cal_error:
            error = cal_error

    return None, error or "Не удалось создать ссылку на звонок в Телемосте."


def diagnose_telemost_config():
    """Проверка OAuth, API Телемоста и CalDAV для отладки Яндекс 360."""
    from .yandex_calendar import resolve_yandex_account_email

    account_email = (
        resolve_yandex_account_email()
        or getattr(settings, "YANDEX_ACCOUNT_EMAIL", "")
        or ""
    ).strip()
    platform_email = (
        getattr(settings, "YANDEX_TELEMOST_COHOST_EMAIL", "")
        or account_email
    ).strip()

    result = {
        "configured": telemost_is_configured(),
        "account_email": account_email or None,
        "platform_email": platform_email or None,
        "client_id": (settings.YANDEX_TELEMOST_CLIENT_ID or "").strip() or None,
        "has_oauth_token": bool((settings.YANDEX_TELEMOST_OAUTH_TOKEN or "").strip()),
        "has_refresh_token": bool((getattr(settings, "YANDEX_TELEMOST_REFRESH_TOKEN", "") or "").strip()),
        "has_auth_code": bool((settings.YANDEX_TELEMOST_AUTH_CODE or "").strip()),
        "has_client_secret": bool((settings.YANDEX_TELEMOST_CLIENT_SECRET or "").strip()),
        "caldav_fallback_enabled": getattr(settings, "YANDEX_TELEMOST_ALLOW_WEB_FALLBACK", True),
        "token_ok": False,
        "token_email": None,
        "api_test": None,
        "service_exchange": None,
        "authorize_url": telemost_authorize_code_url(),
        "next_steps": [],
    }

    token, token_error = resolve_telemost_oauth_token()
    if not token:
        result["token_error"] = token_error
        if not result["has_client_secret"]:
            result["next_steps"].append(
                "Задайте YANDEX_TELEMOST_CLIENT_SECRET (секрет приложения «Цифровой поток» в oauth.yandex.ru)."
            )
        result["next_steps"].append(
            f"Получите OAuth-токен: откройте authorize_url под {platform_email or 'аккаунтом организации'} "
            "и сохраните access_token в YANDEX_TELEMOST_OAUTH_TOKEN (или код в YANDEX_TELEMOST_AUTH_CODE)."
        )
        return result

    result["token_ok"] = True
    try:
        response = requests.get(
            "https://login.yandex.ru/info",
            params={"format": "json"},
            headers={"Authorization": f"OAuth {token}"},
            timeout=15,
        )
        if response.ok:
            info = response.json()
            result["token_email"] = (
                info.get("default_email")
                or (f"{info.get('login')}@yandex.ru" if info.get("login") else None)
            )
    except requests.RequestException:
        pass

    exchange_token, exchange_error = _token_from_service_exchange()
    result["service_exchange"] = {
        "ok": bool(exchange_token),
        "error": exchange_error,
    }
    if not exchange_token and exchange_error:
        result["next_steps"].append(
            "Подключите приложение «Цифровой поток» как сервисное в admin.yandex.ru → "
            "Безопасность → Сервисные приложения (Client ID: "
            f"{result['client_id']})."
        )

    try:
        response = _request_conference(token, {"waiting_room_level": "PUBLIC"})
        code, message, body = _parse_api_error(response)
        result["api_test"] = {
            "ok": response.status_code == 201,
            "status": response.status_code,
            "error_code": code or None,
            "message": message,
        }
        if code == ORG_RESTRICTED_ERROR:
            result["next_steps"].append(
                "Токен не от аккаунта Яндекс 360 для бизнеса. Получите новый токен под "
                f"{platform_email} после подключения сервисного приложения."
            )
    except requests.RequestException as exc:
        result["api_test"] = {"ok": False, "message": str(exc)}

    if not result["next_steps"] and result.get("api_test", {}).get("ok"):
        result["next_steps"].append("Всё настроено — автоматическое создание ссылок должно работать.")

    return result
