from django.test import SimpleTestCase

from Cabinet.homework_api import (
    apply_scoring_checked,
    preserve_correct_answers,
    revision_editable_task_ids,
    revision_is_limited,
    task_answer_is_locked,
)


class HomeworkRevisionLockTests(SimpleTestCase):
    def setUp(self):
        self.payload = {
            "by_task_id": {"101": "26", "102": "нет"},
            "by_number": {"1": "26", "2": "нет"},
            "checked": {"101": False, "102": False},
            "scoring": {
                "tasks": [
                    {"id": 101, "number": 1, "status": "correct", "part": 1},
                    {"id": 102, "number": 2, "status": "incorrect", "part": 1},
                ]
            },
        }

    def test_only_incorrect_tasks_stay_editable(self):
        self.assertTrue(revision_is_limited(self.payload))
        self.assertEqual(revision_editable_task_ids(self.payload), ["102"])
        self.assertTrue(task_answer_is_locked(self.payload, "101"))
        self.assertFalse(task_answer_is_locked(self.payload, "102"))

    def test_checked_follows_scoring_not_the_client_flags(self):
        checked = apply_scoring_checked(self.payload)["checked"]
        self.assertTrue(checked["101"])
        self.assertFalse(checked["102"])

    def test_correct_answer_is_restored_if_the_student_changes_it(self):
        merged = preserve_correct_answers(
            self.payload,
            {"by_task_id": {"101": "другое", "102": "исправлено"}, "by_number": {"1": "другое", "2": "исправлено"}},
        )
        self.assertEqual(merged["by_task_id"]["101"], "26")
        self.assertEqual(merged["by_task_id"]["102"], "исправлено")
        self.assertEqual(merged["by_number"]["1"], "26")
        self.assertEqual(merged["by_number"]["2"], "исправлено")
