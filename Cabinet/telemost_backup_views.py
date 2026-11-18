"""HTTP API запасного звонка Яндекс Телемоста."""

from __future__ import annotations

from typing import ClassVar

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .rate_limit import rate_limit_check, rate_limit_drf_response
from .telemost_backup import (
    broadcast_telemost_opened,
    issue_telemost_backup_link,
    telemost_public_status,
)
from .video_meeting_service import (
    VideoMeetingError,
    get_meeting_by_uuid,
    resolve_access,
)


def _error_response(exc: VideoMeetingError, *, meeting=None) -> Response:
    payload = {"error": exc.message, "detail": exc.message, "code": exc.code}
    if meeting is not None:
        payload["status"] = meeting.status
    return Response(payload, status=exc.status)


def _no_store(response: Response) -> Response:
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response["Pragma"] = "no-cache"
    return response


class VideoMeetingTelemostView(APIView):
    """Запасной звонок Яндекс Телемоста. Не заменяет join-config Jitsi и LiveKit."""

    permission_classes: ClassVar[list] = [IsAuthenticated]

    def get(self, request, meeting_uuid):
        meeting = None
        try:
            meeting, access = self._meeting_access(request, meeting_uuid)
        except VideoMeetingError as exc:
            return _error_response(exc, meeting=meeting)
        payload = telemost_public_status(meeting)
        payload["canCreate"] = access.role in ("teacher", "coteacher", "staff")
        return _no_store(Response(payload))

    def post(self, request, meeting_uuid):
        meeting = None
        try:
            meeting, access = self._meeting_access(request, meeting_uuid)
            can_create = access.role in ("teacher", "coteacher", "staff")
            if can_create and not rate_limit_check(request, "telemost_backup", 20, 60):
                return rate_limit_drf_response()
            payload, created = issue_telemost_backup_link(
                meeting,
                user=request.user,
                can_create=can_create,
            )
        except VideoMeetingError as exc:
            return _error_response(exc, meeting=meeting)
        if created:
            broadcast_telemost_opened(meeting)
        return _no_store(Response(payload))

    def _meeting_access(self, request, meeting_uuid):
        meeting = get_meeting_by_uuid(meeting_uuid)
        access = resolve_access(request.user, meeting.schedule_event)
        if not access.allowed:
            raise VideoMeetingError(
                access.reason or "Доступ запрещён", code="forbidden", status=403
            )
        return meeting, access
