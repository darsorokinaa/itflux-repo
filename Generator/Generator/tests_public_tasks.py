from django.core.cache import cache
from django.test import TestCase, Client

from Generator.models import Level, Subject, Task, TaskList


class PublicTaskAccessR130Tests(TestCase):
    @classmethod
    def setUpTestData(cls):
        lv = Level.objects.create(level="ege", level_rus="ЕГЭ")
        inf = Subject.objects.create(subject_short="inf", subject_name="Информатика")
        tl = TaskList.objects.create(subject=inf, level=lv, task_number=1, task_title="Т", max_score=1, part=None)
        cls.g = Task.objects.create(task=tl, task_template="<p>x</p>", is_active=True, scope="global", answer="42")
        cls.inactive = Task.objects.create(task=tl, task_template="<p>y</p>", is_active=False, scope="global", answer="1")

    def setUp(self):
        cache.clear()
        self.c = Client()

    def _global_task(self):
        return self.g

    def test_anon_correct_answer(self):
        r = self.c.post(f"/api/tasks/{self.g.id}/check-answer/", data='{"answer":" 42 "}', content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["correct"])
        self.assertFalse(r.json()["authenticated"])
        self.assertNotIn("42", r.content.decode())

    def test_inactive_task_hidden(self):
        r = self.c.post(f"/api/tasks/{self.inactive.id}/check-answer/", data='{"answer":"1"}', content_type="application/json")
        self.assertEqual(r.status_code, 404)

    def test_check_unknown_task_404(self):
        r = self.c.post("/api/tasks/999999999/check-answer/", data="{}", content_type="application/json")
        self.assertEqual(r.status_code, 404)

    def test_get_not_allowed(self):
        r = self.c.get("/api/tasks/1/check-answer/")
        self.assertEqual(r.status_code, 405)

    def test_teacher_task_hidden_from_anon(self):
        t = Task.objects.filter(scope=Task.Scope.TEACHER).first()
        if t is None:
            self.skipTest("no teacher tasks in test db")
        r = self.c.post(f"/api/tasks/{t.id}/check-answer/", data='{"answer":"1"}', content_type="application/json")
        self.assertEqual(r.status_code, 404)

    def test_anon_check_and_rate_limit(self):
        from Generator import public_task_check as m
        t = self._global_task()
        if t is None:
            self.skipTest("no global tasks in test db")
        r = self.c.post(f"/api/tasks/{t.id}/check-answer/", data='{"answer":"%s"}' % "zzz-wrong", content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["correct"])
        self.assertFalse(r.json()["saved"])
        self.assertNotIn("expected", r.json())
        for _ in range(m.ANON_CHECK_LIMIT):
            r = self.c.post(f"/api/tasks/{t.id}/check-answer/", data='{"answer":"x"}', content_type="application/json")
        self.assertEqual(r.status_code, 429)

    def test_rate_limit_unit(self):
        from django.test import RequestFactory
        from Cabinet.rate_limit import rate_limit_check
        rf = RequestFactory()
        req = rf.post("/x", REMOTE_ADDR="10.9.9.9")
        oks = [rate_limit_check(req, "r130t", 3, 60) for _ in range(5)]
        self.assertEqual(oks, [True, True, True, False, False])
