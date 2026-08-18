"""Регрессия: array-таблицы с литералом \\& (запросы Динамо & Спартак) не должны расползаться."""
from django.test import SimpleTestCase

from Generator.latex_utils import process_latex, _split_array_row


SEARCH_QUERY_TASK = (
    r"В языке запросов поискового сервера для обозначения логической операции "
    r"«ИЛИ» используется символ «|», а для логической операции «И» — символ «&». "
    r"В таблице приведены запросы и количество найденных по ним страниц."
    r"$$\begin{array}{|c|c|} \hline \text{Запрос} & \text{Найдено страниц (в тысячах)} \\"
    r" \hline \text{Динамо \& (Зенит | Спартак)} & 840 \\"
    r" \hline \text{Динамо \& Зенит} & 530 \\"
    r" \hline \text{Динамо \& Зенит \& Спартак} & 130 \\"
    r" \hline \end{array}$$"
    r" Какое количество страниц будет найдено по запросу $$\text{Динамо \& Спартак}$$ ?"
)


class ArrayTableAmpersandTests(SimpleTestCase):
    def test_split_row_keeps_literal_ampersand_in_one_cell(self):
        cells = _split_array_row(r"\text{Динамо \& (Зенит | Спартак)} & 840")
        self.assertEqual(len(cells), 2)
        self.assertIn("Динамо", cells[0])
        self.assertIn("&amp;", cells[0])
        self.assertNotIn("&amp;", cells[1])
        self.assertIn("840", cells[1])

        cells3 = _split_array_row(r"\text{Динамо \& Зенит \& Спартак} & 130")
        self.assertEqual(len(cells3), 2)
        self.assertEqual(cells3[0].count("&amp;"), 2)
        self.assertEqual(cells3[1], "130")

    def test_process_latex_keeps_two_columns(self):
        process_latex.cache_clear()
        out = process_latex(SEARCH_QUERY_TASK, for_browser=True)
        self.assertIn("array-table", out)
        self.assertIn("Динамо", out)
        self.assertIn("&amp;", out)
        self.assertIn("840", out)
        # Одна шапка + три строки данных, по две ячейки.
        self.assertEqual(out.count("<tr"), 4)
        self.assertEqual(out.count("array-cell"), 8)
        self.assertNotIn(">840Динамо<", out.replace(" ", ""))
