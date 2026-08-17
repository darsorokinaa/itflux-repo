"""WebSocket комнаты видеоурока: синхронизация материалов."""

from __future__ import annotations

import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .meeting_material_session import (
    apply_material_operation,
    close_material_session,
    meeting_material_group_name,
    open_material_session,
    serialize_material_session,
    set_interaction_mode,
    sync_state_payload,
)
from .meeting_screenshare import (
    apply_screenshare_operation,
    report_screenshare_state,
    serialize_screenshare_session,
    set_screenshare_permission,
)
from .video_meeting_service import VideoMeetingError, get_meeting_by_uuid, resolve_access

logger = logging.getLogger(__name__)

MAX_WS_TEXT_BYTES = 64_000


class VideoMeetingConsumer(AsyncWebsocketConsumer):
    """
    Одно соединение на участника видеоурока.
    Доска и варианты остаются на своих каналах/REST; здесь — остальные материалы.
    """

    async def connect(self):
        self.meeting_uuid = self.scope["url_route"]["kwargs"]["meeting_uuid"]
        self.group_name = meeting_material_group_name(self.meeting_uuid)
        self.user = self.scope.get("user")
        self.role = "none"
        self.client_id = ""

        if not self.user or not self.user.is_authenticated:
            await self.close(code=4401)
            return

        meeting, access = await self._resolve_meeting_access()
        if meeting is None or not access or not access.allowed:
            await self.close(code=4403)
            return

        self.meeting_id = meeting.pk
        self.role = access.role
        self.display_name = await self._display_name()
        self.client_id = ""
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.info(
            "material_ws_connect meeting=%s user=%s role=%s",
            self.meeting_uuid,
            self.user.pk,
            self.role,
        )
        payload = await self._sync_state()
        await self.send(text_data=json.dumps(payload, ensure_ascii=False))
        await self._broadcast({
            "type": "material.presence_join",
            "lesson_id": str(self.meeting_uuid),
            "user_id": self.user.pk,
            "author_id": self.user.pk,
            "author_role": self.role,
            "display_name": self.display_name,
        })

    async def disconnect(self, close_code):
        if getattr(self, "group_name", None):
            await self._broadcast({
                "type": "material.presence_leave",
                "lesson_id": str(getattr(self, "meeting_uuid", "")),
                "user_id": getattr(self.user, "pk", None),
                "author_id": getattr(self.user, "pk", None),
                "author_role": getattr(self, "role", ""),
                "display_name": getattr(self, "display_name", ""),
            })
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        logger.info(
            "material_ws_disconnect meeting=%s user=%s code=%s",
            getattr(self, "meeting_uuid", ""),
            getattr(getattr(self, "user", None), "pk", None),
            close_code,
        )

    async def receive(self, text_data=None, bytes_data=None):
        if bytes_data and len(bytes_data) > MAX_WS_TEXT_BYTES:
            await self._send_error("Слишком большое сообщение", code="payload_too_large")
            return
        if text_data and len(text_data) > MAX_WS_TEXT_BYTES:
            await self._send_error("Слишком большое сообщение", code="payload_too_large")
            return
        if not text_data:
            return
        try:
            data = json.loads(text_data)
        except (TypeError, ValueError):
            await self._send_error("Некорректный JSON", code="invalid_json")
            return
        if not isinstance(data, dict):
            await self._send_error("Сообщение должно быть объектом", code="invalid_json")
            return

        msg_type = (data.get("type") or "").strip()
        if msg_type == "material.request_sync":
            payload = await self._sync_state()
            await self.send(text_data=json.dumps(payload, ensure_ascii=False))
            # Повторно заявляем presence после reconnect.
            await self._broadcast({
                "type": "material.presence_join",
                "lesson_id": str(self.meeting_uuid),
                "user_id": self.user.pk,
                "author_id": self.user.pk,
                "author_role": self.role,
                "display_name": self.display_name,
            })
            return

        if msg_type == "material.presence_ping":
            await self._broadcast({
                "type": "material.presence_join",
                "lesson_id": str(self.meeting_uuid),
                "user_id": self.user.pk,
                "author_id": self.user.pk,
                "author_role": self.role,
                "display_name": self.display_name,
            })
            return

        if msg_type == "ping":
            await self.send(text_data=json.dumps({"type": "pong", "t": data.get("t")}))
            return

        if msg_type == "material.open":
            await self._handle_open(data)
            return
        if msg_type == "material.close":
            await self._handle_close(data)
            return
        if msg_type == "material.permission_changed" or msg_type == "material.set_permission":
            await self._handle_permission(data)
            return
        if msg_type == "material.operation":
            await self._handle_operation(data)
            return
        if msg_type in ("material.cursor", "material.pointer", "material.student_viewport"):
            data = {
                **data,
                "action": data.get("action") or (
                    "pointer" if msg_type.endswith("pointer")
                    else "student_viewport" if msg_type.endswith("student_viewport")
                    else "cursor"
                ),
            }
            await self._handle_operation(data)
            return

        if msg_type in ("material.follow_status", "FOLLOW_TEACHER_CHANGED"):
            await self._handle_follow_status(data)
            return

        if msg_type in (
            "screenshare.report",
            "screenshare.state",
            "annotation.session.report",
        ):
            await self._handle_screenshare_report(data)
            return
        if msg_type in ("screenshare.set_permission", "screenshare.permission"):
            await self._handle_screenshare_permission(data)
            return
        if msg_type in (
            "screenshare.operation",
            "screenshare.pointer",
            "annotation.stroke.start",
            "annotation.stroke.update",
            "annotation.stroke.end",
            "annotation.pointer",
        ):
            await self._handle_screenshare_operation(data, msg_type)
            return

        await self._send_error("Неизвестный тип сообщения", code="unknown_type")

    async def _handle_follow_status(self, data: dict):
        payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
        following = payload.get("following")
        if following is None:
            following = data.get("following", True)
        await self._broadcast({
            "type": "material.follow_status",
            "lesson_id": str(self.meeting_uuid),
            "user_id": self.user.pk,
            "author_id": self.user.pk,
            "author_role": self.role,
            "display_name": self.display_name,
            "payload": {
                "following": bool(following),
                "material_id": payload.get("material_id") or payload.get("materialId"),
            },
        })
        logger.info(
            "material_follow_status meeting=%s user=%s following=%s",
            self.meeting_uuid,
            self.user.pk,
            bool(following),
        )

    async def _handle_screenshare_report(self, data: dict):
        payload = data.get("payload") if isinstance(data.get("payload"), dict) else data
        active = payload.get("active")
        if active is None:
            active = payload.get("on")
        try:
            session = await self._report_screenshare(payload, bool(active))
        except VideoMeetingError as exc:
            await self._send_error(exc.message, code=exc.code)
            return
        except Exception:
            logger.exception("screenshare_report_failed meeting=%s", self.meeting_uuid)
            await self._send_error("Не удалось обновить демонстрацию экрана", code="server_error")
            return
        if not bool(active) and session is not None and session.is_active:
            return
        serialized = serialize_screenshare_session(session) if session else None
        is_active = bool(serialized and serialized.get("active"))
        await self._broadcast({
            "type": "screenshare.started" if is_active else "screenshare.ended",
            "meetingUuid": str(self.meeting_uuid),
            "screenshareSession": serialized if is_active else None,
            "author_id": self.user.pk,
            "author_role": self.role,
        })

    async def _handle_screenshare_permission(self, data: dict):
        payload = data.get("payload") if isinstance(data.get("payload"), dict) else data
        enabled = payload.get("participantsCanAnnotate")
        if enabled is None:
            enabled = payload.get("participants_can_annotate")
        if enabled is None:
            enabled = payload.get("enabled")
        try:
            session = await self._set_screenshare_permission(payload, bool(enabled))
        except VideoMeetingError as exc:
            await self._send_error(exc.message, code=exc.code)
            return
        serialized = serialize_screenshare_session(session)
        await self._broadcast({
            "type": "screenshare.permission",
            "meetingUuid": str(self.meeting_uuid),
            "screenshareSession": serialized,
            "participantsCanAnnotate": serialized.get("participantsCanAnnotate") if serialized else False,
            "author_id": self.user.pk,
            "author_role": self.role,
        })

    async def _handle_screenshare_operation(self, data: dict, msg_type: str):
        action = data.get("action") or ""
        if not action:
            if msg_type == "screenshare.pointer" or msg_type == "annotation.pointer":
                action = "pointer"
            elif msg_type.endswith("stroke.start"):
                action = "stroke_start"
            elif msg_type.endswith("stroke.update"):
                action = "stroke_update"
            elif msg_type.endswith("stroke.end"):
                action = "stroke_end"
            else:
                action = "object_upsert"
        try:
            result = await self._apply_screenshare_operation(data, action)
        except VideoMeetingError as exc:
            await self._send_error(
                exc.message,
                code=exc.code,
                extra={"operation_id": data.get("operation_id") or data.get("operationId")},
            )
            return
        except Exception:
            logger.exception("screenshare_op_failed meeting=%s", self.meeting_uuid)
            await self._send_error("Ошибка применения аннотации", code="server_error")
            return

        if result.get("duplicate"):
            await self.send(text_data=json.dumps({
                "type": "screenshare.operation_ack",
                "duplicate": True,
                "operation_id": data.get("operation_id") or data.get("operationId"),
                "version": result.get("version"),
            }, ensure_ascii=False))
            return

        operation = result.get("operation")
        if not operation:
            return
        await self._broadcast(operation)
        if not result.get("ephemeral"):
            await self.send(text_data=json.dumps({
                "type": "screenshare.operation_ack",
                "duplicate": False,
                "operation_id": operation.get("operation_id"),
                "version": operation.get("version"),
            }, ensure_ascii=False))

    async def meeting_material_event(self, event):
        payload = event.get("payload")
        if not payload:
            return
        # Не отправляем автору эхо курсора / preview — он уже видит свой.
        if payload.get("type") in (
            "material.cursor",
            "material.pointer",
            "material.annotation_preview",
            "material.student_viewport",
            "screenshare.pointer",
            "screenshare.stroke_update",
        ):
            if payload.get("author_id") == getattr(self.user, "id", None):
                return
        if payload.get("type") == "material.presence_join":
            if payload.get("user_id") == getattr(self.user, "id", None):
                return
        if payload.get("type") == "material.presence_leave":
            if payload.get("user_id") == getattr(self.user, "id", None):
                return
        # openUrl зависит от роли: учитель и ученик ходят в разные preview API.
        # state тоже персонален для ученика (только свои answers/fields) — без
        # переперсонализации на control.transferred все получали бы срез сессии,
        # посчитанный для учителя, который вызвал передачу управления.
        if payload.get("type") in (
            "material.opened",
            "material.permission_changed",
            "material.sync_state",
            "control.transferred",
        ):
            session_id = payload.get("session_id") or (payload.get("materialSession") or {}).get("sessionId")
            if session_id:
                personalized = await self._serialize_session_by_id(session_id)
                if personalized:
                    payload = {
                        **payload,
                        "material": personalized.get("material"),
                        "materialSession": personalized,
                        "interaction_mode": personalized.get("interactionMode"),
                        "collaborative_scope": personalized.get("collaborativeScope"),
                        "collaborative_user_ids": personalized.get("collaborativeUserIds"),
                        "state": personalized.get("state") if "state" in personalized else payload.get("state"),
                        "version": personalized.get("version"),
                    }
        await self.send(text_data=json.dumps(payload, ensure_ascii=False))

    async def _broadcast(self, payload: dict):
        await self.channel_layer.group_send(
            self.group_name,
            {"type": "meeting.material_event", "payload": payload},
        )

    async def _send_error(self, message: str, *, code: str = "error", extra: dict | None = None):
        body = {"type": "material.error", "code": code, "message": message}
        if extra:
            body.update(extra)
        await self.send(text_data=json.dumps(body, ensure_ascii=False))

    async def _handle_open(self, data: dict):
        if self.role not in ("teacher", "coteacher", "staff"):
            await self._send_error("Только преподаватель может открыть материал", code="forbidden")
            logger.info(
                "material_open_denied meeting=%s user=%s",
                self.meeting_uuid,
                self.user.pk,
            )
            return
        try:
            session = await self._open_session(data)
        except VideoMeetingError as exc:
            await self._send_error(exc.message, code=exc.code)
            return
        except Exception:
            logger.exception("material_open_failed meeting=%s", self.meeting_uuid)
            await self._send_error("Не удалось открыть материал", code="server_error")
            return

        serialized = await self._serialize_session(session)
        await self._broadcast({
            "type": "material.opened",
            "lesson_id": serialized.get("lessonId"),
            "session_id": serialized.get("sessionId"),
            "material": serialized.get("material"),
            "interaction_mode": serialized.get("interactionMode"),
            "collaborative_scope": serialized.get("collaborativeScope"),
            "collaborative_user_ids": serialized.get("collaborativeUserIds"),
            "state": serialized.get("state"),
            "version": serialized.get("version"),
            "materialSession": serialized,
        })

    async def _handle_close(self, data: dict):
        if self.role not in ("teacher", "coteacher", "staff"):
            await self._send_error("Только преподаватель может закрыть материал", code="forbidden")
            return
        try:
            await self._close_session(data.get("session_id") or data.get("sessionId"))
        except VideoMeetingError as exc:
            await self._send_error(exc.message, code=exc.code)
            return
        await self._broadcast({
            "type": "material.closed",
            "session_id": data.get("session_id") or data.get("sessionId"),
            "meetingUuid": self.meeting_uuid,
        })

    async def _handle_permission(self, data: dict):
        if self.role not in ("teacher", "coteacher", "staff"):
            await self._send_error("Только преподаватель может менять режим", code="forbidden")
            logger.info(
                "material_permission_denied meeting=%s user=%s",
                self.meeting_uuid,
                self.user.pk,
            )
            return
        mode = data.get("mode") or data.get("interaction_mode") or data.get("interactionMode")
        try:
            session = await self._set_permission(data, mode)
        except VideoMeetingError as exc:
            await self._send_error(exc.message, code=exc.code)
            return
        serialized = await self._serialize_session(session)
        await self._broadcast({
            "type": "material.permission_changed",
            "session_id": session.pk,
            "interaction_mode": session.interaction_mode,
            "collaborative_scope": session.collaborative_scope,
            "collaborative_user_ids": list(session.collaborative_user_ids or []),
            "version": session.version,
            "materialSession": serialized,
        })

    async def _handle_operation(self, data: dict):
        action = data.get("action") or ""
        # author_id / author_role с клиента игнорируем — берём из сессии.
        try:
            result = await self._apply_operation(data, action)
        except VideoMeetingError as exc:
            await self._send_error(
                exc.message,
                code=exc.code,
                extra={"operation_id": data.get("operation_id") or data.get("operationId")},
            )
            return
        except Exception:
            logger.exception("material_op_failed meeting=%s", self.meeting_uuid)
            await self._send_error("Ошибка применения операции", code="server_error")
            return

        if result.get("duplicate"):
            await self.send(text_data=json.dumps({
                "type": "material.operation_ack",
                "duplicate": True,
                "operation_id": data.get("operation_id") or data.get("operationId"),
                "version": result.get("version"),
            }, ensure_ascii=False))
            return

        operation = result.get("operation")
        if not operation:
            return

        await self._broadcast(operation)
        if not result.get("ephemeral"):
            await self.send(text_data=json.dumps({
                "type": "material.operation_ack",
                "duplicate": False,
                "operation_id": operation.get("operation_id"),
                "version": operation.get("version"),
            }, ensure_ascii=False))

    @database_sync_to_async
    def _display_name(self):
        user = self.user
        profile = getattr(user, "profile", None)
        name = (getattr(profile, "name", None) or "").strip()
        if name:
            return name[:120]
        full = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
        if full:
            return full[:120]
        return str(getattr(user, "username", "") or "Участник")[:120]

    @database_sync_to_async
    def _resolve_meeting_access(self):
        try:
            meeting = get_meeting_by_uuid(self.meeting_uuid)
        except VideoMeetingError:
            return None, None
        access = resolve_access(self.user, meeting.schedule_event)
        return meeting, access

    @database_sync_to_async
    def _sync_state(self):
        meeting = get_meeting_by_uuid(self.meeting_uuid)
        return sync_state_payload(meeting, self.user)

    @database_sync_to_async
    def _open_session(self, data: dict):
        meeting = get_meeting_by_uuid(self.meeting_uuid)
        return open_material_session(
            meeting=meeting,
            user=self.user,
            resource_kind=str(data.get("resource_kind") or data.get("resourceKind") or ""),
            title=str(data.get("title") or ""),
            open_url=str(data.get("open_url") or data.get("openUrl") or data.get("url") or ""),
            content_text=str(data.get("content_text") or data.get("contentText") or data.get("text") or ""),
            material_id=data.get("material_id") or data.get("materialId"),
            interactive_id=data.get("interactive_id") or data.get("interactiveId"),
            cabinet_file_id=data.get("cabinet_file_id") or data.get("cabinetFileId"),
            row_kind=str(data.get("row_kind") or data.get("rowKind") or data.get("kind") or ""),
            material_type=str(data.get("material_type") or data.get("materialType") or ""),
            interactive_type=str(data.get("interactive_type") or data.get("interactiveType") or ""),
            initial_state=data.get("state") if isinstance(data.get("state"), dict) else None,
        )

    @database_sync_to_async
    def _close_session(self, session_id):
        meeting = get_meeting_by_uuid(self.meeting_uuid)
        close_material_session(meeting=meeting, user=self.user, session_id=session_id)

    @database_sync_to_async
    def _set_permission(self, data: dict, mode: str):
        meeting = get_meeting_by_uuid(self.meeting_uuid)
        return set_interaction_mode(
            meeting=meeting,
            user=self.user,
            mode=mode,
            session_id=data.get("session_id") or data.get("sessionId"),
            collaborative_scope=data.get("collaborative_scope") or data.get("collaborativeScope"),
            collaborative_user_ids=data.get("collaborative_user_ids") or data.get("collaborativeUserIds"),
            collaboration_permission=data.get("collaboration_permission") or data.get("collaborationPermission"),
        )

    @database_sync_to_async
    def _apply_operation(self, data: dict, action: str):
        meeting = get_meeting_by_uuid(self.meeting_uuid)
        return apply_material_operation(
            meeting=meeting,
            user=self.user,
            action=action,
            payload=data.get("payload") if isinstance(data.get("payload"), dict) else {},
            operation_id=str(data.get("operation_id") or data.get("operationId") or ""),
            session_id=data.get("session_id") or data.get("sessionId"),
            base_version=data.get("base_version") if data.get("base_version") is not None else data.get("baseVersion"),
        )

    @database_sync_to_async
    def _serialize_session(self, session):
        # session может быть detached — перечитаем с meeting.
        from .meeting_material_models import MeetingMaterialSession

        fresh = (
            MeetingMaterialSession.objects.select_related("meeting", "meeting__schedule_event", "material")
            .filter(pk=session.pk)
            .first()
        )
        return serialize_material_session(fresh, user=self.user, include_state=True)

    @database_sync_to_async
    def _serialize_session_by_id(self, session_id):
        from .meeting_material_models import MeetingMaterialSession

        fresh = (
            MeetingMaterialSession.objects.select_related("meeting", "meeting__schedule_event", "material")
            .filter(pk=session_id, is_active=True)
            .first()
        )
        return serialize_material_session(fresh, user=self.user, include_state=True)

    @database_sync_to_async
    def _report_screenshare(self, payload: dict, active: bool):
        meeting = get_meeting_by_uuid(self.meeting_uuid)
        return report_screenshare_state(
            meeting=meeting,
            user=self.user,
            active=active,
            local_sharing=bool(payload.get("localSharing") or payload.get("local_sharing")),
            presenter_jitsi_id=str(
                payload.get("presenterJitsiId")
                or payload.get("presenter_jitsi_id")
                or ""
            ),
            content_width=payload.get("contentWidth") or payload.get("content_width"),
            content_height=payload.get("contentHeight") or payload.get("content_height"),
        )

    @database_sync_to_async
    def _set_screenshare_permission(self, payload: dict, enabled: bool):
        meeting = get_meeting_by_uuid(self.meeting_uuid)
        return set_screenshare_permission(
            meeting=meeting,
            user=self.user,
            participants_can_annotate=enabled,
            session_id=payload.get("session_id")
            or payload.get("sessionId")
            or payload.get("screenShareSessionId"),
        )

    @database_sync_to_async
    def _apply_screenshare_operation(self, data: dict, action: str):
        meeting = get_meeting_by_uuid(self.meeting_uuid)
        payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
        if not payload:
            payload = {
                key: value
                for key, value in data.items()
                if key not in ("type", "action", "operation_id", "operationId")
            }
        return apply_screenshare_operation(
            meeting=meeting,
            user=self.user,
            action=action,
            payload=payload,
            operation_id=str(data.get("operation_id") or data.get("operationId") or ""),
            session_id=(
                data.get("session_id")
                or data.get("sessionId")
                or data.get("screenShareSessionId")
                or payload.get("screenShareSessionId")
            ),
        )
