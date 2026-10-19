import importlib

from django.apps import apps as django_apps
from django.test import SimpleTestCase, TestCase

from Generator.views import score_scale_is_mark

MIG = importlib.import_module("Generator.migrations.0112_r76_ege_math_base_marks_2026")


class ScaleKindTests(SimpleTestCase):
    def test_scale_kind(self):
        self.assertTrue(score_scale_is_mark("oge", "math"))
        self.assertTrue(score_scale_is_mark("ege", "math_base"))
        self.assertFalse(score_scale_is_mark("ege", "math"))
        self.assertFalse(score_scale_is_mark("ege", "inf"))

    def test_base_table_matches_official(self):
        # Таблица № 5 Рособрнадзора 2026: «2» 0–6, «3» 7–11, «4» 12–16, «5» 17–21.
        self.assertEqual([(r[0], r[1]) for r in MIG.EGE_MATH_BASE], [(0, 2), (7, 3), (12, 4), (17, 5)])


class EgeMathBaseConversionTests(TestCase):
    def setUp(self):
        from Generator.models import Level, Subject

        Subject.objects.get_or_create(subject_short="math_base", defaults={"subject_name": "Математика базовая"})
        Subject.objects.get_or_create(subject_short="math", defaults={"subject_name": "Математика"})
        Level.objects.get_or_create(level="ege", defaults={"level_rus": "ЕГЭ"})
        MIG.forwards(django_apps, None)

    def _get(self, subject, score):
        return self.client.get(f"/api/ege/{subject}/score-conversion/?score={score}").json()

    def test_marks(self):
        expected = {0: 2, 6: 2, 7: 3, 11: 3, 12: 4, 16: 4, 17: 5, 21: 5}
        for primary, grade in expected.items():
            data = self._get("math_base", primary)
            self.assertEqual(data["score_exam"], grade, primary)
            self.assertEqual(data["scale"], "mark")
            self.assertIn("№ 04-6/КИД", data["comment"])

    def test_idempotent_and_reverse(self):
        from Generator.models import Mark

        MIG.forwards(django_apps, None)
        qs = Mark.objects.filter(subject__subject_short="math_base", level__level="ege")
        self.assertEqual(qs.count(), 4)
        MIG.backwards(django_apps, None)
        self.assertEqual(qs.count(), 0)

    def test_profile_untouched(self):
        data = self._get("math", 20)
        self.assertEqual(data["scale"], "test")
        self.assertNotEqual(data["score_exam"], 5)  # профиль — тестовые баллы, не отметка


MIG77 = importlib.import_module("Generator.migrations.0113_r77_ege_math_profile_scale_2026")


class EgeMathProfileScaleTests(TestCase):
    def setUp(self):
        from Generator.models import Level, Subject

        Subject.objects.get_or_create(subject_short="math", defaults={"subject_name": "Математика"})
        Level.objects.get_or_create(level="ege", defaults={"level_rus": "ЕГЭ"})
        MIG77.forwards(django_apps, None)

    def _get(self, subject, score):
        return self.client.get(f"/api/ege/{subject}/score-conversion/?score={score}").json()

    def test_official_points(self):
        # Таблица № 6 Рособрнадзора 2026; 33 — кэп по верхнему значению.
        for primary, test in {0: 0, 4: 22, 5: 27, 12: 70, 20: 86, 29: 99, 30: 100, 32: 100, 33: 100}.items():
            data = self._get("math", primary)
            self.assertEqual(data["score_exam"], test, primary)
            self.assertEqual(data["scale"], "test")
            self.assertIn("2027", data["note"])
        self.assertEqual(len(MIG77.EGE_MATH_TEST), 34)

    def test_threshold_level(self):
        self.assertEqual(self._get("math", 4)["mark_level"], 1)
        self.assertEqual(self._get("math", 5)["mark_level"], 2)

    def test_other_subjects_have_no_note(self):
        self.assertIsNone(self.client.get("/api/ege/inf/score-conversion/?score=10").json().get("note"))
        self.assertIsNone(self.client.get("/api/oge/math/score-conversion/?score=10").json().get("note"))

    def test_reverse(self):
        from Generator.models import Mark

        MIG77.forwards(django_apps, None)
        qs = Mark.objects.filter(subject__subject_short="math", level__level="ege")
        self.assertEqual(qs.count(), 34)
        MIG77.backwards(django_apps, None)
        self.assertEqual(qs.count(), 0)
