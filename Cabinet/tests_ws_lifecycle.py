from django.test import SimpleTestCase

from Cabinet.ws_lifecycle import format_ws_lifecycle, request_id_from_scope


class WsLifecycleTests(SimpleTestCase):
    def test_keeps_a_safe_request_id(self):
        scope = {"headers": [(b"x-request-id", b"abc12345-req")]}
        self.assertEqual(request_id_from_scope(scope), "abc12345-req")

    def test_generates_an_id_when_the_header_is_missing_or_unsafe(self):
        missing = request_id_from_scope({"headers": []})
        leaked = request_id_from_scope({"headers": [(b"x-request-id", b"eyJhbGciOiJIUzI1NiJ9.secret")]})
        self.assertEqual(len(missing), 16)
        self.assertNotIn("eyJ", leaked)
        self.assertNotIn(".", leaked)

    def test_line_has_the_lifecycle_fields_and_drops_a_token(self):
        line = format_ws_lifecycle(
            event="disconnect",
            request_id="abc12345",
            user_id=7,
            lesson_id="lesson-1",
            board_id="board-1",
            close_code=1000,
            duration_s="1.500",
            last_activity_ts="100.000",
            ts="100.000",
            access_token="secret-token",
            query="access_token=hmac",
        )
        self.assertIn("event=disconnect", line)
        self.assertIn("request_id=abc12345", line)
        self.assertIn("user_id=7", line)
        self.assertIn("lesson_id=lesson-1", line)
        self.assertIn("board_id=board-1", line)
        self.assertIn("close_code=1000", line)
        self.assertIn("ts=100.000", line)
        self.assertIn("duration_s=1.500", line)
        self.assertIn("last_activity_ts=100.000", line)
        self.assertNotIn("secret-token", line)
        self.assertNotIn("access_token", line)
        self.assertNotIn("hmac", line)
