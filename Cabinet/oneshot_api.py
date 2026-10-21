"""API разовых окон: GET — следующее окно, POST seen/close — факт показа и закрытия (на сервере)."""

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import oneshot_popups as svc


class OneShotPopupNextView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            data = svc.next_popup(request.user)
        except Exception:  # таблицы ещё нет / сбой — окно просто не показываем
            svc.logger.exception("oneshot next failed user=%s", request.user.pk)
            data = None
        return Response({"popup": data})


class OneShotPopupSeenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, popup_id: int):
        return Response({"ok": svc.mark_shown(request.user, popup_id)})


class OneShotPopupCloseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, popup_id: int):
        action = str((request.data or {}).get("action") or "close")
        return Response({"ok": svc.mark_closed(request.user, popup_id, action)})
