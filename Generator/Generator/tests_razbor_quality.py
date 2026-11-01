"""r136: сверка ответов разборов с банком (razbor_quality.answers_match)."""
from django.test import SimpleTestCase

from Generator.razbor_quality import answers_match


CASES = [("150.",r"\(150\)",True),("90.","90,0",True),("2.","2,0",True),("−9.",r"\(-9\)",True),
(r"а) $\pm\dfrac\pi3+2\pi n;\ \pi+2\pi n,\ n\in\mathbb Z$; б) $-3\pi;\ -\dfrac{7\pi}3$.","-3π;-7π/3",True),
(r"а) $1;\ \dfrac32$; б) $\dfrac32$.","3/2",True),
(r"$a\in(-2;-1)\cup(0;7)\cup(8;9)$.","(-2;-1)∪(0;7)∪(8;9)",True),
(r"б) $\arcsin\sqrt{\dfrac23}$.",r"а)\(AC\perp BD\) как диагонали квадрата, \(AC\perp DD_{1}\), поэтому \(AC\perp(BDD_{1})\), б)\(\arcsin(\sqrt{\frac{2}{3}})\)",True),
("б) 4,8.",r"а)\(AA_{1}\parallel DD_{1}, DD_{1}\) лежит в \((BDD_{1}), A\) не лежит в этой плоскости, б)\(4,8\), в основании расстояние от \(A\) до \(BD\) равно \(\frac{AB·AD}{BD}=\frac{48}{10}\)",True),
# негативные
("151.",r"\(150\)",False),("90,5","90,0",False),("б) 4,9.",r"а)\(AA_{1}\parallel DD_{1}\) лежит в плоскости, б)\(4,8\), расстояние равно \(\frac{48}{10}\)",False),
(r"а) 1; б) 2.","3",False),(r"$a\in(-2;-1)\cup(0;7)$.","(-2;-1)∪(0;8)",False),("2,05","2,5",False),("20","2",False)]


class AnswersMatchTests(SimpleTestCase):
    def test_cases(self):
        for got, want, expected in CASES:
            with self.subTest(got=got, want=want):
                self.assertEqual(answers_match(got, want)[0], expected)

    def test_long_bank_answer_is_lenient(self):
        ok, lenient = answers_match("б) 6.", r"а)\(AD+BC=AB+CD=2AB\) по равенству отрезков касательных, б)\(6\), боковая сторона равна \(13\)")
        self.assertTrue(ok)
        self.assertTrue(lenient)
