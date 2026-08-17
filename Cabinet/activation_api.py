"""Authenticated intent-event intake. Confirmed events are backend-only."""

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .activation_events import (
    CONFIRMED_EVENTS,
    INTENT_EVENTS,
    record_event,
    sanitize_source,
)
from .activation_models import ActivationEvent
from .rate_limit import rate_limit_check, rate_limit_drf_response


class ActivationIntentEventView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not rate_limit_check(request, f"activation_intent:{request.user.pk}", 60, 60):
            return rate_limit_drf_response()

        data = request.data if isinstance(request.data, dict) else {}
        event_name = str(data.get("event_name") or "").strip()
        if event_name in CONFIRMED_EVENTS or event_name not in INTENT_EVENTS:
            return Response(
                {"detail": "Это событие нельзя записать с клиента.", "code": "event_not_allowed"},
                status=status.HTTP_403_FORBIDDEN,
            )

        role = str(getattr(getattr(request.user, "profile", None), "role", "") or "")
        teacher_only = INTENT_EVENTS - {"student_invite_registration_started"}
        if event_name in teacher_only and role != "teacher":
            return Response(
                {"detail": "Недостаточно прав для этого события.", "code": "event_not_allowed"},
                status=status.HTTP_403_FORBIDDEN,
            )

        object_id = data.get("object_id")
        try:
            object_id = int(object_id) if object_id not in (None, "") else None
        except (TypeError, ValueError):
            object_id = None

        client_key = str(data.get("idempotency_key") or data.get("client_event_id") or "").strip()[:160]
        extra = ""
        if event_name == "student_form_validation_failed":
            extra = str((data.get("metadata") or {}).get("reason") or "form")[:32]
        elif client_key:
            extra = client_key[:80]

        event = record_event(
            event_name,
            request.user,
            kind=ActivationEvent.Kind.INTENT,
            object_type=str(data.get("object_type") or "")[:32],
            object_id=object_id,
            source=sanitize_source(data.get("source") or "frontend"),
            metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
            request=request,
            idempotency_key=client_key,
            extra_idempotency=extra,
        )
        return Response(
            {"ok": True, "deduped": event is not None and event.idempotency_key == (client_key or event.idempotency_key)},
            status=status.HTTP_202_ACCEPTED,
        )
