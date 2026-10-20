"""r90: middleware учёта пользователей cdn-зеркала и команда cdn_users_report."""
import io
import os
import tempfile
from datetime import datetime, timedelta, timezone

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.http import HttpResponse
from django.test import RequestFactory, TestCase, override_settings

from Generator import cdn_users


class _Anon:
    is_authenticated = False


class CdnUsersR90Tests(TestCase):
    def setUp(self):
        cache.clear()
        fd, self.path = tempfile.mkstemp(suffix=".log")
        os.close(fd)
        self.ov = override_settings(CDN_USERS_LOG=self.path, CDN_USERS_THROTTLE_SECONDS=600,
                                    ALLOWED_HOSTS=["cdn.itflux-academy.ru", "itflux-academy.ru"])
        self.ov.enable()
        self.user = get_user_model().objects.create_user("ivanov", email="ivanov@yandex.ru", password="x")
        self.rf = RequestFactory()
        self.mw = cdn_users.CdnUsersMiddleware(lambda r: HttpResponse("ok"))

    def tearDown(self):
        self.ov.disable()
        os.unlink(self.path)

    def _req(self, host="cdn.itflux-academy.ru", user=None, **meta):
        r = self.rf.get("/api/x", HTTP_HOST=host, **meta)
        r.user = user or self.user
        return r

    def _lines(self):
        with open(self.path, encoding="utf-8") as fh:
            return fh.read().splitlines()

    def test_logs_once_per_throttle_window(self):
        ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/129.0 Safari/537"
        for _ in range(3):
            self.mw(self._req(HTTP_X_REAL_IP="203.0.113.7", HTTP_USER_AGENT=ua))
        lines = self._lines()
        self.assertEqual(len(lines), 1)
        rec = cdn_users.parse_line(lines[0])
        self.assertEqual(rec["uid"], self.user.pk)
        self.assertEqual(rec["ip"], "203.0.113.7")
        self.assertEqual(rec["ua"], "Chrome/129 Windows")
        self.assertNotIn("ivanov", lines[0])
        self.assertNotIn("yandex", lines[0])

    def test_other_hosts_and_anonymous_ignored(self):
        self.mw(self._req(host="itflux-academy.ru"))
        self.mw(self._req(user=_Anon()))
        self.assertEqual(self._lines(), [])

    def test_ip_fallbacks(self):
        r = self._req(HTTP_X_FORWARDED_FOR="198.51.100.1, 127.0.0.1")
        self.assertEqual(cdn_users.client_ip(r), "198.51.100.1")
        r = self._req()
        self.assertEqual(cdn_users.client_ip(r), "127.0.0.1")

    def test_unwritable_log_does_not_break_request(self):
        with override_settings(CDN_USERS_LOG="/nonexistent-dir/x.log"):
            resp = self.mw(self._req())
        self.assertEqual(resp.status_code, 200)

    def test_mask_login(self):
        self.assertEqual(cdn_users.mask_login("ivanov@yandex.ru"), "iv***@y***.ru")
        self.assertEqual(cdn_users.mask_login("petrov"), "pe***")
        self.assertEqual(cdn_users.mask_login(""), "***")

    def test_report(self):
        other = get_user_model().objects.create_user("p2", email="petrova@mail.ru", password="x")
        now = datetime.now(timezone.utc)
        old = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        cur = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(f'{old} uid={self.user.pk} role=student ip=1.1.1.1 ua="Chrome/1 Android"\n')
            fh.write(f'{cur} uid={self.user.pk} role=student ip=1.1.1.1 ua="Chrome/1 Android"\n')
            fh.write(f'{cur} uid={self.user.pk} role=student ip=2.2.2.2 ua="Chrome/1 Android"\n')
            fh.write(f'{cur} uid={other.pk} role=teacher ip=3.3.3.3 ua="Safari/17 iOS"\n')
            fh.write("garbage\n")
        out = io.StringIO()
        call_command("cdn_users_report", "--since", "7d", stdout=out)
        text = out.getvalue()
        self.assertIn("пользователей 2, записей 3", text)
        self.assertIn("iv***@y***.ru", text)
        self.assertIn("pe***@m***.ru", text)
        self.assertNotIn("ivanov@", text)
