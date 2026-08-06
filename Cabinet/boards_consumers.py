"""WebSocket для совместного редактирования интерактивных досок."""

from __future__ import annotations

import asyncio
import json
import logging
import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings

from .boards_api import board_collab_group_name

logger = logging.getLogger(__name__)

MAX_WS_TEXT_BYTES = 2_000_000
CURSOR_MIN_INTERVAL_SEC = 0.035  # ~28 Hz
SCENE_LIVE_MIN_INTERVAL_SEC = 0.012  # ~80 Hz max relay
# Защита от раздувания буфера при очень быстром штрихе.
MAX_BUFFERED_OPS = 800


def _board_debug_enabled() -> bool:
    return bool(getattr(settings, "DEBUG", False))


def coalesce_element_ops(ops: list) -> list:
    """
    Сжимает последовательность upsert/delete: для одного element id
    остаётся только последнее действие. Upsert несёт полное состояние
    элемента Excalidraw, поэтому промежуточные версии штриха не нужны.
    """
    if not ops:
        return []
    latest: dict[str, dict] = {}
    order: list[str] = []
    for item in ops:
        if not isinstance(item, dict):
            continue
        kind = item.get("op")
        if kind == "delete":
            eid = str(item.get("id") or "")
            if not eid:
                continue
            if eid not in latest:
                order.append(eid)
            latest[eid] = item
        elif kind == "upsert":
            el = item.get("element")
            if not isinstance(el, dict):
                continue
            eid = str(el.get("id") or "")
            if not eid:
                continue
            if eid not in latest:
                order.append(eid)
            latest[eid] = item
    return [latest[eid] for eid in order if eid in latest]


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
        # Per-client буфер: иначе ops ученика в том же 25ms-окне затирали
        # pending учителя (и наоборот) — штрихи/элементы пропадали у пиров.
        self._pending_scene_by_client: dict[str, dict] = {}
        self._scene_flush_task = None

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
        if _board_debug_enabled():
            logger.info(
                "board_ws connect board=%s user=%s perm=%s",
                self.board_id,
                getattr(self.user, "id", None),
                self.permission,
            )
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
        task = getattr(self, "_scene_flush_task", None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        pending_map = getattr(self, "_pending_scene_by_client", None) or {}
        if pending_map and getattr(self, "group_name", None):
            # Последние buffered кадры — отдать пирам перед выходом.
            try:
                for event in pending_map.values():
                    await self.channel_layer.group_send(self.group_name, event)
            except Exception:
                logger.debug("board collab flush on disconnect failed", exc_info=True)
        self._pending_scene_by_client = {}
        self._scene_flush_task = None
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
        if _board_debug_enabled():
            logger.info(
                "board_ws disconnect board=%s user=%s client=%s code=%s",
                getattr(self, "board_id", None),
                getattr(getattr(self, "user", None), "id", None),
                getattr(self, "client_id", ""),
                close_code,
            )

    async def _flush_all_pending(self):
        pending_map = self._pending_scene_by_client
        self._pending_scene_by_client = {}
        self._scene_flush_task = None
        if not pending_map:
            return
        self._last_scene_live_at = time.monotonic()
        for event in pending_map.values():
            payload = event.get("payload") or {}
            if payload.get("type") == "scene_ops":
                ops_wrap = payload.get("ops") or {}
                ops_wrap["ops"] = coalesce_element_ops(list(ops_wrap.get("ops") or []))
            await self.channel_layer.group_send(self.group_name, event)

    async def _flush_pending_scene(self, delay: float):
        try:
            if delay > 0:
                await asyncio.sleep(delay)
            await self._flush_all_pending()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("board collab pending scene flush failed", exc_info=True)
            self._scene_flush_task = None

    def _merge_into_client_buffer(self, client_key: str, event: dict) -> None:
        payload = event.get("payload") or {}
        pending = self._pending_scene_by_client.get(client_key)
        pending_payload = (pending or {}).get("payload") or {}
        if (
            pending is not None
            and payload.get("type") == "scene_ops"
            and pending_payload.get("type") == "scene_ops"
        ):
            pending_ops = pending_payload.setdefault("ops", {})
            new_ops = payload.get("ops") or {}
            merged_ops = list(pending_ops.get("ops") or []) + list(new_ops.get("ops") or [])
            if len(merged_ops) > MAX_BUFFERED_OPS:
                merged_ops = coalesce_element_ops(merged_ops)
            pending_ops["ops"] = merged_ops
            pending_ops["files"] = {
                **(pending_ops.get("files") or {}),
                **(new_ops.get("files") or {}),
            }
            pending_ops["appStatePatch"] = {
                **(pending_ops.get("appStatePatch") or {}),
                **(new_ops.get("appStatePatch") or {}),
            }
            # baseVersion оставляем от первого пакета окна; version — свежий.
            pending_payload["version"] = payload.get("version", pending_payload.get("version"))
            return

        # scene_live (полный снимок) или смена типа — latest-wins для ЭТОГО клиента.
        self._pending_scene_by_client[client_key] = event

    async def _send_or_buffer_scene(self, event: dict):
        """
        Rate-limit с per-client буфером.

        Для scene_live (полный снапшот) latest-wins по клиенту безопасен.
        Для scene_ops копим upsert/delete внутри окна, а не заменяем пакет целиком —
        иначе при нескольких элементах/точках за 25ms пир терял часть дельты.

        Важно: буфер разделён по client_id. Общий однослотовый pending раньше
        затирал ops другого участника в том же окне троттлинга.
        """
        now = time.monotonic()
        elapsed = now - self._last_scene_live_at
        payload = event.get("payload") or {}
        client_key = str(payload.get("client_id") or "") or "_anon"

        if elapsed >= SCENE_LIVE_MIN_INTERVAL_SEC:
            # Сначала отдаём уже накопленное от других клиентов, затем текущий пакет.
            if self._pending_scene_by_client:
                task = self._scene_flush_task
                if task and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                await self._flush_all_pending()
            self._last_scene_live_at = time.monotonic()
            await self.channel_layer.group_send(self.group_name, event)
            return

        self._merge_into_client_buffer(client_key, event)

        if self._scene_flush_task is None or self._scene_flush_task.done():
            delay = max(0.0, SCENE_LIVE_MIN_INTERVAL_SEC - elapsed)
            self._scene_flush_task = asyncio.create_task(self._flush_pending_scene(delay))

    async def receive(self, text_data=None, bytes_data=None):
        if bytes_data and len(bytes_data) > MAX_WS_TEXT_BYTES:
            if _board_debug_enabled():
                logger.warning(
                    "board_ws drop oversized binary board=%s bytes=%s",
                    getattr(self, "board_id", None),
                    len(bytes_data),
                )
            return
        if text_data and len(text_data) > MAX_WS_TEXT_BYTES:
            if _board_debug_enabled():
                logger.warning(
                    "board_ws drop oversized text board=%s bytes=%s",
                    getattr(self, "board_id", None),
                    len(text_data),
                )
            try:
                await self.send(
                    text_data=json.dumps(
                        {
                            "type": "error",
                            "code": "MESSAGE_TOO_LARGE",
                            "detail": "Сообщение слишком большое для синхронизации.",
                        }
                    )
                )
            except Exception:
                pass
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
            if _board_debug_enabled():
                logger.info(
                    "board_ws join board=%s user=%s client=%s role=%s",
                    self.board_id,
                    getattr(self.user, "id", None),
                    self.client_id,
                    self.role,
                )
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
                clean_ops = coalesce_element_ops(clean_ops)
                if _board_debug_enabled():
                    logger.debug(
                        "board_ws scene_ops board=%s client=%s ops=%s files=%s bytes=%s",
                        self.board_id,
                        str(data.get("client_id") or self.client_id)[:64],
                        len(clean_ops),
                        len(_clean_files(ops_payload.get("files"))),
                        len(text_data),
                    )
                await self._send_or_buffer_scene(
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
                    }
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
            if _board_debug_enabled():
                logger.debug(
                    "board_ws scene_live board=%s client=%s elements=%s files=%s bytes=%s",
                    self.board_id,
                    str(data.get("client_id") or self.client_id)[:64],
                    len(elements) if isinstance(elements, list) else 0,
                    len(clean_files),
                    len(text_data),
                )
            await self._send_or_buffer_scene(
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
                }
            )
            return

        if msg_type == "file_add":
            if not self.can_edit:
                return
            raw_files = data.get("files")
            if not isinstance(raw_files, list) or not raw_files:
                return
            clean_files = []
            for item in raw_files[:40]:
                if not isinstance(item, dict):
                    continue
                fid = str(item.get("id") or "")[:128]
                url = str(item.get("url") or "")[:2048]
                if not fid or not url:
                    continue
                if url.startswith("blob:") or url.startswith("data:"):
                    continue
                clean_files.append(
                    {
                        "id": fid,
                        "url": url,
                        "mimeType": str(item.get("mimeType") or "image/png")[:64],
                        "created": item.get("created"),
                    }
                )
            if not clean_files:
                return
            elements = data.get("elements")
            clean_elements = elements[:50] if isinstance(elements, list) else []
            if _board_debug_enabled():
                logger.debug(
                    "board_ws file_add board=%s client=%s files=%s elements=%s",
                    self.board_id,
                    str(data.get("client_id") or self.client_id)[:64],
                    [f["id"] for f in clean_files],
                    len(clean_elements),
                )
            # Без троттлинг-буфера сцены: файл должен дойти до пира сразу и
            # до/вместе с image-элементом, иначе Excalidraw зависает в pending.
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "board.collab",
                    "payload": {
                        "type": "file_add",
                        "client_id": str(data.get("client_id") or self.client_id)[:64],
                        "user_id": self.user.id,
                        "display_name": self.display_name,
                        "files": clean_files,
                        "elements": clean_elements,
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
            return

        if msg_type == "snapshot_request":
            # Клиент после reconnect запрашивает REST snapshot сам; здесь только ack.
            # Оставляем тип для совместимости протокола — без тяжёлой работы в consumer.
            await self.send(
                text_data=json.dumps(
                    {
                        "type": "snapshot_request_ack",
                        "board_id": str(self.board_id),
                        "known_revision": data.get("known_revision"),
                    }
                )
            )
            return

        if _board_debug_enabled() and msg_type:
            logger.debug(
                "board_ws unknown_type board=%s type=%s",
                getattr(self, "board_id", None),
                str(msg_type)[:64],
            )

    async def board_collab(self, event):
        payload = event.get("payload") or {}
        # Не эхоить собственные live-сообщения обратно отправителю.
        if (
            payload.get("type")
            in (
                "scene_live",
                "scene_ops",
                "file_add",
                "cursor",
                "cursor_move",
                "presence_join",
                "active_tool_change",
            )
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
