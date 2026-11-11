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
        Profile.objects.update_or_create(
            user=self.teacher, defaults=dict(role=Profile.Role.TEACHER)
        )
        self.su = User.objects.create_user(username="r145_s", password="x")
        Profile.objects.update_or_create(
            user=self.su, defaults=dict(role=Profile.Role.STUDENT)
        )
        Student.objects.create(
            teacher=self.teacher, user=self.su, first_name="И", status="active"
        )
        self.out = User.objects.create_user(username="r145_o", password="x")
        Profile.objects.update_or_create(
            user=self.out, defaults=dict(role=Profile.Role.STUDENT)
        )
        self.teacher, self.su, self.out = (
            User.objects.get(pk=u.pk) for u in (self.teacher, self.su, self.out)
        )
        p = mock.patch(
            "Cabinet.variant_issuance.plan_for",
            return_value=_plan(None, "pro", "Профи"),
        )
        p.start()
        self.addCleanup(p.stop)
        g = mock.patch(
            "Cabinet.meeting_present.grading_tasks",
            return_value=[dict(r) for r in GRADING],
        )
        g.start()
        self.addCleanup(g.stop)
        c = APIClient()
        c.force_login(self.teacher)
        r = c.post(
            "/api/cabinet/variant-live/",
            {"variantUrl": "/oge/inf/variant/42"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.sess = r.data["session"]

    def _post(self, user, body):
        c = APIClient()
        c.force_login(user)
        return c.post("/api/cabinet/variant-board/", body, format="json")

    def test_teacher_and_student_share_board(self):
        self.assertEqual(
            self._post(self.teacher, {"live_session": self.sess["id"]}).status_code, 404
        )
        j = APIClient()
        j.force_login(self.su)
        j.post(f"/api/cabinet/variant-live/{self.sess['id']}/join/", {}, format="json")
        r1 = self._post(self.teacher, {"live_session": self.sess["id"]})
        self.assertEqual(r1.status_code, 200, r1.content)
        r2 = self._post(self.su, {"homework_id": self.sess["homeworkId"]})
        self.assertEqual(
            (r2.status_code, r2.data.get("code")), (403, "teacher_only")
        )  # r151
        board = InteractiveBoard.objects.get(pk=r1.data["boardId"])
        self.assertEqual(board.owner_id, self.teacher.pk)
        self.assertEqual(board.student.user_id, self.su.pk)
        self.assertFalse(board.description.startswith("variant-live-board:"))
        self.assertEqual(board.student.user_id, self.su.pk)
        self.assertFalse(board.description.startswith("variant-live-board:"))
        self.assertEqual(board.get_permission_for(self.su), "edit")
        self.assertTrue(
            InteractiveBoardAccess.objects.filter(board=board, user=self.su).exists()
        )

    def test_outsider_forbidden(self):
        r = self._post(self.out, {"live_session": self.sess["id"]})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self._post(self.su, {}).status_code, 400)


class VariantBoardStudentRuleTests(TestCase):
    """r147: строго доска ученика (та же, что на его уроках), без выбора чужой."""

    def setUp(self):
        from datetime import timedelta
        from django.utils import timezone
        from Cabinet.schedule_service import create_single_event
        from Cabinet.video_meeting_service import get_or_create_meeting_for_event

        def mk(name, role):
            u = User.objects.create_user(username=name, password="x")
            Profile.objects.update_or_create(user=u, defaults=dict(role=role))
            return User.objects.get(pk=u.pk)

        self.teacher = mk("r147_t", Profile.Role.TEACHER)
        self.ua, self.ub = (
            mk("r147_a", Profile.Role.STUDENT),
            mk("r147_b", Profile.Role.STUDENT),
        )
        self.out = mk("r147_o", Profile.Role.STUDENT)
        self.sa = Student.objects.create(
            teacher=self.teacher, user=self.ua, first_name="Аня", status="active"
        )
        self.sb = Student.objects.create(
            teacher=self.teacher, user=self.ub, first_name="Боря", status="active"
        )
        now = timezone.now()

        def ev(ids):
            e = create_single_event(
                teacher=self.teacher,
                data=dict(
                    title="Урок",
                    starts_at=now,
                    ends_at=now + timedelta(hours=1),
                    event_type="individual_lesson",
                    format="online",
                    notify_participants=False,
                ),
                notify=False,
                student_ids=ids,
            )
            e = e[0] if isinstance(e, (list, tuple)) else e
            m = get_or_create_meeting_for_event(event=e, created_by=self.teacher)
            m = m[0] if isinstance(m, tuple) else m
            return str(m.uuid)

        self.m1 = ev([self.sa.pk])
        self.mg = ev([self.sa.pk, self.sb.pk])

    def _post(self, user, body):
        c = APIClient()
        c.force_login(user)
        return c.post("/api/cabinet/variant-board/", body, format="json")

    def test_individual_lesson_same_student_board(self):
        old = InteractiveBoard.objects.create(
            owner=self.teacher, student=self.sa, title="Доска Ани"
        )
        rt = self._post(
            self.teacher, {"meeting": self.m1, "boardId": "x", "board": "y"}
        )
        rs = self._post(self.ua, {"meeting": self.m1})
        self.assertEqual(rt.status_code, 200, rt.content)
        self.assertEqual(rt.data["boardId"], str(old.pk))
        self.assertEqual(
            (rs.status_code, rs.data.get("code")), (403, "teacher_only")
        )  # r151
        self.assertEqual(old.get_permission_for(self.ua), "edit")
        self.assertIsNone(old.get_permission_for(self.ub))
        self.assertEqual(self._post(self.out, {"meeting": self.m1}).status_code, 403)
        self.assertEqual(self._post(self.ub, {"meeting": self.m1}).status_code, 403)

    def test_created_once_and_old_session_boards_ignored(self):
        InteractiveBoard.objects.create(
            owner=self.teacher,
            student=self.sa,
            title="old",
            description="variant-live-board:abc",
        )
        r1 = self._post(self.teacher, {"meeting": self.m1})
        r2 = self._post(self.teacher, {"meeting": self.m1})
        self.assertEqual(r1.data["boardId"], r2.data["boardId"])
        b = InteractiveBoard.objects.get(pk=r1.data["boardId"])
        self.assertEqual(
            (b.student_id, b.group_id, b.owner_id), (self.sa.pk, None, self.teacher.pk)
        )
        self.assertEqual(InteractiveBoard.objects.filter(student=self.sa).count(), 2)

    def test_group_lesson_each_student_own_board(self):
        r = self._post(self.teacher, {"meeting": self.mg})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(
            {s["id"] for s in r.data["students"]}, {self.sa.pk, self.sb.pk}
        )
        for body in (
            {"meeting": self.mg, "student_id": self.sb.pk},
            {"meeting": self.mg},
        ):
            self.assertEqual(self._post(self.ua, body).status_code, 403)  # r151
        ta = self._post(self.teacher, {"meeting": self.mg, "student_id": self.sa.pk})
        tb = self._post(self.teacher, {"meeting": self.mg, "student_id": self.sb.pk})
        rb = tb
        self.assertNotEqual(ta.data["boardId"], tb.data["boardId"])
        self.assertEqual(
            InteractiveBoard.objects.get(pk=tb.data["boardId"]).get_permission_for(
                self.ub
            ),
            "edit",
        )
        self.assertEqual(len(tb.data["students"]), 2)
        self.assertEqual(
            self._post(
                self.teacher, {"meeting": self.mg, "student_id": 999999}
            ).status_code,
            403,
        )
        # чужая доска по id → 403
        c = APIClient()
        c.force_login(self.ua)
        self.assertEqual(
            c.get(f"/api/cabinet/interactive-boards/{rb.data['boardId']}/").status_code,
            403,
        )


class VariantBoardGroupTests(VariantBoardStudentRuleTests):
    """r148: общая доска группы."""

    def setUp(self):
        super().setUp()
        from datetime import timedelta
        from django.utils import timezone
        from Cabinet.models import StudentGroup
        from Cabinet.schedule_service import create_single_event
        from Cabinet.video_meeting_service import get_or_create_meeting_for_event

        self.g = StudentGroup.objects.create(teacher=self.teacher, title="9А")
        self.g.students.add(self.sa, self.sb)
        now = timezone.now()
        e = create_single_event(
            teacher=self.teacher,
            data=dict(
                title="Группа",
                starts_at=now,
                ends_at=now + timedelta(hours=1),
                event_type="group_lesson",
                format="online",
                notify_participants=False,
            ),
            notify=False,
            group_id=self.g.pk,
        )
        e = e[0] if isinstance(e, (list, tuple)) else e
        m = get_or_create_meeting_for_event(event=e, created_by=self.teacher)
        self.mgr = str((m[0] if isinstance(m, tuple) else m).uuid)

    def test_group_board_shared(self):
        r = self._post(self.teacher, {"meeting": self.mgr})
        self.assertEqual(r.status_code, 409, r.content)
        self.assertEqual(r.data["group"]["id"], self.g.pk)
        ta = self._post(self.teacher, {"meeting": self.mgr, "target": "group"})
        self.assertEqual(ta.status_code, 200, ta.content)
        for u in (self.ua, self.ub):  # r151: ученикам «Доска рядом» недоступна
            for t in ("group", "mine", None, "board"):
                body = {"meeting": self.mgr, **({"target": t} if t else {})}
                self.assertEqual(self._post(u, body).status_code, 403, (u.username, t))
        b = InteractiveBoard.objects.get(pk=ta.data["boardId"])
        self.assertEqual((b.group_id, b.title), (self.g.pk, "Доска группы — 9А"))
        self.assertEqual(b.get_permission_for(self.ub), "edit")
        mine = self._post(self.teacher, {"meeting": self.mgr, "student_id": self.sa.pk})
        self.assertEqual(mine.data["kind"], "student")
        self.assertNotEqual(mine.data["boardId"], str(b.pk))
        self.assertEqual(
            self._post(
                self.teacher, {"meeting": self.mgr, "target": "board"}
            ).status_code,
            400,
        )
        self.assertEqual(
            self._post(
                self.teacher, {"meeting": self.mgr, "target": "mine"}
            ).status_code,
            400,
        )
        self.assertEqual(
            self._post(self.out, {"meeting": self.mgr, "target": "group"}).status_code,
            403,
        )
        c = APIClient()
        c.force_login(self.out)
        self.assertEqual(
            c.get(f"/api/cabinet/interactive-boards/{b.pk}/").status_code, 403
        )
        # индивидуальный урок — без группы
        self.assertEqual(
            self._post(
                self.teacher, {"meeting": self.m1, "target": "group"}
            ).status_code,
            403,
        )
        self.assertNotIn("group", self._post(self.teacher, {"meeting": self.m1}).data)
        # повтор — та же доска
        self.assertEqual(
            self._post(self.teacher, {"meeting": self.mgr, "target": "group"}).data[
                "boardId"
            ],
            str(b.pk),
        )


class VariantBoardSplitSyncTests(VariantBoardGroupTests):
    """Сплит «Доска рядом» на уроке виден только тому, кому доступна доска."""

    def _meeting(self, uuid):
        from Cabinet.models import VideoMeeting
        from Cabinet.video_meeting_service import start_meeting

        meeting = VideoMeeting.objects.get(uuid=uuid)
        if meeting.status != VideoMeeting.Status.LIVE:
            start_meeting(meeting=meeting, user=self.teacher)
            meeting.refresh_from_db()
        return meeting

    def _present(self, meeting):
        from Cabinet.meeting_present import present_variant

        present_variant(
            meeting=meeting,
            user=self.teacher,
            title="Вариант",
            url="/oge/inf/variant/42",
        )
        meeting.refresh_from_db()
        return meeting

    def _split(self, user, uuid, body):
        c = APIClient()
        c.force_login(user)
        return c.post(
            f"/api/video-meetings/{uuid}/variant-board-split/", body, format="json"
        )

    def _status(self, user, uuid):
        c = APIClient()
        c.force_login(user)
        return c.get(f"/api/video-meetings/{uuid}/status/")

    def test_student_variant_board_stays_forbidden(self):
        for user, meeting in (
            (self.ua, self.m1),
            (self.ub, self.mg),
            (self.ua, self.mgr),
        ):
            res = self._post(user, {"meeting": meeting})
            self.assertEqual(
                (res.status_code, res.data.get("code")),
                (403, "teacher_only"),
                user.username,
            )

    def _open_for_anya(self):
        meeting = self._present(self._meeting(self.mg))
        decoy = InteractiveBoard.objects.create(
            owner=self.teacher, student=self.sb, title="Чужая"
        )
        opened = self._split(
            self.teacher,
            self.mg,
            {"open": True, "studentId": self.sa.pk, "boardId": str(decoy.pk)},
        )
        self.assertEqual(opened.status_code, 200, opened.content)
        return meeting, opened, decoy

    def test_choose_student_does_not_broadcast(self):
        meeting = self._present(self._meeting(self.mg))
        with mock.patch(
            "Cabinet.video_meeting_api.broadcast_material_event"
        ) as broadcast:
            pending = self._split(
                self.teacher, self.mg, {"open": True, "boardId": "ignore-me"}
            )
            self.assertEqual(pending.status_code, 409, pending.content)
            self.assertEqual(pending.data.get("code"), "choose_student")
            broadcast.assert_not_called()
        meeting.refresh_from_db()
        self.assertNotIn("boardSplit", meeting.presented_payload)

    def test_open_reaches_owner_not_foreign_student(self):
        import json
        from Cabinet.meeting_material_session import sync_state_payload

        meeting, opened, decoy = self._open_for_anya()
        split = opened.data["presented"]["boardSplit"]
        self.assertEqual(
            (split["open"], split["kind"], split["studentId"]),
            (True, "student", self.sa.pk),
        )
        self.assertNotEqual(split["boardId"], str(decoy.pk))
        board_id = split["boardId"]
        meeting.refresh_from_db()
        self.assertEqual(meeting.presented_payload["boardSplit"]["boardId"], board_id)
        own = self._status(self.ua, self.mg)
        self.assertEqual(own.data["presented"]["boardSplit"]["boardId"], board_id)
        late = sync_state_payload(meeting, self.ua)
        self.assertEqual(late["presented"]["boardSplit"]["boardId"], board_id)
        foreign = json.dumps(self._status(self.ub, self.mg).data["presented"])
        self.assertNotIn(board_id, foreign)
        denied = self._split(self.ua, self.mg, {"open": False})
        self.assertEqual(denied.status_code, 403)

    def test_close_keeps_variant(self):
        self._open_for_anya()
        closed = self._split(self.teacher, self.mg, {"open": False})
        self.assertEqual(closed.status_code, 200, closed.content)
        self.assertEqual(closed.data["presented"]["kind"], "variant")
        self.assertEqual(closed.data["presented"]["boardSplit"], {"open": False})
        self.assertTrue(closed.data["presented"]["homeworkId"])
        student = self._status(self.ua, self.mg)
        self.assertEqual(student.data["presented"]["boardSplit"], {"open": False})

    def test_present_again_drops_stale_split(self):
        from Cabinet.meeting_present import present_variant

        meeting, _, _ = self._open_for_anya()
        present_variant(
            meeting=meeting, user=self.teacher, title="Снова", url="/oge/inf/variant/43"
        )
        meeting.refresh_from_db()
        self.assertNotIn("boardSplit", meeting.presented_payload)
        again = self._status(self.ua, self.mg)
        self.assertNotIn("boardSplit", again.data["presented"])

    def test_clear_and_finish_drop_split(self):
        from Cabinet.meeting_present import clear_presented
        from Cabinet.models import VideoMeeting
        from Cabinet.video_meeting_service import finish_meeting

        meeting, _, _ = self._open_for_anya()
        clear_presented(meeting=meeting, user=self.teacher)
        meeting.refresh_from_db()
        self.assertEqual(meeting.presented_kind, "")
        self.assertEqual(meeting.presented_payload, {})
        meeting = self._present(VideoMeeting.objects.get(uuid=self.mg))
        self._split(self.teacher, self.mg, {"open": True, "studentId": self.sa.pk})
        finish_meeting(meeting=meeting, user=self.teacher)
        meeting.refresh_from_db()
        self.assertEqual(meeting.presented_kind, "")
        self.assertEqual(meeting.presented_payload, {})

    def test_group_board_reaches_members_only(self):
        meeting = self._present(self._meeting(self.mgr))
        opened = self._split(
            self.teacher, self.mgr, {"open": True, "target": "group", "boardId": "nope"}
        )
        self.assertEqual(opened.status_code, 200, opened.content)
        board_id = opened.data["presented"]["boardSplit"]["boardId"]
        self.assertEqual(opened.data["presented"]["boardSplit"]["kind"], "group")
        self.assertNotIn("studentId", opened.data["presented"]["boardSplit"])
        for user in (self.ua, self.ub):
            res = self._status(user, self.mgr)
            self.assertEqual(
                res.data["presented"]["boardSplit"]["boardId"], board_id, user.username
            )
        self.assertEqual(
            self._post(self.ua, {"meeting": self.mgr, "target": "group"}).status_code,
            403,
        )
        meeting.status = "scheduled"
        meeting.save(update_fields=["status"])
        stopped = self._split(self.teacher, self.mgr, {"open": False})
        self.assertEqual(stopped.status_code, 409)
        meeting.refresh_from_db()
        self.assertEqual(meeting.presented_payload["boardSplit"]["boardId"], board_id)
        outsider = self._status(self.out, self.mgr)
        self.assertEqual(outsider.status_code, 403)
        self.assertNotIn(board_id, outsider.content.decode())
