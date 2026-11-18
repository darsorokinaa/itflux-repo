"""Публичная фиксация ссылки коллеги и карточка в кабинете учителя."""

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .colleague_invite import COOKIE_NAME, ColleagueInviteService
from .colleague_models import ColleagueInviteSettings, ru_days
from .rate_limit import rate_limit_check


def _device_id(request) -> str:
    return str(request.META.get("HTTP_X_DEVICE_ID") or "")[:128]


@require_http_methods(["GET"])
def api_colleague_summary(request):
    if not request.user.is_authenticated:
        return JsonResponse({"ok": False, "error": "Нужна авторизация"}, status=401)
    payload = ColleagueInviteService.summary(request.user, request, _device_id(request))
    payload["ok"] = True
    return JsonResponse(payload)


@require_http_methods(["GET"])
def api_colleague_touch(request, code):
    if not rate_limit_check(request, "colleague_touch", 60, 3600):
        return JsonResponse(
            {"valid": False, "message": "Слишком много запросов."},
            status=429,
        )
    link = ColleagueInviteService.touch(code, request)
    if link is None:
        settings_row = ColleagueInviteSettings.get_solo()
        message = (
            "Приглашения коллег сейчас не принимаются."
            if not settings_row.enabled
            else "Ссылка приглашения недействительна."
        )
        return JsonResponse({"valid": False, "message": message}, status=404)
    settings_row = ColleagueInviteSettings.get_solo()
    days = int(settings_row.bonus_days or 0)
    response = JsonResponse(
        {
            "valid": True,
            "bonus_days": days,
            "message": (
                "Вас пригласил коллега. Когда вы выдадите первое домашнее задание "
                f"или проведёте урок, он получит {ru_days(days)} тарифа «Репетитор»."
            ),
        }
    )
    response.set_cookie(
        COOKIE_NAME,
        link.code,
        max_age=60 * 60 * 24 * 90,
        samesite="Lax",
        secure=request.is_secure(),
        httponly=False,
    )
    return response
