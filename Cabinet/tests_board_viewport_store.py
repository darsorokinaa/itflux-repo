"""Shared viewport store: L1 + Redis/cache."""

from __future__ import annotations

from django.test import SimpleTestCase

from Cabinet.board_viewport_store import (
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

    def test_clear(self):
        set_teacher_viewport("b1", {"client_id": "t1", "scrollX": 1, "scrollY": 2, "zoom": 1})
        clear_teacher_viewport("b1")
        self.assertIsNone(get_teacher_viewport("b1"))
