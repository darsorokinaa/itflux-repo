"""_send_or_buffer_scene: ops внутри окна троттлинга должны копиться, не перезаписываться.

Регресс на баг: быстрый штрих (много scene_ops за короткое время) терял
промежуточные апдейты, потому что буфер заменял pending целиком вместо
накопления — у пира пропадали куски рисунка.

Также: ops разных клиентов в одном окне не должны затирать друг друга.
"""
from __future__ import annotations

import json
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


class ViewportRelayTests(IsolatedAsyncioTestCase):
    async def test_viewport_update_is_relayed_and_stored_shared(self):
        from Cabinet.board_viewport_store import get_teacher_viewport, reset_viewport_store_for_tests

        reset_viewport_store_for_tests()
        consumer = _make_consumer()
        consumer.user = type("U", (), {"id": 9})()
        consumer.client_id = "teacher-1"
        consumer.display_name = "Учитель"
        consumer.role = "teacher"
        consumer.permission = "owner"
        consumer.board_id = "board-vp-1"
        consumer.can_edit = True
        consumer._last_viewport_at = 0.0

        await consumer.receive(
            text_data=(
                '{"type":"viewport_update","client_id":"teacher-1",'
                '"scrollX":120.5,"scrollY":-40,"zoom":1.25,"centerX":840,"centerY":500,"seq":3}'
            )
        )
        self.assertEqual(consumer.channel_layer.group_send.call_count, 1)
        event = consumer.channel_layer.group_send.call_args.args[1]
        payload = event["payload"]
        self.assertEqual(payload["type"], "viewport_update")
        self.assertEqual(payload["scrollX"], 120.5)
        self.assertEqual(payload["scrollY"], -40)
        self.assertEqual(payload["zoom"], 1.25)
        self.assertEqual(payload["centerX"], 840)
        self.assertEqual(payload["centerY"], 500)
        cached = get_teacher_viewport("board-vp-1")
        self.assertIsNotNone(cached)
        self.assertEqual(cached["type"], "viewport_state")
        self.assertEqual(cached["scrollX"], 120.5)

    async def test_viewport_request_sends_cached_state_from_store(self):
        from Cabinet.board_viewport_store import reset_viewport_store_for_tests, set_teacher_viewport

        reset_viewport_store_for_tests()
        consumer = _make_consumer()
        consumer.user = type("U", (), {"id": 2})()
        consumer.client_id = "student-1"
        consumer.display_name = "Ученик"
        consumer.role = "student"
        consumer.permission = "edit"
        consumer.board_id = "board-vp-2"
        consumer.can_edit = True
        consumer.send = AsyncMock()
        set_teacher_viewport(
            "board-vp-2",
            {
                "type": "viewport_state",
                "client_id": "teacher-1",
                "scrollX": 10,
                "scrollY": 20,
                "zoom": 1,
                "seq": 1,
                "role": "teacher",
            },
        )
        await consumer.receive(text_data='{"type":"viewport_request","client_id":"student-1"}')
        self.assertTrue(consumer.send.called)
        sent = consumer.send.call_args.kwargs.get("text_data") or consumer.send.call_args.args[0]
        import json

        data = json.loads(sent)
        self.assertEqual(data["type"], "viewport_state")
        self.assertEqual(data["scrollX"], 10)

    async def test_student_viewport_update_is_relayed(self):
        consumer = _make_consumer()
        consumer.user = type("U", (), {"id": 4})()
        consumer.client_id = "student-2"
        consumer.display_name = "Анна"
        consumer.role = "student"
        consumer.permission = "edit"
        consumer.board_id = "board-vp-student"
        consumer.can_edit = True
        consumer._last_viewport_at = 0.0
        await consumer.receive(
            text_data=(
                '{"type":"viewport_update","client_id":"student-2",'
                '"scrollX":10,"scrollY":20,"zoom":1,"centerX":200,"centerY":160,"seq":1}'
            )
        )
        self.assertEqual(consumer.channel_layer.group_send.call_count, 1)
        payload = consumer.channel_layer.group_send.call_args.args[1]["payload"]
        self.assertEqual(payload["role"], "student")
        self.assertEqual(payload["centerX"], 200)

    async def test_sync_probe_echoes_ack_to_sender(self):
        consumer = _make_consumer()
        consumer.user = type("U", (), {"id": 1})()
        consumer.client_id = "c1"
        consumer.display_name = "A"
        consumer.role = "teacher"
        consumer.permission = "owner"
        consumer.board_id = "board-probe"
        consumer.can_edit = True
        consumer.send = AsyncMock()
        await consumer.receive(
            text_data='{"type":"sync_probe","client_id":"c1","probe_id":"p1","t_sent":1000}'
        )
        self.assertTrue(consumer.send.called)
        import json

        ack = json.loads(consumer.send.call_args.kwargs.get("text_data") or consumer.send.call_args.args[0])
        self.assertEqual(ack["type"], "sync_probe_ack")
        self.assertTrue(ack.get("echo"))
        self.assertEqual(ack["probe_id"], "p1")
        self.assertIn("t_server", ack)
        # Также ретрансляция пирам.
        self.assertTrue(consumer.channel_layer.group_send.called)


