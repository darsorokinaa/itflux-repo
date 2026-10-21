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

    def test_decimal_separator_equal(self):
        self.assertTrue(answers_equal("0,95", "0.95", subject="math"))
        self.assertTrue(answers_equal("0.95", "<p>0,95</p>", subject="math"))
        self.assertTrue(answers_equal("-0,7", "-0.7"))
        self.assertTrue(answers_equal("0.5", "0,4 или 0,5", subject="math"))
        self.assertFalse(answers_equal("0,95", "0.96"))
        self.assertFalse(answers_equal("0,950", "0.95"))  # строгое строковое сравнение после замены разделителя

    def test_lists_and_digit_strings_unchanged(self):
        self.assertFalse(answers_equal("1.2.3", "1,2,3"))
        self.assertTrue(answers_equal("1,2,3", "1,2,3"))
        self.assertFalse(answers_equal("132", "1,32"))
        self.assertFalse(answers_equal("13", "31"))
        self.assertFalse(answers_equal("312", "3.12"))
        self.assertFalse(answers_equal("-3;-1", "-3.-1"))
