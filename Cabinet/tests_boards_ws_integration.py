"""End-to-end WS-проверка: быстрый штрих одного участника долетает до другого целиком.

В отличие от tests_boards_consumer_buffer.py (юнит на _send_or_buffer_scene),
здесь поднимаются два реальных WebsocketCommunicator через channel layer —
максимально близко к тому, что видит браузер.
"""
from __future__ import annotations

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TransactionTestCase

from Cabinet.boards_consumers import InteractiveBoardConsumer
from Cabinet.models import InteractiveBoard, Profile, Student


class BoardWebsocketRapidStrokeTests(TransactionTestCase):
    """TransactionTestCase — WS-коммуникаторы бегут в своём event loop/потоке,
    обычный TestCase с обёрткой в транзакцию тут ненадёжен."""

    def setUp(self):
        self.teacher = User.objects.create_user(username="ws_board_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()

        self.student_user = User.objects.create_user(username="ws_board_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()

        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Иван",
            last_name="Ученик",
            status="active",
        )
        self.board = InteractiveBoard.objects.create(
            owner=self.teacher,
            title="WS test",
            student=self.student,
        )

    async def _connect(self, user):
        communicator = WebsocketCommunicator(
            InteractiveBoardConsumer.as_asgi(),
            f"/ws/interactive-boards/{self.board.id}/",
        )
        communicator.scope["user"] = user
        communicator.scope["url_route"] = {"kwargs": {"board_id": str(self.board.id)}}
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        return communicator

    async def test_rapid_scene_ops_from_student_all_reach_teacher(self):
        teacher_ws = await self._connect(self.teacher)
        student_ws = await self._connect(self.student_user)
        try:
            # Оба получают presence join друг друга — сливаем это, до чистого состояния.
            await teacher_ws.receive_json_from(timeout=2)
            await student_ws.receive_json_from(timeout=2)

            # Быстрый штрих: 5 точек одного элемента подряд, без пауз (как реальный freedraw).
            for i in range(1, 6):
                await student_ws.send_json_to({
                    "type": "scene_ops",
                    "client_id": "student-tab",
                    "version": i,
                    "ops": {
                        "baseVersion": i - 1,
                        "ops": [{
                            "op": "upsert",
                            "element": {"id": "stroke-1", "version": i, "points": list(range(i))},
                        }],
                        "files": {},
                        "appStatePatch": {},
                    },
                })

            # Учитель должен в итоге увидеть версию 5 элемента stroke-1 — не потеряв её
            # где-то в промежуточных (задропанных бы раньше) кадрах.
            seen_versions = []
            for _ in range(6):
                try:
                    msg = await teacher_ws.receive_json_from(timeout=1)
                except Exception:
                    break
                if msg.get("type") != "scene_ops":
                    continue
                for op in msg.get("ops", {}).get("ops", []):
                    if op.get("element", {}).get("id") == "stroke-1":
                        seen_versions.append(op["element"]["version"])

            self.assertIn(
                5, seen_versions,
                f"Финальная версия штриха не долетела до учителя. Получено: {seen_versions}",
            )
        finally:
            for ws in (teacher_ws, student_ws):
                try:
                    await ws.disconnect()
                except BaseException:
                    pass

    async def test_student_reconnect_still_receives_teacher_ops(self):
        teacher_ws = await self._connect(self.teacher)
        student_ws = await self._connect(self.student_user)
        try:
            await teacher_ws.receive_json_from(timeout=2)
            await student_ws.receive_json_from(timeout=2)
            await student_ws.disconnect()

            student_ws = await self._connect(self.student_user)
            ready = await student_ws.receive_json_from(timeout=2)
            self.assertEqual(ready.get("type"), "ready")
            await student_ws.send_json_to({
                "type": "join",
                "client_id": "student-rejoin",
                "display_name": "Ученик",
            })
            joined = await student_ws.receive_json_from(timeout=2)
            self.assertEqual(joined.get("type"), "room_joined")
            self.assertEqual(joined.get("client_id"), "student-rejoin")

            await teacher_ws.send_json_to({
                "type": "scene_ops",
                "client_id": "teacher-tab",
                "version": 1,
                "ops": {
                    "baseVersion": 0,
                    "ops": [{
                        "op": "upsert",
                        "element": {"id": "after-reconnect", "version": 1},
                    }],
                    "files": {},
                    "appStatePatch": {},
                },
            })
            seen = []
            for _ in range(8):
                try:
                    msg = await student_ws.receive_json_from(timeout=1)
                except Exception:
                    break
                seen.append(msg.get("type"))
                if msg.get("type") != "scene_ops":
                    continue
                for op in msg.get("ops", {}).get("ops", []):
                    if op.get("element", {}).get("id") == "after-reconnect":
                        return
            self.fail(f"После reconnect ученик не получил ops. Типы: {seen}")
        finally:
            for ws in (teacher_ws, student_ws):
                try:
                    await ws.disconnect()
                except BaseException:
                    pass

    async def _consume_ready(self, ws):
        ready = await ws.receive_json_from(timeout=2)
        self.assertEqual(ready.get("type"), "ready")

    async def _join(self, ws, client_id, display_name):
        await ws.send_json_to({
            "type": "join",
            "client_id": client_id,
            "display_name": display_name,
        })
        seen = []
        for _ in range(8):
            msg = await ws.receive_json_from(timeout=2)
            seen.append(msg.get("type"))
            if msg.get("type") == "room_joined":
                self.assertEqual(msg.get("client_id"), client_id)
                return
        self.fail(f"Не получили room_joined для {client_id}. Типы: {seen}")

    async def _wait_scene_op(self, ws, pred, fail_msg, limit=12):
        seen = []
        for _ in range(limit):
            msg = await ws.receive_json_from(timeout=2)
            seen.append(msg.get("type"))
            if msg.get("type") != "scene_ops":
                continue
            for op in msg.get("ops", {}).get("ops", []):
                if pred(op):
                    return msg
        self.fail(f"{fail_msg}. Типы: {seen}")

    async def test_teacher_and_student_exchange_upsert_and_delete(self):
        teacher_ws = await self._connect(self.teacher)
        student_ws = await self._connect(self.student_user)
        try:
            await self._consume_ready(teacher_ws)
            await self._consume_ready(student_ws)
            await self._join(teacher_ws, "teacher-tab", "Учитель")
            await self._join(student_ws, "student-tab", "Ученик")

            await teacher_ws.send_json_to({
                "type": "scene_ops",
                "client_id": "teacher-tab",
                "version": 1,
                "ops": {
                    "baseVersion": 0,
                    "ops": [{
                        "op": "upsert",
                        "element": {"id": "rect-a", "version": 1, "type": "rectangle"},
                    }],
                    "files": {},
                    "appStatePatch": {},
                },
            })
            await self._wait_scene_op(
                student_ws,
                lambda op: op.get("element", {}).get("id") == "rect-a",
                "Ученик не получил upsert учителя",
            )

            await student_ws.send_json_to({
                "type": "scene_ops",
                "client_id": "student-tab",
                "version": 1,
                "ops": {
                    "baseVersion": 0,
                    "ops": [{
                        "op": "upsert",
                        "element": {"id": "text-b", "version": 1, "type": "text", "text": "TEST"},
                    }],
                    "files": {},
                    "appStatePatch": {},
                },
            })
            await self._wait_scene_op(
                teacher_ws,
                lambda op: op.get("element", {}).get("id") == "text-b",
                "Учитель не получил upsert ученика",
            )

            await teacher_ws.send_json_to({
                "type": "scene_ops",
                "client_id": "teacher-tab",
                "version": 2,
                "ops": {
                    "baseVersion": 1,
                    "ops": [{"op": "delete", "id": "rect-a"}],
                    "files": {},
                    "appStatePatch": {},
                },
            })
            await self._wait_scene_op(
                student_ws,
                lambda op: (
                    (op.get("op") == "delete" and op.get("id") == "rect-a")
                    or (
                        op.get("op") == "upsert"
                        and op.get("element", {}).get("id") == "rect-a"
                        and op.get("element", {}).get("isDeleted")
                    )
                ),
                "Ученик не получил delete учителя",
            )
        finally:
            for ws in (teacher_ws, student_ws):
                try:
                    await ws.disconnect()
                except BaseException:
                    pass

    async def test_snapshot_response_is_unicast_to_target(self):
        teacher_ws = await self._connect(self.teacher)
        student_ws = await self._connect(self.student_user)
        try:
            await self._consume_ready(teacher_ws)
            await self._consume_ready(student_ws)
            await self._join(teacher_ws, "teacher-tab", "Учитель")
            await self._join(student_ws, "student-tab", "Ученик")
            await teacher_ws.send_json_to({
                "type": "snapshot_response",
                "client_id": "teacher-tab",
                "target_client_id": "student-tab",
                "version": 3,
                "scene": {
                    "elements": [{"id": "keep", "version": 1, "isDeleted": False}],
                    "appState": {},
                    "files": {},
                },
            })
            seen = []
            snap = None
            for _ in range(12):
                msg = await student_ws.receive_json_from(timeout=2)
                seen.append(msg.get("type"))
                if msg.get("type") == "snapshot_response":
                    snap = msg
                    break
            self.assertIsNotNone(snap, f"Ученик не получил snapshot_response. Типы: {seen}")
            self.assertEqual(snap.get("target_client_id"), "student-tab")
            self.assertEqual(snap["scene"]["elements"][0]["id"], "keep")

            await teacher_ws.send_json_to({"type": "ping", "t": 7})
            ping_seen = []
            for _ in range(8):
                msg = await teacher_ws.receive_json_from(timeout=2)
                ping_seen.append(msg.get("type"))
                self.assertNotEqual(
                    msg.get("type"),
                    "snapshot_response",
                    "snapshot_response не должен приходить отправителю",
                )
                if msg.get("type") == "pong":
                    break
            else:
                self.fail(f"Учитель не получил pong. Типы: {ping_seen}")
        finally:
            for ws in (teacher_ws, student_ws):
                try:
                    await ws.disconnect()
                except BaseException:
                    pass

    async def test_student_disconnect_sends_presence_leave(self):
        teacher_ws = await self._connect(self.teacher)
        student_ws = await self._connect(self.student_user)
        try:
            await self._consume_ready(teacher_ws)
            await self._consume_ready(student_ws)
            await self._join(teacher_ws, "teacher-tab", "Учитель")
            await self._join(student_ws, "student-tab", "Ученик")
            await student_ws.disconnect()
            seen = []
            leave = None
            for _ in range(12):
                msg = await teacher_ws.receive_json_from(timeout=2)
                seen.append(msg.get("type"))
                if msg.get("type") == "presence_leave" and msg.get("client_id") == "student-tab":
                    leave = msg
                    break
            self.assertIsNotNone(
                leave,
                f"Учитель не получил presence_leave после disconnect ученика. Типы: {seen}",
            )
        finally:
            try:
                await teacher_ws.disconnect()
            except BaseException:
                pass
