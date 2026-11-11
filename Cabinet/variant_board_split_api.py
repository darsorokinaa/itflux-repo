"""POST «Доска рядом» у показанного на уроке варианта."""

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .meeting_material_session import broadcast_material_event
from .meeting_present import set_variant_board_split
from .variant_board import VariantBoardError
from .video_meeting_api import _error_response
from .video_meeting_service import VideoMeetingError, get_meeting_by_uuid


class VideoMeetingVariantBoardSplitView(APIView):
    """Доску выбирает сервер. open=false закрывает только сплит, вариант остаётся."""

    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        data = request.data if isinstance(request.data, dict) else {}
        if "open" not in data or not isinstance(data.get("open"), bool):
            return Response(
                {"detail": "Укажите open: true или false", "code": "invalid"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            presented = set_variant_board_split(
                meeting=meeting,
                user=request.user,
                open_split=data.get("open"),
                pick=_split_pick(data),
            )
        except VariantBoardError as exc:
            return Response(
                {"detail": str(exc), "code": exc.code, **exc.extra}, status=exc.status
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        broadcast_material_event(
            meeting.uuid,
            {"type": "resource.presented", "presented": presented},
        )
        return Response({"success": True, "presented": presented})


def _split_pick(data):
    student_id = data.get("student_id")
    if "studentId" in data:
        student_id = data.get("studentId")
    return {"target": data.get("target"), "student_id": student_id}
