"""r95: маршрут в телеметрии, журнал автопереходов, отчёт call_route_report."""
import json
import os
import tempfile
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, RequestFactory, TestCase, override_settings
from django.utils import timezone

from Cabinet.cdn_handoff_models import CdnSwitchEvent

UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0"
HOSTS = ["cdn.itflux-academy.ru", "itflux-academy.ru", "testserver"]


@override_settings(ALLOWED_HOSTS=HOSTS)
class CdnSwitchEventR95Tests(TestCase):
    def setUp(self):
        cache.clear()
        fd, self.log = tempfile.mkstemp(suffix=".log")
        os.close(fd)
        self.ov = override_settings(CDN_USERS_LOG=self.log)
        self.ov.enable()
        self.u = get_user_model().objects.create_user("r95a", password="pw-a")

    def tearDown(self):
        self.ov.disable()
        os.unlink(self.log)

    def _issue(self, reason):
        c = Client(HTTP_USER_AGENT=UA)
        c.force_login(self.u)
        r = c.post("/api/cdn-handoff/issue/", data=json.dumps({"next": "/cabinet/", "reason": reason}),
                   content_type="application/json", HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.status_code, 200, r.content)
        return c, r.json()["url"].split("t=", 1)[1]

    def test_issue_records_switch_and_redeem_marks(self):
        c, token = self._issue("join_timeout")
        ev = CdnSwitchEvent.objects.get()
        self.assertEqual((ev.user_id, ev.reason, ev.via, ev.route_from, ev.route_to), (self.u.pk, "join_timeout", "token", "direct", "cdn"))
        self.assertIsNone(ev.redeemed_at)
        c.get("/api/cdn-handoff/redeem/", {"t": token}, HTTP_HOST="cdn.itflux-academy.ru")
        ev.refresh_from_db()
        self.assertIsNotNone(ev.redeemed_at)

    def test_pinned_not_recorded(self):
        from Generator import cdn_handoff
        from Cabinet.cdn_handoff_models import CdnPreference
        CdnPreference.objects.create(user=self.u, reason="pinned", until=timezone.now() + timedelta(days=30))
        self._issue("pinned")
        self.assertEqual(CdnSwitchEvent.objects.count(), 0)
        self.assertIn("pinned", cdn_handoff.ALLOWED_REASONS)

    def test_fallback_event_cdn_only_and_dedup(self):
        c = Client(HTTP_USER_AGENT=UA)
        c.force_login(self.u)
        body = json.dumps({"reason": "call_drops"})
        r = c.post("/api/cdn-handoff/event/", data=body, content_type="application/json", HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.status_code, 400)
        r = c.post("/api/cdn-handoff/event/", data=json.dumps({"reason": "x"}), content_type="application/json",
                   HTTP_HOST="cdn.itflux-academy.ru")
        self.assertEqual(r.status_code, 400)
        for _ in range(3):
            r = c.post("/api/cdn-handoff/event/", data=body, content_type="application/json", HTTP_HOST="cdn.itflux-academy.ru")
            self.assertEqual(r.status_code, 200)
        ev = CdnSwitchEvent.objects.get()
        self.assertEqual((ev.via, ev.reason), ("fallback", "call_drops"))
        with open(self.log) as fh:
            self.assertIn("reason=call_drops_fb", fh.read())

    def test_fallback_requires_auth(self):
        r = Client().post("/api/cdn-handoff/event/", data="{}", content_type="application/json", HTTP_HOST="cdn.itflux-academy.ru")
        self.assertIn(r.status_code, (401, 403))


@override_settings(ALLOWED_HOSTS=HOSTS)
class RouteMetaR95Tests(TestCase):
    def test_route_meta_by_host(self):
        from Cabinet.video_meeting_api import _route_meta
        rf = RequestFactory()
        self.assertEqual(_route_meta(rf.get("/", HTTP_HOST="cdn.itflux-academy.ru", HTTP_USER_AGENT=UA))["route"], "cdn")
        m = _route_meta(rf.get("/", HTTP_HOST="itflux-academy.ru", HTTP_USER_AGENT=UA))
        self.assertEqual(m["route"], "direct")
        self.assertEqual(m["uaFamily"], "Chrome/130 Windows")


class CallRouteReportR95Tests(TestCase):
    def test_report_compares_routes(self):
        from Generator.management.commands import call_route_report as rep
        u = get_user_model().objects.create_user("r95r", password="pw")
        with mock.patch.object(rep, "session_stats") as ss:
            ss.return_value = {
                "a": {"route": "cdn", "ua": "x", "joined": True, "join_timeout": False, "drops": 1, "reconnects": 1,
                      "restored": 1, "peer_fail": 0, "seconds": 3600.0, "users": {u.pk}},
                "b": {"route": "direct", "ua": "x", "joined": False, "join_timeout": True, "drops": 0, "reconnects": 0,
                      "restored": 0, "peer_fail": 0, "seconds": 0.0, "users": {u.pk}},
            }
            CdnSwitchEvent.objects.create(user=u, reason="call_drops", via="token")
            out = StringIO()
            call_command("call_route_report", "--days", "1", "--by-ua", stdout=out)
        txt = out.getvalue()
        self.assertIn("cdn", txt)
        self.assertIn("1.00", txt)  # cdn drops/h
        self.assertIn("Автопереходы на cdn: 1", txt)
        self.assertIn("call_drops", txt)

    def test_session_stats_empty(self):
        from Generator.management.commands import call_route_report as rep
        self.assertEqual(rep.session_stats(timezone.now() - timedelta(days=1)), {})


