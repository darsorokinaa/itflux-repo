"""_send_or_buffer_scene: ops внутри окна троттлинга должны копиться, не перезаписываться.

Регресс на баг: быстрый штрих (много scene_ops за короткое время) терял
промежуточные апдейты, потому что буфер заменял pending целиком вместо
накопления — у пира пропадали куски рисунка.

Также: ops разных клиентов в одном окне не должны затирать друг друга.
"""
from __future__ import annotations

from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from Cabinet.boards_consumers import InteractiveBoardConsumer, coalesce_element_ops


def _make_consumer():
    consumer = InteractiveBoardConsumer()
    consumer.group_name = "board_test"
    consumer.channel_layer = AsyncMock()
    consumer._last_scene_live_at = 0.0
    consumer._pending_scene_by_client = {}
    consumer._scene_flush_task = None
    return consumer


def _ops_event(client_id, element_id, version, points=None):
    element = {"id": element_id, "version": version}
    if points is not None:
        element["points"] = points
    return {
        "type": "board.collab",
        "payload": {
            "type": "scene_ops",
            "client_id": client_id,
            "user_id": 1,
            "display_name": "Ученик",
            "version": version,
            "ops": {
                "baseVersion": version - 1,
                "ops": [{"op": "upsert", "element": element}],
                "files": {},
                "appStatePatch": {},
            },
        },
    }


class CoalesceElementOpsTests(IsolatedAsyncioTestCase):
    def test_coalesce_keeps_latest_upsert_per_id(self):
        ops = [
            {"op": "upsert", "element": {"id": "a", "version": 1}},
            {"op": "upsert", "element": {"id": "b", "version": 1}},
            {"op": "upsert", "element": {"id": "a", "version": 3}},
            {"op": "delete", "id": "b", "version": 2},
        ]
        out = coalesce_element_ops(ops)
        self.assertEqual(len(out), 2)
        by_id = {
            (o["element"]["id"] if o["op"] == "upsert" else o["id"]): o
            for o in out
        }
        self.assertEqual(by_id["a"]["element"]["version"], 3)
        self.assertEqual(by_id["b"]["op"], "delete")


class SendOrBufferSceneTests(IsolatedAsyncioTestCase):
    async def test_rapid_ops_from_same_client_are_merged_not_dropped(self):
        consumer = _make_consumer()
        # Первый пакет уходит сразу (окно ещё не запущено) и взводит троттлинг.
        await consumer._send_or_buffer_scene(_ops_event("c1", "stroke-1", 1))
        self.assertEqual(consumer.channel_layer.group_send.call_count, 1)

        # Второй и третий приходят внутри окна — копим, не затираем.
        await consumer._send_or_buffer_scene(_ops_event("c1", "stroke-2", 2))
        await consumer._send_or_buffer_scene(_ops_event("c1", "stroke-3", 3))

        self.assertEqual(consumer.channel_layer.group_send.call_count, 1)
        pending_ops = consumer._pending_scene_by_client["c1"]["payload"]["ops"]["ops"]
        sent_ids = [op["element"]["id"] for op in pending_ops]
        self.assertEqual(sent_ids, ["stroke-2", "stroke-3"])

        if consumer._scene_flush_task:
            consumer._scene_flush_task.cancel()

    async def test_ops_from_different_clients_are_kept_separately(self):
        consumer = _make_consumer()
        await consumer._send_or_buffer_scene(_ops_event("c1", "stroke-1", 1))
        await consumer._send_or_buffer_scene(_ops_event("c2", "stroke-2", 1))

        # Разные авторы — оба слота живы (раньше c2 затирал pending c1).
        self.assertIn("c2", consumer._pending_scene_by_client)
        # c1 уже ушёл сразу; в буфере только c2, либо оба если первый тоже буферизован.
        # После первого send окно открыто — второй в буфере.
        pending_ops = consumer._pending_scene_by_client["c2"]["payload"]["ops"]["ops"]
        self.assertEqual([op["element"]["id"] for op in pending_ops], ["stroke-2"])

        # Имитация третьего пакета от c1 внутри окна — свой слот, не затирает c2.
        await consumer._send_or_buffer_scene(_ops_event("c1", "stroke-1b", 2))
        self.assertIn("c1", consumer._pending_scene_by_client)
        self.assertIn("c2", consumer._pending_scene_by_client)
        c1_ids = [
            op["element"]["id"]
            for op in consumer._pending_scene_by_client["c1"]["payload"]["ops"]["ops"]
        ]
        c2_ids = [
            op["element"]["id"]
            for op in consumer._pending_scene_by_client["c2"]["payload"]["ops"]["ops"]
        ]
        self.assertEqual(c1_ids, ["stroke-1b"])
        self.assertEqual(c2_ids, ["stroke-2"])

        if consumer._scene_flush_task:
            consumer._scene_flush_task.cancel()

    async def test_flush_sends_all_client_slots(self):
        consumer = _make_consumer()
        await consumer._send_or_buffer_scene(_ops_event("c1", "a", 1))
        await consumer._send_or_buffer_scene(_ops_event("c2", "b", 1))
        await consumer._send_or_buffer_scene(_ops_event("c1", "a2", 2))

        before = consumer.channel_layer.group_send.call_count
        await consumer._flush_all_pending()
        # Должны уйти оба клиента (c1 с накопленным a2, c2 с b).
        self.assertEqual(consumer.channel_layer.group_send.call_count, before + 2)
        self.assertEqual(consumer._pending_scene_by_client, {})
