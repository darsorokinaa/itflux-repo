from django.test import SimpleTestCase, TestCase

from Generator.variant_scoring import (
    logical_exam_part,
    score_short_answer_rule,
    score_variant_attempt,
)


def _task(task_id, number, max_score, answer, part=1):
    return {"id": task_id, "number": number, "max_score": max_score, "part": part,
            "part_title": "", "exam_part": None, "answer": answer}


class ShortAnswerRulesTests(SimpleTestCase):
    """Правила оценивания кратких ответов из спецификаций ФИПИ 2026."""

    def test_positional_one_error(self):
        self.assertEqual(score_short_answer_rule("pos1", "124", "124", 2), 2)
        self.assertEqual(score_short_answer_rule("pos1", "125", "124", 2), 1)
        self.assertEqual(score_short_answer_rule("pos1", "12", "124", 2), 1)
        self.assertEqual(score_short_answer_rule("pos1", "421", "124", 2), 0)
        self.assertEqual(score_short_answer_rule("pos1", "1245", "124", 2), 0)

    def test_set_rule(self):
        self.assertEqual(score_short_answer_rule("set1", "31", "13", 2), 2)
        self.assertEqual(score_short_answer_rule("set1", "14", "13", 2), 1)
        self.assertEqual(score_short_answer_rule("set1", "1", "13", 2), 1)
        self.assertEqual(score_short_answer_rule("set1", "134", "13", 2), 0)
        self.assertEqual(score_short_answer_rule("set1", "45", "13", 2), 0)

    def test_positional_decrement(self):
        self.assertEqual(score_short_answer_rule("posdec", "1122332", "1122332", 3), 3)
        self.assertEqual(score_short_answer_rule("posdec", "2122332", "1122332", 3), 2)
        self.assertEqual(score_short_answer_rule("posdec", "2222332", "1122332", 3), 1)
        self.assertEqual(score_short_answer_rule("posdec", "2211332", "1122332", 3), 0)
        self.assertEqual(score_short_answer_rule("posdec", "11223321", "1122332", 3), 0)

    def test_unordered_and_non_digit_fallback(self):
        self.assertEqual(score_short_answer_rule("unordered", "54", "45", 1), 1)
        self.assertIsNone(score_short_answer_rule("unordered", "чахлый", "чахлый", 1))

    def test_variant_scoring_uses_rules(self):
        tasks = [_task(1, 1, 2, "124"), _task(2, 14, 2, "13"), _task(3, 5, 1, "3")]
        summary = score_variant_attempt(tasks=tasks, level="oge", subject="phys",
                                        answers={1: "125", 2: "31", 3: "3"})
        self.assertEqual([r["points"] for r in summary["tasks"]], [1, 2, 1])
        self.assertEqual(summary["partial_count"], 1)
        eng = score_variant_attempt(tasks=[_task(9, 2, 3, "1122332")], level="ege",
                                    subject="eng_write", answers={9: "2122332"})
        self.assertEqual(eng["earned_points"], 2)
        rus = score_variant_attempt(tasks=[_task(7, 2, 1, "45")], level="oge",
                                    subject="rus", answers={7: "54"})
        self.assertEqual(rus["earned_points"], 1)

    def test_other_subjects_unchanged(self):
        summary = score_variant_attempt(tasks=[_task(1, 1, 2, "124")], level="ege",
                                        subject="phys", answers={1: "125"})
        self.assertEqual(summary["earned_points"], 0)

    def test_rus_oge_summary_is_manual(self):
        self.assertEqual(logical_exam_part({"number": 1, "part": 1, "part_title": "Часть 1"}, "oge", "rus"), 2)
        self.assertEqual(logical_exam_part({"number": 2, "part": 1, "part_title": "Часть 1"}, "oge", "rus"), 1)


class OgeMathGeometryFloorTests(TestCase):
    def setUp(self):
        from Generator.models import Level, Mark, Subject

        self.subject, _ = Subject.objects.get_or_create(subject_short="math", defaults={"subject_name": "Математика"})
        self.level, _ = Level.objects.get_or_create(level="oge", defaults={"level_rus": "ОГЭ"})
        Mark.objects.filter(subject=self.subject, level=self.level).delete()
        for primary, grade in ((0, 2), (8, 3), (15, 4), (22, 5)):
            Mark.objects.create(subject=self.subject, level=self.level, score=primary, score_exam=grade)

    def _get(self, query):
        return self.client.get(f"/api/oge/math/score-conversion/?{query}").json()

    def test_grade_without_geometry_is_two(self):
        self.assertEqual(self._get("score=20&geo_points=1")["score_exam"], 2)
        self.assertTrue(self._get("score=20&geo_points=1")["geometry_floor_applied"])

    def test_grade_with_geometry(self):
        self.assertEqual(self._get("score=20&geo_points=2")["score_exam"], 4)
        self.assertEqual(self._get("score=25&geo_correct=3")["score_exam"], 5)
        self.assertEqual(self._get("score=20")["score_exam"], 4)
