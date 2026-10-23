"""r105: эндпоинт /api/load-timing/ и команда load_timing_report."""
import io
import json
import os
import tempfile

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings

from Generator import load_timing

UA = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/129.0 Safari/537"


class LoadTimingR105Tests(TestCase):
    def setUp(self):
        cache.clear()
        fd, self.path = tempfile.mkstemp(suffix=".log")
        os.close(fd)
        self.ov = override_settings(LOAD_TIMING_LOG=self.path, LOAD_TIMING_RATE=3,
                                    ALLOWED_HOSTS=["cdn.itflux-academy.ru", "itflux-academy.ru", "testserver"])
        self.ov.enable()

    def tearDown(self):
        self.ov.disable()
        os.unlink(self.path)

    def _post(self, data, host="cdn.itflux-academy.ru", **extra):
        body = data if isinstance(data, (bytes, str)) else json.dumps(data)
        return self.client.post("/api/load-timing/", body, content_type="text/plain", HTTP_HOST=host,
                                HTTP_USER_AGENT=UA, HTTP_X_REAL_IP="203.0.113.7", **extra)

    def _lines(self):
        with open(self.path, encoding="utf-8") as fh:
            return fh.read().splitlines()

    def test_writes_anonymous_line(self):
        r = self._post({"ev": "ok", "ttfb": 120.4, "dcl": 800, "load": 1500, "ready": 2100, "nav": "navigate",
                        "sw": 1, "email": "ivanov@yandex.ru", "url": "/cabinet?token=x"})
        self.assertEqual(r.status_code, 204)
        (line,) = self._lines()
        rec = load_timing.parse_line(line)
        self.assertEqual((rec["host"], rec["ev"], rec["ttfb"], rec["load"], rec["ready"]), ("cdn", "ok", 120, 1500, 2100))
        self.assertEqual(rec["ua"], "Chrome/129 Windows")
        self.assertEqual(rec["uidh"], "-")
        for bad in ("203.0.113", "ivanov", "token", "cabinet"):
            self.assertNotIn(bad, line)

    def test_direct_host_invalid_values_and_uid_hash(self):
        u = get_user_model().objects.create_user("petrov", password="x")
        self.client.force_login(u)
        self._post({"ev": "evil event", "ttfb": -5, "load": "abc", "ready": 10 ** 9}, host="itflux-academy.ru")
        rec = load_timing.parse_line(self._lines()[0])
        self.assertEqual((rec["host"], rec["ev"], rec["ttfb"], rec["load"], rec["ready"]), ("direct", "ok", None, None, None))
        self.assertRegex(rec["uidh"], r"^[0-9a-f]{10}$")
        self.assertNotEqual(rec["uidh"], str(u.pk))

    def test_rejects_bad_input_other_host_and_get(self):
        self.assertEqual(self._post("not json").status_code, 400)
        self.assertEqual(self._post("x" * 5000).status_code, 413)
        self.assertEqual(self._post({"ev": "ok"}, host="testserver").status_code, 204)
        self.assertEqual(self.client.get("/api/load-timing/", HTTP_HOST="cdn.itflux-academy.ru").status_code, 405)
        self.assertEqual(self._lines(), [])

    def test_rate_limited(self):
        codes = [self._post({"ev": "ok"}).status_code for _ in range(5)]
        self.assertEqual(codes, [204, 204, 204, 429, 429])
        self.assertEqual(len(self._lines()), 3)

    def test_report(self):
        for host, ev, ttfb, load in [("cdn", "ok", 100, 1000), ("cdn", "ok", 300, 3000), ("cdn", "boot_fail", 900, None),
                                     ("direct", "auto_switch", 2000, None), ("direct", "ok", 50, 500)]:
            cache.clear()
            self._post({"ev": ev, "ttfb": ttfb, "load": load}, host=f"{'cdn.' if host == 'cdn' else ''}itflux-academy.ru")
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write("garbage line\n")
        out = io.StringIO()
        call_command("load_timing_report", "--since", "1d", "--log", self.path, "--by-browser", stdout=out)
        text = out.getvalue()
        cdn_total = next(line for line in text.splitlines() if line.startswith("cdn") and "ВСЕГО" in line).split()
        self.assertEqual(cdn_total[2:4], ["3", "300"])  # n, ttfb p50
        self.assertIn("33.3%", " ".join(cdn_total))
        direct_total = next(line for line in text.splitlines() if line.startswith("direct") and "ВСЕГО" in line)
        self.assertIn("50.0%", direct_total)
        self.assertIn("Chrome/129", text)
