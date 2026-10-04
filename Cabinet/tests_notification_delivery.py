import threading
import time

from django.test import SimpleTestCase

from Cabinet.channel_layer_guard import assert_channel_layer_process_model
from Cabinet.large_json import install_large_json_log
from Cabinet.notification_delivery import (
    reset_notification_delivery_for_tests,
    schedule_notification,
    start_background_delivery,
)


class NotificationDeliveryTests(SimpleTestCase):
    def tearDown(self):
        reset_notification_delivery_for_tests()

    def test_queued_send_returns_before_the_job(self):
        start_background_delivery()
        finished = threading.Event()

        def slow():
            time.sleep(0.3)
            finished.set()

        started = time.perf_counter()
        schedule_notification(slow)
        self.assertLess(time.perf_counter() - started, 0.15)
        self.assertTrue(finished.wait(2))


class ChannelLayerGuardTests(SimpleTestCase):
    def test_single_process_inmemory_is_allowed(self):
        from django.test import override_settings

        with override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}):
            assert_channel_layer_process_model()

    def test_multi_process_inmemory_fails(self):
        import os

        from django.test import override_settings

        os.environ["DAPHNE_WORKERS"] = "2"
        try:
            with override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}):
                with self.assertRaises(RuntimeError):
                    assert_channel_layer_process_model()
        finally:
            os.environ.pop("DAPHNE_WORKERS", None)


class LargeJsonLogTests(SimpleTestCase):
    def test_large_parse_logs_size_not_body(self):
        import json
        import logging

        install_large_json_log()
        payload = "x" * 1_000_000
        with self.assertLogs("itflux.json", level=logging.WARNING) as captured:
            json.loads(json.dumps({"blob": payload}))
        text = "\n".join(captured.output)
        self.assertIn("large_json bytes=", text)
        self.assertNotIn(payload, text)
