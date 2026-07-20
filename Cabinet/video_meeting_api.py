"""API видеоконференций Jitsi."""

from __future__ import annotations

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .video_meeting_service import (
    VideoMeetingError,
    build_join_config,
    finish_meeting,
    get_event_for_teacher,
    get_meeting_by_uuid,
    get_or_create_meeting_for_event,
    list_attendance_for_teacher,
    meeting_join_window_state,
    record_attendance_join,
    record_attendance_leave,
    resolve_access,
    serialize_meeting_summary,
    start_meeting,
    ui_state_message,
)


def _error_response(exc: VideoMeetingError) -> Response:
    return Response(
        {"error": exc.message, "code": exc.code},
        status=exc.status,
    )


class VideoMeetingForEventView(APIView):
    """GET — статус комнаты; POST — создать (или вернуть существующую) комнату для урока."""

    permission_classes = [IsAuthenticated]

    def get(self, request, event_id: int):
        try:
            event = get_event_for_teacher(event_id, request.user)
        except VideoMeetingError as exc:
            return _error_response(exc)

        from .models import VideoMeeting

        meeting = VideoMeeting.objects.filter(schedule_event=event).first()
        access = resolve_access(request.user, event)
        state = meeting_join_window_state(event, meeting)
        return Response({
            "eventId": event.pk,
            "title": event.title,
            "startsAt": event.starts_at.isoformat(),
            "endsAt": event.ends_at.isoformat(),
            "eventStatus": event.status,
            "joinState": state,
            "joinStateLabel": ui_state_message(state),
            "canManage": access.role in ("teacher", "staff"),
            "videoMeeting": serialize_meeting_summary(meeting, event=event, user=request.user),
        })

    def post(self, request, event_id: int):
        try:
            event = get_event_for_teacher(event_id, request.user)
            meeting = get_or_create_meeting_for_event(event=event, created_by=request.user)
        except VideoMeetingError as exc:
            return _error_response(exc)
        return Response(
            {
                "videoMeeting": serialize_meeting_summary(meeting, event=event, user=request.user),
            },
            status=status.HTTP_200_OK,
        )


class VideoMeetingDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            access = resolve_access(request.user, meeting.schedule_event)
            if not access.allowed:
                raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)
        except VideoMeetingError as exc:
            return _error_response(exc)

        event = meeting.schedule_event
        state = meeting_join_window_state(event, meeting)

        from .plan_schedule import resolve_plan_item_for_event
        from .schedule_events import _plan_item_to_json

        plan_item, lesson_number = resolve_plan_item_for_event(event)
        plan_item_json = (
            _plan_item_to_json(plan_item, lesson_number=lesson_number) if plan_item else None
        )

        return Response({
            "videoMeeting": serialize_meeting_summary(meeting, event=event, user=request.user),
            "event": {
                "id": event.pk,
                "title": event.title,
                "topic": (plan_item_json or {}).get("topic") or event.topic or "",
                "startsAt": event.starts_at.isoformat(),
                "endsAt": event.ends_at.isoformat(),
                "status": event.status,
                "materials": event.materials or "",
                "teacherComment": event.teacher_comment or "",
                "planItem": plan_item_json,
                "teacherName": (
                    getattr(event.owner, "profile", None).get_display_name()
                    if getattr(event.owner, "profile", None)
                    else (event.owner.get_full_name() or event.owner.username)
                ),
            },
            "joinState": state,
            "joinStateLabel": ui_state_message(state),
            "canManage": access.role in ("teacher", "staff"),
        })


class VideoMeetingJoinConfigView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, meeting_uuid):
        return self._join(request, meeting_uuid)

    def post(self, request, meeting_uuid):
        return self._join(request, meeting_uuid)

    def _join(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            config = build_join_config(meeting=meeting, user=request.user, request=request)
        except VideoMeetingError as exc:
            return _error_response(exc)
        return Response(config)


class VideoMeetingStartView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            meeting = start_meeting(meeting=meeting, user=request.user)
        except VideoMeetingError as exc:
            return _error_response(exc)
        return Response({
            "videoMeeting": serialize_meeting_summary(
                meeting, event=meeting.schedule_event, user=request.user
            ),
        })


class VideoMeetingFinishView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            meeting = finish_meeting(meeting=meeting, user=request.user)
        except VideoMeetingError as exc:
            return _error_response(exc)
        return Response({
            "videoMeeting": serialize_meeting_summary(
                meeting, event=meeting.schedule_event, user=request.user
            ),
        })


class VideoMeetingAttendanceJoinView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            participant_id = ""
            if isinstance(request.data, dict):
                participant_id = request.data.get("jitsiParticipantId") or request.data.get(
                    "jitsi_participant_id"
                ) or ""
            session = record_attendance_join(
                meeting=meeting,
                user=request.user,
                jitsi_participant_id=str(participant_id or ""),
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        return Response({
            "id": session.pk,
            "joinedAt": session.joined_at.isoformat(),
            "leftAt": session.left_at.isoformat() if session.left_at else None,
            "durationSeconds": session.duration_seconds,
        })


class VideoMeetingAttendanceLeaveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            participant_id = ""
            data = request.data if isinstance(request.data, dict) else {}
            if not data and request.POST:
                data = request.POST
            participant_id = data.get("jitsiParticipantId") or data.get("jitsi_participant_id") or ""
            session = record_attendance_leave(
                meeting=meeting,
                user=request.user,
                jitsi_participant_id=str(participant_id or ""),
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        if session is None:
            return Response({"ok": True, "closed": False})
        return Response({
            "ok": True,
            "closed": True,
            "id": session.pk,
            "joinedAt": session.joined_at.isoformat(),
            "leftAt": session.left_at.isoformat() if session.left_at else None,
            "durationSeconds": session.duration_seconds,
        })


class VideoMeetingAttendanceListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            rows = list_attendance_for_teacher(meeting=meeting, user=request.user)
        except VideoMeetingError as exc:
            return _error_response(exc)
        return Response({"results": rows})
