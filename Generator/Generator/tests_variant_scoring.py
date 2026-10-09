from django.test import SimpleTestCase

from Generator.variant_scoring import (
    attach_variant_scoring,
    lesson_result_counts,
    logical_exam_part,
    redact_result_for_student,
    score_informatics_table,
    score_variant_attempt,
    strip_previous_grades,
    task_max_points,
)


def _task(task_id, *, number=1, max_score=1, part=1, answer="42", exam_part=None, part_title=""):
    return {
        "id": task_id,
        "number": number,
        "max_score": max_score,
        "part": part,
        "part_title": part_title,
        "exam_part": exam_part,
        "answer": answer,
    }


def _assert_invariant(test, summary):
    test.assertGreaterEqual(summary["earned_points"], 0)
    test.assertLessEqual(summary["earned_points"], summary["max_points"])
    test.assertEqual(
        summary["correct_count"]
        + summary["incorrect_count"]
        + summary["partial_count"]
        + summary["unanswered_count"]
        + summary["pending_review_count"],
        summary["total_tasks"],
    )


class VariantScoringTests(SimpleTestCase):
    def test_max_points_follow_composition(self):
        cases = [
            ([_task(i, max_score=1, exam_part=1) for i in range(1)], 1),
            ([_task(i, max_score=1, exam_part=1) for i in range(5)], 5),
            ([_task(i, max_score=1, exam_part=1) for i in range(10)], 10),
            ([_task(i, max_score=2, exam_part=1) for i in range(12)], 24),
            (
                [_task(i, max_score=1, exam_part=1) for i in range(8)]
                + [_task(100 + i, max_score=3, part=2, exam_part=2, answer="") for i in range(4)],
                20,
            ),
            ([_task(i, max_score=1, exam_part=1) for i in range(20)], 20),
            ([_task(i, max_score=1, exam_part=1) for i in range(27)], 27),
        ]
        for tasks, expected in cases:
            answers = {
                task["id"]: "42"
                for task in tasks
                if task.get("exam_part") != 2
            }
            scores = {
                task["id"]: task["max_score"]
                for task in tasks
                if task.get("exam_part") == 2
            }
            summary = score_variant_attempt(
                tasks=tasks,
                answers=answers,
                scores=scores,
                level="ege",
                subject="math",
            )
            self.assertEqual(summary["max_points"], expected)
            self.assertEqual(summary["earned_points"], expected)
            self.assertEqual(summary["correct_count"], len(tasks))
            _assert_invariant(self, summary)

    def test_missing_max_score_is_one_not_three(self):
        self.assertEqual(task_max_points({}), 1)
        self.assertEqual(task_max_points({"max_score": None}), 1)
        summary = score_variant_attempt(
            tasks=[{"id": 1, "number": 1, "part": 1, "answer": "a"}],
            answers={1: "a"},
        )
        self.assertEqual(summary["max_points"], 1)
        self.assertEqual(summary["earned_points"], 1)

    def test_all_wrong_all_skipped_and_mixed(self):
        tasks = [_task(i, max_score=2) for i in range(1, 6)]
        wrong = score_variant_attempt(
            tasks=tasks,
            answers={task["id"]: "нет" for task in tasks},
        )
        self.assertEqual(wrong["earned_points"], 0)
        self.assertEqual(wrong["incorrect_count"], 5)
        self.assertEqual(wrong["percentage"], 0)
        _assert_invariant(self, wrong)

        skipped = score_variant_attempt(tasks=tasks, answers={})
        self.assertEqual(skipped["unanswered_count"], 5)
        self.assertEqual(skipped["incorrect_count"], 0)
        self.assertEqual(skipped["earned_points"], 0)
        self.assertEqual(skipped["review_status"], "final")
        _assert_invariant(self, skipped)

        mixed_tasks = [_task(1), _task(2), _task(3), _task(4, max_score=3, exam_part=2, part=2)]
        mixed = score_variant_attempt(
            tasks=mixed_tasks,
            answers={1: "42", 2: "нет", 4: "решение"},
            scores={4: 1},
        )
        self.assertEqual(mixed["correct_count"], 1)
        self.assertEqual(mixed["incorrect_count"], 1)
        self.assertEqual(mixed["unanswered_count"], 1)
        self.assertEqual(mixed["partial_count"], 1)
        self.assertEqual(mixed["pending_review_count"], 0)
        self.assertEqual(mixed["earned_points"], 2)
        self.assertEqual(mixed["max_points"], 6)
        _assert_invariant(self, mixed)

    def test_manual_task_without_score_is_not_incorrect(self):
        tasks = [
            _task(1, answer="1"),
            _task(2, max_score=3, exam_part=2, part=2, answer=""),
        ]
        summary = score_variant_attempt(
            tasks=tasks,
            answers={1: "1", 2: "текст"},
            scores={},
        )
        self.assertEqual(summary["pending_review_count"], 1)
        self.assertEqual(summary["incorrect_count"], 0)
        self.assertEqual(summary["earned_points"], 1)
        self.assertIsNone(summary["percentage"])
        self.assertEqual(summary["review_status"], "pending_review")
        self.assertTrue(summary["preliminary"])
        _assert_invariant(self, summary)

        graded = score_variant_attempt(
            tasks=tasks,
            answers={1: "1", 2: "текст"},
            scores={2: 0},
        )
        self.assertEqual(graded["incorrect_count"], 1)
        self.assertEqual(graded["pending_review_count"], 0)
        self.assertEqual(graded["review_status"], "final")
        self.assertEqual(graded["percentage"], 25.0)

    def test_null_score_is_not_zero(self):
        task = _task(7, max_score=4, exam_part=2, part=2, answer="")
        pending = score_variant_attempt(tasks=[task], answers={7: "решение"}, scores={})
        zero = score_variant_attempt(tasks=[task], answers={7: "решение"}, scores={7: 0})
        self.assertEqual(pending["pending_review_count"], 1)
        self.assertEqual(pending["earned_points"], 0)
        self.assertIsNone(pending["percentage"])
        self.assertEqual(zero["incorrect_count"], 1)
        self.assertEqual(zero["percentage"], 0)

    def test_teacher_rescore_replaces_points(self):
        task = _task(3, max_score=3, exam_part=2, part=2, answer="")
        first = score_variant_attempt(tasks=[task], answers={3: "x"}, scores={3: 1})
        second = score_variant_attempt(tasks=[task], answers={3: "x"}, scores={3: 3})
        self.assertEqual(first["earned_points"], 1)
        self.assertEqual(first["partial_count"], 1)
        self.assertEqual(second["earned_points"], 3)
        self.assertEqual(second["correct_count"], 1)
        self.assertEqual(second["earned_points"], 3)

    def test_score_is_clamped_to_task_max(self):
        task = _task(3, max_score=2, exam_part=2, part=2, answer="")
        summary = score_variant_attempt(tasks=[task], scores={3: 9})
        self.assertEqual(summary["earned_points"], 2)
        self.assertEqual(summary["max_points"], 2)

    def test_empty_variant_has_no_division(self):
        summary = score_variant_attempt(tasks=[])
        self.assertEqual(summary["total_tasks"], 0)
        self.assertEqual(summary["max_points"], 0)
        self.assertIsNone(summary["percentage"])
        self.assertEqual(summary["review_status"], "empty")
        _assert_invariant(self, summary)

    def test_inf_table_partial_credit_is_not_one_point(self):
        self.assertEqual(score_informatics_table(26, "5\t7", "5\t7"), 2)
        self.assertEqual(score_informatics_table(26, "5\t0", "5\t7"), 1)
        self.assertEqual(score_informatics_table(26, "0\t0", "5\t7"), 0)
        self.assertEqual(score_informatics_table(27, "1\t2\n3\t4", "1\t2\n3\t4"), 2)
        self.assertEqual(score_informatics_table(27, "1\t2\n0\t0", "1\t2\n3\t4"), 1)
        self.assertIsNone(score_informatics_table(25, "1", "1"))

        task = _task(26, number=26, max_score=2, answer="5\t7")
        partial = score_variant_attempt(
            tasks=[task],
            level="ege",
            subject="inf",
            answers={26: "5\t0"},
        )
        self.assertEqual(partial["partial_count"], 1)
        self.assertEqual(partial["earned_points"], 1)
        self.assertEqual(partial["correct_count"], 0)
        full = score_variant_attempt(
            tasks=[task],
            level="ege",
            subject="inf",
            answers={26: "5\t7"},
        )
        self.assertEqual(full["earned_points"], 2)
        self.assertEqual(full["correct_count"], 1)

    def test_expanded_answer_without_key_is_not_auto_zero(self):
        task = _task(8, number=13, max_score=2, exam_part=2, answer="")
        summary = score_variant_attempt(
            tasks=[task],
            level="ege",
            subject="math",
            answers={8: "доказательство"},
        )
        self.assertEqual(summary["pending_review_count"], 1)
        self.assertEqual(summary["incorrect_count"], 0)
        self.assertIsNone(summary["percentage"])

    def test_part1_worth_two_points_when_correct(self):
        task = _task(6, number=6, max_score=2, answer="15")
        summary = score_variant_attempt(
            tasks=[task],
            level="ege",
            subject="chem",
            answers={6: "15"},
        )
        self.assertEqual(summary["earned_points"], 2)
        self.assertEqual(summary["max_points"], 2)
        self.assertEqual(summary["correct_count"], 1)

    def test_resubmit_drops_previous_grades_but_keeps_snapshot(self):
        cleaned = strip_previous_grades(
            {
                "by_task_id": {"1": "5"},
                "scores": {"9": 2},
                "checked": {"1": True},
                "scoring": {"earned_points": 3},
                "manual_stats": {"correct": 1, "total": 1},
                "tasks_snapshot": [{"id": 1, "max_score": 1}],
                "grading_snapshot": [{"id": 1, "max_score": 1, "answer": "5"}],
            }
        )
        self.assertEqual(cleaned["by_task_id"], {"1": "5"})
        self.assertEqual(cleaned["tasks_snapshot"], [{"id": 1, "max_score": 1}])
        self.assertEqual(cleaned["grading_snapshot"][0]["answer"], "5")
        self.assertNotIn("scores", cleaned)
        self.assertNotIn("scoring", cleaned)
        self.assertNotIn("checked", cleaned)

    def test_lesson_empty_is_not_wrong(self):
        counts = lesson_result_counts(total_tasks=10, correct_count=4, answered_wrong_count=2)
        self.assertEqual(counts["wrong_count"], 2)
        self.assertEqual(counts["empty_count"], 4)
        self.assertEqual(
            counts["correct_count"] + counts["wrong_count"] + counts["empty_count"],
            counts["total_tasks"],
        )

    def test_logical_part_matches_exam_rules(self):
        self.assertEqual(logical_exam_part({"exam_part": 2, "number": 1}, "ege", "inf"), 2)
        self.assertEqual(logical_exam_part({"exam_part": 1, "number": 27}, "ege", "inf"), 1)
        self.assertEqual(logical_exam_part({"number": 28}, "ege", "chem"), 1)
        self.assertEqual(logical_exam_part({"number": 29}, "ege", "chem"), 2)
        self.assertEqual(logical_exam_part({"number": 12}, "ege", "math"), 2)
        self.assertEqual(logical_exam_part({"part_title": "Говорение", "number": 1}, "ege", "eng"), 2)


