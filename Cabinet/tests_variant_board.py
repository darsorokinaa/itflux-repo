"""r145: «Доска рядом» — доска к варианту (сессия «Решать вариант»)."""
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.models import InteractiveBoard, InteractiveBoardAccess, Profile, Student
from Cabinet.tests_variant_live import GRADING, _plan


@override_settings(LESSON_SECRET="test-lesson-secret-r145")
class VariantBoardLiveTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="r145_t", password="x")
        Profile.objects.update_or_create(user=self.teacher, defaults=dict(role=Profile.Role.TEACHER))
        self.su = User.objects.create_user(username="r145_s", password="x")
        Profile.objects.update_or_create(user=self.su, defaults=dict(role=Profile.Role.STUDENT))
        Student.objects.create(teacher=self.teacher, user=self.su, first_name="И", status="active")
        self.out = User.objects.create_user(username="r145_o", password="x")
        Profile.objects.update_or_create(user=self.out, defaults=dict(role=Profile.Role.STUDENT))
        self.teacher, self.su, self.out = (User.objects.get(pk=u.pk) for u in (self.teacher, self.su, self.out))
        p = mock.patch("Cabinet.variant_issuance.plan_for", return_value=_plan(None, "pro", "Профи"))
        p.start(); self.addCleanup(p.stop)
        g = mock.patch("Cabinet.meeting_present.grading_tasks", return_value=[dict(r) for r in GRADING])
        g.start(); self.addCleanup(g.stop)
        c = APIClient(); c.force_login(self.teacher)
        r = c.post("/api/cabinet/variant-live/", {"variantUrl": "/oge/inf/variant/42"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.sess = r.data["session"]

    def _post(self, user, body):
        c = APIClient(); c.force_login(user)
        return c.post("/api/cabinet/variant-board/", body, format="json")

    def test_teacher_and_student_share_board(self):
        r1 = self._post(self.teacher, {"live_session": self.sess["id"]})
        self.assertEqual(r1.status_code, 200, r1.content)
        j = APIClient(); j.force_login(self.su)
        j.post(f"/api/cabinet/variant-live/{self.sess['id']}/join/", {}, format="json")
        r2 = self._post(self.su, {"homework_id": self.sess["homeworkId"]})
        self.assertEqual(r2.status_code, 200, r2.content)
        self.assertEqual(r1.data["boardId"], r2.data["boardId"])
        board = InteractiveBoard.objects.get(pk=r1.data["boardId"])
        self.assertEqual(board.owner_id, self.teacher.pk)
        self.assertEqual(board.get_permission_for(self.su), "edit")
        self.assertTrue(InteractiveBoardAccess.objects.filter(board=board, user=self.su).exists())

    def test_outsider_forbidden(self):
        r = self._post(self.out, {"live_session": self.sess["id"]})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self._post(self.su, {}).status_code, 400)
