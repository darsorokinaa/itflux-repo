"""Shared viewport store: L1 + Redis/cache."""

from __future__ import annotations

import json

from django.core.cache import cache
from django.test import SimpleTestCase

from Cabinet.board_viewport_store import (
    _cache_key,
    _get_redis,
    clear_teacher_viewport,
    get_teacher_viewport,
    reset_viewport_store_for_tests,
    set_teacher_viewport,
)


class BoardViewportStoreTests(SimpleTestCase):
    def setUp(self):
        reset_viewport_store_for_tests()

    def tearDown(self):
        clear_teacher_viewport("b1")
        reset_viewport_store_for_tests()

    def test_set_get_roundtrip_local(self):
        set_teacher_viewport(
            "b1",
            {
                "client_id": "t1",
                "scrollX": 11,
                "scrollY": 22,
                "zoom": 1.5,
                "role": "teacher",
                "seq": 4,
            },
        )
        got = get_teacher_viewport("b1")
        self.assertIsNotNone(got)
        self.assertEqual(got["type"], "viewport_state")
        self.assertEqual(got["scrollX"], 11)
        self.assertEqual(got["zoom"], 1.5)
        self.assertEqual(got["seq"], 4)

    def test_rapid_updates_keep_latest_in_l1_even_when_remote_throttled(self):
        set_teacher_viewport("b1", {"client_id": "t1", "scrollX": 1, "scrollY": 0, "zoom": 1})
        set_teacher_viewport("b1", {"client_id": "t1", "scrollX": 50, "scrollY": 0, "zoom": 1.2})
        got = get_teacher_viewport("b1")
        self.assertEqual(got["scrollX"], 50)
        self.assertEqual(got["zoom"], 1.2)
        set_teacher_viewport(
            "b1",
            {"client_id": "t1", "scrollX": 90, "scrollY": 3, "zoom": 1.4},
            force=True,
        )
        got = get_teacher_viewport("b1")
        self.assertEqual(got["scrollX"], 90)
        self.assertEqual(got["zoom"], 1.4)

    def test_get_prefers_higher_seq_when_l1_is_stale(self):
        set_teacher_viewport(
            "b1",
            {"client_id": "t1", "scrollX": 100, "scrollY": 0, "zoom": 1, "seq": 10},
            force=True,
        )
        from Cabinet import board_viewport_store as store

        store._LOCAL["b1"] = {
            "type": "viewport_state",
            "client_id": "t1",
            "scrollX": 1,
            "scrollY": 0,
            "zoom": 1,
            "seq": 1,
        }
        got = get_teacher_viewport("b1")
        self.assertEqual(got["scrollX"], 100)
        self.assertEqual(got["seq"], 10)

    def test_remount_low_seq_does_not_lose_to_stale_high_seq_l1(self):
        """Teacher remount resets client seq; other worker L1 may still have seq=500."""
        from Cabinet import board_viewport_store as store

        store._LOCAL["b1"] = {
            "type": "viewport_state",
            "client_id": "t1",
            "scrollX": 1,
            "scrollY": 0,
            "zoom": 1,
            "seq": 500,
            "stored_at": 1000.0,
        }
        remote = {
            "type": "viewport_state",
            "client_id": "t1",
            "scrollX": 200,
            "scrollY": 0,
            "zoom": 1.5,
            "seq": 1,
            "stored_at": 2000.0,
        }
        client = _get_redis()
        if client is not None:
            client.setex(_cache_key("b1"), 3600, json.dumps(remote))
        else:
            cache.set(_cache_key("b1"), remote, timeout=3600)
        got = get_teacher_viewport("b1")
        self.assertEqual(got["scrollX"], 200)
        self.assertEqual(got["seq"], 1)

    def test_simultaneous_force_writes_last_write_wins(self):
        set_teacher_viewport(
            "b1",
            {"client_id": "t1", "scrollX": 1, "seq": 1},
            force=True,
        )
        set_teacher_viewport(
            "b1",
            {"client_id": "t1", "scrollX": 77, "seq": 2},
            force=True,
        )
        got = get_teacher_viewport("b1")
        self.assertEqual(got["scrollX"], 77)

    def test_clear(self):
        set_teacher_viewport("b1", {"client_id": "t1", "scrollX": 1, "scrollY": 2, "zoom": 1})
        clear_teacher_viewport("b1")
        self.assertIsNone(get_teacher_viewport("b1"))
