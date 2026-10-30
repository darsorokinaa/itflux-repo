"""r120: балл второй части на видеоуроке — сохраняется один раз и учитывается в итоге."""
from unittest import mock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.models import HomeworkSubmission, Notification
from Cabinet.tests_video_meeting import VideoMeetingApiTests
from Cabinet.video_meeting_service import start_meeting

GRADING = [
    {"id": 5, "part": 1, "maxScore": 1},
    {"id": 101, "part": 2, "maxScore": 3, "criteria": {"scoring_mode": "single", "criteria": [], "axes": [], "max_score": 3}},
]


@override_settings(
    LESSON_SECRET="test-lesson-secret-for-present",
    VIDEO_FAILOVER_ENABLED=False, VIDEO_PROVIDER="meet", JITSI_DOMAIN="meet.example.test",
    JITSI_AUTH_MODE="jwt", JITSI_APP_ID="itflux-test", JITSI_APP_SECRET="test-secret-not-for-production-32b",
    JITSI_SUB="meet.example.test", JITSI_AUD="jitsi", JITSI_TOKEN_TTL_SECONDS=3600,
    JITSI_JOIN_BEFORE_MINUTES=15, JITSI_JOIN_AFTER_MINUTES=30,
)
class LiveScoreTests(TestCase):
    setUp_base = VideoMeetingApiTests.setUp
    _create_meeting = VideoMeetingApiTests._create_meeting

    def setUp(self):
        self.setUp_base()
        meeting = self._create_meeting()
        start_meeting(meeting=meeting, user=self.teacher)
        self.client.force_login(self.teacher)
        res = self.client.post(
            f"/api/video-meetings/{meeting.uuid}/present/",
            {"kind": "variant", "title": "Вариант", "url": "/oge/inf/variant/42"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.meeting = meeting
        self.homework_id = res.data["presented"]["homeworkId"]
        self.url = f"/api/video-meetings/{meeting.uuid}/live-score/"
        self.patcher = mock.patch("Cabinet.meeting_present.grading_tasks", return_value=[dict(r) for r in GRADING])
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def _student_draft(self, result):
        c = APIClient()
        c.force_login(self.student_user)
        r = c.post(f"/api/homework/assignment/{self.homework_id}/save-draft/", {"result": result}, format="json")
        self.assertEqual(r.status_code, 200, r.content)

    def _post(self, task_id=101, score=2, user=None):
        self.client.force_login(user or self.teacher)
        return self.client.post(self.url, {"studentId": self.student.pk, "taskId": task_id, "score": score}, format="json")

    def test_save_once_then_locked(self):
        self._student_draft({"by_task_id": {"101": "решение"}})
        notif_before = Notification.objects.count()
        r = self._post(score=2)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["score"], 2)
        sub = HomeworkSubmission.objects.get(homework_id=self.homework_id, student=self.student)
        self.assertEqual(sub.result_payload["scores"]["101"], 2)
        self.assertEqual(sub.result_payload["lesson_locked_scores"]["101"]["score"], 2)
        # повтор — 409, значение не меняется
        r2 = self._post(score=3)
        self.assertEqual(r2.status_code, 409, r2.content)
        sub.refresh_from_db()
        self.assertEqual(sub.result_payload["scores"]["101"], 2)
        self.assertEqual(Notification.objects.count(), notif_before)
        # live-answers отдаёт замок и критерии
        a = self.client.get(f"/api/video-meetings/{self.meeting.uuid}/live-answers/")
        self.assertEqual(a.data["students"][0]["lockedScores"]["101"]["score"], 2)

    def test_student_cannot_override_locked(self):
        self._student_draft({"by_task_id": {"101": "x"}})
        self.assertEqual(self._post(score=1).status_code, 200)
        self._student_draft({"scores": {"101": 3}, "lesson_locked_scores": {"101": {"score": 3}}})
        sub = HomeworkSubmission.objects.get(homework_id=self.homework_id, student=self.student)
        self.assertEqual(sub.result_payload["scores"]["101"], 1)
        self.assertEqual(sub.result_payload["lesson_locked_scores"]["101"]["score"], 1)

    def test_validation(self):
        self._student_draft({"by_task_id": {"101": "x"}})
        self.assertEqual(self._post(score=4).status_code, 400)
        self.assertEqual(self._post(score=-1).status_code, 400)
        self.assertEqual(self._post(score="1.5").status_code, 400)
        self.assertEqual(self._post(task_id=5, score=1).status_code, 400)
        self.assertEqual(self._post(task_id=999, score=1).status_code, 400)
        self.assertEqual(self._post(score=0).status_code, 200)

    def test_forbidden_for_others(self):
        self._student_draft({"by_task_id": {"101": "x"}})
        self.assertIn(self._post(user=self.other_teacher).status_code, (403, 404))
        self.assertIn(self._post(user=self.student_user).status_code, (403, 404))
        sub = HomeworkSubmission.objects.get(homework_id=self.homework_id, student=self.student)
        self.assertNotIn("lesson_locked_scores", sub.result_payload or {})


class Part2ScoreCountsInTotal(TestCase):
    def test_score_variant_attempt_uses_scores(self):
        try:
            from Generator.variant_scoring import score_variant_attempt
        except Exception:
            from Generator.Generator.variant_scoring import score_variant_attempt
        tasks = [
            {"id": 5, "number": 1, "max_score": 1, "part": None, "part_title": "Часть 1", "exam_part": 1, "answer": "15"},
            {"id": 101, "number": 20, "max_score": 3, "part": None, "part_title": "Часть 2", "exam_part": 2, "answer": ""},
        ]
        out = score_variant_attempt(
            tasks=tasks, level="oge", subject="inf",
            answers={"5": "15", "101": "r"}, scores={"101": 2}, checked={"5": True},
        )
        self.assertEqual(out.get("earned_points"), 3, out)
