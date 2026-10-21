import hmac
import json
import logging

from django.conf import settings
from django.db import IntegrityError
from django.http import HttpResponse, HttpResponseBadRequest, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import funnel, vkapi

logger = logging.getLogger("vkfunnel")


@csrf_exempt
@require_POST
def vk_callback(request):
    try:
        event = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return HttpResponseBadRequest("bad json")
    if int(event.get("group_id") or 0) != vkapi.group_id():
        return HttpResponseForbidden("wrong group")
    if event.get("type") == "confirmation":
        code = (getattr(settings, "VK_CALLBACK_CONFIRMATION", "") or "").strip()
        return HttpResponse(code or "not-configured", content_type="text/plain")
    secret = (getattr(settings, "VK_CALLBACK_SECRET", "") or "").strip()
    if not secret or not hmac.compare_digest(str(event.get("secret") or ""), secret):
        return HttpResponseForbidden("bad secret")
    if not funnel.enabled():
        return HttpResponse("ok", content_type="text/plain")  # флаг выключен: ничего не пишем и не отправляем
    from .models import VkCallbackEvent
    eid = str(event.get("event_id") or "")
    if eid:
        try:
            VkCallbackEvent.objects.create(event_id=eid, event_type=str(event.get("type"))[:64])
        except IntegrityError:
            return HttpResponse("ok", content_type="text/plain")  # повтор от VK
    try:
        funnel.handle_event(event)
    except Exception:  # noqa: BLE001 — VK должен получить ok, иначе будет ретраить
        logger.exception("vkfunnel handle_event failed type=%s", event.get("type"))
    return HttpResponse("ok", content_type="text/plain")
