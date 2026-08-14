"""API видеоконференций Jitsi."""

from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .rate_limit import rate_limit_check, rate_limit_drf_response

from .meeting_material_session import (
    apply_material_operation,
    broadcast_material_event,
    close_material_session,
    get_active_material_session,
    open_material_session,
    serialize_material_session,
    set_follow_policy,
    set_interaction_mode,
    transfer_material_control,
)
from .meeting_present import (
    clear_presented,
    live_variant_answers,
    present_board,
    present_variant,
    redact_plan_item_for_student,
    serialize_presented,
)
from .student_api import _interactive_to_player_payload
from .video_meeting_service import (
    VideoMeetingError,
    build_connection_probe_config,
    build_join_config,
    finish_meeting,
    get_event_for_teacher,
    get_meeting_by_uuid,
    get_or_create_meeting_for_event,
    lesson_meeting_audience,
    lesson_meeting_subject,
    list_attendance_for_teacher,
    meeting_join_window_state,
    record_attendance_join,
    record_attendance_leave,
    resolve_access,
    serialize_meeting_compact,
    serialize_meeting_summary,
    start_meeting,
    ui_state_message,
)

logger = logging.getLogger(__name__)


def _error_response(exc: VideoMeetingError, *, meeting=None) -> Response:
    payload = {"error": exc.message, "detail": exc.message, "code": exc.code}
    if meeting is not None:
        payload["status"] = meeting.status
    elif exc.code in ("not_live", "finished", "cancelled", "invalid_status"):
        # Клиенту удобно читать статус рядом с detail.
        payload.setdefault("status", exc.code if exc.code != "not_live" else "scheduled")
    return Response(payload, status=exc.status)


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
            meeting, created = get_or_create_meeting_for_event(event=event, created_by=request.user)
        except VideoMeetingError as exc:
            return _error_response(exc)

        summary = serialize_meeting_summary(meeting, event=event, user=request.user)
        compact = serialize_meeting_compact(meeting)
        return Response(
            {
                "success": True,
                "created": created,
                "meeting": compact,
                "videoMeeting": summary,
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
        can_manage = access.role in ("teacher", "coteacher", "staff")
        if not can_manage:
            plan_item_json = redact_plan_item_for_student(plan_item_json)

        subject = lesson_meeting_subject(event)
        audience = lesson_meeting_audience(event)
        return Response({
            "videoMeeting": serialize_meeting_summary(meeting, event=event, user=request.user),
            "event": {
                "id": event.pk,
                "title": subject,
                "eventTitle": event.title,
                "audience": audience,
                "topic": (plan_item_json or {}).get("topic") or event.topic or "",
                "startsAt": event.starts_at.isoformat(),
                "endsAt": event.ends_at.isoformat(),
                "status": event.status,
                "materials": (event.materials or "") if can_manage else "",
                "teacherComment": (event.teacher_comment or "") if can_manage else "",
                "planItem": plan_item_json,
                "studentId": event.student_id,
                "groupId": event.group_id,
                "lessonId": event.lesson_id,
                "teacherName": (
                    getattr(event.owner, "profile", None).get_display_name()
                    if getattr(event.owner, "profile", None)
                    else (event.owner.get_full_name() or event.owner.username)
                ),
            },
            "joinState": state,
            "joinStateLabel": ui_state_message(state),
            "canManage": can_manage,
            "viewerUserId": request.user.pk,
            "viewerRole": access.role,
            "canControlMaterial": bool(getattr(access, "can_control_material", can_manage)),
            "presented": serialize_presented(meeting, user=request.user),
            "materialSession": serialize_material_session(
                get_active_material_session(meeting),
                user=request.user,
                include_state=True,
            ),
        })


class VideoMeetingStatusView(APIView):
    """Лёгкий polling статуса без выдачи JWT."""

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
        return Response({
            "uuid": str(meeting.uuid),
            "status": meeting.status,
            "statusLabel": meeting.get_status_display(),
            "joinState": state,
            "joinStateLabel": ui_state_message(state),
            "joinUrl": f"/cabinet/meetings/{meeting.uuid}",
            "canManage": access.role in ("teacher", "staff"),
            "actualStartedAt": (
                meeting.actual_started_at.isoformat() if meeting.actual_started_at else None
            ),
            "actualFinishedAt": (
                meeting.actual_finished_at.isoformat() if meeting.actual_finished_at else None
            ),
            "presented": serialize_presented(meeting, user=request.user),
            "materialSession": serialize_material_session(
                get_active_material_session(meeting),
                user=request.user,
                include_state=True,
            ),
        })


class VideoMeetingJoinConfigView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, meeting_uuid):
        return self._join(request, meeting_uuid)

    def post(self, request, meeting_uuid):
        return self._join(request, meeting_uuid)

    def _join(self, request, meeting_uuid):
        meeting = None
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            config = build_join_config(meeting=meeting, user=request.user, request=request)
        except VideoMeetingError as exc:
            return _error_response(exc, meeting=meeting)
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
            "success": True,
            "videoMeeting": serialize_meeting_summary(
                meeting, event=meeting.schedule_event, user=request.user
            ),
            "meeting": serialize_meeting_compact(meeting),
            "joinUrl": f"/cabinet/meetings/{meeting.uuid}",
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
            "success": True,
            "videoMeeting": serialize_meeting_summary(
                meeting, event=meeting.schedule_event, user=request.user
            ),
            "meeting": serialize_meeting_compact(meeting),
        })


