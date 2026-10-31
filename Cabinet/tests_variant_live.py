"""r125/r126: «Решать вариант» вне урока, лимит вариантов (без ДЗ) и строки журнала."""
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.choices import HomeworkStatus, HomeworkTaskType
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkTask,
    Profile,
    Student,
    TariffPlan,
    VariantIssuance,
    VariantLiveSession,
)
from Cabinet import variant_issuance
from Cabinet.variant_issuance import VariantLimitExceeded, enforce_variant_limits

GRADING = [
    {"id": 5, "part": 1, "maxScore": 1},
    {"id": 101, "part": 2, "maxScore": 3, "criteria": {"scoring_mode": "single", "criteria": [], "axes": [], "max_score": 3}},
]


def _plan(limit, slug="start", name="Старт"):
    return SimpleNamespace(slug=slug, name=name, max_variants_per_student_monthly=limit)


@override_settings(LESSON_SECRET="test-lesson-secret-r125")
class VariantLiveTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(username="r125_t", password="x")
        Profile.objects.update_or_create(user=self.teacher, defaults=dict(role=Profile.Role.TEACHER))
        self.su = User.objects.create_user(username="r125_s", password="x")
        Profile.objects.update_or_create(user=self.su, defaults=dict(role=Profile.Role.STUDENT, name="Иван"))
        self.student = Student.objects.create(teacher=self.teacher, user=self.su, first_name="Иван", last_name="Ученик", status="active")
        self.su2 = User.objects.create_user(username="r125_s2", password="x")
        Profile.objects.update_or_create(user=self.su2, defaults=dict(role=Profile.Role.STUDENT))
        self.student2 = Student.objects.create(teacher=self.teacher, user=self.su2, first_name="Петя", status="active")
        self.outsider = User.objects.create_user(username="r125_o", password="x")
        Profile.objects.update_or_create(user=self.outsider, defaults=dict(role=Profile.Role.STUDENT))
        # force_login сохраняет User, а post_save профиля перезаписал бы роль из кэша.
        self.teacher, self.su, self.su2, self.outsider = (
            User.objects.get(pk=u.pk) for u in (self.teacher, self.su, self.su2, self.outsider)
        )
        self.plan_patch = mock.patch("Cabinet.variant_issuance.plan_for", return_value=_plan(None, "pro", "Профи"))
        self.plan_mock = self.plan_patch.start()
        self.addCleanup(self.plan_patch.stop)
        g = mock.patch("Cabinet.meeting_present.grading_tasks", return_value=[dict(r) for r in GRADING])
        g.start()
        self.addCleanup(g.stop)

    def _create(self, **extra):
        self.client.force_login(self.teacher)
        r = self.client.post("/api/cabinet/variant-live/", {"variantUrl": "/oge/inf/variant/42", **extra}, format="json")
        return r

    def _join(self, sid, user):
        c = APIClient()
        c.force_login(user)
        return c.post(f"/api/cabinet/variant-live/{sid}/join/", {}, format="json")

    # ---------- live-solve

    def test_create_join_answers_score(self):
        r = self._create()
        self.assertEqual(r.status_code, 201, r.content)
        sess = r.data["session"]
        self.assertEqual(sess["variantId"], 42)
        self.assertIn("live_session=", sess["teacherUrl"])
        self.assertIn("cabinet_assignment=", sess["teacherUrl"])
        hw = Homework.objects.get(pk=sess["homeworkId"])
        self.assertIn("live-meeting:solve:", hw.description)

        j = self._join(sess["id"], self.su)
        self.assertEqual(j.status_code, 200, j.content)
        self.assertIn("live_meeting=1", j.data["openUrl"])
        self.assertIn("lesson_token=", j.data["openUrl"])
        self.assertTrue(HomeworkSubmission.objects.filter(homework=hw, student=self.student).exists())

        c = APIClient()
        c.force_login(self.su)
        d = c.post(f"/api/homework/assignment/{hw.pk}/save-draft/", {"result": {"by_task_id": {"101": "решение"}}}, format="json")
        self.assertEqual(d.status_code, 200, d.content)

        a = self.client.get(f"/api/cabinet/variant-live/{sess['id']}/answers/")
        self.assertEqual(a.status_code, 200, a.content)
        self.assertTrue(a.data["presented"])
        self.assertEqual([s["studentId"] for s in a.data["students"]], [self.student.pk])

        s = self.client.post(f"/api/cabinet/variant-live/{sess['id']}/score/", {"studentId": self.student.pk, "taskId": 101, "score": 2}, format="json")
        self.assertEqual(s.status_code, 200, s.content)
        s2 = self.client.post(f"/api/cabinet/variant-live/{sess['id']}/score/", {"studentId": self.student.pk, "taskId": 101, "score": 3}, format="json")
        self.assertEqual(s2.status_code, 409)
        sub = HomeworkSubmission.objects.get(homework=hw, student=self.student)
        self.assertEqual(sub.result_payload["scores"]["101"], 2)

        lst = self.client.get("/api/cabinet/variant-live/?variant_id=42")
        self.assertEqual(lst.data["sessions"][0]["studentsCount"], 1)

    def test_student_cannot_read_answers_or_other_teacher(self):
        sid = self._create().data["session"]["id"]
        c = APIClient()
        c.force_login(self.su)
        self.assertEqual(c.get(f"/api/cabinet/variant-live/{sid}/answers/").status_code, 403)
        self.assertEqual(self._join(sid, self.outsider).status_code, 403)

    def test_anonymous_join_requires_login(self):
        sid = self._create().data["session"]["id"]
        self.assertIn(APIClient().post(f"/api/cabinet/variant-live/{sid}/join/").status_code, (401, 403))

    def test_session_for_chosen_student(self):
        sid = self._create(studentId=self.student.pk).data["session"]["id"]
        self.assertEqual(self._join(sid, self.su2).status_code, 403)
        self.assertEqual(self._join(sid, self.su).status_code, 200)

    def test_closed_session(self):
        sid = self._create().data["session"]["id"]
        self.assertEqual(self.client.delete(f"/api/cabinet/variant-live/{sid}/").status_code, 200)
        self.assertEqual(self._join(sid, self.su).status_code, 410)

    def test_live_homework_hidden_from_student_list(self):
        sid = self._create().data["session"]["id"]
        self._join(sid, self.su)
        hw_id = VariantLiveSession.objects.get(pk=sid).homework_id
        self.assertFalse(
            Homework.objects.filter(pk=hw_id).exclude(description__contains="live-meeting:").exists()
        )

    # ---------- limits

    def test_limit_start_three_distinct_variants(self):
        self.plan_mock.return_value = _plan(3)
        for vid in (1, 2, 3):
            variant_issuance.check_and_record(self.teacher, [self.student], vid, source="live_solve")
        # тот же вариант повторно — бесплатно
        variant_issuance.check_and_record(self.teacher, [self.student], 2, source="live_solve")
        with self.assertRaises(VariantLimitExceeded) as ctx:
            variant_issuance.check_and_record(self.teacher, [self.student], 4, source="live_solve")
        self.assertIn("не больше 3", ctx.exception.message)
        self.assertIn("/cabinet/upgrade", ctx.exception.message)
        self.assertEqual(ctx.exception.to_dict()["remaining"], 0)
        # другому ученику можно
        variant_issuance.check_and_record(self.teacher, [self.student2], 4, source="live_solve")
        self.assertEqual(VariantIssuance.objects.filter(student=self.student).count(), 3)

    def test_limit_unlimited_for_pro(self):
        for vid in range(1, 15):
            variant_issuance.check_and_record(self.teacher, [self.student], vid, source="live_solve")
        self.assertEqual(VariantIssuance.objects.count(), 14)

    def test_month_boundary(self):
        self.plan_mock.return_value = _plan(1)
        variant_issuance.check_and_record(self.teacher, [self.student], 1, source="live_solve")
        VariantIssuance.objects.update(month="2000-01")
        variant_issuance.check_and_record(self.teacher, [self.student], 2, source="live_solve")

    def test_create_for_student_blocked_with_message(self):
        self.plan_mock.return_value = _plan(1)
        variant_issuance.check_and_record(self.teacher, [self.student], 7, source="live_solve")
        r = self._create(studentId=self.student.pk)
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(r.data["code"], "VARIANT_PER_STUDENT_LIMIT")
        self.assertEqual(r.data["upgrade_url"], "/cabinet/upgrade")
        self.assertFalse(VariantLiveSession.objects.exists())

    def test_join_blocked_without_tariff_details(self):
        sid = self._create().data["session"]["id"]
        self.plan_mock.return_value = _plan(1)
        variant_issuance.check_and_record(self.teacher, [self.student], 7, source="live_solve")
        j = self._join(sid, self.su)
        self.assertEqual(j.status_code, 403)
        self.assertEqual(j.data["code"], "VARIANT_PER_STUDENT_LIMIT")
        self.assertNotIn("Старт", j.data["detail"])

    def test_homework_not_counted_nor_blocked(self):
        """r126: ДЗ (ручное, авто, копия) не входят в лимит и не блокируются."""
        self.plan_mock.return_value = _plan(1)
        with enforce_variant_limits():
            for vid in (11, 12, 13):
                hw = Homework.objects.create(teacher=self.teacher, title=f"ДЗ{vid}", student=self.student, status=HomeworkStatus.ASSIGNED)
                HomeworkTask.objects.create(homework=hw, task_type=HomeworkTaskType.GENERATED_TASK, title="В", description=f"/ege/inf/variant/{vid}", order=0)
        self.assertEqual(Homework.objects.filter(title__startswith="ДЗ").count(), 3)
        self.assertFalse(VariantIssuance.objects.filter(source="homework").exists())
        self.assertEqual(variant_issuance.quota(self.teacher, self.student)["used"], 0)
        # live-ссылка после трёх ДЗ всё ещё доступна
        self.assertEqual(self._create(studentId=self.student.pk).status_code, 201)

    def test_copy_homework_not_limited(self):
        self.plan_mock.return_value = _plan(1)
        variant_issuance.check_and_record(self.teacher, [self.student2], 3, source="live_solve")
        src = Homework.objects.create(teacher=self.teacher, title="ДЗ", student=self.student, status=HomeworkStatus.ASSIGNED)
        HomeworkTask.objects.create(homework=src, task_type=HomeworkTaskType.GENERATED_TASK, title="В", description="/ege/inf/variant/9", order=0)
        self.client.force_login(self.teacher)
        r = self.client.post(f"/api/cabinet/homework/{src.pk}/copy/", {"student_ids": [self.student2.pk]}, format="json")
        self.assertNotEqual(r.status_code, 403, r.content)

    def test_legacy_homework_rows_ignored_and_upgraded(self):
        self.plan_mock.return_value = _plan(1)
        VariantIssuance.objects.create(teacher=self.teacher, student=self.student, variant_id=5, month=variant_issuance.current_month(), source="homework")
        self.assertEqual(variant_issuance.quota(self.teacher, self.student)["used"], 0)
        variant_issuance.check_and_record(self.teacher, [self.student], 5, source="live_solve")
        self.assertEqual(variant_issuance.quota(self.teacher, self.student)["used"], 1)

    # ---------- journal (r126)

    def _solved_session(self):
        sess = self._create().data["session"]
        self._join(sess["id"], self.su)
        return sess

    def _fake_scoring(self, homework, submission):
        scores = (submission.result_payload or {}).get("scores") or {}
        p2 = scores.get("101")
        return {"earned_points": 1 + (p2 or 0), "max_points": 4, "pending_review_count": 0 if p2 is not None else 1}

    def test_journal_row_and_updates_after_part2(self):
        from Cabinet.journal_service import build_journal_entries_feed

        with mock.patch("Cabinet.variant_live_journal._scoring", side_effect=self._fake_scoring):
            sess = self._solved_session()
            feed = build_journal_entries_feed(self.teacher, student_id=self.student.pk)
            rows = [e for e in feed["entries"] if e.get("entry_subtype") == "live_variant"]
            self.assertEqual(len(rows), 1)
            row = rows[0]
            self.assertIn(sess["title"], row["title"])
            self.assertEqual(row["status"], "pending_review")
            self.assertEqual(row["earned_points"], 1)
            self.assertTrue(row["date"])
            self.client.post(f"/api/cabinet/variant-live/{sess['id']}/score/", {"studentId": self.student.pk, "taskId": 101, "score": 3}, format="json")
            row = [e for e in build_journal_entries_feed(self.teacher, student_id=self.student.pk)["entries"] if e.get("entry_subtype") == "live_variant"][0]
            self.assertEqual(row["earned_points"], 4)
            self.assertEqual(row["score_percent"], 100.0)
            self.assertEqual(row["status"], "checked")
            # отдельная строка на каждую сессию
            self._solved_session()
            rows = [e for e in build_journal_entries_feed(self.teacher)["entries"] if e.get("entry_subtype") == "live_variant"]
            self.assertEqual(len(rows), 2)
            # другой ученик не видит чужую строку
            self.assertFalse([e for e in build_journal_entries_feed(self.teacher, student_id=self.student2.pk)["entries"] if e.get("entry_subtype") == "live_variant"])

    def test_student_results_and_parent_feed(self):
        from Cabinet.parent_api import _filter_parent_journal_entries
        from Cabinet.journal_service import build_journal_entries_feed

        with mock.patch("Cabinet.variant_live_journal._scoring", side_effect=self._fake_scoring):
            sess = self._solved_session()
            c = APIClient()
            c.force_login(self.su)
            r = c.get("/api/cabinet/student/results/")
            self.assertEqual(r.status_code, 200, r.content)
            live = [x for x in r.data["results"] if x.get("live_session_id") == sess["id"]]
            self.assertEqual(len(live), 1)
            self.assertIsNone(live[0]["review_url"])
            rel = SimpleNamespace(has_permission=lambda p: True)
            feed = build_journal_entries_feed(self.teacher, student_id=self.student.pk)
            parent = _filter_parent_journal_entries(feed["entries"], rel=rel, include_comments=True)
            self.assertTrue([e for e in parent if e.get("live_session_id") == sess["id"]])

    def test_quota_endpoint(self):
        self.plan_mock.return_value = _plan(3)
        variant_issuance.check_and_record(self.teacher, [self.student], 42, source="live_solve")
        self.client.force_login(self.teacher)
        r = self.client.get("/api/cabinet/variant-live/quota/?variant_id=42")
        self.assertEqual(r.status_code, 200)
        row = next(x for x in r.data["students"] if x["studentId"] == self.student.pk)
        self.assertEqual(row["remaining"], 2)
        self.assertTrue(row["alreadyIssued"])

    def test_migration_seeded_limits(self):
        start = TariffPlan.objects.filter(slug="start").first()
        teacher = TariffPlan.objects.filter(slug="teacher").first()
        pro = TariffPlan.objects.filter(slug="pro").first()
        if start:
            self.assertEqual(start.max_variants_per_student_monthly, 3)
        if teacher:
            self.assertEqual(teacher.max_variants_per_student_monthly, 8)
        if pro:
            self.assertIsNone(pro.max_variants_per_student_monthly)
