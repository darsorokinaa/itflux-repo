"""r91: OAuth без молчаливого «учителя», вход по ссылке на урок, переход к следующему уроку серии,
скользящая сессия, отчёт/слияние дублей. Внешние сервисы (Яндекс/VK) замоканы."""
import datetime as dt
import io
import time
from unittest import mock

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from Cabinet.models import Profile, ScheduleEvent, ScheduleEventSeries, SocialAccount, Student, VideoMeeting
from Cabinet.r91_oauth import mask_email
from Cabinet.video_meeting_service import generate_room_name

ENV = {"YANDEX_CLIENT_ID": "test-id", "YANDEX_CLIENT_SECRET": "test-x", "ITFLUX_OAUTH_ORIGIN": "http://testserver"}


def mkuser(username, role, email="", first="", last=""):
    u = User.objects.create_user(username=username, password="pass-12345", email=email)
    u.profile.role = role
    u.profile.name, u.profile.surname = first, last
    u.profile.save(update_fields=["role", "name", "surname"])
    return u


class Base(TestCase):
    def setUp(self):
        self.teacher = mkuser("r91_t", Profile.Role.TEACHER, "teacher@example.com", "Анна", "Учитель")
        self.stud_user = mkuser("r91_s", Profile.Role.STUDENT, "nikita.ivanov@gmail.com", "Никита", "Иванов")
        self.student = Student.objects.create(teacher=self.teacher, user=self.stud_user, first_name="Никита",
                                              last_name="Иванов", email="nikita.ivanov@gmail.com")
        now = timezone.now()
        self.series = ScheduleEventSeries.objects.create(
            teacher=self.teacher, title="Информатика", start_date=(now - dt.timedelta(days=7)).date(),
            start_time=dt.time(15, 0), end_time=dt.time(16, 0), created_by=self.teacher)
        self.prev = self._event(now - dt.timedelta(days=7), series=self.series)
        self.cur = self._event(now + dt.timedelta(hours=2), series=self.series)
        self.prev_m = self._meeting(self.prev, VideoMeeting.Status.FINISHED)
        self.cur_m = self._meeting(self.cur, VideoMeeting.Status.SCHEDULED)

    def _event(self, start, series=None, student=None):
        return ScheduleEvent.objects.create(owner=self.teacher, title="Урок", starts_at=start,
                                            ends_at=start + dt.timedelta(hours=1), student=student or self.student,
                                            series=series)

    def _meeting(self, ev, status):
        return VideoMeeting.objects.create(schedule_event=ev, created_by=self.teacher,
                                           room_name=generate_room_name(), status=status)


class MaskTests(TestCase):
    def test_mask(self):
        self.assertEqual(mask_email("nikita@gmail.com"), "ni***@gmail.com")
        self.assertEqual(mask_email("ab@x.ru"), "a***@x.ru")
        self.assertEqual(mask_email(""), "")


class MeetingEntryTests(Base):
    def test_anonymous_gets_masked_hint_only(self):
        r = self.client.get(f"/api/cabinet/meeting-entry/{self.prev_m.uuid}/")
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertFalse(d["authenticated"])
        self.assertEqual(d["student_email_hint"], "ni***@gmail.com")
        self.assertNotIn("nikita.ivanov", r.content.decode())
        self.assertTrue(d["finished"])

    def test_unknown_meeting_404(self):
        r = self.client.get("/api/cabinet/meeting-entry/00000000-0000-0000-0000-000000000000/")
        self.assertEqual(r.status_code, 404)

    def test_student_redirected_to_current_series_lesson(self):
        self.client.force_login(self.stud_user)
        d = self.client.get(f"/api/cabinet/meeting-entry/{self.prev_m.uuid}/").json()
        self.assertEqual(d["redirect"], f"/cabinet/meetings/{self.cur_m.uuid}")

    def test_next_lesson_without_meeting_goes_to_room_entry(self):
        self.cur_m.delete()
        self.client.force_login(self.stud_user)
        d = self.client.get(f"/api/cabinet/meeting-entry/{self.prev_m.uuid}/").json()
        self.assertEqual(d["redirect"], f"/cabinet/student/lessons/room/{self.cur.pk}")

    def test_finished_no_next(self):
        self.cur.status = ScheduleEvent.Status.CANCELLED
        self.cur.save(update_fields=["status"])
        self.client.force_login(self.stud_user)
        d = self.client.get(f"/api/cabinet/meeting-entry/{self.prev_m.uuid}/").json()
        self.assertIsNone(d["redirect"])
        self.assertTrue(d["finished_no_next"])

    def test_current_lesson_no_redirect(self):
        self.client.force_login(self.stud_user)
        d = self.client.get(f"/api/cabinet/meeting-entry/{self.cur_m.uuid}/").json()
        self.assertIsNone(d["redirect"])
        self.assertFalse(d["finished_no_next"])

    def test_other_user_not_redirected(self):
        stranger = mkuser("r91_x", Profile.Role.TEACHER, "x@example.com")
        self.client.force_login(stranger)
        d = self.client.get(f"/api/cabinet/meeting-entry/{self.prev_m.uuid}/").json()
        self.assertFalse(d["is_student"])
        self.assertIsNone(d["redirect"])
        self.assertNotIn("student_email_hint", d)