class SubmissionSummaryScoringTests(SimpleTestCase):
    def test_final_summary_uses_points_not_task_count(self):
        from types import SimpleNamespace

        from Cabinet.homework_result import build_submission_result_summary

        submission = SimpleNamespace(
            status="checked",
            submitted_at="now",
            score=50,
            teacher_comment="",
            result_payload={
                "checked": {"1": True, "2": False},
                "scoring": {
                    "review_status": "final",
                    "total_tasks": 2,
                    "correct_count": 1,
                    "incorrect_count": 0,
                    "partial_count": 1,
                    "unanswered_count": 0,
                    "pending_review_count": 0,
                    "earned_points": 3,
                    "max_points": 6,
                    "percentage": 50,
                },
            },
        )
        summary = build_submission_result_summary(submission)
        self.assertTrue(summary["is_final"])
        self.assertEqual(summary["earned_points"], 3)
        self.assertEqual(summary["max_points"], 6)
        self.assertEqual(summary["correct_count"], 1)
        self.assertEqual(summary["percentage"], 50.0)
        self.assertNotEqual(summary["correct_count"], summary["earned_points"])

    def test_pending_manual_review_hides_percentage(self):
        from types import SimpleNamespace

        from Cabinet.homework_result import build_submission_result_summary

        submission = SimpleNamespace(
            status="checked",
            submitted_at="now",
            score=0,
            teacher_comment="",
            result_payload={
                "scoring": {
                    "review_status": "pending_review",
                    "total_tasks": 2,
                    "correct_count": 1,
                    "incorrect_count": 0,
                    "partial_count": 0,
                    "unanswered_count": 0,
                    "pending_review_count": 1,
                    "earned_points": 1,
                    "max_points": 4,
                    "percentage": None,
                }
            },
        )
        summary = build_submission_result_summary(submission)
        self.assertTrue(summary["is_final"])
        self.assertIsNone(summary["percentage"])
        self.assertIsNone(summary["earned_points"])
        self.assertEqual(summary["pending_review_count"], 1)

    def test_client_cannot_replace_frozen_criteria(self):
        grading = [{
            "id": 1,
            "number": 1,
            "max_score": 2,
            "exam_part": 1,
            "answer": "эталон",
        }]
        stored = attach_variant_scoring(
            {
                "by_task_id": {"1": "эталон"},
                "grading_snapshot": [{"id": 1, "answer": "подмена", "max_score": 9, "exam_part": 1}],
                "tasks_snapshot": [{"id": 99, "max_score": 9, "exam_part": 1}],
            },
            1,
            level="ege",
            subject="math",
            previous_grading=grading,
        )
        self.assertEqual(stored["scoring"]["earned_points"], 2)
        self.assertEqual(stored["scoring"]["max_points"], 2)
        self.assertEqual(stored["scoring"]["total_tasks"], 1)
        self.assertEqual(stored["grading_snapshot"][0]["answer"], "эталон")
        student = redact_result_for_student(stored)
        self.assertNotIn("grading_snapshot", student)
        self.assertNotIn("answer", student["scoring"]["tasks"][0])

    def test_repeat_grade_keeps_part1_when_criteria_are_not_frozen_yet(self):
        stored_scoring = {
            "tasks": [{
                "id": 1,
                "number": 1,
                "part": 1,
                "status": "correct",
                "points": 1,
                "max_points": 1,
            }],
        }
        updated = attach_variant_scoring(
            {
                "by_task_id": {"1": "5"},
                "checked": {"1": False},
                "scores": {"2": 3},
                "scoring": stored_scoring,
            },
            1,
            level="ege",
            subject="math",
            previous_snapshot=[{"id": 1, "number": 1, "max_score": 1, "exam_part": 1}],
        )
        self.assertEqual(updated["scoring"]["correct_count"], 1)
        self.assertEqual(updated["scoring"]["earned_points"], 1)
        self.assertNotIn("grading_snapshot", updated)
