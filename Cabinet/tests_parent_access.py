"""Тесты приглашений родителя, прав доступа и журнала ДЗ."""

from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .choices import CommentVisibility, HomeworkStatus, ParentRelationshipStatus, SubmissionStatus
from .homework_attempts import maybe_snapshot_before_resubmit, serialize_attempts
from .journal_service import build_homework_result_payload, build_journal_entries_feed
from .models import Homework, HomeworkSubmission, Profile, Student
from .parent_invitations import (
    accept_parent_invitation,
    create_parent_invitation,
    get_invitation_by_raw_token,
    hash_token,
    revoke_parent_access,
    revoke_parent_invitation,
)
from .parent_models import ParentStudentRelationship


class ParentInviteTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("t1", "t1@example.com", "pass12345")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.other_teacher = User.objects.create_user("t2", "t2@example.com", "pass12345")
        self.other_teacher.profile.role = Profile.Role.TEACHER
        self.other_teacher.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            first_name="Иван",
            last_name="Иванов",
        )
        self.client = APIClient()

    def test_teacher_can_create_invite_from_student_card(self):
        self.client.force_authenticate(self.teacher)
        resp = self.client.post(
            f"/api/cabinet/students/{self.student.id}/parents/invite/",
            {
                "invited_name": "Мария",
                "invited_email": "mom@example.com",
                "relationship_type": "mother",
                "permissions": {"view_billing": True, "view_homework": True},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertIn("token", resp.data)
        self.assertTrue(resp.data["invite_url"].startswith("/parent/invite/accept/"))
        inv = get_invitation_by_raw_token(resp.data["token"])
        self.assertIsNotNone(inv)
        self.assertEqual(inv.student_id, self.student.id)
        self.assertEqual(inv.token_hash, hash_token(resp.data["token"]))

    def test_teacher_cannot_invite_foreign_student(self):
        self.client.force_authenticate(self.other_teacher)
        resp = self.client.post(
            f"/api/cabinet/students/{self.student.id}/parents/invite/",
            {"invited_name": "X"},
            format="json",
        )
        self.assertEqual(resp.status_code, 404)

    def test_invite_one_time_and_accept_creates_relationship(self):
        inv, raw = create_parent_invitation(
            self.teacher, self.student, invited_name="Папа", relationship_type="father"
        )
        parent = User.objects.create_user("p1", "p1@example.com", "pass12345")
        parent.profile.role = Profile.Role.PARENT
        parent.profile.save()
        rel = accept_parent_invitation(parent, inv)
        self.assertEqual(rel.status, ParentRelationshipStatus.ACTIVE)
        self.assertEqual(rel.student_id, self.student.id)
        inv.refresh_from_db()
        self.assertEqual(inv.status, "accepted")
        with self.assertRaises(ValueError):
            accept_parent_invitation(parent, inv)

    def test_expired_and_revoked_invite_blocked(self):
        inv, raw = create_parent_invitation(self.teacher, self.student, invited_name="X", expires_days=1)
        inv.expires_at = timezone.now() - timedelta(hours=1)
        inv.save(update_fields=["expires_at"])
        parent = User.objects.create_user("p2", "p2@example.com", "pass12345")
        parent.profile.role = Profile.Role.PARENT
        parent.profile.save()
        with self.assertRaises(ValueError):
            accept_parent_invitation(parent, inv)

        inv2, raw2 = create_parent_invitation(self.teacher, self.student, invited_name="Y")
        revoke_parent_invitation(self.teacher, inv2)
        with self.assertRaises(ValueError):
            accept_parent_invitation(parent, inv2)

    def test_parent_cannot_access_foreign_student(self):
        inv, raw = create_parent_invitation(self.teacher, self.student, invited_name="Mom")
        parent = User.objects.create_user("p3", "p3@example.com", "pass12345")
        parent.profile.role = Profile.Role.PARENT
        parent.profile.save()
        accept_parent_invitation(parent, inv)
        other = Student.objects.create(teacher=self.teacher, first_name="Пётр", last_name="Петров")
        self.client.force_authenticate(parent)
        resp = self.client.get("/api/cabinet/parent/dashboard/", {"student_id": other.id})
        self.assertEqual(resp.status_code, 403)

    def test_revoked_access_blocks_immediately(self):
        inv, raw = create_parent_invitation(self.teacher, self.student, invited_name="Mom")
        parent = User.objects.create_user("p4", "p4@example.com", "pass12345")
        parent.profile.role = Profile.Role.PARENT
        parent.profile.save()
        rel = accept_parent_invitation(parent, inv)
        revoke_parent_access(self.teacher, rel)
        self.client.force_authenticate(parent)
        resp = self.client.get("/api/cabinet/parent/dashboard/", {"student_id": self.student.id})
        self.assertEqual(resp.status_code, 403)

    def test_multiple_parents_allowed(self):
        p1 = User.objects.create_user("pa", "pa@example.com", "pass12345")
        p1.profile.role = Profile.Role.PARENT
        p1.profile.save()
        p2 = User.objects.create_user("pb", "pb@example.com", "pass12345")
        p2.profile.role = Profile.Role.PARENT
        p2.profile.save()
        inv1, _ = create_parent_invitation(self.teacher, self.student, invited_name="A")
        inv2, _ = create_parent_invitation(self.teacher, self.student, invited_name="B")
        accept_parent_invitation(p1, inv1)
        accept_parent_invitation(p2, inv2)
        self.assertEqual(
            ParentStudentRelationship.objects.filter(
                student=self.student, status=ParentRelationshipStatus.ACTIVE
            ).count(),
            2,
        )


class HomeworkAttemptAndJournalTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("thw", "thw@example.com", "pass12345")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student = Student.objects.create(teacher=self.teacher, first_name="Аня", last_name="С.")
        self.hw = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ тест",
            status=HomeworkStatus.ASSIGNED,
            due_at=timezone.now() + timedelta(days=2),
        )

    def test_checked_homework_appears_in_journal_feed(self):
        sub = HomeworkSubmission.objects.create(
            homework=self.hw,
            student=self.student,
            status=SubmissionStatus.CHECKED,
            score=Decimal("85.00"),
            submitted_at=timezone.now(),
            result_payload={"checked": {"1": True, "2": True}},
        )
        feed = build_journal_entries_feed(self.teacher, student_id=self.student.id, homework_only=True)
        self.assertTrue(any(e.get("homework_id") == self.hw.id for e in feed["entries"]))
        payload = build_homework_result_payload(homework=self.hw, student=self.student, submission=sub)
        self.assertEqual(payload["score_percent"], 85.0)
        self.assertEqual(payload["entry_type"], "homework")

    def test_resubmit_keeps_attempt_history(self):
        sub = HomeworkSubmission.objects.create(
            homework=self.hw,
            student=self.student,
            status=SubmissionStatus.RETURNED,
            score=Decimal("40.00"),
            submitted_at=timezone.now() - timedelta(days=1),
            result_payload={"checked": {"1": False}},
            teacher_comment="Доработай",
        )
        snap = maybe_snapshot_before_resubmit(sub)
        self.assertIsNotNone(snap)
        sub.status = SubmissionStatus.SUBMITTED
        sub.score = Decimal("90.00")
        sub.result_payload = {"checked": {"1": True}}
        sub.submitted_at = timezone.now()
        sub.save()
        attempts = serialize_attempts(sub)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0]["score"], 40.0)

    def test_unfinished_draft_not_final_in_feed_status(self):
        HomeworkSubmission.objects.create(
            homework=self.hw,
            student=self.student,
            status=SubmissionStatus.SUBMITTED,
            submitted_at=None,
            result_payload={"draft": True},
        )
        payload = build_homework_result_payload(homework=self.hw, student=self.student)
        self.assertEqual(payload["status"], "not_submitted")