class VideoMeetingAttendanceJoinView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        meeting = None
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
            return _error_response(exc, meeting=meeting)
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


class VideoMeetingPresentView(APIView):
    """POST — показать доску/вариант ученику; DELETE — убрать показ."""

    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            data = request.data if isinstance(request.data, dict) else {}
            kind = (data.get("kind") or "").strip().lower()
            if kind == "board":
                board_id = data.get("boardId") or data.get("board_id")
                if not board_id:
                    raise VideoMeetingError("Укажите boardId", code="invalid", status=400)
                presented = present_board(meeting=meeting, user=request.user, board_id=str(board_id))
            elif kind == "variant":
                presented = present_variant(
                    meeting=meeting,
                    user=request.user,
                    title=str(data.get("title") or ""),
                    url=str(data.get("url") or data.get("openUrl") or data.get("open_url") or ""),
                    material_id=data.get("materialId") or data.get("material_id"),
                )
            else:
                raise VideoMeetingError(
                    "kind должен быть board или variant",
                    code="invalid",
                    status=400,
                )
        except VideoMeetingError as exc:
            return _error_response(exc)
        broadcast_material_event(
            meeting.uuid,
            {
                "type": "resource.presented",
                "presented": presented,
            },
        )
        return Response({"success": True, "presented": presented})

    def delete(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            clear_presented(meeting=meeting, user=request.user)
        except VideoMeetingError as exc:
            return _error_response(exc)
        broadcast_material_event(
            meeting.uuid,
            {
                "type": "resource.cleared",
                "presented": None,
            },
        )
        return Response({"success": True, "presented": None})


class VideoMeetingLiveAnswersView(APIView):
    """Ответы ученика по показанному варианту (для учителя, polling)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            payload = live_variant_answers(meeting=meeting, user=request.user)
        except VideoMeetingError as exc:
            return _error_response(exc)
        return Response(payload)


class VideoMeetingMaterialSessionView(APIView):
    """
    REST-управление синхронным материалом (дублирует WS для надёжности и тестов).
    GET — текущая сессия; POST — открыть; DELETE — закрыть.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            access = resolve_access(request.user, meeting.schedule_event)
            if not access.allowed:
                raise VideoMeetingError(access.reason or "Доступ запрещён", code="forbidden", status=403)
        except VideoMeetingError as exc:
            return _error_response(exc)
        session = get_active_material_session(meeting)
        return Response({
            "materialSession": serialize_material_session(session, user=request.user, include_state=True),
        })

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            data = request.data if isinstance(request.data, dict) else {}
            session = open_material_session(
                meeting=meeting,
                user=request.user,
                resource_kind=str(data.get("resourceKind") or data.get("resource_kind") or ""),
                title=str(data.get("title") or ""),
                open_url=str(data.get("openUrl") or data.get("open_url") or data.get("url") or ""),
                content_text=str(data.get("contentText") or data.get("content_text") or data.get("text") or ""),
                material_id=data.get("materialId") or data.get("material_id"),
                interactive_id=data.get("interactiveId") or data.get("interactive_id"),
                cabinet_file_id=data.get("cabinetFileId") or data.get("cabinet_file_id"),
                row_kind=str(data.get("kind") or data.get("rowKind") or ""),
                material_type=str(data.get("materialType") or data.get("material_type") or ""),
                interactive_type=str(data.get("interactiveType") or data.get("interactive_type") or ""),
                initial_state=data.get("state") if isinstance(data.get("state"), dict) else None,
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        serialized = serialize_material_session(session, user=request.user, include_state=True)
        broadcast_material_event(
            meeting.uuid,
            {
                "type": "material.opened",
                "lesson_id": serialized.get("lessonId"),
                "session_id": serialized.get("sessionId"),
                "material": serialized.get("material"),
                "interaction_mode": serialized.get("interactionMode"),
                "state": serialized.get("state"),
                "version": serialized.get("version"),
                "materialSession": serialized,
            },
        )
        return Response({
            "success": True,
            "materialSession": serialized,
        })

    def delete(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            data = request.data if isinstance(request.data, dict) else {}
            close_material_session(
                meeting=meeting,
                user=request.user,
                session_id=data.get("sessionId") or data.get("session_id"),
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        return Response({"success": True, "materialSession": None})


class VideoMeetingMaterialPermissionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            data = request.data if isinstance(request.data, dict) else {}
            session_id = data.get("sessionId") or data.get("session_id")
            follow_policy = data.get("followPolicy") or data.get("follow_policy")
            mode = data.get("mode") or data.get("interactionMode") or data.get("interaction_mode")

            if follow_policy:
                session = set_follow_policy(
                    meeting=meeting,
                    user=request.user,
                    policy=str(follow_policy),
                    session_id=session_id,
                    independent_user_ids=data.get("independentUserIds") or data.get("independent_user_ids"),
                )
            elif mode:
                session = set_interaction_mode(
                    meeting=meeting,
                    user=request.user,
                    mode=str(mode or ""),
                    session_id=session_id,
                    collaborative_scope=data.get("collaborativeScope") or data.get("collaborative_scope"),
                    collaborative_user_ids=data.get("collaborativeUserIds") or data.get("collaborative_user_ids"),
                    collaboration_permission=data.get("collaborationPermission") or data.get("collaboration_permission"),
                )
            else:
                raise VideoMeetingError("Укажите mode или followPolicy", code="invalid", status=400)
        except VideoMeetingError as exc:
            return _error_response(exc)
        serialized = serialize_material_session(session, user=request.user, include_state=True)
        broadcast_material_event(
            meeting.uuid,
            {
                "type": "material.permission_changed",
                "session_id": session.pk,
                "interaction_mode": session.interaction_mode,
                "follow_policy": session.follow_policy,
                "controller_user_id": session.controller_id,
                "collaborative_scope": session.collaborative_scope,
                "collaborative_user_ids": list(session.collaborative_user_ids or []),
                "collaboration_permission": getattr(session, "collaboration_permission", None) or "annotate",
                "independent_user_ids": list(session.independent_user_ids or []),
                "version": session.version,
                "materialSession": serialized,
            },
        )
        return Response({
            "success": True,
            "materialSession": serialized,
        })


class VideoMeetingMaterialControlView(APIView):
    """Передать управление материалом соучителю."""

    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            data = request.data if isinstance(request.data, dict) else {}
            to_user_id = data.get("toUserId") or data.get("to_user_id") or request.user.pk
            session = transfer_material_control(
                meeting=meeting,
                user=request.user,
                to_user_id=int(to_user_id),
                session_id=data.get("sessionId") or data.get("session_id"),
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        serialized = serialize_material_session(session, user=request.user, include_state=True)
        broadcast_material_event(
            meeting.uuid,
            {
                "type": "control.transferred",
                "session_id": session.pk,
                "controller_user_id": session.controller_id,
                "materialSession": serialized,
            },
        )
        return Response({"success": True, "materialSession": serialized})


class VideoMeetingMaterialInteractiveView(APIView):
    """
    Player-payload интерактива, который сейчас открыт в материале урока.
    Отдельно от /interactives/<id>/ — тот эндпоинт доступен только владельцу-учителю
    (IsCabinetTeacher), поэтому ученик не мог получить контент интерактива,
    который учитель показывает на уроке.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, meeting_uuid, interactive_id):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
        except VideoMeetingError as exc:
            return _error_response(exc)
        access = resolve_access(request.user, meeting.schedule_event)
        if not access.allowed:
            return Response(
                {"detail": access.reason or "Доступ запрещён"},
                status=status.HTTP_403_FORBIDDEN,
            )
        session = get_active_material_session(meeting)
        if not session or not session.interactive_id or int(session.interactive_id) != int(interactive_id):
            return Response(
                {"detail": "Интерактив сейчас не открыт на уроке."},
                status=status.HTTP_404_NOT_FOUND,
            )
        interactive = session.interactive
        if interactive is None:
            return Response({"detail": "Интерактив не найден."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"interactive": _interactive_to_player_payload(interactive)})


class VideoMeetingMaterialOperationView(APIView):
    """REST-применение операции (для тестов и fallback при проблемах WS)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, meeting_uuid):
        try:
            meeting = get_meeting_by_uuid(meeting_uuid)
            data = request.data if isinstance(request.data, dict) else {}
            result = apply_material_operation(
                meeting=meeting,
                user=request.user,
                action=str(data.get("action") or ""),
                payload=data.get("payload") if isinstance(data.get("payload"), dict) else {},
                operation_id=str(data.get("operationId") or data.get("operation_id") or ""),
                session_id=data.get("sessionId") or data.get("session_id"),
                base_version=data.get("baseVersion") if data.get("baseVersion") is not None else data.get("base_version"),
            )
        except VideoMeetingError as exc:
            return _error_response(exc)
        operation = result.get("operation")
        if operation and not result.get("duplicate"):
            broadcast_material_event(meeting.uuid, operation)
        return Response({
            "success": True,
            "duplicate": bool(result.get("duplicate")),
            "ephemeral": bool(result.get("ephemeral")),
            "operation": operation,
            "version": result.get("version"),
            "materialSession": serialize_material_session(
                result.get("session"),
                user=request.user,
                include_state=True,
            ),
        })


class VideoMeetingConnectionProbeView(APIView):
    """Диагностика Jitsi: без VideoMeeting, посещаемости, журнала и уведомлений."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not rate_limit_check(request, "jitsi_probe", 12, 300):
            return rate_limit_drf_response()
        try:
            payload = build_connection_probe_config(user=request.user, request=request)
        except Exception:
            logger.exception("jitsi_connection_probe_failed user_id=%s", request.user.pk)
            return Response(
                {
                    "error": "Не удалось подготовить проверку видеосвязи",
                    "detail": "Не удалось подготовить проверку видеосвязи",
                    "code": "probe_failed",
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        return Response(payload)

    def post(self, request):
        """Клиентский отчёт о сбое диагностики — только лог, без БД и без JWT."""
        if not rate_limit_check(request, "jitsi_probe_log", 20, 300):
            return rate_limit_drf_response()
        data = request.data if isinstance(request.data, dict) else {}
        stage = str(data.get("stage") or "")[:64]
        error_type = str(data.get("errorType") or data.get("error_type") or "")[:64]
        duration = data.get("durationMs")
        if duration is None:
            duration = data.get("duration_ms")
        try:
            duration_ms = int(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration_ms = None
        online = data.get("online")
        browser = str(data.get("browser") or "")[:32]
        device_type = str(data.get("deviceType") or data.get("device_type") or "")[:32]
        logger.warning(
            "jitsi_connection_probe_client user_id=%s stage=%s duration_ms=%s "
            "error_type=%s online=%s browser=%s device=%s",
            request.user.pk,
            stage,
            duration_ms,
            error_type,
            online,
            browser,
            device_type,
        )
        return Response({"ok": True})
