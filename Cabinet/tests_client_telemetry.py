from django.test import Client, TestCase


class ClientTelemetryApiTests(TestCase):
    def setUp(self):
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
