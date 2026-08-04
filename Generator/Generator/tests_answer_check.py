from django.test import SimpleTestCase

from .answer_check import answers_equal, normalize_answer


class AnswerCheckTests(SimpleTestCase):
    def test_case_insensitive_cyrillic(self):
        self.assertEqual(normalize_answer("Нетерпеливого"), normalize_answer("нетерпеливого"))
        self.assertTrue(answers_equal("Нетерпеливого", "нетерпеливого"))

    def test_html_and_nbsp(self):
        self.assertTrue(answers_equal("Нетерпеливого", "<p>нетерпеливого</p>"))
        self.assertTrue(answers_equal("Нетерпеливого", "нетерпеливого&nbsp;"))

    def test_or_alternatives(self):
        self.assertTrue(answers_equal("2", "2 или 3", subject="math"))
        self.assertTrue(answers_equal("3", "2 или 3", subject="math"))
        self.assertFalse(answers_equal("4", "2 или 3", subject="math"))

    def test_mismatch(self):
        self.assertFalse(answers_equal("гуава", "дядя"))
