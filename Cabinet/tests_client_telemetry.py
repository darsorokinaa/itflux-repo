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