@override_settings(ALLOWED_HOSTS=HOSTS)
class R97FixesTests(TestCase):
    def setUp(self):
        cache.clear()
        fd, self.log = tempfile.mkstemp(suffix=".log")
        os.close(fd)
        self.ov = override_settings(CDN_USERS_LOG=self.log)
        self.ov.enable()
        self.u = get_user_model().objects.create_user("r97a", password="pw-a")

    def tearDown(self):
        self.ov.disable()
        os.unlink(self.log)

    def test_event_stored_with_csrf_checks_and_no_referer(self):
        c = Client(HTTP_USER_AGENT=UA, enforce_csrf_checks=True)
        c.force_login(self.u)
        r = c.post("/api/cdn-handoff/event/", data=json.dumps({"reason": "call_drops"}), content_type="application/json",
                   HTTP_HOST="cdn.itflux-academy.ru", secure=True, HTTP_ORIGIN="https://cdn.itflux-academy.ru")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(CdnSwitchEvent.objects.filter(via="fallback").count(), 1)

    def test_event_rejects_foreign_origin_and_form(self):
        c = Client(HTTP_USER_AGENT=UA, enforce_csrf_checks=True)
        c.force_login(self.u)
        r = c.post("/api/cdn-handoff/event/", data=json.dumps({"reason": "call_drops"}), content_type="application/json",
                   HTTP_HOST="cdn.itflux-academy.ru", secure=True, HTTP_ORIGIN="https://evil.example")
        self.assertEqual(r.status_code, 403)
        r = c.post("/api/cdn-handoff/event/", data={"reason": "call_drops"}, HTTP_HOST="cdn.itflux-academy.ru", secure=True)
        self.assertEqual(r.status_code, 415)
        self.assertEqual(CdnSwitchEvent.objects.count(), 0)

    def test_event_still_requires_auth_and_cdn(self):
        r = Client(enforce_csrf_checks=True).post("/api/cdn-handoff/event/", data="{}", content_type="application/json",
                                                  HTTP_HOST="cdn.itflux-academy.ru")
        self.assertEqual(r.status_code, 401)
        c = Client(HTTP_USER_AGENT=UA, enforce_csrf_checks=True)
        c.force_login(self.u)
        r = c.post("/api/cdn-handoff/event/", data=json.dumps({"reason": "call_drops"}), content_type="application/json",
                   HTTP_HOST="itflux-academy.ru")
        self.assertEqual(r.status_code, 400)

    def test_cdn_origin_trusted(self):
        from django.conf import settings
        self.assertIn("https://cdn.itflux-academy.ru", settings.CSRF_TRUSTED_ORIGINS)

    def test_hangup_and_legacy_left_not_drops(self):
        from Generator.management.commands import call_route_report as rep
        self.assertFalse(rep.is_drop("connection_reconnecting", "videoConferenceLeft"))
        self.assertFalse(rep.is_drop("connection_reconnecting", "hangup"))
        self.assertFalse(rep.is_drop("connection_failed", "backgrounded"))
        self.assertTrue(rep.is_drop("connection_reconnecting", "conference_left_unexpected"))
        self.assertTrue(rep.is_drop("connection_reconnecting", "connectionFailed"))
        self.assertTrue(rep.is_drop("connection_failed", ""))
        self.assertFalse(rep.is_drop("conference_left", ""))

    def test_session_stats_excludes_legacy_left(self):
        from Generator.management.commands import call_route_report as rep
        rows = [
            {"call_session_id": "s", "event_type": "connection_reconnecting", "reason": "videoConferenceLeft", "user_id": None, "c": 3, "a": timezone.now()},
            {"call_session_id": "s", "event_type": "connection_reconnecting", "reason": "connectionFailed", "user_id": None, "c": 1, "a": timezone.now()},
        ]

        class QS(list):
            def __getattr__(self, n):
                return lambda *a, **k: self

        empty, typed = QS(), QS(rows)

        class Root:
            calls = 0

            def filter(self, **k):
                return self

            def exclude(self, **k):
                return self

            def values(self, *a):
                Root.calls += 1
                return {1: empty, 2: empty, 3: typed}[Root.calls]

        with mock.patch("Cabinet.models.MeetingTechnicalEvent.objects", Root()):
            out = rep.session_stats(timezone.now() - timedelta(days=1))
        self.assertEqual(out["s"]["drops"], 1)
        self.assertEqual(out["s"]["reconnects"], 1)
