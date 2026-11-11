"""Публичная витрина: цена промокода, события и баннер пробного «Премиума»."""

from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsCabinetTeacher
from .rate_limit import rate_limit_check, rate_limit_drf_response
from .storefront_events import CLIENT_EVENTS, record_storefront_event
from .storefront_models import TeacherUiDismissal
from .storefront_promo import preview_storefront_promo
from .tutor_offer_banner import build_premium_trial_banner


class StorefrontPromoPreviewView(APIView):
    permission_classes = (AllowAny,)

    def get(self, request):
        code = (request.query_params.get("code") or "").strip()
        user = request.user if getattr(request.user, "is_authenticated", False) else None
        return Response(preview_storefront_promo(code, user=user))


class StorefrontEventView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        scope = "storefront"
        if getattr(request.user, "is_authenticated", False):
            scope = f"storefront:{request.user.pk}"
        if not rate_limit_check(request, scope, 60, 60):
            return rate_limit_drf_response()
        data = request.data if isinstance(request.data, dict) else {}
        event_name = str(data.get("event_name") or "").strip()
        if event_name not in CLIENT_EVENTS:
            return Response(
                {"detail": "Это событие нельзя записать с клиента.", "code": "event_not_allowed"},
                status=403,
            )
        user = request.user if getattr(request.user, "is_authenticated", False) else None
        event, created = record_storefront_event(
            event_name=event_name,
            user=user,
            metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
            idempotency_key=str(data.get("idempotency_key") or ""),
        )
        return Response({"ok": True, "created": created, "id": event.pk}, status=201 if created else 200)


class TutorOfferBannerView(APIView):
    permission_classes = (IsCabinetTeacher,)

    def get(self, request):
        banner = build_premium_trial_banner(request.user)
        return Response({"banner": banner})


class UiNoticeDismissView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        key = str((request.data or {}).get("key") or "").strip()
        allowed = {item[0] for item in TeacherUiDismissal.KEYS}
        if key not in allowed:
            return Response({"detail": "Неизвестное уведомление.", "code": "notice_unknown"}, status=400)
        TeacherUiDismissal.objects.get_or_create(user=request.user, notice_key=key)
        return Response({"ok": True, "key": key})
