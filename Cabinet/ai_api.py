"""API ИИ-помощника кабинета учителя.

GET  /api/cabinet/ai/usage/
POST /api/cabinet/ai/open/
GET  /api/cabinet/ai/conversations/
GET  /api/cabinet/ai/conversations/<uuid>/
POST /api/cabinet/ai/request/
"""

from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .ai_service import (
    AIServiceError,
    list_conversation_payload,
    open_assistant,
    run_teacher_request,
    usage_snapshot,
)
from .models import AIConversation
from .permissions import IsCabinetTeacher
from .subscription_service import LimitExceeded


class AIUsageView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        snap = usage_snapshot(request.user)
        # Совместимость со старым фронтом.
        return Response({
            **snap,
            "used": snap["text"]["used"],
            "limit": snap["text"]["limit"],
            "remaining": snap["text"]["remaining"],
            "period_start": snap["period_start"],
            "period_end": snap["period_end"],
        })


class AIOpenView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        payload = open_assistant(request.user, (request.data or {}).get("conversation_id"))
        return Response(payload)


class AIConversationListView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        items = [
            {
                "id": str(c.id),
                "title": c.title or "Новый диалог",
                "updated_at": c.updated_at.isoformat(),
            }
            for c in AIConversation.objects.filter(teacher=request.user).order_by("-updated_at")[:30]
        ]
        return Response({"results": items, "usage": usage_snapshot(request.user)})


class AIConversationDetailView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request, conversation_id):
        conversation = AIConversation.objects.filter(pk=conversation_id, teacher=request.user).first()
        if not conversation:
            return Response({"code": "NOT_FOUND", "message": "Диалог не найден."}, status=404)
        return Response({
            **list_conversation_payload(conversation),
            "usage": usage_snapshot(request.user),
        })


class AIRequestView(APIView):
    permission_classes = [IsCabinetTeacher]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request):
        data = request.data
        if hasattr(data, "dict"):
            data = data.dict()
        else:
            data = dict(data)
        # Никогда не принимаем идентичность/тариф/модель от клиента.
        for blocked in (
            "user_id", "teacher_id", "plan", "plan_slug", "limit", "model",
            "cost", "credits", "ai_requests_monthly_limit",
        ):
            data.pop(blocked, None)

        image = request.FILES.get("image")
        if image:
            import base64

            raw = image.read()[: 4 * 1024 * 1024]
            mime = image.content_type or "image/png"
            data["image_data_url"] = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
            data["image_attachment"] = True

        idem = (
            request.headers.get("Idempotency-Key")
            or request.headers.get("X-Idempotency-Key")
            or data.get("idempotency_key")
            or request.headers.get("X-Request-ID")
            or ""
        )
        try:
            result = run_teacher_request(request.user, data, idempotency_key=str(idem))
        except LimitExceeded as exc:
            return Response(exc.to_dict(), status=403)
        except AIServiceError as exc:
            return Response(exc.to_dict(), status=exc.status)
        return Response(result)