class SnapshotRequestRelayTests(IsolatedAsyncioTestCase):
    async def test_snapshot_request_acks_and_broadcasts_to_peers(self):
        consumer = _make_consumer()
        consumer.user = type("U", (), {"id": 3})()
        consumer.client_id = "rejoin-1"
        consumer.display_name = "Ученик"
        consumer.role = "student"
        consumer.permission = "edit"
        consumer.board_id = "board-snap"
        consumer.can_edit = True
        consumer.send = AsyncMock()
        await consumer.receive(
            text_data='{"type":"snapshot_request","client_id":"rejoin-1","known_revision":7}'
        )
        ack = json.loads(
            consumer.send.call_args.kwargs.get("text_data") or consumer.send.call_args.args[0]
        )
        self.assertEqual(ack["type"], "snapshot_request_ack")
        self.assertEqual(ack["known_revision"], 7)
        self.assertTrue(consumer.channel_layer.group_send.called)
        event = consumer.channel_layer.group_send.call_args.args[1]
        self.assertEqual(event["payload"]["type"], "snapshot_request")
        self.assertEqual(event["payload"]["client_id"], "rejoin-1")

    async def test_snapshot_request_not_delivered_to_requester_or_viewer(self):
        requester = _make_consumer()
        requester.client_id = "rejoin-1"
        requester.can_edit = True
        requester.send = AsyncMock()
        await requester.board_collab(
            {"payload": {"type": "snapshot_request", "client_id": "rejoin-1"}}
        )
        self.assertFalse(requester.send.called)

        viewer = _make_consumer()
        viewer.client_id = "view-1"
        viewer.can_edit = False
        viewer.send = AsyncMock()
        await viewer.board_collab(
            {"payload": {"type": "snapshot_request", "client_id": "rejoin-1"}}
        )
        self.assertFalse(viewer.send.called)

        editor = _make_consumer()
        editor.client_id = "teacher-1"
        editor.can_edit = True
        editor.send = AsyncMock()
        await editor.board_collab(
            {"payload": {"type": "snapshot_request", "client_id": "rejoin-1"}}
        )
        self.assertTrue(editor.send.called)

    async def test_snapshot_response_reaches_only_target(self):
        teacher = _make_consumer()
        teacher.user = type("U", (), {"id": 1})()
        teacher.client_id = "teacher-1"
        teacher.display_name = "Учитель"
        teacher.can_edit = True
        teacher.board_id = "board-snap"
        teacher.send = AsyncMock()
        await teacher.receive(
            text_data=json.dumps(
                {
                    "type": "snapshot_response",
                    "client_id": "teacher-1",
                    "target_client_id": "rejoin-1",
                    "version": 4,
                    "scene": {
                        "elements": [{"id": "a", "version": 1}],
                        "appState": {},
                        "files": {"f1": {"dataURL": "blob:x"}},
                    },
                }
            )
        )
        self.assertTrue(teacher.channel_layer.group_send.called)
        event = teacher.channel_layer.group_send.call_args.args[1]
        self.assertEqual(event["payload"]["type"], "snapshot_response")
        self.assertEqual(event["payload"]["target_client_id"], "rejoin-1")
        self.assertNotIn("f1", event["payload"]["scene"]["files"])

        target = _make_consumer()
        target.client_id = "rejoin-1"
        target.can_edit = True
        target.send = AsyncMock()
        await target.board_collab(event)
        self.assertTrue(target.send.called)

        other = _make_consumer()
        other.client_id = "student-2"
        other.can_edit = True
        other.send = AsyncMock()
        await other.board_collab(event)
        self.assertFalse(other.send.called)

        sender = _make_consumer()
        sender.client_id = "teacher-1"
        sender.can_edit = True
        sender.send = AsyncMock()
        await sender.board_collab(event)
        self.assertFalse(sender.send.called)
