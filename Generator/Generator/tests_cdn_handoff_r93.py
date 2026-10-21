"""r93: одноразовый токен переноса сессии на cdn."""
import json
import os
import tempfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from Generator import cdn_handoff

UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0"
HOSTS = ["cdn.itflux-academy.ru", "itflux-academy.ru", "testserver"]


@override_settings(ALLOWED_HOSTS=HOSTS)
class CdnHandoffR93Tests(TestCase):
    def setUp(self):
        cache.clear()
        fd, self.log = tempfile.mkstemp(suffix=".log")
        os.close(fd)
        self.ov = override_settings(CDN_USERS_LOG=self.log)
        self.ov.enable()
        U = get_user_model()
        self.u = U.objects.create_user("r93a", password="pw-a")
        self.other = U.objects.create_user("r93b", password="pw-b")

    def tearDown(self):
        self.ov.disable()
        os.unlink(self.log)

    def _issue(self, client=None, nxt="/cabinet/meetings/abc/?_itflux_v=123&x=1"):
        c = client or Client(HTTP_USER_AGENT=UA)
        c.force_login(self.u)
        r = c.post("/api/cdn-handoff/issue/", data=json.dumps({"next": nxt, "reason": "call_drops"}),
                   content_type="application/json", HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["url"].split("t=", 1)[1]

    def _redeem(self, token, client=None, ua=UA):
        c = client or Client(HTTP_USER_AGENT=ua)
        return c, c.get("/api/cdn-handoff/redeem/", {"t": token}, HTTP_HOST="cdn.itflux-academy.ru")

    def test_happy_path_logs_in_and_strips_version(self):
        t = self._issue()
        c, r = self._redeem(t)
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r["Location"], "/cabinet/meetings/abc/?x=1&itflux_cdn=call_drops")
        self.assertEqual(int(c.session["_auth_user_id"]), self.u.pk)
        cookie = c.cookies[cdn_handoff.settings.SESSION_COOKIE_NAME]
        self.assertTrue(cookie["httponly"])
        self.assertTrue(cdn_handoff.prefers_cdn(self.u))
        with open(self.log) as fh:
            self.assertIn("reason=call_drops", fh.read())

    def test_single_use(self):
        t = self._issue()
        self._redeem(t)
        c, r = self._redeem(t)
        self.assertTrue(r["Location"].startswith("/cabinet/login"))
        self.assertNotIn("_auth_user_id", c.session)

    def test_expired(self):
        from datetime import timedelta
        from django.utils import timezone as tz
        from Cabinet.cdn_handoff_models import CdnHandoffToken
        t = self._issue()
        CdnHandoffToken.objects.update(expires_at=tz.now() - timedelta(seconds=1))
        c, r = self._redeem(t)
        self.assertTrue(r["Location"].startswith("/cabinet/login"))
        self.assertNotIn("_auth_user_id", c.session)

    def test_ttl_is_short_and_token_not_stored(self):
        from Cabinet.cdn_handoff_models import CdnHandoffToken
        t = cdn_handoff.issue_token(mock.Mock(META={}), self.u, "/x", "call_drops")
        row = CdnHandoffToken.objects.get()
        self.assertLessEqual((row.expires_at - row.created_at).total_seconds(), 61)
        self.assertNotEqual(row.token_hash, t)

    def test_wrong_user_session_not_replaced(self):
        t = self._issue()
        c = Client(HTTP_USER_AGENT=UA)
        c.force_login(self.other)
        c, r = self._redeem(t, client=c)
        self.assertTrue(r["Location"].startswith("/cabinet/login"))
        self.assertEqual(int(c.session["_auth_user_id"]), self.other.pk)

    def test_wrong_user_agent(self):
        t = self._issue()
        c, r = self._redeem(t, ua="curl/8")
        self.assertNotIn("_auth_user_id", c.session)

    def test_garbage_token(self):
        c, r = self._redeem("nope")
        self.assertEqual(r.status_code, 302)
        self.assertNotIn("_auth_user_id", c.session)

    def test_redeem_only_on_cdn_and_issue_needs_auth(self):
        t = self._issue()
        r = Client(HTTP_USER_AGENT=UA).get("/api/cdn-handoff/redeem/", {"t": t}, HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.status_code, 400)
        r = Client().post("/api/cdn-handoff/issue/", data="{}", content_type="application/json",
                          HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.status_code, 401)

    def test_safe_next(self):
        self.assertEqual(cdn_handoff.safe_next("https://evil/x"), "/cabinet/")
        self.assertEqual(cdn_handoff.safe_next("//evil"), "/cabinet/")
        self.assertEqual(cdn_handoff.safe_next("/a?_itflux_v=1&_itflux_v=2&itflux_nocdn=1"), "/a")


@override_settings(ALLOWED_HOSTS=HOSTS)
class CdnPinnedR93bTests(TestCase):
    def test_pinned_pref_and_issue(self):
        from datetime import timedelta
        from django.utils import timezone as tz
        from Cabinet.cdn_handoff_models import CdnPreference
        u = get_user_model().objects.create_user("r93p", password="x")
        c = Client(HTTP_USER_AGENT=UA)
        c.force_login(u)
        body = json.dumps({"next": "/cabinet/", "reason": "pinned"})
        r = c.post("/api/cdn-handoff/issue/", data=body, content_type="application/json", HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.status_code, 403)  # не закреплён — нельзя
        CdnPreference.objects.create(user=u, reason="pinned", until=tz.now() + timedelta(days=3650))
        r = c.get("/api/cdn-handoff/pref/", HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.json(), {"prefer_cdn": True, "reason": "pinned"})
        r = c.post("/api/cdn-handoff/issue/", data=json.dumps({"next": "/cabinet/", "reason": "call_drops"}),
                   content_type="application/json", HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(CdnPreference.objects.get(user=u).reason, "pinned")  # не понижен до 7 дней
