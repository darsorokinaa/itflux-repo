"""
r52: согласия по 38-ФЗ (ст. 18) и 152-ФЗ.

* Реклама (промокоды, скидки, акции) — только при добровольном согласии
  (MARKETING_CONSENT_V1+), не отозванном и полученном НЕ через обязательный шлюз сообщений.
* Отдельное согласие на обработку ПД (PD_CONSENT_V1) — при регистрации / первом входе.
* Double opt-in для e-mail из баннера кабинета, отписка от рекламы одной ссылкой.
"""

from __future__ import annotations

import logging
from datetime import datetime

from django.conf import settings
from django.core import signing
from django.utils import timezone

logger = logging.getLogger(__name__)

OPTIN_SALT = "r52-email-optin"
MKT_UNSUB_SALT = "r52-marketing-unsubscribe"
OPTIN_MAX_AGE = 60 * 60 * 24 * 7
GATE_SOURCES = frozenset({"messages_gate"})
# Пользователи, зарегистрированные после выката r52, без согласия на ПД видят шаг согласия.
R52_CUTOFF = datetime(2026, 10, 16, 18, 0, 0)
TEST_EMAIL = "itflux.academy@yandex.ru"


def _client(request):
    if request is None:
        return None, ""
    xff = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
    ip = xff or request.META.get("HTTP_X_REAL_IP") or request.META.get("REMOTE_ADDR") or None
    return ip, (request.META.get("HTTP_USER_AGENT") or "")[:300]


def _public_url() -> str:
    return (getattr(settings, "LK_PUBLIC_URL", "") or "https://itflux-academy.ru").rstrip("/")


# ── проверки ────────────────────────────────────────────────────────────────

def has_promo_consent(user, channel: str = "email_marketing") -> bool:
    """Можно ли отправлять рекламу в этот канал (email_marketing / inapp_marketing)."""
    from messaging.consent_texts import VOLUNTARY_MARKETING_VERSIONS
    from messaging.models import UserConsent

    if not getattr(user, "pk", None):
        return False
    row = UserConsent.objects.filter(user_id=user.pk, channel=channel).first()
    return bool(
        row
        and row.granted
        and row.consented_at
        and not row.revoked_at
        and row.consent_text_version in VOLUNTARY_MARKETING_VERSIONS
        and (row.source or "") not in GATE_SOURCES
    )


def has_pd_consent(user) -> bool:
    from messaging.consent_texts import PD_CONSENT_VERSIONS
    from messaging.models import UserConsent

    row = UserConsent.objects.filter(user_id=user.pk, channel="personal_data").first()
    if row and row.granted and not row.revoked_at and row.consent_text_version in PD_CONSENT_VERSIONS:
        return True
    from messaging.models import UserConsentLog

    return UserConsentLog.objects.filter(
        user_id=user.pk, channel="personal_data", action="granted", consent_text_version__in=PD_CONSENT_VERSIONS
    ).exists() and not (row and row.revoked_at)


def pd_consent_required(user) -> bool:
    cutoff = timezone.make_aware(R52_CUTOFF, timezone.get_current_timezone())
    return bool(user.date_joined and user.date_joined >= cutoff and not has_pd_consent(user))


def email_optin_pending(user) -> bool:
    from messaging.models import UserConsentLog

    last = UserConsentLog.objects.filter(user_id=user.pk, channel="email_marketing").order_by("-id").first()
    return bool(last and last.action == "requested" and (timezone.now() - last.created_at).total_seconds() < OPTIN_MAX_AGE)


# ── запись ──────────────────────────────────────────────────────────────────

def grant_pd(user, *, source: str, request=None):
    """Согласие на обработку ПД (отдельный документ). Шлюз сообщений его не перезаписывает."""
    from messaging.consent_texts import PD_CONSENT_V1, consent_snapshot
    from messaging.services import _grant_channel

    _defn, digest = consent_snapshot(PD_CONSENT_V1)
    ip, ua = _client(request)
    _grant_channel(user=user, channel="personal_data", version=PD_CONSENT_V1, digest=digest, source=source,
                   ip_address=ip, user_agent=ua, consent_type="personal_data")


def grant_marketing(user, channel: str, *, source: str, request=None, ip=None, ua=""):
    from messaging.consent_texts import MARKETING_CONSENT_V1, consent_snapshot
    from messaging.services import _grant_channel

    _defn, digest = consent_snapshot(MARKETING_CONSENT_V1)
    if request is not None:
        ip, ua = _client(request)
    _grant_channel(user=user, channel=channel, version=MARKETING_CONSENT_V1, digest=digest, source=source,
                   ip_address=ip, user_agent=ua, consent_type="marketing")


def _log(user, channel, action, version, digest, source, request=None):
    from messaging.models import UserConsentLog
    from messaging.retention import KIND_CONSENT_EVIDENCE, KIND_CONSENT_LOGS, retention_until_for

    ip, ua = _client(request)
    UserConsentLog.objects.create(
        user=user, consent_type="marketing", channel=channel, action=action,
        consent_text_version=version or "", text_sha256=digest or "", source=source,
        ip_address=ip, user_agent=ua,
        log_retention_until=retention_until_for(KIND_CONSENT_LOGS),
        evidence_retention_until=retention_until_for(KIND_CONSENT_EVIDENCE),
    )


