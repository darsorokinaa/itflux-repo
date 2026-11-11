"""Платформенные письма: один SMTP и один From из настроек окружения."""

from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner

logger = logging.getLogger(__name__)

CONFIRM_SALT = "itflux-email-confirm"
CONFIRM_MAX_AGE = 60 * 60 * 24 * 7


def public_site_origin(request=None) -> str:
    origin = (getattr(settings, "LK_PUBLIC_URL", "") or "").rstrip("/")
    if origin:
        return origin
    if request is not None:
        return request.build_absolute_uri("/").rstrip("/")
    return "https://itflux-academy.ru"


def mail_is_configured() -> bool:
    user = str(getattr(settings, "EMAIL_HOST_USER", "") or "").strip()
    return bool(user)


def make_confirmation_token(user) -> str:
    return TimestampSigner(salt=CONFIRM_SALT).sign(str(user.pk))


def user_from_confirmation_token(token: str):
    try:
        raw = TimestampSigner(salt=CONFIRM_SALT).unsign(str(token or ""), max_age=CONFIRM_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    if not str(raw).isdigit():
        return None
    return User.objects.filter(pk=int(raw)).first()


def confirmation_url(user, request=None) -> str:
    from urllib.parse import quote

    token = quote(make_confirmation_token(user), safe="")
    return f"{public_site_origin(request)}/api/cabinet/email-confirm/?token={token}"


def send_confirmation_email(user, request=None, *, force: bool = False) -> bool:
    email = (getattr(user, "email", "") or "").strip()
    if not email or (not force and not mail_is_configured()):
        return False
    url = confirmation_url(user, request)
    body = "\n".join(
        [
            "Здравствуйте!",
            "",
            "Подтвердите почту на платформе «Цифровой поток».",
            "Вход в кабинет доступен и без этого шага.",
            "",
            url,
            "",
            "Если вы не регистрировались, проигнорируйте письмо.",
        ]
    )
    try:
        sent = send_mail(
            subject="Подтверждение почты — Цифровой поток",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=False,
        )
    except Exception:
        logger.exception("confirmation email failed user=%s", getattr(user, "pk", None))
        return False
    return bool(sent)
