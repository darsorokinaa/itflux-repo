"""Локальная проверка JWT комнаты. Секрет тестовый, токен в утверждения не попадает."""

from datetime import datetime, timedelta, timezone as dt_timezone

import jwt
from django.test import SimpleTestCase, override_settings

from Cabinet.jitsi_service import generate_jitsi_jwt, get_jitsi_domain, inspect_jitsi_access_token

SECRET = "test-secret-not-for-production-32b"
ROOM = "digitalstreamisolated01"
OTHER = "digitalstreamisolated02"


class _User:
    pk = 7
    email = ""
    username = "isolated"

    def get_full_name(self):
        return "Проверка"


def _sign(payload: dict, secret: str = SECRET) -> str:
    return jwt.encode(payload, secret, algorithm="HS256", headers={"kid": "itflux-test", "typ": "JWT"})


def _base(**overrides) -> dict:
    now = datetime.now(dt_timezone.utc)
    payload = {
        "aud": "jitsi",
        "iss": "itflux-test",
        "sub": "lesson.example.test",
        "room": ROOM,
        "iat": int(now.timestamp()),
        "nbf": int((now - timedelta(seconds=10)).timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
        "context": {"user": {"id": "7", "name": "Проверка", "moderator": "true", "affiliation": "owner"}},
    }
    payload.update(overrides)
    return payload


@override_settings(
    DEBUG=True,
    JITSI_DOMAIN="lesson.example.test",
    JITSI_AUTH_MODE="jwt",
    JITSI_APP_ID="itflux-test",
    JITSI_APP_SECRET=SECRET,
    JITSI_SUB="lesson.example.test",
    JITSI_AUD="jitsi",
)
class JitsiTokenIsolationTests(SimpleTestCase):
    def test_valid_token_matches_its_room_and_teacher_role(self):
        token = generate_jitsi_jwt(room_name=ROOM, user=_User(), is_moderator=True)
        self.assertEqual(
            inspect_jitsi_access_token(token, secret=SECRET, room_name=ROOM, expect_moderator=True),
            "ok",
        )

    def test_same_token_is_rejected_for_another_room(self):
        token = generate_jitsi_jwt(room_name=ROOM, user=_User(), is_moderator=True)
        self.assertEqual(
            inspect_jitsi_access_token(token, secret=SECRET, room_name=OTHER, expect_moderator=True),
            "wrong_room",
        )

    def test_expired_token(self):
        past = datetime.now(dt_timezone.utc) - timedelta(hours=2)
        token = _sign(_base(exp=int(past.timestamp()), iat=int((past - timedelta(minutes=5)).timestamp())))
        self.assertEqual(
            inspect_jitsi_access_token(token, secret=SECRET, room_name=ROOM, expect_moderator=True),
            "expired",
        )

    def test_bad_signature(self):
        token = _sign(_base(), secret="other-secret-not-the-server-one")
        self.assertEqual(
            inspect_jitsi_access_token(token, secret=SECRET, room_name=ROOM, expect_moderator=True),
            "bad_signature",
        )

    def test_missing_room_claim(self):
        payload = _base()
        payload.pop("room")
        token = _sign(payload)
        self.assertEqual(
            inspect_jitsi_access_token(token, secret=SECRET, room_name=ROOM, expect_moderator=True),
            "missing_claims",
        )

    def test_student_token_is_not_a_teacher(self):
        token = generate_jitsi_jwt(room_name=ROOM, user=_User(), is_moderator=False)
        self.assertEqual(
            inspect_jitsi_access_token(token, secret=SECRET, room_name=ROOM, expect_moderator=False),
            "ok",
        )
        self.assertEqual(
            inspect_jitsi_access_token(token, secret=SECRET, room_name=ROOM, expect_moderator=True),
            "role_mismatch",
        )

    def test_wildcard_room_is_rejected(self):
        token = _sign(_base(room="*"))
        self.assertEqual(
            inspect_jitsi_access_token(token, secret=SECRET, room_name=ROOM, expect_moderator=True),
            "wrong_room",
        )

    @override_settings(DEBUG=False, JITSI_DOMAIN="", JITSI_ALLOW_PUBLIC_MEET=False)
    def test_production_empty_domain_is_not_public_meet(self):
        self.assertEqual(get_jitsi_domain(), "")

    @override_settings(DEBUG=False, JITSI_DOMAIN="meet.jit.si", JITSI_ALLOW_PUBLIC_MEET=False)
    def test_production_explicit_public_host_is_not_used(self):
        self.assertEqual(get_jitsi_domain(), "")

    @override_settings(DEBUG=True, JITSI_DOMAIN="", JITSI_ALLOW_PUBLIC_MEET=False)
    def test_debug_still_has_public_meet_for_local_experiments(self):
        self.assertEqual(get_jitsi_domain(), "meet.jit.si")
