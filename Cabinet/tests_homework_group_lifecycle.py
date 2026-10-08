"""Общая групповая работа: действие одного ученика не меняет данные остальных."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.journal_models import LessonJournal
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkSubmissionAttachment,
    HomeworkTask,
    Profile,
    ReviewItem,
    ScheduleEvent,
    Student,
    StudentGroup,
)


def _teacher(username):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save(update_fields=["role"])
    return user


def _student(username, teacher, first_name):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.STUDENT
    user.profile.save(update_fields=["role"])
    return Student.objects.create(
        teacher=teacher,
        user=user,
        first_name=first_name,
        last_name="Ученица",
        status="active",
    )


class SharedGroupHomeworkLifecycleTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("grp_teacher")
        self.other = _teacher("grp_other")
        self.group = StudentGroup.objects.create(
            teacher=self.teacher,
            title="Группа 1",
            status="active",
        )
        self.nora = _student("grp_nora", self.teacher, "Нора")
        self.daria = _student("grp_daria", self.teacher, "Даша")
        self.sonya = _student("grp_sonya", self.teacher, "Соня")
        self.kate = _student("grp_kate", self.teacher, "Катя")
        self.rita = _student("grp_rita", self.teacher, "Рита")
        self.group.students.add(self.nora, self.daria, self.sonya, self.kate, self.rita)
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=None,
            group=self.group,
            title="Общая работа",
            description="Решите номера",
            status="assigned",
            due_at=timezone.now() + timedelta(days=4),
        )
        self.task = HomeworkTask.objects.create(
            homework=self.homework,
            title="Номер 1",
            description="2+2",
            task_type="text",
            order=0,
        )
        self.client = APIClient()
        self.client.force_login(self.teacher)

    def _submission(self, student, **kwargs):
        return HomeworkSubmission.objects.create(
            homework=self.homework,
            student=student,
            **kwargs,
        )

    def _review_for(self, student):
        submission = HomeworkSubmission.objects.get(homework=self.homework, student=student)
        return ReviewItem.objects.get(source_type="homework", source_id=submission.pk)

    def test_five_students_keep_independent_states(self):
        draft = self._submission(
            self.daria,
            status="submitted",
            answer_text="черновик Даши",
            result_payload={"answers": {"1": "черновик"}},
        )
        HomeworkSubmissionAttachment.objects.create(
            submission=draft,
            file=SimpleUploadedFile("daria.png", b"daria", content_type="image/png"),
            original_name="daria.png",
        )
        sonya = self._submission(
            self.sonya,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="ответ Сони",
            result_payload={"answers": {"1": "4"}},
        )
        kate = self._submission(
            self.kate,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="ответ Кати",
            result_payload={"answers": {"1": "4"}},
        )
        rita = self._submission(
            self.rita,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="ответ Риты",
            result_payload={"answers": {"1": "5"}},
        )
        before_rows = Homework.objects.filter(group=self.group).count()
        before_submissions = HomeworkSubmission.objects.filter(homework=self.homework).count()

        checked = self.client.post(
            f"/api/cabinet/review/{self._review_for(self.kate).pk}/check/",
            {
                "teacher_comment": "Верно",
                "manual_stats": {"total": 1, "correct": 1, "incorrect": 0, "unsolved": 0},
            },
            format="json",
        )
        self.assertEqual(checked.status_code, 200, checked.content)
        returned = self.client.post(
            f"/api/cabinet/review/{self._review_for(self.rita).pk}/return/",
            {"teacher_comment": "Исправь номер"},
            format="json",
        )
        self.assertEqual(returned.status_code, 200, returned.content)

        self.homework.refresh_from_db()
        self.assertEqual(self.homework.status, "assigned")
        self.assertEqual(Homework.objects.filter(group=self.group).count(), before_rows)
        self.assertEqual(
            HomeworkSubmission.objects.filter(homework=self.homework).count(),
            before_submissions,
        )
        self.assertFalse(
            HomeworkSubmission.objects.filter(homework=self.homework, student=self.nora).exists()
        )

        draft.refresh_from_db()
        sonya.refresh_from_db()
        kate.refresh_from_db()
        rita.refresh_from_db()
        self.assertEqual(draft.answer_text, "черновик Даши")
        self.assertIsNone(draft.submitted_at)
        self.assertEqual(draft.result_payload["answers"]["1"], "черновик")
        self.assertEqual(draft.file_attachments.get().original_name, "daria.png")
        self.assertEqual(sonya.status, "submitted")
        self.assertEqual(sonya.answer_text, "ответ Сони")
        self.assertIsNone(sonya.score)
        self.assertEqual(sonya.teacher_comment, "")
        self.assertEqual(kate.status, "checked")
        self.assertEqual(kate.teacher_comment, "Верно")
        self.assertEqual(float(kate.score), 100.0)
        self.assertEqual(kate.answer_text, "ответ Кати")
        self.assertEqual(rita.status, "returned")
        self.assertEqual(rita.teacher_comment, "Исправь номер")
        self.assertEqual(rita.answer_text, "ответ Риты")
        self.assertEqual(self._review_for(self.sonya).status, "pending")
        self.assertEqual(self._review_for(self.kate).status, "checked")
        self.assertEqual(self._review_for(self.rita).status, "returned")

        payload = self.client.get("/api/cabinet/review/").json()
        self.assertEqual(payload["counts"]["pending"], 1)
        self.assertEqual(payload["counts"]["unsubmitted"], 2)
        missing = {
            row["student_id"]: row["status"]
            for row in payload["unsubmitted"]
            if row["homework_id"] == self.homework.id
        }
        self.assertEqual(missing, {self.nora.id: "not_submitted", self.daria.id: "draft"})

        self.homework.status = "checked"
        self.homework.save(update_fields=["status", "updated_at"])
        nora_client = APIClient()
        nora_client.force_login(self.nora.user)
        cards = nora_client.get("/api/cabinet/student/assignments/").json()["items"]
        nora_card = next(row for row in cards if row["id"] == self.homework.id)
        self.assertEqual(nora_card["status"], "new")
        kate_client = APIClient()
        kate_client.force_login(self.kate.user)
        kate_cards = kate_client.get("/api/cabinet/student/assignments/").json()["items"]
        kate_card = next(row for row in kate_cards if row["id"] == self.homework.id)
        self.assertEqual(kate_card["status"], "checked")

    def test_individual_copies_do_not_share_review_status(self):
        left = Homework.objects.create(
            teacher=self.teacher,
            student=self.nora,
            group=self.group,
            title="Личная копия Норы",
            status="assigned",
        )
        right = Homework.objects.create(
            teacher=self.teacher,
            student=self.daria,
            group=self.group,
            title="Личная копия Даши",
            status="assigned",
        )
        left_sub = HomeworkSubmission.objects.create(
            homework=left,
            student=self.nora,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="только Нора",
        )
        right_sub = HomeworkSubmission.objects.create(
            homework=right,
            student=self.daria,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="только Даша",
            score=40,
            teacher_comment="пока не трогать",
        )
        review = ReviewItem.objects.get(source_type="homework", source_id=left_sub.pk)
        response = self.client.post(
            f"/api/cabinet/review/{review.pk}/check/",
            {"teacher_comment": "Зачтено Норе", "manual_stats": {"total": 1, "correct": 1}},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        left.refresh_from_db()
        right.refresh_from_db()
        right_sub.refresh_from_db()
        self.assertEqual(left.status, "checked")
        self.assertEqual(right.status, "assigned")
        self.assertEqual(right_sub.answer_text, "только Даша")
        self.assertEqual(float(right_sub.score), 40.0)
        self.assertEqual(right_sub.teacher_comment, "пока не трогать")

    def test_task_edit_and_delete_do_not_touch_other_students(self):
        sonya = self._submission(
            self.sonya,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="уже сдано",
            result_payload={"answers": {"1": "4"}},
            score=70,
            teacher_comment="черновой комментарий",
        )
        draft = self._submission(self.daria, status="submitted", answer_text="мой черновик")
        self.homework.refresh_from_db()
        blocked = self.client.patch(
            f"/api/cabinet/homework/{self.homework.id}/",
            {
                "updated_at": self.homework.updated_at.isoformat(),
                "confirm_student_started": True,
                "tasks": [],
            },
            format="json",
        )
        self.assertEqual(blocked.status_code, 400, blocked.content)
        self.task.refresh_from_db()
        sonya.refresh_from_db()
        draft.refresh_from_db()
        self.assertTrue(self.task.is_active)
        self.assertEqual(sonya.answer_text, "уже сдано")
        self.assertEqual(float(sonya.score), 70.0)
        self.assertEqual(sonya.result_payload["answers"]["1"], "4")
        self.assertEqual(draft.answer_text, "мой черновик")

        self.homework.refresh_from_db()
        due = timezone.now() + timedelta(days=9)
        shifted = self.client.patch(
            f"/api/cabinet/homework/{self.homework.id}/",
            {
                "updated_at": self.homework.updated_at.isoformat(),
                "due_at": due.isoformat(),
            },
            format="json",
        )
        self.assertEqual(shifted.status_code, 200, shifted.content)
        sonya.refresh_from_db()
        draft.refresh_from_db()
        self.assertEqual(sonya.answer_text, "уже сдано")
        self.assertEqual(draft.answer_text, "мой черновик")

        added = self.client.post(
            f"/api/cabinet/homework/{self.homework.id}/tasks/",
            {"text": "Новый номер", "text_title": "Номер 2"},
            format="json",
        )
        self.assertEqual(added.status_code, 400, added.content)
        self.assertEqual(self.homework.tasks.filter(is_active=True).count(), 1)

        removed = self.client.delete(f"/api/cabinet/homework/{self.homework.id}/")
        self.assertEqual(removed.status_code, 400, removed.content)
        self.assertEqual(removed.json()["code"], "group_personal_work")
        self.assertTrue(Homework.objects.filter(pk=self.homework.pk).exists())
        self.assertEqual(sonya.answer_text, "уже сдано")

        empty = Homework.objects.create(
            teacher=self.teacher,
            group=self.group,
            title="Ещё никто не открыл",
            status="assigned",
        )
        other_personal = Homework.objects.create(
            teacher=self.teacher,
            student=self.kate,
            title="Чужая личная",
            status="assigned",
        )
        gone = self.client.delete(f"/api/cabinet/homework/{empty.id}/")
        self.assertEqual(gone.status_code, 204, getattr(gone, "content", b""))
        self.assertFalse(Homework.objects.filter(pk=empty.pk).exists())
        self.assertTrue(Homework.objects.filter(pk=self.homework.pk).exists())
        self.assertTrue(Homework.objects.filter(pk=other_personal.pk).exists())

    def test_group_membership_does_not_duplicate_or_drop_started_work(self):
        newbie = _student("grp_newbie", self.teacher, "Нина")
        self.group.students.add(newbie)
        self.assertEqual(Homework.objects.filter(group=self.group).count(), 1)
        client = APIClient()
        client.force_login(newbie.user)
        visible = [row["id"] for row in client.get("/api/cabinet/student/assignments/").json()["items"]]
        self.assertIn(self.homework.id, visible)
        self.assertEqual(Homework.objects.filter(group=self.group).count(), 1)

        HomeworkSubmission.objects.create(
            homework=self.homework,
            student=newbie,
            status="submitted",
            submitted_at=timezone.now(),
            answer_text="успела сдать",
        )
        self.group.students.remove(newbie)
        still = [row["id"] for row in client.get("/api/cabinet/student/assignments/").json()["items"]]
        self.assertIn(self.homework.id, still)
        self.assertEqual(
            HomeworkSubmission.objects.get(homework=self.homework, student=newbie).answer_text,
            "успела сдать",
        )

        self.group.students.remove(self.nora)
        nora_client = APIClient()
        nora_client.force_login(self.nora.user)
        nora_ids = [row["id"] for row in nora_client.get("/api/cabinet/student/assignments/").json()["items"]]
        self.assertNotIn(self.homework.id, nora_ids)

        self.group.students.add(newbie)
        again = [row["id"] for row in client.get("/api/cabinet/student/assignments/").json()["items"]]
        self.assertEqual(again.count(self.homework.id), 1)
        self.assertEqual(Homework.objects.filter(teacher=self.teacher, group=self.group).count(), 1)

        self.nora.status = "archived"
        self.nora.save(update_fields=["status"])
        self.group.students.add(self.nora)
        self.daria.status = "paused"
        self.daria.save(update_fields=["status"])
        review = self.client.get("/api/cabinet/review/").json()
        missing_ids = {row["student_id"] for row in review["unsubmitted"]}
        self.assertNotIn(self.nora.id, missing_ids)
        self.assertIn(self.daria.id, missing_ids)

    def test_other_teacher_cannot_change_the_group_homework(self):
        foreign = APIClient()
        foreign.force_login(self.other)
        self.assertEqual(foreign.get(f"/api/cabinet/homework/{self.homework.id}/").status_code, 403)
        self.assertEqual(foreign.delete(f"/api/cabinet/homework/{self.homework.id}/").status_code, 403)
        self.assertTrue(Homework.objects.filter(pk=self.homework.pk).exists())

    def test_group_journal_status_is_not_overwritten_by_one_student(self):
        submission = self._submission(
            self.kate,
            status="checked",
            submitted_at=timezone.now(),
            answer_text="ответ Кати",
            score=90,
            teacher_comment="Верно",
        )
        now = timezone.now()
        group_event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Групповой урок",
            starts_at=now,
            ends_at=now + timedelta(hours=1),
            group=self.group,
            event_type="group_lesson",
        )
        group_journal = LessonJournal.objects.create(
            schedule_event=group_event,
            teacher=self.teacher,
            group=self.group,
            lesson_date=timezone.localdate(),
            previous_homework=self.homework,
            previous_homework_status="not_reviewed",
        )
        own_event = ScheduleEvent.objects.create(
            owner=self.teacher,
            title="Индивидуальный",
            starts_at=now,
            ends_at=now + timedelta(hours=1),
            student=self.kate,
            event_type="individual_lesson",
        )
        own_journal = LessonJournal.objects.create(
            schedule_event=own_event,
            teacher=self.teacher,
            student=self.kate,
            lesson_date=timezone.localdate(),
            previous_homework=self.homework,
            previous_homework_status="not_reviewed",
        )
        from Cabinet.journal_service import sync_previous_homework_status_from_submission

        sync_previous_homework_status_from_submission(submission)
        group_journal.refresh_from_db()
        own_journal.refresh_from_db()
        self.assertEqual(group_journal.previous_homework_status, "not_reviewed")
        self.assertEqual(own_journal.previous_homework_status, "full")