class ParentJournalVisibilityTests(TestCase):
    def setUp(self):
        from .journal_models import LessonJournal, StudentLessonRecord
        from .models import ScheduleEvent

        self.teacher = User.objects.create_user("tj", "tj@example.com", "pass12345")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student = Student.objects.create(teacher=self.teacher, first_name="Кира")
        self.parent = User.objects.create_user("parj", "parj@example.com", "pass12345")
        self.parent.profile.role = Profile.Role.PARENT
        self.parent.profile.save()
        inv, _ = create_parent_invitation(self.teacher, self.student, invited_name="Mom")
        accept_parent_invitation(self.parent, inv)

        def _journal(topic: str) -> LessonJournal:
            starts = timezone.now()
            event = ScheduleEvent.objects.create(
                owner=self.teacher,
                student=self.student,
                title=topic,
                starts_at=starts,
                ends_at=starts + timedelta(hours=1),
                status="planned",
            )
            return LessonJournal.objects.create(
                schedule_event=event,
                teacher=self.teacher,
                student=self.student,
                lesson_date=starts.date(),
                actual_topic=topic,
            )

        self.draft = StudentLessonRecord.objects.create(
            journal=_journal("draft-topic"),
            student=self.student,
            publish_status="draft",
            visible_to_parent=False,
            overall_score=Decimal("90"),
            teacher_comment="секрет",
            comment_visibility=CommentVisibility.STUDENT_AND_PARENT,
        )
        self.published_hidden = StudentLessonRecord.objects.create(
            journal=_journal("hidden-topic"),
            student=self.student,
            publish_status="published",
            visible_to_parent=False,
            overall_score=Decimal("70"),
            teacher_comment="не для родителя",
        )
        self.published_visible = StudentLessonRecord.objects.create(
            journal=_journal("visible-topic"),
            student=self.student,
            publish_status="published",
            visible_to_parent=True,
            overall_score=Decimal("80"),
            teacher_comment="ок",
            comment_visibility=CommentVisibility.STUDENT_AND_PARENT,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.parent)

    def test_parent_journal_hides_draft_and_hidden(self):
        resp = self.client.get(
            "/api/cabinet/parent/journal/",
            {"student_id": self.student.id, "entry_type": "lesson"},
        )
        self.assertEqual(resp.status_code, 200)
        ids = {e.get("record_id") for e in resp.data.get("entries") or []}
        self.assertNotIn(self.draft.id, ids)
        self.assertNotIn(self.published_hidden.id, ids)
        self.assertIn(self.published_visible.id, ids)

    def test_student_account_cannot_accept_parent_invite(self):
        student_user = User.objects.create_user("stuacc", "stu@example.com", "pass12345")
        student_user.profile.role = Profile.Role.STUDENT
        student_user.profile.save()
        Student.objects.create(
            teacher=self.teacher,
            first_name="Ученик",
            user=student_user,
        )
        inv, _ = create_parent_invitation(self.teacher, self.student, invited_name="Bad")
        with self.assertRaises(ValueError):
            accept_parent_invitation(student_user, inv)
