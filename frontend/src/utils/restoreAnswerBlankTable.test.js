import { describe, expect, it } from "vitest";
import { preparePlainBankTaskHtml } from "../components/MathContent.jsx";
import { restoreAnswerBlankTablesHtml } from "./restoreAnswerBlankTable";

const STACKED = `
<p>Заполните таблицу, в бланк ответов перенесите последовательность трёх цифр без пробелов.</p>
<div class="task-html-block">Насел. пункты</div>
<div class="task-html-block">д. Таловка</div>
<div class="task-html-block">д. Грушёвка</div>
<div class="task-html-block">с. Абрамово</div>
<div class="task-html-block">Цифры</div>
`;

function blankTable(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root.querySelector("table.task-answer-blank");
}

describe("restoreAnswerBlankTablesHtml", () => {
  it("turns a vertical stack of names into a header row and digit cells", () => {
    const out = preparePlainBankTaskHtml(STACKED, { ogeMathChoiceEnhance: false });
    const table = blankTable(out);
    expect(table).toBeTruthy();
    const rows = [...table.rows];
    expect(rows).toHaveLength(2);
    expect([...rows[0].cells].map((cell) => cell.textContent.trim())).toEqual([
      "Насел. пункты",
      "д. Таловка",
      "д. Грушёвка",
      "с. Абрамово",
    ]);
    expect(rows[1].cells[0].textContent.trim()).toBe("Цифры");
    expect(rows[1].cells).toHaveLength(4);
    expect(rows[1].querySelectorAll(".task-answer-blank__digit")).toHaveLength(3);
    expect(out).toContain("Заполните таблицу");
  });

  it("rebuilds the same blank from line breaks and from a one-column table", () => {
    const fromBreaks = restoreAnswerBlankTablesHtml(
      "<p>Насел. пункты<br>д. Таловка<br>д. Грушёвка<br>Цифры</p>",
    );
    expect([...blankTable(fromBreaks).rows[0].cells].map((cell) => cell.textContent.trim())).toEqual([
      "Насел. пункты",
      "д. Таловка",
      "д. Грушёвка",
    ]);

    const fromColumn = restoreAnswerBlankTablesHtml(`
      <table><tr><td>Насел. пункты</td></tr><tr><td>д. Таловка</td></tr><tr><td>Цифры</td></tr></table>
    `);
    const table = blankTable(fromColumn);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells).toHaveLength(2);
    expect(table.rows[1].cells).toHaveLength(2);
  });

  it("pads an existing two-row blank and leaves a price table alone", () => {
    const padded = restoreAnswerBlankTablesHtml(`
      <table>
        <tr><td>Насел. пункты</td><td>д. Таловка</td><td>с. Абрамово</td></tr>
        <tr><td>Цифры</td><td></td><td></td></tr>
      </table>
    `);
    const blank = blankTable(padded);
    expect(blank.rows[1].querySelectorAll(".task-answer-blank__digit")).toHaveLength(2);

    const price = restoreAnswerBlankTablesHtml(`
      <table>
        <tr><td>Наименование</td><td>д. Грушёвка</td><td>с. Абрамово</td></tr>
        <tr><td>Молоко</td><td>30</td><td>40</td></tr>
        <tr><td>Хлеб</td><td>20</td><td>25</td></tr>
      </table>
    `);
    expect(price).not.toContain("task-answer-blank");
    expect(price).toContain("Молоко");
  });
});
