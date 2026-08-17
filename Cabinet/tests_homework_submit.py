from concurrent.futures import ThreadPoolExecutor, as_completed

from django.contrib.auth.models import User
from django.db import close_old_connections
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from Cabinet.choices import SubmissionStatus
from Cabinet.models import Homework, HomeworkSubmission, Profile, Student


@override_settings(LESSON_SECRET="test-lesson-secret")
class HomeworkSubmitConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username="hwc_teacher", password="pass")
        self.teacher.profile.role = Profile.Role.TEACHER
        self.teacher.profile.save()
        self.student_user = User.objects.create_user(username="hwc_student", password="pass")
        self.student_user.profile.role = Profile.Role.STUDENT
        self.student_user.profile.save()
        self.student = Student.objects.create(
            teacher=self.teacher,
            user=self.student_user,
            first_name="Кира",
            last_name="Ученица",
            status="active",
        )
        self.homework = Homework.objects.create(
            teacher=self.teacher,
            student=self.student,
            title="ДЗ: гонка",
            status="assigned",
        )

    def test_parallel_student_submit_creates_one_row(self):
        homework_id = self.homework.pk
        user_id = self.student_user.pk

        def worker(text):
            close_old_connections()
            client = APIClient()
            user = User.objects.get(pk=user_id)
            client.force_login(user)
            response = client.post(
                f"/api/cabinet/student/assignments/{homework_id}/",
                {"answer_text": text},
                format="multipart",
            )
            close_old_connections()
            return response.status_code, response.content

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(worker, "Ответ A"),
                pool.submit(worker, "Ответ B"),
            ]
            results = [future.result() for future in as_completed(futures)]

        self.assertTrue(all(status == 200 for status, _ in results), results)
        self.assertEqual(
            HomeworkSubmission.objects.filter(
                homework=self.homework, student=self.student
            ).count(),
            1,
        )
        submission = HomeworkSubmission.objects.get(
            homework=self.homework, student=self.student
        )
        self.assertEqual(submission.status, SubmissionStatus.SUBMITTED)
        self.assertIn(submission.answer_text, ("Ответ A", "Ответ B"))
