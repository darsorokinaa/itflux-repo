"""r50: API страницы тарифов (пробный период, «сэкономили», оплата по ссылке, отписка)."""

from __future__ import annotations

import hashlib
import logging

from django.core import signing
from django.http import HttpResponse, HttpResponseRedirect
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsCabinetTeacher

logger = logging.getLogger(__name__)


class PricingMeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        from .r50_tariffs import saved_time, trial_status

        user = request.user
        payload = {"authenticated": bool(user and user.is_authenticated), "is_teacher": False}
        if not payload["authenticated"]:
            return Response(payload)
        profile = getattr(user, "profile", None)
        is_teacher = bool(profile and profile.role == "teacher")
        payload["is_teacher"] = is_teacher
        if not is_teacher:
            return Response(payload)
        from .subscription_service import SubscriptionLimitService

        sub = SubscriptionLimitService.get_or_create_subscription(user)
        plan = SubscriptionLimitService.get_current_plan(user)
        payload["current_plan"] = plan.slug
        payload["current_plan_name"] = plan.name
        payload["subscription_status"] = sub.status
        payload["expires_at"] = sub.expires_at.isoformat() if sub.expires_at and plan.slug != "start" else None
        payload["trial"] = trial_status(user)
        try:
            st = saved_time(user)
            # Меньше 10 минут — блок на /pricing не показываем.
            payload["saved"] = st if st["visible"] else None
        except Exception:
            logger.exception("saved_time failed user=%s", user.pk)
            payload["saved"] = None
        return Response(payload)


class TrialStartView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        from .r50_tariffs import TrialError, start_trial, trial_status

        try:
            sub = start_trial(request.user, source="pricing")
        except TrialError as exc:
            return Response({"ok": False, "code": exc.code, "detail": exc.message}, status=400)
        return Response({"ok": True, "plan": sub.plan.slug, "expires_at": sub.expires_at.isoformat(), "trial": trial_status(request.user)})


def pay_link_view(request, token: str):
    """Ссылка из письма: сразу создаёт оплату нужного тарифа в Т-Банке и перенаправляет на форму."""
    from django.conf import settings
    from django.contrib.auth.models import User

    from .models import TariffPlan
    from .r50_tariffs import read_pay_token

    try:
        data = read_pay_token(token)
    except signing.BadSignature:
        return HttpResponseRedirect("/pricing?link=expired")
    user = User.objects.filter(pk=data.get("u"), is_active=True).first()
    plan = TariffPlan.objects.filter(slug=data.get("p"), is_active=True).first()
    period = "year" if data.get("b") == "year" else "month"
    promo = (data.get("c") or "").strip()
    fallback = f"/cabinet/upgrade?plan={data.get('p')}&period={period}" + (f"&promo={promo}" if promo else "")
    if not user or not plan:
        return HttpResponseRedirect("/pricing")
    if request.user.is_authenticated and request.user.pk != user.pk:
        return HttpResponseRedirect(fallback)
    if not getattr(settings, "PAYMENTS_ENABLED", False):
        return HttpResponseRedirect(fallback)
    from .payment_service import PaymentProviderService

    idem = "r50link-" + hashlib.sha256(f"{token}:{timezone.localdate().isoformat()}".encode()).hexdigest()[:40]
    for code in ([promo, None] if promo else [None]):
        try:
            result = PaymentProviderService.create_payment(
                teacher=user, plan=plan, billing_period=period, promo_code=code or None,
                idempotency_key=idem + ("" if code else "-np"),
            )
        except Exception as exc:
            logger.warning("r50 pay link: create_payment failed user=%s promo=%s: %s", user.pk, code, exc)
            continue
        url = (result or {}).get("payment_url")
        if url:
            return HttpResponseRedirect(url)
    return HttpResponseRedirect(fallback)


def unsubscribe_view(request, token: str):
    from django.contrib.auth.models import User

    from .models import EmailOptOut
    from .r50_tariffs import read_unsubscribe_token

    try:
        uid = read_unsubscribe_token(token)
    except signing.BadSignature:
        return HttpResponse("Ссылка недействительна.", status=400, content_type="text/plain; charset=utf-8")
    user = User.objects.filter(pk=uid).first()
    if user:
        EmailOptOut.objects.get_or_create(user=user)
    html = (
        "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'>"
        "<title>Отписка</title><body style='font-family:system-ui;max-width:520px;margin:60px auto;padding:0 16px'>"
        "<h1>Вы отписались</h1><p>Письма о сроке подписки больше не будут приходить на этот адрес. "
        "Уведомления в кабинете сохранятся.</p><p><a href='/'>На главную «Цифрового потока»</a></p></body>"
    )
    return HttpResponse(html, content_type="text/html; charset=utf-8")
