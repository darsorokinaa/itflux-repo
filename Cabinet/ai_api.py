"""
API для ИИ-помощника.

Endpoints:
  GET  /api/cabinet/ai/usage/
  POST /api/cabinet/ai/request/

cost_units (кредиты) по типу запроса:
  explain / comment / idea        → 1
  generate_task / feedback        → 2
  generate_set / adapt_level      → 3
  bulk_generate / interactive_gen → 5
"""

from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AIRequestLog
from .permissions import IsCabinetTeacher
from .subscription_service import LimitExceeded, SubscriptionLimitService

COST_MAP = {
    "explain": 1,
    "comment": 1,
    "idea": 1,
    "generate_task": 2,
    "feedback": 2,
    "generate_set": 3,
    "adapt_level": 3,
    "bulk_generate": 5,
    "interactive_gen": 5,
}


class AIUsageView(APIView):
    permission_classes = [IsCabinetTeacher]

    def get(self, request):
        ai_usage = SubscriptionLimitService.get_ai_usage(request.user)
        plan = SubscriptionLimitService.get_current_plan(request.user)
        return Response({
            "used": ai_usage.used_requests,
            "limit": plan.ai_requests_monthly_limit,
            "period_start": ai_usage.period_start.isoformat(),
            "period_end": ai_usage.period_end.isoformat(),
            "remaining": max(0, plan.ai_requests_monthly_limit - ai_usage.used_requests),
        })


class AIRequestView(APIView):
    permission_classes = [IsCabinetTeacher]

    def post(self, request):
        prompt = (request.data.get("prompt") or "").strip()
        request_type = (request.data.get("request_type") or "explain").strip()
        cost_units = COST_MAP.get(request_type, 1)

        # Проверка лимита
        try:
            SubscriptionLimitService.raise_if_ai_limit_reached(request.user, cost_units=cost_units)
        except LimitExceeded as exc:
            AIRequestLog.objects.create(
                teacher=request.user,
                request_type=request_type,
                prompt=prompt[:500],
                cost_units=cost_units,
                status=AIRequestLog.RequestStatus.BLOCKED,
                error_message=exc.message,
            )
            return Response(exc.to_dict(), status=403)

        # TODO: Заменить на реальный LLM-вызов
        result = _mock_ai_response(prompt, request_type)

        # Фиксируем использование
        SubscriptionLimitService.consume_ai_request(request.user, cost_units=cost_units)
        ai_usage = SubscriptionLimitService.get_ai_usage(request.user)
        plan = SubscriptionLimitService.get_current_plan(request.user)

        AIRequestLog.objects.create(
            teacher=request.user,
            request_type=request_type,
            prompt=prompt[:500],
            result=result[:2000],
            cost_units=cost_units,
            status=AIRequestLog.RequestStatus.SUCCESS,
        )

        return Response({
            "result": result,
            "cost_units": cost_units,
            "usage": {
                "used": ai_usage.used_requests,
                "limit": plan.ai_requests_monthly_limit,
                "remaining": max(0, plan.ai_requests_monthly_limit - ai_usage.used_requests),
            },
        })


def _mock_ai_response(prompt: str, request_type: str) -> str:
    """Заглушка ИИ-ответа до подключения реального провайдера."""
    return (
        f"[Демо-режим] Запрос типа «{request_type}» обработан. "
        "Подключите реальный LLM-провайдер в ai_api.py::AIRequestView.post."
    )
