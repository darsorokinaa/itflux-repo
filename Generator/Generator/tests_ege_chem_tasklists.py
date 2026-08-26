from django.test import TestCase

from Generator.ege_chem_tasklists import (
    EGE_CHEM_TASKS,
    max_score_for_ege_chem,
    seed_ege_chem_tasklists,
)
from Generator.models import Level, Part, Subject, TaskList


class EgeChemTaskListsTests(TestCase):
    def test_seed_creates_34_topics(self):
        seed_ege_chem_tasklists(Subject, Level, Part, TaskList)

        qs = TaskList.objects.filter(
            subject__subject_short="chem",
            level__level="ege",
        ).order_by("task_number")
        self.assertEqual(qs.count(), 34)
        self.assertEqual(qs.first().task_title, EGE_CHEM_TASKS[0][1])
        self.assertEqual(qs.get(task_number=6).max_score, 2)
        self.assertEqual(qs.get(task_number=28).part.part_title, "Часть 1")
        self.assertEqual(qs.get(task_number=29).part.part_title, "Часть 2")
        self.assertEqual(qs.get(task_number=32).max_score, 5)
        self.assertEqual(qs.get(task_number=33).max_score, 3)
        self.assertEqual(qs.get(task_number=34).task_title, EGE_CHEM_TASKS[-1][1])

        again = seed_ege_chem_tasklists(Subject, Level, Part, TaskList)
        self.assertEqual(again["created"], 0)
        self.assertEqual(again["skipped"], 34)
        self.assertEqual(
            TaskList.objects.filter(subject__subject_short="chem", level__level="ege").count(),
            34,
        )

    def test_max_scores_sum_to_56(self):
        total = sum(max_score_for_ege_chem(n) for n, _ in EGE_CHEM_TASKS)
        self.assertEqual(total, 56)
        self.assertEqual(len(EGE_CHEM_TASKS), 34)
        self.assertTrue(all(len(title) <= 255 for _, title in EGE_CHEM_TASKS))
