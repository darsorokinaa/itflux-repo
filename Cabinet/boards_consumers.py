"""WebSocket для совместного редактирования интерактивных досок."""

from __future__ import annotations

import json
import logging
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

from .boards_api import board_collab_group_name

logger = logging.getLogger(__name__)

MAX_WS_TEXT_BYTES = 2_000_000
CURSOR_MIN_INTERVAL_SEC = 0.035  # ~28 Hz
SCENE_LIVE_MIN_INTERVAL_SEC = 0.05


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
        self._last_cursor_at = 0.0
        self._last_scene_live_at = 0.0

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

        if msg_type in ("scene_live", "scene_ops"):
            if not self.can_edit:
                return
            now = time.monotonic()
            if now - self._last_scene_live_at < SCENE_LIVE_MIN_INTERVAL_SEC:
                return
            self._last_scene_live_at = now

            def _clean_files(files):
                clean = {}
                if not isinstance(files, dict):
                    return clean
                for fid, meta in files.items():
                    if not isinstance(meta, dict):
                        continue
                    url = str(meta.get("dataURL") or meta.get("url") or "")
                    if url.startswith("blob:") or url.startswith("data:"):
                        continue
                    clean[str(fid)[:128]] = meta
                return clean

            if msg_type == "scene_ops":
                ops_payload = data.get("ops")
                if not isinstance(ops_payload, dict):
                    return
                ops = ops_payload.get("ops") or []
                if not isinstance(ops, list) or len(ops) > 500:
                    return
                # Компактная ретрансляция: только upsert/delete без blob.
                clean_ops = []
                for item in ops[:500]:
                    if not isinstance(item, dict):
                        continue
                    kind = item.get("op")
                    if kind == "delete":
                        eid = str(item.get("id") or "")[:64]
                        if eid:
                            clean_ops.append({
                                "op": "delete",
                                "id": eid,
                                "version": item.get("version"),
                                "versionNonce": item.get("versionNonce"),
                                "updated": item.get("updated"),
                            })
                    elif kind == "upsert":
                        el = item.get("element")
                        if isinstance(el, dict) and el.get("id"):
                            clean_ops.append({"op": "upsert", "element": el})
                await self.channel_layer.group_send(
                    self.group_name,
                    {
                        "type": "board.collab",
                        "payload": {
                            "type": "scene_ops",
                            "client_id": str(data.get("client_id") or self.client_id)[:64],
                            "user_id": self.user.id,
                            "display_name": self.display_name,
                            "version": data.get("version"),
                            "ops": {
                                "baseVersion": ops_payload.get("baseVersion"),
                                "ops": clean_ops,
                                "files": _clean_files(ops_payload.get("files")),
                                "appStatePatch": ops_payload.get("appStatePatch")
                                if isinstance(ops_payload.get("appStatePatch"), dict)
                                else {},
                            },
                        },
                    },
                )
                return

            scene = data.get("scene")
            if not isinstance(scene, dict):
                return
            # Не ретранслируем blob:/data: как «постоянные» — клиент обязан
            # externalize перед publishLive; фильтруем на сервере на всякий случай.
            clean_files = _clean_files(scene.get("files") or {})
            elements = scene.get("elements") or []
            if isinstance(elements, list) and len(elements) > 20_000:
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
                            "elements": elements,
                            "appState": scene.get("appState") or {},
                            "files": clean_files,
                        },
                    },
                },
            )
            return

        if msg_type in ("cursor", "cursor_move"):
            now = time.monotonic()
            if now - self._last_cursor_at < CURSOR_MIN_INTERVAL_SEC:
                return
            self._last_cursor_at = now
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
            payload.get("type")
            in ("scene_live", "scene_ops", "cursor", "cursor_move", "presence_join", "active_tool_change")
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
