"""WebSocket для совместного редактирования интерактивных досок."""

from __future__ import annotations

import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .boards_api import board_collab_group_name

logger = logging.getLogger(__name__)

MAX_WS_TEXT_BYTES = 2_000_000


class InteractiveBoardConsumer(AsyncWebsocketConsumer):
    """
    Комната доски: учитель-владелец и привязанный ученик (или edit-доступ)
    обмениваются live-сценой, presence и курсорами.
    """

    async def connect(self):
        self.board_id = self.scope["url_route"]["kwargs"]["board_id"]
        self.group_name = board_collab_group_name(self.board_id)
        self.client_id = ""
        self.display_name = ""
        self.role = ""
        self.user = self.scope.get("user")

        if not self.user or not self.user.is_authenticated:
            await self.close(code=4401)
            return

        perm = await self._get_permission()
        if perm not in ("owner", "edit", "view"):
            await self.close(code=4403)
            return

        self.permission = perm
        self.can_edit = perm in ("owner", "edit")
        self.role = "teacher" if perm == "owner" else ("student" if self.can_edit else "viewer")
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(
            text_data=json.dumps(
                {
                    "type": "ready",
                    "board_id": str(self.board_id),
                    "can_edit": self.can_edit,
                    "permission": self.permission,
                    "role": self.role,
                }
            )
        )

    async def disconnect(self, close_code):
        if getattr(self, "group_name", None):
            if self.client_id:
                await self.channel_layer.group_send(
                    self.group_name,
                    {
                        "type": "board.collab",
                        "payload": {
                            "type": "presence_leave",
                            "client_id": self.client_id,
                            "user_id": getattr(self.user, "id", None),
                            "display_name": self.display_name,
                        },
                    },
                )
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if bytes_data and len(bytes_data) > MAX_WS_TEXT_BYTES:
            return
        if text_data and len(text_data) > MAX_WS_TEXT_BYTES:
            return
        if not text_data:
            return
        try:
            data = json.loads(text_data)
        except (TypeError, ValueError):
            return
        if not isinstance(data, dict):
            return

        msg_type = data.get("type")
        if msg_type == "ping":
            await self.send(text_data=json.dumps({"type": "pong", "t": data.get("t")}))
            return

        if msg_type == "join":
            self.client_id = str(data.get("client_id") or "")[:64]
            self.display_name = str(data.get("display_name") or "")[:120]
            role = str(data.get("role") or self.role or "")[:32]
            if role in ("teacher", "student", "viewer"):
                self.role = role
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "board.collab",
                    "payload": {
                        "type": "presence_join",
                        "client_id": self.client_id,
                        "user_id": self.user.id,
                        "display_name": self.display_name,
                        "can_edit": self.can_edit,
                        "role": self.role,
                    },
                },
            )
            return

        if msg_type == "scene_live":
            if not self.can_edit:
                return
            scene = data.get("scene")
            if not isinstance(scene, dict):
                return
            # Не ретранслируем blob:/data: как «постоянные» — клиент обязан
            # externalize перед publishLive; фильтруем на сервере на всякий случай.
            files = scene.get("files") or {}
            clean_files = {}
            if isinstance(files, dict):
                for fid, meta in files.items():
                    if not isinstance(meta, dict):
                        continue
                    url = str(meta.get("dataURL") or meta.get("url") or "")
                    if url.startswith("blob:") or url.startswith("data:"):
                        continue
                    clean_files[str(fid)[:128]] = meta
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "board.collab",
                    "payload": {
                        "type": "scene_live",
                        "client_id": str(data.get("client_id") or self.client_id)[:64],
                        "user_id": self.user.id,
                        "display_name": self.display_name,
                        "version": data.get("version"),
                        "scene": {
                            "elements": scene.get("elements") or [],
                            "appState": scene.get("appState") or {},
                            "files": clean_files,
                        },
                    },
                },
            )
            return

        if msg_type in ("cursor", "cursor_move"):
            x = data.get("x")
            y = data.get("y")
            try:
                x = float(x)
                y = float(y)
            except (TypeError, ValueError):
                return
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "board.collab",
                    "payload": {
                        "type": "cursor_move",
                        "client_id": str(data.get("client_id") or self.client_id)[:64],
                        "user_id": self.user.id,
                        "display_name": self.display_name,
                        "role": self.role,
                        "x": x,
                        "y": y,
                        "tool": str(data.get("tool") or "pointer")[:32],
                    },
                },
            )
            return

        if msg_type == "active_tool_change":
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "board.collab",
                    "payload": {
                        "type": "active_tool_change",
                        "client_id": str(data.get("client_id") or self.client_id)[:64],
                        "user_id": self.user.id,
                        "display_name": self.display_name,
                        "tool": str(data.get("tool") or "")[:64],
                    },
                },
            )

    async def board_collab(self, event):
        payload = event.get("payload") or {}
        # Не эхоить собственные live-сообщения обратно отправителю.
        if (
            payload.get("type") in ("scene_live", "cursor", "cursor_move", "presence_join", "active_tool_change")
            and payload.get("client_id")
            and payload.get("client_id") == self.client_id
        ):
            return
        try:
            await self.send(text_data=json.dumps(payload, ensure_ascii=False))
        except Exception:
            logger.debug("board collab send failed", exc_info=True)

    @database_sync_to_async
    def _get_permission(self):
        from .models import InteractiveBoard

        try:
            board = InteractiveBoard.objects.select_related("student", "group").get(
                pk=self.board_id
            )
        except (InteractiveBoard.DoesNotExist, ValueError, TypeError):
            return None
        return board.get_permission_for(self.user)
