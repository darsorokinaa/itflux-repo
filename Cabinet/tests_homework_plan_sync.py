"""Выдача домашнего задания из пункта плана: устойчивый идентификатор, без склейки по названию."""

import threading

from django.contrib.auth.models import User
from django.db import close_old_connections, connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from Cabinet.models import (
    Homework,
    HomeworkSubmission,
    HomeworkSubmissionAttempt,
    HomeworkTask,
    LessonPlan,
    LessonPlanItem,
    Material,
    Profile,
    Student,
)
from Cabinet.student_release import assign_homework_manually, plan_material_task_key


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
        last_name="Ученик",
        status="active",
    )


def _plan_item(teacher, title="Занятие"):
    plan = LessonPlan.objects.create(teacher=teacher, title="План", direction="oge", status="active")
    return LessonPlanItem.objects.create(
        plan=plan,
        order=1,
        title=title,
        topic=title,
        homework_description="Инструкция",
    )


def _material(teacher, title, url):
    return Material.objects.create(
        teacher=teacher,
        title=title,
        external_url=url,
        material_type="link",
        is_public=False,
    )


class PlanHomeworkSyncTests(TestCase):
    def setUp(self):
        self.teacher = _teacher("plan_sync_teacher")
        self.other = _teacher("plan_sync_other")
        self.ira = _student("plan_sync_ira", self.teacher, "Ира")
        self.olya = _student("plan_sync_olya", self.teacher, "Оля")

    def _issue(self, student, item):
        return assign_homework_manually(teacher=self.teacher, student=student, plan_item=item)

    def test_same_title_materials_stay_separate_and_resync_is_idempotent(self):
        item = _plan_item(self.teacher)
        left = _material(self.teacher, "Тренажёр", "https://example.test/left")
        right = _material(self.teacher, "Тренажёр", "https://example.test/right")
        item.homework_materials.add(left, right)

        homework = self._issue(self.ira, item)
        again = self._issue(self.ira, item)
        tasks = list(homework.tasks.filter(is_active=True).order_by("order", "id"))

        self.assertEqual(again.pk, homework.pk)
        self.assertEqual(Homework.objects.filter(student=self.ira, lesson_plan_item=item).count(), 1)
        self.assertEqual(len(tasks), 2)
        self.assertEqual(
            {task.task_id for task in tasks},
            {plan_material_task_key(left.pk), plan_material_task_key(right.pk)},
        )
        self.assertEqual(
            {task.description for task in tasks},
            {"https://example.test/left", "https://example.test/right"},
        )
        self.assertEqual(
            list(again.tasks.filter(is_active=True).order_by("id").values_list("id", flat=True)),
            [task.id for task in tasks],
        )

    def test_two_plan_items_with_the_same_title_are_two_homeworks(self):
        first = _plan_item(self.teacher, "Одинаковое занятие")
        second = _plan_item(self.teacher, "Одинаковое занятие")
        left = self._issue(self.ira, first)
        right = self._issue(self.ira, second)
        self.assertNotEqual(left.pk, right.pk)
        self.assertEqual(left.lesson_plan_item_id, first.pk)
        self.assertEqual(right.lesson_plan_item_id, second.pk)

    def test_each_student_gets_an_independent_copy(self):
        item = _plan_item(self.teacher)
        material = _material(self.teacher, "Листок", "https://example.test/sheet")
        item.homework_materials.add(material)
        ira_hw = self._issue(self.ira, item)
        olya_hw = self._issue(self.olya, item)
        self.assertNotEqual(ira_hw.pk, olya_hw.pk)

        material.external_url = "https://example.test/sheet-new"
        material.save(update_fields=["external_url"])
        self._issue(self.ira, item)

        ira_task = ira_hw.tasks.get()
        olya_task = olya_hw.tasks.get()
        ira_task.refresh_from_db()
        olya_task.refresh_from_db()
        self.assertEqual(ira_task.description, "https://example.test/sheet-new")
        self.assertEqual(olya_task.description, "https://example.test/sheet")
        self.assertEqual(Homework.objects.filter(lesson_plan_item=item).count(), 2)

    def test_started_submitted_and_checked_work_is_not_rewritten(self):
        item = _plan_item(self.teacher)
        material = _material(self.teacher, "Номер 1", "https://example.test/v1")
        item.homework_materials.add(material)
        homework = self._issue(self.ira, item)
        task = homework.tasks.get()

        draft = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.ira,
            status="submitted",
            answer_text="черновик",
            result_payload={"answers": {str(task.id): "7"}},
        )
        material.external_url = "https://example.test/v2"
        material.save(update_fields=["external_url"])
        extra = _material(self.teacher, "Номер 1", "https://example.test/extra")
        item.homework_materials.add(extra)
        self._issue(self.ira, item)
        task.refresh_from_db()
        draft.refresh_from_db()
        self.assertEqual(task.description, "https://example.test/v1")
        self.assertEqual(draft.answer_text, "черновик")
        self.assertEqual(draft.result_payload["answers"][str(task.id)], "7")
        self.assertEqual(homework.tasks.filter(is_active=True).count(), 2)

        draft.submitted_at = timezone.now()
        draft.answer_text = "сдано"
        draft.save(update_fields=["submitted_at", "answer_text", "updated_at"])
        attempt = HomeworkSubmissionAttempt.objects.create(
            submission=draft,
            attempt_number=1,
            status="submitted",
            answer_text="сдано",
            submitted_at=draft.submitted_at,
        )
        material.external_url = "https://example.test/v3"
        material.save(update_fields=["external_url"])
        item.homework_materials.remove(material)
        self._issue(self.ira, item)
        task.refresh_from_db()
        draft.refresh_from_db()
        attempt.refresh_from_db()
        self.assertTrue(task.is_active)
        self.assertEqual(task.description, "https://example.test/v1")
        self.assertEqual(draft.answer_text, "сдано")
        self.assertEqual(attempt.answer_text, "сдано")

        draft.status = "checked"
        draft.score = 91
        draft.teacher_comment = "Зачтено"
        draft.save(update_fields=["status", "score", "teacher_comment", "updated_at"])
        item.title = "Новое имя занятия"
        item.homework_description = "Другая инструкция"
        item.save(update_fields=["title", "homework_description", "updated_at"])
        self._issue(self.ira, item)
        homework.refresh_from_db()
        draft.refresh_from_db()
        self.assertEqual(homework.title, "ДЗ: Занятие")
        self.assertEqual(homework.description, "Инструкция")
        self.assertEqual(homework.status, "assigned")
        self.assertEqual(float(draft.score), 91.0)
        self.assertEqual(draft.teacher_comment, "Зачтено")
        self.assertEqual(HomeworkSubmissionAttempt.objects.filter(pk=attempt.pk).count(), 1)

    def test_removed_material_is_hidden_only_before_the_student_starts(self):
        item = _plan_item(self.teacher)
        keep = _material(self.teacher, "Оставить", "https://example.test/keep")
        drop = _material(self.teacher, "Убрать", "https://example.test/drop")
        item.homework_materials.add(keep, drop)
        homework = self._issue(self.ira, item)
        dropped = homework.tasks.get(task_id=plan_material_task_key(drop.pk))
        item.homework_materials.remove(drop)
        self._issue(self.ira, item)
        dropped.refresh_from_db()
        self.assertFalse(dropped.is_active)
        self.assertTrue(HomeworkTask.objects.filter(pk=dropped.pk).exists())
        self.assertEqual(homework.tasks.filter(is_active=True).count(), 1)

    def test_unlinking_the_plan_item_keeps_the_homework_and_answers(self):
        item = _plan_item(self.teacher)
        homework = self._issue(self.ira, item)
        submission = HomeworkSubmission.objects.create(
            homework=homework,
            student=self.ira,
            status="checked",
            submitted_at=timezone.now(),
            answer_text="ответ",
            score=80,
            teacher_comment="Хорошо",
        )
        item_id = item.pk
        item.delete()
        homework.refresh_from_db()
        submission.refresh_from_db()
        self.assertIsNone(homework.lesson_plan_item_id)
        self.assertFalse(LessonPlanItem.objects.filter(pk=item_id).exists())
        self.assertEqual(submission.answer_text, "ответ")
        self.assertEqual(float(submission.score), 80.0)
        self.assertEqual(submission.teacher_comment, "Хорошо")

    def test_other_teacher_and_other_student_are_rejected(self):
        item = _plan_item(self.teacher)
        foreign_item = _plan_item(self.other)
        foreign_student = _student("plan_sync_foreign", self.other, "Чужой")
        with self.assertRaises(PermissionError):
            assign_homework_manually(teacher=self.teacher, student=self.ira, plan_item=foreign_item)
        with self.assertRaises(PermissionError):
            assign_homework_manually(teacher=self.teacher, student=foreign_student, plan_item=item)
        self.assertFalse(Homework.objects.filter(lesson_plan_item=foreign_item).exists())
        self.assertFalse(Homework.objects.filter(student=foreign_student).exists())


class ConcurrentPlanHomeworkTests(TransactionTestCase):
    def test_parallel_issue_creates_one_homework(self):
        teacher = _teacher("plan_sync_race_teacher")
        student = _student("plan_sync_race_student", teacher, "Гонка")
        item = _plan_item(teacher)
        item.homework_materials.add(_material(teacher, "Тренажёр", "https://example.test/race"))
        barrier = threading.Barrier(2)
        found = []
        errors = []

        def worker():
            close_old_connections()
            try:
                barrier.wait(timeout=5)
                homework = assign_homework_manually(
                    teacher=teacher,
                    student=student,
                    plan_item=item,
                )
                found.append(homework.pk)
            except Exception as exc:
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        self.assertEqual(errors, [])
        self.assertEqual(len(found), 2)
        self.assertEqual(len(set(found)), 1)
        self.assertEqual(
            Homework.objects.filter(teacher=teacher, student=student, lesson_plan_item=item).count(),
            1,
        )
        self.assertEqual(HomeworkTask.objects.filter(homework_id=found[0], is_active=True).count(), 1)
