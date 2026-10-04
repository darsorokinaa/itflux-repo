import re
from pathlib import Path

from django.test import Client, TestCase


class ClientTelemetryApiTests(TestCase):
    def setUp(self):
        from django.core.cache import cache

        cache.clear()
        self.client = Client()

    def test_unknown_event_rejected(self):
        res = self.client.post(
            "/api/cabinet/client-telemetry/",
            data={"event": "not_allowed"},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 400)

    def test_allowed_event_logged_without_auth(self):
        res = self.client.post(
            "/api/cabinet/client-telemetry/",
            data={
                "event": "board_ws_closed",
                "context": {"page": "/cabinet/boards/x", "online": True, "viewport": "390x844"},
                "extra": {"code": 1006},
            },
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json().get("ok"))

    def test_resume_events_allowed(self):
        for event in (
            "PWA_BACKGROUND",
            "RESUME_START",
            "RESUME_TIMEOUT",
            "MANUAL_RECONNECT_CLICK",
            "MANUAL_RELOAD_CLICK",
            "APP_FATAL_ERROR",
            "APP_RENDER_ERROR",
        ):
            res = self.client.post(
                "/api/cabinet/client-telemetry/",
                data={"event": event, "extra": {"pwa": True, "stage": "jitsi"}},
                content_type="application/json",
            )
            self.assertEqual(res.status_code, 200, event)
            self.assertTrue(res.json().get("ok"), event)

    def test_collaboration_and_runtime_events_allowed(self):
        for event in (
            "collaboration_connect_start",
            "collaboration_connected",
            "collaboration_reconnect",
            "collaboration_error",
            "MAIN_THREAD_STALL",
            "JITSI_DUPLICATE",
            "RESOURCE_SNAPSHOT",
            "SW_UPDATE_FOUND",
            "pip_failed",
            "initial_state_received",
        ):
            res = self.client.post(
                "/api/cabinet/client-telemetry/",
                data={"event": event, "extra": {"material": 1}},
                content_type="application/json",
            )
            self.assertEqual(res.status_code, 200, event)
            self.assertTrue(res.json().get("ok"), event)

    def test_board_snapshot_events_allowed(self):
        for event in (
            "board_full_state_requested",
            "board_full_state_received",
            "board_error",
            "board_health_sample",
        ):
            res = self.client.post(
                "/api/cabinet/client-telemetry/",
                data={"event": event, "extra": {"boardId": "x"}},
                content_type="application/json",
            )
            self.assertEqual(res.status_code, 200, event)
            self.assertTrue(res.json().get("ok"), event)

    def test_batch_accepts_known_and_counts_unknown(self):
        res = self.client.post(
            "/api/cabinet/client-telemetry/",
            data={"events": [
                {"event": "board_ws_closed", "extra": {"code": 1006}},
                {"event": "not_allowed"},
            ]},
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["accepted"], 1)
        self.assertEqual(body["rejected"], 1)

    def test_rate_limit_sets_retry_after(self):
        from django.core.cache import cache

        cache.clear()
        statuses = []
        retry = None
        for _ in range(45):
            res = self.client.post(
                "/api/cabinet/client-telemetry/",
                data={"event": "board_ws_closed"},
                content_type="application/json",
            )
            statuses.append(res.status_code)
            if res.status_code == 429:
                retry = res.headers.get("Retry-After")
                break
        self.assertIn(429, statuses)
        self.assertEqual(retry, "60")

    def test_frontend_event_names_are_allowed(self):
        from Cabinet.client_telemetry import ALLOWED_EVENTS

        source = (
            Path(__file__).resolve().parents[1] / "frontend/src/utils/clientTelemetry.js"
        ).read_text(encoding="utf-8")
        block = source.split("CLIENT_TELEMETRY_EVENTS", 1)[1].split("]);", 1)[0]
        names = re.findall(r'"([A-Za-z0-9_]+)"', block)
        missing = [name for name in names if name not in ALLOWED_EVENTS]
        self.assertEqual(missing, [])