def revoke_marketing(user, channel: str, *, source: str, request=None) -> bool:
    from messaging.models import UserConsent

    row = UserConsent.objects.filter(user=user, channel=channel).first()
    if not row or (not row.granted and row.revoked_at):
        return False
    row.granted = False
    row.revoked_at = timezone.now()
    row.save(update_fields=["granted", "revoked_at"])
    _log(user, channel, "revoked", row.consent_text_version, row.text_sha256, source, request)
    return True


# ── double opt-in ───────────────────────────────────────────────────────────

def make_optin_link(user) -> str:
    from messaging.consent_texts import MARKETING_CONSENT_V1

    token = signing.dumps({"u": user.pk, "v": MARKETING_CONSENT_V1}, salt=OPTIN_SALT, compress=True)
    return f"{_public_url()}/api/cabinet/r52/marketing/confirm/{token}/"


def read_optin_token(token: str) -> dict:
    return signing.loads(token, salt=OPTIN_SALT, max_age=OPTIN_MAX_AGE)


def make_marketing_unsubscribe_link(user) -> str:
    token = signing.dumps({"u": user.pk, "c": "email_marketing"}, salt=MKT_UNSUB_SALT)
    return f"{_public_url()}/api/cabinet/r52/marketing/unsubscribe/{token}/"


def read_marketing_unsubscribe_token(token: str) -> dict:
    return signing.loads(token, salt=MKT_UNSUB_SALT)


def optin_email(user) -> dict:
    from messaging.consent_texts import get_consent_definition

    d = get_consent_definition()
    link = make_optin_link(user)
    name = (getattr(getattr(user, "profile", None), "name", "") or user.first_name or "").strip() or user.username
    subject = "Подтвердите подписку на новости «Цифрового потока»"
    text = (
        f"Здравствуйте, {name}!\n\n"
        "Вы отметили в кабинете «Цифрового потока», что хотите получать новости и предложения на этот адрес. "
        "Чтобы подписка заработала, подтвердите её по ссылке (действует 7 дней):\n\n"
        f"{link}\n\n"
        f"Текст согласия: «{d['email_text']}»\n{d['note']}\n\n"
        "Если вы не подписывались — просто проигнорируйте это письмо, рассылки приходить не будут.\n\n"
        "—\n«Цифровой поток», itflux-academy.ru\n"
    )
    from html import escape

    html = (
        f"<p>Здравствуйте, {escape(name)}!</p>"
        "<p>Вы отметили в кабинете «Цифрового потока», что хотите получать новости и предложения на этот адрес. "
        "Чтобы подписка заработала, подтвердите её (ссылка действует 7 дней):</p>"
        f'<p><a href="{link}" style="display:inline-block;padding:12px 22px;background:#4f46e5;color:#fff;'
        'border-radius:10px;text-decoration:none;font-weight:600">Подтвердить подписку</a></p>'
        f'<p style="color:#555;font-size:13px">Текст согласия: «{escape(d["email_text"])}» {escape(d["note"])}</p>'
        "<p>Если вы не подписывались — просто проигнорируйте это письмо.</p>"
        '<hr><p style="color:#888;font-size:12px">«Цифровой поток», itflux-academy.ru</p>'
    )
    return {"subject": subject, "text": text, "html": html, "link": link}


def request_email_optin(user, *, request=None, source: str = "cabinet_banner", send_to: str | None = None) -> dict:
    """Шаг 1 double opt-in: письмо со ссылкой. Согласие появится только после перехода по ней."""
    from django.core.mail import EmailMultiAlternatives
    from messaging.consent_texts import MARKETING_CONSENT_V1, consent_snapshot

    to = send_to or user.email
    if not to:
        return {"ok": False, "error": "В аккаунте не указан e-mail"}
    _d, digest = consent_snapshot(MARKETING_CONSENT_V1)
    msg_data = optin_email(user)
    msg = EmailMultiAlternatives(subject=msg_data["subject"], body=msg_data["text"],
                                 from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None), to=[to])
    msg.attach_alternative(msg_data["html"], "text/html")
    msg.send(fail_silently=False)
    _log(user, "email_marketing", "requested", MARKETING_CONSENT_V1, digest, source, request)
    return {"ok": True, "pending": True}


def consent_status(user) -> dict:
    from messaging.models import ConsentPromptState
    from messaging.consent_texts import MARKETING_PROMPT_V1, get_consent_definition

    email_ok = has_promo_consent(user, "email_marketing")
    inapp_ok = has_promo_consent(user, "inapp_marketing")
    state = ConsentPromptState.objects.filter(user=user, prompt_key=MARKETING_PROMPT_V1).first()
    role = getattr(getattr(user, "profile", None), "role", "")
    pending = email_optin_pending(user)
    return {
        "pd_required": pd_consent_required(user),
        "marketing": {"email": email_ok, "inapp": inapp_ok, "email_pending": pending},
        "prompt": {
            "show": role == "teacher" and not email_ok and not pending and not (state and state.decided_at),
            "texts": get_consent_definition(),
        },
    }
