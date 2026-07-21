"""WebSocket для совместного редактирования интерактивных досок."""

from __future__ import annotations

import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .boards_api import board_collab_group_name

logger = logging.getLogger(__name__)


class InteractiveBoardConsumer(AsyncWebsocketConsumer):
    """
    Комната доски: учитель-владелец и привязанный ученик (или edit-доступ)
    обмениваются live-сценой и presence.
    """

    async def connect(self):
        self.board_id = self.scope["url_route"]["kwargs"]["board_id"]
        self.group_name = board_collab_group_name(self.board_id)
        self.client_id = ""
        self.display_name = ""
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
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        await self.send(
            text_data=json.dumps(
                {
                    "type": "ready",
                    "board_id": str(self.board_id),
                    "can_edit": self.can_edit,
                    "permission": self.permission,
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
        if not text_data:
            return
        try:
            data = json.loads(text_data)
        except (TypeError, ValueError):
            return
        if not isinstance(data, dict):
            return

        msg_type = data.get("type")
        if msg_type == "join":
            self.client_id = str(data.get("client_id") or "")[:64]
            self.display_name = str(data.get("display_name") or "")[:120]
            # presence_join уходит всем, включая других участников;
            # эхо себе режется в board_collab.
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
                            "files": scene.get("files") or {},
                        },
                    },
                },
            )
            return

        if msg_type == "cursor":
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "board.collab",
                    "payload": {
                        "type": "cursor",
                        "client_id": str(data.get("client_id") or self.client_id)[:64],
                        "user_id": self.user.id,
                        "display_name": self.display_name,
                        "x": data.get("x"),
                        "y": data.get("y"),
                    },
                },
            )

    async def board_collab(self, event):
        payload = event.get("payload") or {}
        # Не эхоить собственные live-сообщения обратно отправителю.
        if (
            payload.get("type") in ("scene_live", "cursor", "presence_join")
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
