"""Исторические дубли ReviewItem: одна сдача в счётчиках и верное замечание ученику."""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from Cabinet.dashboard_engagement import build_engagement
from Cabinet.homework_api import count_new_homework_reviews
from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkTask,
    Notification,
    NotificationPreference,
    Profile,
    ReviewItem,
    Student,
)
from Cabinet.teacher_notifications import send_homework_review_digests


def _teacher(username):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.TEACHER
    user.profile.save()
    return user


def _student(username, teacher):
    user = User.objects.create_user(username=username, password="pass")
    user.profile.role = Profile.Role.STUDENT
    user.profile.save()
    student = Student.objects.create(
        teacher=teacher,
        user=user,
        first_name="Ира",
        last_name="Ученица",
        status="active",
    )
    return user, student


class HomeworkReviewHistoryTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("hist_teacher")
        self.student_user, self.student = _student("hist_student", self.teacher)
        self.teacher_client = APIClient()
        self.teacher_client.force_login(self.teacher)
        self.student_client = APIClient()
        self.student_client.force_login(self.student_user)
        self.now = timezone.now()

    def _homework(self, title, *, status, teacher_comment="", payload=None):
        homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title=title,
            status="assigned",
        )
        HomeworkTask.objects.create(
            homework=homework,
            task_type="generated_task",
            title="Вариант",
            description="/oge/inf/variant/99",
            order=0,
        )
        # checked/returned не создают карточку сигналом, дубли задаём явно.
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.student,
            status=status,
            submitted_at=self.now,
            teacher_comment=teacher_comment,
            answer_text="Ответ",
            result_payload=payload
            or {
                "checked": {"101": False},
                "by_task_id": {"101": "42"},
            },
        )
        return homework, submission

    def _card(self, submission, *, title, status, comment="", checked_at=None):
        return ReviewItem.objects.create(
            teacher=self.teacher,
            student=self.student,
            source_type="homework",
            source_id=submission.pk,
            title=title,
            status=status,
            teacher_comment=comment,
            checked_at=checked_at,
        )

    def _assert_pending(self, expected):
        review = self.teacher_client.get("/api/cabinet/review/")
        nav = self.teacher_client.get("/api/cabinet/nav-counts/")
        dash = self.teacher_client.get("/api/cabinet/dashboard/")
        reports = self.teacher_client.get("/api/cabinet/reports/overview/")
        self.assertEqual(review.status_code, 200, review.content)
        pending = review.json()["counts"]["pending"]
        self.assertEqual(pending, expected)
        self.assertEqual(nav.json()["reviews_count"], expected)
        self.assertEqual(dash.json()["pending_reviews_count"], expected)
        self.assertEqual(reports.json()["pending_reviews"], expected)
        return review.json()

    def _error_task(self):
        response = self.teacher_client.get(
            f"/api/cabinet/journal/students/{self.student.id}/errors/"
        )
        self.assertEqual(response.status_code, 200, response.content)
        tasks = [
            task
            for group in response.json()["subjects"]
            for task in group["tasks"]
        ]
        self.assertEqual(len(tasks), 1, response.content)
        return tasks[0]

    def test_pending_and_week_counts_ignore_duplicate_cards(self):
        _homework, submission = self._homework("Две ожидающие", status="submitted")
        # Сигнал уже создал одну карточку. Вторая — исторический дубль.
        signal_card = ReviewItem.objects.get(source_type="homework", source_id=submission.pk)
        duplicate = self._card(submission, title="Дубль", status="pending")
        self.assertGreater(duplicate.pk, signal_card.pk)

        payload = self._assert_pending(1)
        self.assertEqual([row["id"] for row in payload["results"]], [signal_card.pk])

        signal_card.status = "checked"
        signal_card.teacher_comment = "Проверено"
        signal_card.checked_at = self.now
        signal_card.save(update_fields=["status", "teacher_comment", "checked_at"])
        duplicate.status = "checked"
        duplicate.teacher_comment = "Проверено"
        duplicate.checked_at = self.now
        duplicate.save(update_fields=["status", "teacher_comment", "checked_at"])
        HomeworkSubmission.objects.filter(pk=submission.pk).update(status="checked")

        review = self._assert_pending(0)
        self.assertEqual(review["counts"]["checked"], 1)
        stats = build_engagement(self.teacher, now=self.now)["stats"]
        self.assertEqual(stats["homeworks_checked"], 1)
        dash = self.teacher_client.get("/api/cabinet/dashboard/")
        self.assertEqual(dash.json()["engagement"]["stats"]["homeworks_checked"], 1)

    def test_larger_id_does_not_replace_later_check_in_error_list(self):
        _homework, submission = self._homework("Проверено раньше по id", status="checked")
        current = self._card(
            submission,
            title="Актуальная",
            status="checked",
            comment="Смотри шаг 2",
            checked_at=self.now,
        )
        historical = self._card(
            submission,
            title="Старая",
            status="checked",
            comment="Смотри шаг 2",
            checked_at=self.now - timedelta(days=6),
        )
        self.assertGreater(historical.pk, current.pk)

        task = self._error_task()
        self.assertEqual(task["review_id"], current.pk)
        self.assertEqual(task["teacher_comment"], "Смотри шаг 2")
        self.assertNotIn("review_comment_conflict", task)

        student_view = self.student_client.get(
            f"/api/cabinet/student/assignments/{submission.homework_id}/"
        )
        self.assertEqual(student_view.status_code, 200, student_view.content)
        self.assertEqual(student_view.json()["teacher_comment"], "Смотри шаг 2")
        current.refresh_from_db()
        historical.refresh_from_db()
        self.assertEqual(current.teacher_comment, "Смотри шаг 2")
        self.assertEqual(historical.teacher_comment, "Смотри шаг 2")

    def test_checked_duplicate_is_not_a_second_pending_or_week_event(self):
        _homework, submission = self._homework("Проверено и дубль", status="checked")
        checked = self._card(
            submission,
            title="Проверено",
            status="checked",
            comment="Зачтено",
            checked_at=self.now - timedelta(days=1),
        )
        pending = self._card(submission, title="Лишняя", status="pending")
        self.assertGreater(pending.pk, checked.pk)

        payload = self._assert_pending(0)
        self.assertEqual(payload["counts"]["checked"], 1)
        self.assertEqual([row["id"] for row in payload["results"] if row["status"] == "checked"], [checked.pk])
        stats = build_engagement(self.teacher, now=self.now)["stats"]
        self.assertEqual(stats["homeworks_checked"], 1)

        task = self._error_task()
        self.assertEqual(task["review_id"], checked.pk)
        self.assertEqual(task["teacher_comment"], "Зачтено")

    def test_returned_card_stays_current_when_a_checked_duplicate_has_larger_id(self):
        homework, submission = self._homework(
            "Возврат",
            status="returned",
            teacher_comment="Нужна доработка",
        )
        returned = self._card(
            submission,
            title="Возврат",
            status="returned",
            comment="Нужна доработка",
            checked_at=self.now - timedelta(days=1),
        )
        checked = self._card(
            submission,
            title="Чужая отметка",
            status="checked",
            comment="Зачтено по ошибке",
            checked_at=self.now,
        )
        self.assertGreater(checked.pk, returned.pk)

        with self.assertLogs("Cabinet.homework_api", level="WARNING") as logs:
            review = self._assert_pending(0)
        self.assertEqual(review["counts"]["returned"], 1)
        self.assertEqual(review["counts"]["checked"], 0)
        history = self.teacher_client.get("/api/cabinet/review/?status=returned")
        self.assertEqual([row["id"] for row in history.json()["results"]], [returned.pk])

        task = self._error_task()
        self.assertEqual(task["review_id"], returned.pk)
        self.assertEqual(task["teacher_comment"], "Нужна доработка")
        self.assertTrue(task["review_comment_conflict"])
        self.assertTrue(any("review_comment_conflict" in line for line in logs.output))
        returned.refresh_from_db()
        checked.refresh_from_db()
        self.assertEqual(returned.teacher_comment, "Нужна доработка")
        self.assertEqual(checked.teacher_comment, "Зачтено по ошибке")

        resubmit = self.student_client.post(
            f"/api/cabinet/student/assignments/{homework.pk}/",
            {"answer_text": "Исправленный ответ"},
            format="multipart",
        )
        self.assertEqual(resubmit.status_code, 200, resubmit.content)
        returned.refresh_from_db()
        checked.refresh_from_db()
        self.assertEqual(returned.status, "pending")
        self.assertEqual(returned.teacher_comment, "Нужна доработка")
        self.assertEqual(checked.status, "checked")
        self.assertEqual(checked.teacher_comment, "Зачтено по ошибке")
        self._assert_pending(1)
        self.assertEqual(
            ReviewItem.objects.filter(source_type="homework", source_id=submission.pk).count(),
            2,
        )

    def test_comment_only_on_historical_card_is_shown_and_kept(self):
        homework, submission = self._homework("Только старый комментарий", status="submitted")
        current = ReviewItem.objects.get(source_type="homework", source_id=submission.pk)
        historical = self._card(
            submission,
            title="Старая проверка",
            status="checked",
            comment="Посмотри пример 4",
            checked_at=self.now - timedelta(days=2),
        )
        self.assertGreater(historical.pk, current.pk)
        self.assertEqual(current.teacher_comment, "")

        task = self._error_task()
        self.assertEqual(task["review_id"], current.pk)
        self.assertEqual(task["teacher_comment"], "Посмотри пример 4")
        self.assertNotIn("review_comment_conflict", task)

        student_view = self.student_client.get(
            f"/api/cabinet/student/assignments/{homework.pk}/"
        )
        self.assertEqual(student_view.json()["teacher_comment"], "Посмотри пример 4")
        current.refresh_from_db()
        historical.refresh_from_db()
        self.assertEqual(current.teacher_comment, "")
        self.assertEqual(historical.teacher_comment, "Посмотри пример 4")
        submission.refresh_from_db()
        self.assertEqual(submission.teacher_comment, "")

    def test_conflicting_comments_are_kept_and_not_guessed(self):
        homework, submission = self._homework("Конфликт", status="checked", teacher_comment="")
        older = self._card(
            submission,
            title="Первая",
            status="checked",
            comment="Первое замечание",
            checked_at=self.now - timedelta(days=2),
        )
        newer = self._card(
            submission,
            title="Вторая",
            status="checked",
            comment="Второе замечание",
            checked_at=self.now,
        )

        with self.assertLogs("Cabinet.homework_api", level="WARNING") as logs:
            task = self._error_task()
        self.assertEqual(task["review_id"], newer.pk)
        self.assertEqual(task["teacher_comment"], "")
        self.assertTrue(task["review_comment_conflict"])
        self.assertTrue(any("review_comment_conflict" in line for line in logs.output))
        self.assertNotIn("Первое замечание", " ".join(logs.output))
        self.assertNotIn("Второе замечание", " ".join(logs.output))

        student_view = self.student_client.get(
            f"/api/cabinet/student/assignments/{homework.pk}/"
        )
        self.assertEqual(student_view.json()["teacher_comment"], "")
        self.assertTrue(student_view.json()["review_comment_conflict"])
        older.refresh_from_db()
        newer.refresh_from_db()
        submission.refresh_from_db()
        self.assertEqual(older.teacher_comment, "Первое замечание")
        self.assertEqual(newer.teacher_comment, "Второе замечание")
        self.assertEqual(submission.teacher_comment, "")

    def test_digest_counts_one_new_work_and_skips_an_old_duplicate(self):
        _homework, submission = self._homework("Дайджест", status="submitted")
        canonical = ReviewItem.objects.get(source_type="homework", source_id=submission.pk)
        duplicate = self._card(submission, title="Дубль дайджеста", status="pending")
        since = self.now - timedelta(hours=1)
        self.assertEqual(count_new_homework_reviews(self.teacher, since), 1)

        ReviewItem.objects.filter(pk=canonical.pk).update(
            created_at=self.now - timedelta(days=3)
        )
        self.assertEqual(count_new_homework_reviews(self.teacher, since), 0)
        self.assertGreater(duplicate.pk, canonical.pk)

        fresh_hw, fresh_submission = self._homework("Одна новая", status="submitted")
        self.assertEqual(count_new_homework_reviews(self.teacher, since), 1)
        prefs, _created = NotificationPreference.objects.get_or_create(user=self.teacher)
        prefs.homework_review_push_mode = "digest_15"
        prefs.save(update_fields=["homework_review_push_mode"])

        sent = send_homework_review_digests(window_minutes=15)
        self.assertEqual(sent, 1)
        note = Notification.objects.filter(
            recipient_user=self.teacher,
            payload__type="homework_review_digest",
        ).latest("id")
        self.assertEqual(note.payload["count"], 1)
        self.assertEqual(fresh_submission.homework_id, fresh_hw.pk)