@mock.patch("Cabinet.social_auth.SITE_ORIGIN", "http://testserver")
@mock.patch.dict("os.environ", ENV)
class OAuthRoleTests(Base):
    ident = {"uid": "ya-999", "email": "other.mail@yandex.ru", "first_name": "Никита", "last_name": "Иванов"}

    def _start(self, next_path, role=None):
        q = {"next": next_path}
        if role:
            q["role"] = role
        r = self.client.get("/api/cabinet/oauth/yandex/start/", q)
        self.assertEqual(r.status_code, 302)
        return self.client.session["oauth_ctx"]["state"]

    def _callback(self, state):
        with mock.patch("Cabinet.social_auth._yandex_identity", return_value=dict(self.ident)):
            return self.client.get("/api/cabinet/oauth/yandex/callback/", {"code": "c", "state": state})

    def test_new_email_from_meeting_link_does_not_create_teacher(self):
        before = User.objects.count()
        nxt = f"/cabinet/meetings/{self.prev_m.uuid}"
        r = self._callback(self._start(nxt))
        self.assertEqual(r.status_code, 302)
        self.assertTrue(r["Location"].startswith("/cabinet/oauth/role?"))
        self.assertEqual(User.objects.count(), before)
        self.assertNotIn("_auth_user_id", self.client.session)
        p = self.client.get("/api/cabinet/oauth/pending/").json()
        self.assertEqual(p["default_role"], "student")
        self.assertTrue(p["student_link"])
        self.assertEqual(p["meeting_student_email_hint"], "ni***@gmail.com")
        self.assertTrue(p["name_match_student"])
        self.assertEqual(p["next"], nxt)
        self.assertNotIn("other.mail", str(p))

    def test_cancel_returns_to_login_with_next(self):
        nxt = f"/cabinet/meetings/{self.prev_m.uuid}"
        self._callback(self._start(nxt))
        before = User.objects.count()
        d = self.client.post("/api/cabinet/oauth/cancel/", content_type="application/json").json()
        self.assertIn("/cabinet/login?next=", d["redirect"])
        self.assertEqual(User.objects.count(), before)
        self.assertEqual(self.client.get("/api/cabinet/oauth/pending/").status_code, 404)

    def test_complete_as_student(self):
        self._callback(self._start("/cabinet"))
        r = self.client.post("/api/cabinet/oauth/complete/", {"role": "student"}, content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        u = User.objects.get(email="other.mail@yandex.ru")
        self.assertEqual(u.profile.role, Profile.Role.STUDENT)
        self.assertTrue(SocialAccount.objects.filter(user=u, provider="yandex", uid="ya-999").exists())
        self.assertEqual(int(self.client.session["_auth_user_id"]), u.id)

    def test_complete_requires_role(self):
        self._callback(self._start("/cabinet"))
        r = self.client.post("/api/cabinet/oauth/complete/", {}, content_type="application/json")
        self.assertEqual(r.status_code, 400)

    def test_complete_as_teacher(self):
        self._callback(self._start("/cabinet"))
        self.client.post("/api/cabinet/oauth/complete/", {"role": "teacher"}, content_type="application/json")
        self.assertEqual(User.objects.get(email="other.mail@yandex.ru").profile.role, Profile.Role.TEACHER)

    def test_explicit_role_from_register_page_still_creates(self):
        r = self._callback(self._start("/cabinet", role="teacher"))
        self.assertEqual(r["Location"], "/cabinet")
        self.assertEqual(User.objects.get(email="other.mail@yandex.ru").profile.role, Profile.Role.TEACHER)

    def test_existing_email_logs_in_directly(self):
        self.ident = dict(self.ident, email="nikita.ivanov@gmail.com")
        nxt = f"/cabinet/meetings/{self.prev_m.uuid}"
        r = self._callback(self._start(nxt))
        self.assertEqual(r["Location"], nxt)
        self.assertEqual(int(self.client.session["_auth_user_id"]), self.stud_user.id)

    def test_pending_expires(self):
        self._callback(self._start("/cabinet"))
        s = self.client.session
        s["oauth_pending"]["ts"] = int(time.time()) - 3600
        s.save()
        self.assertEqual(self.client.get("/api/cabinet/oauth/pending/").status_code, 404)


@override_settings(SESSION_ROLLING_REFRESH_SECONDS=60)
class RollingSessionTests(Base):
    def test_touch_written_then_throttled(self):
        self.client.force_login(self.stud_user)
        self.client.get("/api/cabinet/oauth/providers/")
        t1 = self.client.session.get("_r91_touch")
        self.assertTrue(t1)
        self.client.get("/api/cabinet/oauth/providers/")
        self.assertEqual(self.client.session.get("_r91_touch"), t1)
        s = self.client.session
        s["_r91_touch"] = t1 - 120
        s.save()
        r = self.client.get("/api/cabinet/oauth/providers/")
        self.assertGreaterEqual(self.client.session.get("_r91_touch"), t1)
        self.assertIn("sessionid", r.cookies)

    def test_anonymous_no_session(self):
        r = self.client.get("/api/cabinet/oauth/providers/")
        self.assertNotIn("sessionid", r.cookies)


class DuplicateReportTests(Base):
    def test_report_and_merge_dry_run(self):
        dup = mkuser("r91_dup", Profile.Role.TEACHER, "other.mail@yandex.ru", "Никита", "Иванов")
        SocialAccount.objects.create(user=dup, provider="yandex", uid="ya-1", email=dup.email)
        out = io.StringIO()
        call_command("report_duplicate_accounts", stdout=out)
        text = out.getvalue()
        self.assertIn(f"dup user={dup.id}", text)
        self.assertIn(f"existing user={self.stud_user.id}", text)
        self.assertIn("ot***@yandex.ru", text)
        self.assertNotIn("other.mail", text)
        self.assertNotIn("Никита", text)
        out = io.StringIO()
        call_command("merge_duplicate_accounts", "--pair", f"{dup.id}:{self.stud_user.id}", stdout=out)
        self.assertIn("DRY-RUN", out.getvalue())
        dup.refresh_from_db()
        self.assertTrue(dup.is_active)
        self.assertEqual(SocialAccount.objects.get(uid="ya-1").user_id, dup.id)
        call_command("merge_duplicate_accounts", "--pair", f"{dup.id}:{self.stud_user.id}", "--apply", stdout=io.StringIO())
        dup.refresh_from_db()
        self.assertFalse(dup.is_active)
        self.assertEqual(SocialAccount.objects.get(uid="ya-1").user_id, self.stud_user.id)

    def test_non_empty_not_reported(self):
        dup = mkuser("r91_dup2", Profile.Role.TEACHER, "z@yandex.ru", "Никита", "Иванов")
        SocialAccount.objects.create(user=dup, provider="vk", uid="vk-1")
        Student.objects.create(teacher=dup, first_name="Ученик")
        out = io.StringIO()
        call_command("report_duplicate_accounts", stdout=out)
        self.assertNotIn(f"dup user={dup.id}", out.getvalue())
