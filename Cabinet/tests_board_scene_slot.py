import asyncio

from channels.layers import InMemoryChannelLayer
from django.test import SimpleTestCase

from Cabinet.board_scene_slot import (
    reset_board_scenes_for_tests,
    resolve_board_event,
    stage_board_event,
    staged_scene_count,
)
from Cabinet.channel_retention import clean_expired_channels
from Cabinet.http_db_budget import HttpDbBudget
from Cabinet.process_snapshot import pressure_alerts


def _queued_element_bytes(layer, channel):
    total = 0
    queue = layer.channels[channel]
    for _expiry, message in list(queue._queue):
        scene = ((message.get("payload") or {}).get("scene") or {})
        elements = scene.get("elements") or ""
        total += len(elements)
    return total


class BoardSceneSlotTests(SimpleTestCase):
    def setUp(self):
        reset_board_scenes_for_tests()

    def test_repeated_scene_live_keeps_one_copy(self):
        async def main():
            layer = InMemoryChannelLayer(capacity=100, expiry=3600)
            await layer.group_add("board", "specific.one!abcdefghijkl")
            await layer.group_add("board", "specific.two!abcdefghijkl")
            blob = "e" * 100_000
            naive = InMemoryChannelLayer(capacity=100, expiry=3600)
            await naive.group_add("board", "specific.one!abcdefghijkl")
            await naive.group_add("board", "specific.two!abcdefghijkl")
            for index in range(20):
                event = {
                    "type": "board.collab",
                    "payload": {
                        "type": "scene_live",
                        "client_id": "c",
                        "scene": {"elements": blob, "n": index},
                    },
                }
                await naive.group_send("board", event)
                await layer.group_send("board", stage_board_event("board", event))
            return naive, layer

        naive, staged = asyncio.run(main())
        naive_bytes = _queued_element_bytes(naive, "specific.one!abcdefghijkl")
        staged_bytes = _queued_element_bytes(staged, "specific.one!abcdefghijkl")
        self.assertEqual(naive_bytes, 20 * 100_000)
        self.assertEqual(staged_bytes, 0)
        self.assertEqual(staged_scene_count(), 1)
        queued = staged.channels["specific.one!abcdefghijkl"]._queue[0][1]
        resolved = resolve_board_event(queued)
        self.assertEqual(len(resolved["payload"]["scene"]["elements"]), 100_000)

    def test_expired_queue_is_dropped_without_a_reader(self):
        async def main():
            layer = InMemoryChannelLayer(capacity=10, expiry=-1)
            await layer.send("specific.orphan!abcdefghijkl", {"type": "x", "body": "z" * 1000})
            self.assertEqual(layer.channels["specific.orphan!abcdefghijkl"].qsize(), 1)
            return clean_expired_channels(layer)

        stats = asyncio.run(main())
        self.assertEqual(stats["channel_queued_messages"], 0)


class HttpDbBudgetTests(SimpleTestCase):
    def test_second_request_is_rejected_when_the_only_slot_is_busy(self):
        async def app(scope, receive, send):
            await asyncio.sleep(0.2)
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"ok"})

        gate = HttpDbBudget(app, limit=1, wait_timeout=0.05)
        statuses = []

        async def call():
            sent = []

            async def send(message):
                sent.append(message)

            async def receive():
                return {"type": "http.request", "body": b""}

            await gate({"type": "http"}, receive, send)
            statuses.append(sent[0]["status"])

        async def main():
            await asyncio.gather(call(), call())

        asyncio.run(main())
        self.assertEqual(sorted(statuses), [200, 503])


class PostgresBudgetAlertTests(SimpleTestCase):
    def test_thresholds(self):
        self.assertEqual(pressure_alerts({"pg_active": 10}), [])
        self.assertIn("threshold=75", pressure_alerts({"pg_active": 80})[0])
        self.assertIn("threshold=90", pressure_alerts({"pg_active": 91})[0])
        self.assertIn(
            "pg_idle_in_transaction_over_30s=2",
            pressure_alerts({"pg_active": 1, "pg_idle_in_transaction_over_30s": 2})[0],
        )
