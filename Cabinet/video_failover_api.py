"""API согласованного провайдера видеосвязи. JWT здесь не логируется."""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .rate_limit import rate_limit_check, rate_limit_drf_response
from .livekit_service import failover_enabled
from .video_failover import (
    admin_switch,
    disconnect_participant,
    public_route,
    report_fault,
)
from .video_meeting_api import _error_response
from .video_meeting_service import VideoMeetingError, get_meeting_by_uuid, resolve_access


def _meeting_or_error(request, meeting_uuid):
    meeting = get_meeting_by_uuid(meeting_uuid)
    access = resolve_access(request.user, meeting.schedule_event)
    if not access.allowed:
        raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)
    return meeting, access


class VideoMeetingMediaRouteView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, meeting_uuid):
        if not rate_limit_check(request, "media_route", 60, 60):
            return rate_limit_drf_response()
        try:
            meeting, _access = _meeting_or_error(request, meeting_uuid)
        except VideoMeetingError as exc:
            return _error_response(exc)
        if not failover_enabled():
            body = public_route(None)
        else:
            from .video_failover_models import MeetingCallRoute

            route = MeetingCallRoute.objects.filter(meeting=meeting).first()
            body = public_route(route)
        response = Response(body)
        response["Cache-Control"] = "no-store"
        return response


class VideoMeetingMediaFaultView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        if not rate_limit_check(request, "media_fault", 20, 60):
            return rate_limit_drf_response()
        try:
            meeting, _access = _meeting_or_error(request, meeting_uuid)
            if not failover_enabled():
                body = public_route(None)
                body.update({"switched": False, "roomAction": "none"})
                return Response(body)
            data = request.data if isinstance(request.data, dict) else {}
            generation = data.get("generation")
            body = report_fault(
                meeting=meeting,
                user=request.user,
                fault=str(data.get("fault") or ""),
                confirmed=bool(data.get("confirmed")),
                attempts_exhausted=bool(data.get("attemptsExhausted") or data.get("attempts_exhausted")),
                code=str(data.get("code") or ""),
                generation=int(generation) if str(generation or "").isdigit() else None,
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        response = Response(body)
        response["Cache-Control"] = "no-store"
        return response


class VideoMeetingMediaSwitchView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        if not rate_limit_check(request, "media_switch", 10, 60):
            return rate_limit_drf_response()
        try:
            meeting, _access = _meeting_or_error(request, meeting_uuid)
            data = request.data if isinstance(request.data, dict) else {}
            expected = data.get("expectedGeneration")
            if expected in (None, ""):
                expected_generation = None
            else:
                expected_generation = int(expected)
            body = admin_switch(
                meeting=meeting,
                user=request.user,
                target=str(data.get("provider") or ""),
                expected_generation=expected_generation,
            )
        except (TypeError, ValueError):
            return _error_response(VideoMeetingError("Некорректное поколение", code="generation_conflict", status=409))
        except VideoMeetingError as exc:
            return _error_response(exc)
        response = Response(body)
        response["Cache-Control"] = "no-store"
        return response


class VideoMeetingMediaDisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        if not rate_limit_check(request, "media_disconnect", 20, 60):
            return rate_limit_drf_response()
        try:
            meeting, _access = _meeting_or_error(request, meeting_uuid)
            data = request.data if isinstance(request.data, dict) else {}
            body = disconnect_participant(
                meeting=meeting,
                actor=request.user,
                target_user_id=data.get("userId") or data.get("user_id"),
                block_rejoin=bool(data.get("blockRejoin") or data.get("block_rejoin")),
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        response = Response(body)
        response["Cache-Control"] = "no-store"
        return response
