"""Двухклиентная симуляция collab-пайплайна (без браузера)."""

from __future__ import annotations

import json
from unittest import IsolatedAsyncioTestCase

from Cabinet.board_viewport_store import (
    get_teacher_viewport,
    reset_viewport_store_for_tests,
)
from Cabinet.boards_consumers import coalesce_element_ops
from Cabinet.tests_boards_consumer_buffer import _make_consumer, _ops_event

class TwoClientCollabSimTests(IsolatedAsyncioTestCase):
    """Учитель + ученик через один consumer-пайплайн (имитация channel layer)."""

    def setUp(self):
        reset_viewport_store_for_tests()

    async def test_teacher_stroke_ops_reach_student_without_drop(self):
        teacher = _make_consumer()
        teacher.user = type("U", (), {"id": 1})()
        teacher.client_id = "teacher"
        teacher.display_name = "T"
        teacher.role = "teacher"
        teacher.permission = "owner"
        teacher.board_id = "b-dual"
        teacher.can_edit = True
        teacher._last_scene_live_at = 0.0

        # Быстрый штрих: 5 upsert одного id
        for v in range(1, 6):
            await teacher._send_or_buffer_scene(
                _ops_event("teacher", "stroke-a", v, points=list(range(v)))
            )

        # Flush буфера
        if teacher._pending_scene_by_client:
            await teacher._flush_all_pending()

        payloads = [
            c.args[1]["payload"]
            for c in teacher.channel_layer.group_send.call_args_list
            if c.args and isinstance(c.args[1], dict)
        ]
        ops_msgs = [p for p in payloads if p.get("type") == "scene_ops"]
        self.assertGreaterEqual(len(ops_msgs), 1)
        # После coalesce у пира — последняя версия штриха
        last = ops_msgs[-1]
        ops = last["ops"]["ops"]
        coalesced = coalesce_element_ops(ops)
        by_id = {
            (o["element"]["id"] if o["op"] == "upsert" else o["id"]): o
            for o in coalesced
        }
        self.assertIn("stroke-a", by_id)
        self.assertEqual(by_id["stroke-a"]["element"]["version"], 5)

    async def test_student_cannot_spoof_teacher_role_on_join(self):
        student = _make_consumer()
        student.user = type("U", (), {"id": 2})()
        student.client_id = ""
        student.display_name = ""
        student.role = "student"
        student.permission = "edit"
        student.board_id = "b-role"
        student.can_edit = True
        student.group_name = "board_b-role"

        await student.receive(
            text_data=json.dumps(
                {
                    "type": "join",
                    "client_id": "stu-1",
                    "display_name": "Ученик",
                    "role": "teacher",  # spoof
                }
            )
        )
        self.assertEqual(student.role, "student")
        event = student.channel_layer.group_send.call_args.args[1]
        self.assertEqual(event["payload"]["role"], "student")

    async def test_viewport_immediate_not_dropped_under_throttle(self):
        teacher = _make_consumer()
        teacher.user = type("U", (), {"id": 1})()
        teacher.client_id = "teacher"
        teacher.display_name = "T"
        teacher.role = "teacher"
        teacher.permission = "owner"
        teacher.board_id = "b-vp"
        teacher.can_edit = True
        teacher._last_viewport_at = 0.0
        teacher._pending_viewport_event = None
        teacher._viewport_flush_task = None

        await teacher.receive(
            text_data=json.dumps(
                {
                    "type": "viewport_update",
                    "client_id": "teacher",
                    "scrollX": 1,
                    "scrollY": 2,
                    "zoom": 1,
                    "seq": 1,
                }
            )
        )
        # Второе сразу — без immediate ушло бы в буфер; с immediate — сразу.
        await teacher.receive(
            text_data=json.dumps(
                {
                    "type": "viewport_update",
                    "client_id": "teacher",
                    "scrollX": 99,
                    "scrollY": 88,
                    "zoom": 2,
                    "seq": 2,
                    "immediate": True,
                }
            )
        )
        cached = get_teacher_viewport("b-vp")
        self.assertIsNotNone(cached)
        self.assertEqual(cached["scrollX"], 99)
        self.assertEqual(cached["zoom"], 2)

    async def test_clear_keeps_delete_over_upsert(self):
        ops = coalesce_element_ops(
            [
                {"op": "upsert", "element": {"id": "x", "version": 1}},
                {"op": "delete", "id": "x", "version": 2},
            ]
        )
        self.assertEqual(ops[0]["op"], "delete")
