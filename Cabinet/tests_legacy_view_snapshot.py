from django.test import SimpleTestCase

from Cabinet.homework_api import _merge_result_payload
from Cabinet.task_answer_sync import _legacy_view_answer
from Generator.variant_scoring import LEGACY_VIEW_KEY, attach_variant_scoring, is_legacy_view


class LegacyViewSnapshotTests(SimpleTestCase):
    def _payload(self):
        return {
            "by_task_id": {"1": "5"},
            "scores": {"2": 1},
            "tasks_snapshot": [{"id": 1, "max_score": 2}],
            "grading_snapshot": [{"id": 1, "max_score": 2, "answer": "5"}],
            LEGACY_VIEW_KEY: "r69",
        }

    def test_marker_detected(self):
        self.assertTrue(is_legacy_view(self._payload()))
        self.assertFalse(is_legacy_view({"tasks_snapshot": []}))

    def test_client_cannot_change_marker_or_snapshot(self):
        merged = _merge_result_payload(self._payload(), {"by_task_id": {"1": "6"}, LEGACY_VIEW_KEY: None})
        self.assertEqual(merged[LEGACY_VIEW_KEY], "r69")
        self.assertEqual(merged["grading_snapshot"][0]["answer"], "5")
        merged = _merge_result_payload({"by_task_id": {}}, {LEGACY_VIEW_KEY: "x"})
        self.assertNotIn(LEGACY_VIEW_KEY, _merge_result_payload({"a": 1}, {LEGACY_VIEW_KEY: "x"}))

    def test_rescoring_drops_legacy_view(self):
        data = attach_variant_scoring(self._payload(), None)
        self.assertNotIn(LEGACY_VIEW_KEY, data)
        self.assertNotIn("grading_snapshot", data)

    def test_bank_answer_sync_does_not_rescore(self):
        updated = _legacy_view_answer(self._payload(), 1, "7")
        self.assertEqual(updated["grading_snapshot"][0]["answer"], "7")
        self.assertNotIn("scoring", updated)
        self.assertEqual(updated["scores"], {"2": 1})
        self.assertFalse(_legacy_view_answer(self._payload(), 1, "5"))
        self.assertIsNone(_legacy_view_answer({"grading_snapshot": [{"id": 1}]}, 1, "7"))
