"""Регрессия: ВПР информатика 8, таблица истинности считается и сверяется по клеткам."""

from django.test import SimpleTestCase

from .truth_table_check import (
    canonical_row_answer,
    compile_truth_table,
    match_truth_table_answer,
    strip_truth_table_answer_hint,
)

# Формулы и опубликованные эталоны задания 6 (углублённый уровень).
BANK = [
    (r"A \land B", "0001", ["A ∧ B"]),
    (r"A \lor B", "0111", ["A ∨ B"]),
    (r"\lnot A \land B", "0100", ["¬A", "¬A ∧ B"]),
    (r"A \land \lnot B", "0010", ["¬B", "A ∧ ¬B"]),
    (r"\lnot A \lor B", "1101", ["¬A", "¬A ∨ B"]),
    (r"A \lor \lnot B", "1011", ["¬B", "A ∨ ¬B"]),
    (r"\lnot A \land \lnot B", "1000", ["¬A", "¬B", "¬A ∧ ¬B"]),
    (r"\lnot A \lor \lnot B", "1110", ["¬A", "¬B", "¬A ∨ ¬B"]),
    (r"\lnot (A \land B)", "1110", ["A ∧ B", "¬(A ∧ B)"]),
    (r"\lnot (A \lor B)", "1000", ["A ∨ B", "¬(A ∨ B)"]),
    (r"\lnot (\lnot A \land B)", "1011", ["¬A", "¬A ∧ B", "¬(¬A ∧ B)"]),
    (r"\lnot (A \land \lnot B)", "1101", ["¬B", "A ∧ ¬B", "¬(A ∧ ¬B)"]),
    (r"\lnot (\lnot A \lor B)", "0010", ["¬A", "¬A ∨ B", "¬(¬A ∨ B)"]),
    (r"\lnot (A \lor \lnot B)", "0100", ["¬B", "A ∨ ¬B", "¬(A ∨ ¬B)"]),
    (r"\lnot (\lnot A \land \lnot B)", "0111", ["¬A", "¬B", "¬A ∧ ¬B", "¬(¬A ∧ ¬B)"]),
    (r"\lnot (\lnot A \lor \lnot B)", "0001", ["¬A", "¬B", "¬A ∨ ¬B", "¬(¬A ∨ ¬B)"]),
]


def _prompt(formula: str) -> str:
    esc = formula.replace("\\", "&#92;")
    return (
        "<p>Заполните таблицу истинности выражения.</p>"
        f'<p><span class="math-inline">&#92;({esc}&#92;&#41;</span></p>'
        "<p>строк &#92;((A&#123;=&#125;0,B&#123;=&#125;0)&#92;&#41;</p>"
    )


def _indep(bits_fn, n: int) -> str:
    out = []
    for i in range(1 << n):
        env = [(i >> (n - 1 - j)) & 1 for j in range(n)]
        out.append("1" if bits_fn(env) else "0")
    return "".join(out)


class TruthTableBankTests(SimpleTestCase):
    def test_every_input_row_matches_published_answer(self):
        for formula, result, steps in BANK:
            table = compile_truth_table(_prompt(formula))
            self.assertIsNotNone(table, formula)
            self.assertEqual(table["steps"], steps, formula)
            self.assertEqual(table["variables"], ["A", "B"])
            for column in table["columns"]:
                self.assertEqual(len(column), 4, formula)
                self.assertTrue(set(column) <= {"0", "1"}, formula)
            self.assertEqual(table["columns"][-1], result, formula)

    def test_and_not_b_keeps_intermediate_column(self):
        table = compile_truth_table(_prompt(r"A \land \lnot B"))
        self.assertEqual(table["columns"], ["1010", "0010"])
        self.assertEqual(canonical_row_answer(table), "10 00 11 00")

    def test_published_results_are_the_last_symbol_of_each_row(self):
        not_or = compile_truth_table(_prompt(r"\lnot (A \lor \lnot B)"))
        self.assertEqual(canonical_row_answer(not_or), "110 001 110 010")
        for formula, result, _steps in BANK:
            table = compile_truth_table(_prompt(formula))
            rows = canonical_row_answer(table).split(" ")
            self.assertEqual("".join(row[-1] for row in rows), result, formula)


