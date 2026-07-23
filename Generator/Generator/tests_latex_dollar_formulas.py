"""Регрессия: формулы в $...$ с \\right) не должны ломаться naked-матчем."""
from django.test import SimpleTestCase

from Generator.latex_utils import process_latex


class DollarFormulaLatexTests(SimpleTestCase):
    def test_process_latex_keeps_single_math_display_span(self):
        raw = (
            r"$\left(\sqrt{\dfrac{(1-n)\sqrt[3]{1+n}}{n}}"
            r"\cdot\sqrt[3]{\dfrac{3n^2}{4-8n+4n^2}}\right)^{-1}"
            r":\sqrt[3]{\left(\dfrac{3n\sqrt n}{2\sqrt{1-n^2}}\right)^{-1}}$"
        )
        process_latex.cache_clear()
        out = process_latex(raw, for_browser=True)
        self.assertIn("math-display", out)
        self.assertNotIn("&#92;($", out)
        self.assertEqual(out.count("<span"), 1)

    def test_process_latex_sqrt_b_formula(self):
        raw = (
            r"$\left(\dfrac{a+a^{3/4}b^{1/2}+a^{1/4}b^{3/2}+b^2}"
            r"{a^{1/2}+2a^{1/4}b^{1/2}+b}(\sqrt[4]{a}+\sqrt b)"
            r"+\dfrac{3\sqrt b(a^{1/2}-b)}{a^{-1/4}(a^{1/4}-\sqrt b)}"
            r"\right)^{-1/3}:(\sqrt[4]{a}+\sqrt b)^{-1}$"
        )
        process_latex.cache_clear()
        out = process_latex(raw, for_browser=True)
        self.assertIn("math-display", out)
        self.assertNotIn("&#92;($", out)
        self.assertEqual(out.count("math-inline"), 0)

    def test_process_latex_simple_dfrac(self):
        process_latex.cache_clear()
        out = process_latex(r"$\dfrac{8-m}{\sqrt[3]{m}+2}$", for_browser=True)
        self.assertIn("math-display", out)
        self.assertNotIn("&#92;($", out)
