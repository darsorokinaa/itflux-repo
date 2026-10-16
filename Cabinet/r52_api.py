"""r52: API согласий (ПД, реклама, double opt-in, отписка от рекламы)."""

from __future__ import annotations

import logging
from html import escape

from django.core import signing
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


def _page(title: str, body_html: str, status: int = 200) -> HttpResponse:
    html = (
        "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'>"
        f"<title>{escape(title)}</title><body style='font-family:system-ui;max-width:560px;margin:60px auto;"
        f"padding:0 16px;line-height:1.5'><h1>{escape(title)}</h1>{body_html}"
        "<p><a href='/'>На главную «Цифрового потока»</a></p></body>"
    )
    return HttpResponse(html, status=status, content_type="text/html; charset=utf-8")


class ConsentTextView(APIView):
    """Тексты документов из единого источника (для страниц /personal-data-consent и т. п.)."""

    permission_classes = [AllowAny]

    def get(self, request, version: str):
        from messaging.consent_texts import (
            MARKETING_CONSENT_V1,
            PD_CONSENT_V1,
            UnknownConsentVersion,
            consent_snapshot,
        )

        if version not in (PD_CONSENT_V1, MARKETING_CONSENT_V1):
            return Response({"detail": "not found"}, status=404)
        try:
            d, digest = consent_snapshot(version)
        except UnknownConsentVersion:
            return Response({"detail": "not found"}, status=404)
        return Response(dict(d, sha256=digest))


class ConsentStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .r52_consent import consent_status

        return Response(consent_status(request.user))


class ConsentStepView(APIView):
    """Шаг согласия при первом входе (OAuth): ПД обязательно, реклама — по желанию."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .r52_consent import grant_marketing, grant_pd

        data = request.data or {}
        if not data.get("pd"):
            return Response({"ok": False, "error": "Нужно согласие на обработку персональных данных"}, status=400)
        grant_pd(request.user, source="first_login_step", request=request)
        if data.get("marketing_email"):
            grant_marketing(request.user, "email_marketing", source="first_login_step", request=request)
        return Response({"ok": True})


class MarketingPromptView(APIView):
    """Баннер «Подписаться на новости и акции» (MARKETING_PROMPT_V1)."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from messaging.services import record_prompt_decision

        from .r52_consent import consent_status, grant_marketing, request_email_optin

        data = request.data or {}
        action = data.get("action")
        from .r52_consent import _client

        ip, ua = _client(request)
        if action == "dismiss":
            record_prompt_decision(user=request.user, email_opt_in=False, inapp_opt_in=False,
                                   source="cabinet_banner", ip_address=ip, user_agent=ua)
            return Response(consent_status(request.user))
        if action != "subscribe":
            return Response({"ok": False}, status=400)
        want_email = bool(data.get("email"))
        want_inapp = bool(data.get("inapp"))
        if not (want_email or want_inapp):
            return Response({"ok": False, "error": "Отметьте хотя бы один канал"}, status=400)
        # e-mail — только после подтверждения по ссылке (double opt-in); в кабинете — сразу.
        record_prompt_decision(user=request.user, email_opt_in=False, inapp_opt_in=want_inapp,
                               source="cabinet_banner", ip_address=ip, user_agent=ua)
        sent = False
        if want_email:
            try:
                sent = request_email_optin(request.user, request=request).get("ok", False)
            except Exception:
                logger.exception("r52 optin email failed user=%s", request.user.pk)
                return Response({"ok": False, "error": "Не удалось отправить письмо, попробуйте позже"}, status=502)
        out = consent_status(request.user)
        out["confirmation_sent"] = sent
        return Response(out)


class MarketingSettingsView(APIView):
    """Настройки уведомлений: включить/выключить рекламные рассылки."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .r52_consent import consent_status, grant_marketing, request_email_optin, revoke_marketing

        data = request.data or {}
        channel = data.get("channel")
        if channel not in ("email_marketing", "inapp_marketing"):
            return Response({"ok": False}, status=400)
        enabled = bool(data.get("enabled"))
        out_extra = {}
        if not enabled:
            revoke_marketing(request.user, channel, source="settings", request=request)
        elif channel == "inapp_marketing":
            grant_marketing(request.user, channel, source="settings", request=request)
        else:
            try:
                out_extra["confirmation_sent"] = request_email_optin(request.user, request=request, source="settings").get("ok")
            except Exception:
                logger.exception("r52 optin email failed user=%s", request.user.pk)
                return Response({"ok": False, "error": "Не удалось отправить письмо"}, status=502)
        out = consent_status(request.user)
        out.update(out_extra)
        return Response(out)


@csrf_exempt
def marketing_confirm_view(request, token: str):
    """Шаг 2 double opt-in. GET показывает кнопку (чтобы сканеры ссылок не подтверждали за человека), POST — подтверждает."""
    from django.contrib.auth.models import User

    from .r52_consent import OPTIN_MAX_AGE, grant_marketing, read_optin_token

    try:
        data = read_optin_token(token)
    except signing.SignatureExpired:
        return _page("Ссылка устарела", "<p>Подпишитесь заново в кабинете — мы пришлём новое письмо.</p>", 400)
    except signing.BadSignature:
        return _page("Ссылка недействительна", "<p>Проверьте ссылку из письма.</p>", 400)
    user = User.objects.filter(pk=data.get("u")).first()
    if not user:
        return _page("Ссылка недействительна", "", 400)
    if request.method == "POST":
        grant_marketing(user, "email_marketing", source="email_double_optin", request=request)
        return _page("Подписка подтверждена", "<p>Спасибо! Новости и предложения «Цифрового потока» будут приходить на "
                     f"{escape(user.email)}. Отписаться можно в любой момент — ссылкой в письме или в настройках уведомлений.</p>")
    return _page(
        "Подтвердите подписку",
        f"<p>Подтвердите, что хотите получать новости, специальные предложения и промокоды «Цифрового потока» на {escape(user.email)}.</p>"
        f"<form method='post'><button type='submit' style='padding:12px 22px;background:#4f46e5;color:#fff;border:0;"
        "border-radius:10px;font-weight:600;font-size:16px;cursor:pointer'>Подтвердить подписку</button></form>",
    )


@csrf_exempt
def marketing_unsubscribe_view(request, token: str):
    """Отписка от рекламы одной ссылкой (и List-Unsubscribe-Post). Служебные письма о подписке не затрагиваются."""
    from django.contrib.auth.models import User

    from .r52_consent import read_marketing_unsubscribe_token, revoke_marketing

    try:
        data = read_marketing_unsubscribe_token(token)
    except signing.BadSignature:
        return _page("Ссылка недействительна", "", 400)
    user = User.objects.filter(pk=data.get("u")).first()
    if user:
        revoke_marketing(user, "email_marketing", source="email_unsubscribe_link", request=request)
    return _page("Вы отписались от рекламных писем",
                 "<p>Новости, акции и промокоды больше не будут приходить на этот адрес. Служебные письма о работе "
                 "аккаунта и сроке подписки приходят отдельно — от них можно отписаться ссылкой в таком письме.</p>")
