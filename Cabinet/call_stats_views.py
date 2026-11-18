"""HTTP API статистики звонка: POST — снимок участника, GET — сводка для персонала."""

from __future__ import annotations

from typing import ClassVar

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .call_stats import (
    MAX_BODY_BYTES,
    clean_call_stats,
    has_metrics,
    meeting_call_stats_summary,
    record_call_stats,
)
from .rate_limit import rate_limit_check, rate_limit_drf_response
from .video_meeting_service import (
    VideoMeetingError,
    get_meeting_by_uuid,
    resolve_access,
)


def _error(message: str, code: str, status: int) -> Response:
    return Response({"error": message, "code": code}, status=status)


class _Reject(Exception):
    def __init__(self, response: Response):
        super().__init__(response.status_code)
        self.response = response


def _authorize_post(request, meeting_uuid):
    """Проверки до записи: размер, лимит, доступ к встрече. Иначе _Reject."""
    if len(request.body or b"") > MAX_BODY_BYTES:
        raise _Reject(_error("Слишком большой отчёт", "too_large", 413))
    # За прокси IP у всех один, поэтому лимит считаем на пользователя.
    if not rate_limit_check(request, f"call_stats:{request.user.pk}", 6, 60):
        raise _Reject(rate_limit_drf_response())
    try:
        meeting = get_meeting_by_uuid(meeting_uuid)
        access = resolve_access(request.user, meeting.schedule_event)
    except VideoMeetingError as exc:
        raise _Reject(_error(exc.message, exc.code, exc.status)) from exc
    if not access.allowed:
        raise _Reject(_error("Доступ запрещён", "forbidden", 403))
    return meeting, access


class VideoMeetingCallStatsView(APIView):
    permission_classes: ClassVar[list] = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting, access = _authorize_post(request, meeting_uuid)
        except _Reject as reject:
            return reject.response
        cleaned = clean_call_stats(request.data)
        if not has_metrics(cleaned):
            return Response({"ok": False, "ignored": True}, status=400)
        sample = record_call_stats(
            meeting=meeting, user=request.user, role=access.role, cleaned=cleaned
        )
        return Response({"ok": True, "id": sample.pk}, status=201)

    def get(self, request, meeting_uuid):
        if not request.user.is_staff:
            return _error("Только для администраторов", "forbidden", 403)
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
        except VideoMeetingError as exc:
            return _error(exc.message, exc.code, exc.status)
        response = Response(
            {
                "meetingId": meeting.pk,
                "participants": meeting_call_stats_summary(meeting),
            }
        )
        response["Cache-Control"] = "no-store"
        return response