class TruthTablePrecedenceTests(SimpleTestCase):
    def test_not_binds_tighter_than_or(self):
        self.assertEqual(compile_truth_table("¬A ∨ B")["columns"][-1], "1101")
        self.assertEqual(compile_truth_table("¬(A ∨ B)")["columns"][-1], "1000")

    def test_and_binds_tighter_than_or_on_all_eight_rows(self):
        loose = compile_truth_table("A ∨ B ∧ C")["columns"][-1]
        tight = compile_truth_table("(A ∨ B) ∧ C")["columns"][-1]
        self.assertEqual(loose, "00011111")
        self.assertEqual(tight, "00010101")
        self.assertEqual(loose, _indep(lambda e: e[0] or (e[1] and e[2]), 3))
        self.assertEqual(tight, _indep(lambda e: (e[0] or e[1]) and e[2], 3))

    def test_implication_equivalence_xor_double_not(self):
        self.assertEqual(compile_truth_table("A → B")["columns"][-1], "1101")
        self.assertEqual(compile_truth_table("A → B")["columns"][-1], _indep(lambda e: (not e[0]) or e[1], 2))
        self.assertEqual(compile_truth_table("¬A → ¬B")["columns"][-1], "1011")
        self.assertEqual(compile_truth_table("A ≡ B")["columns"][-1], "1001")
        self.assertEqual(compile_truth_table("A ≡ B")["columns"][-1], _indep(lambda e: e[0] == e[1], 2))
        self.assertEqual(compile_truth_table("A ⊕ B")["columns"][-1], "0110")
        self.assertEqual(compile_truth_table("A ⊕ B")["columns"][-1], _indep(lambda e: e[0] ^ e[1], 2))
        self.assertEqual(compile_truth_table("¬¬A")["columns"], ["10", "01"])

    def test_russian_words_and_slash_operators(self):
        self.assertEqual(compile_truth_table("НЕ A ИЛИ B")["columns"][-1], "1101")
        self.assertEqual(compile_truth_table("A /\\ НЕ B")["columns"][-1], "0010")
        self.assertEqual(compile_truth_table("A \\/ B")["columns"][-1], "0111")


class TruthTableCellGradeTests(SimpleTestCase):
    def test_result_column_keeps_leading_zero_and_rejects_empty(self):
        prompt = _prompt(r"A \land B")
        expected = "<p>0001</p>"
        self.assertTrue(match_truth_table_answer("0001", prompt=prompt, expected=expected, enabled=True))
        self.assertTrue(match_truth_table_answer("0 0 0 1", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("1", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("001", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("1000", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("   ", prompt=prompt, expected=expected, enabled=True))

    def test_empty_cell_does_not_shift_zero_into_another_column(self):
        prompt = _prompt(r"\lnot A \land B")
        self.assertFalse(match_truth_table_answer(".0 .1 .0 .0", prompt=prompt, expected="0100", enabled=True))
        self.assertFalse(match_truth_table_answer("0. 1. 0. 0.", prompt=prompt, expected="0100", enabled=True))
        self.assertTrue(match_truth_table_answer("10 11 00 00", prompt=prompt, expected="0100", enabled=True))

    def test_two_columns_are_row_major_only(self):
        prompt = _prompt(r"A \land \lnot B")
        expected = "10 00 11 00"
        self.assertTrue(match_truth_table_answer("10 00 11 00", prompt=prompt, expected=expected, enabled=True))
        self.assertTrue(match_truth_table_answer("10001100", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("1010 0010", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("10100010", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("0010", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer(".0 .0 .1 .0", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("00 00 11 00", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("0010 1010", prompt=prompt, expected=expected, enabled=True))
        self.assertFalse(match_truth_table_answer("10 00 11 0", prompt=prompt, expected=expected, enabled=True))
        self.assertIsNone(match_truth_table_answer(
            "10 00 11 00", prompt=prompt, expected="<p>1010 0010</p>", enabled=True,
        ))

    def test_hint_paragraph_is_removed_and_formula_stays(self):
        html = (
            _prompt(r"\lnot (A \lor \lnot B)")
            + "<p>В ответе запишите 4 цифры подряд — значения столбца результата.</p>"
        )
        stripped = strip_truth_table_answer_hint(html)
        self.assertIn("Заполните таблицу истинности", stripped)
        self.assertIn("lnot", stripped)
        self.assertNotIn("В ответе запишите", stripped)
        self.assertEqual(strip_truth_table_answer_hint(stripped), stripped)

    def test_plan_rewrites_column_storage_and_strips_the_hint(self):
        from .vpr_truth_table_tasks import plan_task

        class Level:
            level = "vpr"

        class Subject:
            subject_short = "inf"

        class TaskList:
            level = Level()
            subject = Subject()
            task_number = 6

        class Task:
            pk = 1327
            task = TaskList()
            vpr_class = 8
            vpr_advanced = True
            truth_table_enabled = True
            task_template = (
                "<p>Заполните таблицу истинности выражения.</p>"
                r"<p>\(A \land \lnot B\)</p>"
                "<p>В ответе запишите 4 цифры подряд — значения столбца результата.</p>"
            )
            answer = "<p>1010 0010</p>"

        change = plan_task(Task())
        self.assertTrue(change["text_changed"])
        self.assertTrue(change["answer_changed"])
        self.assertNotIn("В ответе запишите", change["new_template"])
        self.assertIn("Заполните таблицу истинности", change["new_template"])
        self.assertEqual(change["new_answer"], "10 00 11 00")

        task_one = Task()
        task_one.pk = 1324
        task_one.task_template = "<p>Заполните таблицу истинности выражения.</p>" + r"<p>\(A \land B\)</p>"
        task_one.answer = "0001"
        self.assertIsNone(plan_task(task_one))

    def test_unrelated_task_is_not_captured(self):
        graded = match_truth_table_answer(
            "4",
            prompt="Укажите фрукт. НЕ (гласная) ИЛИ (чётность)",
            expected="4",
            enabled=False,
        )
        self.assertIsNone(graded)
