import { describe, expect, it } from "vitest";
import {
  buildTruthTableConfigFromPrompt,
  canonicalTruthTableAnswer,
  evaluateTruthTable,
  formatTruthTableAnswerFromGrid,
  gradeTruthTableAnswer,
  matchTruthTableAnswer,
  parseTruthTableAnswerToGrid,
  stripTruthTableAnswerHint,
} from "./truthTable";

/** Формулы и эталоны ВПР информатика 8, углублённый, задание 6 (публичный банк). */
const BANK = [
  ["A \\land B", "0001", ["A ∧ B"]],
  ["A \\lor B", "0111", ["A ∨ B"]],
  ["\\lnot A \\land B", "0100", ["¬A", "¬A ∧ B"]],
  ["A \\land \\lnot B", "0010", ["¬B", "A ∧ ¬B"]],
  ["\\lnot A \\lor B", "1101", ["¬A", "¬A ∨ B"]],
  ["A \\lor \\lnot B", "1011", ["¬B", "A ∨ ¬B"]],
  ["\\lnot A \\land \\lnot B", "1000", ["¬A", "¬B", "¬A ∧ ¬B"]],
  ["\\lnot A \\lor \\lnot B", "1110", ["¬A", "¬B", "¬A ∨ ¬B"]],
  ["\\lnot (A \\land B)", "1110", ["A ∧ B", "¬(A ∧ B)"]],
  ["\\lnot (A \\lor B)", "1000", ["A ∨ B", "¬(A ∨ B)"]],
  ["\\lnot (\\lnot A \\land B)", "1011", ["¬A", "¬A ∧ B", "¬(¬A ∧ B)"]],
  ["\\lnot (A \\land \\lnot B)", "1101", ["¬B", "A ∧ ¬B", "¬(A ∧ ¬B)"]],
  ["\\lnot (\\lnot A \\lor B)", "0010", ["¬A", "¬A ∨ B", "¬(¬A ∨ B)"]],
  ["\\lnot (A \\lor \\lnot B)", "0100", ["¬B", "A ∨ ¬B", "¬(A ∨ ¬B)"]],
  ["\\lnot (\\lnot A \\land \\lnot B)", "0111", ["¬A", "¬B", "¬A ∧ ¬B", "¬(¬A ∧ ¬B)"]],
  ["\\lnot (\\lnot A \\lor \\lnot B)", "0001", ["¬A", "¬B", "¬A ∨ ¬B", "¬(¬A ∨ ¬B)"]],
];

function prompt(formula) {
  return (
    `<p>Заполните таблицу истинности выражения.</p>` +
    `<p><span class="math-inline">&#92;(${formula.replace(/\\/g, "&#92;")}&#92;&#41;</span></p>` +
    `<p>строк &#92;((A&#123;=&#125;0,B&#123;=&#125;0)&#92;&#41;</p>`
  );
}

function task(formula, answer, extra = {}) {
  return {
    text: prompt(formula),
    answer,
    truth_table_enabled: true,
    ...extra,
  };
}

describe("evaluateTruthTable — все наборы входов банка", () => {
  it.each(BANK)("%s → %s", (formula, result, steps) => {
    const table = evaluateTruthTable(prompt(formula));
    expect(table.steps).toEqual(steps);
    expect(table.columns).toHaveLength(steps.length);
    expect(table.columns[0]).toHaveLength(4);
    expect(table.columns[table.columns.length - 1]).toBe(result);
    expect(table.variables).toEqual(["A", "B"]);
  });

  it("A ∧ ¬B: промежуточный столбец ¬B не сдвигается относительно результата", () => {
    const table = evaluateTruthTable(prompt("A \\land \\lnot B"));
    expect(table.columns).toEqual(["1010", "0010"]);
  });
});

describe("порядок операций, скобки, НЕ/И/ИЛИ и остальные связки", () => {
  it("НЕ теснее ИЛИ: ¬A ∨ B это не ¬(A ∨ B)", () => {
    expect(evaluateTruthTable("¬A ∨ B").columns.at(-1)).toBe("1101");
    expect(evaluateTruthTable("¬(A ∨ B)").columns.at(-1)).toBe("1000");
  });

  it("И теснее ИЛИ на всех 8 наборах: A ∨ B ∧ C = A ∨ (B ∧ C)", () => {
    const loose = evaluateTruthTable("A ∨ B ∧ C");
    const tight = evaluateTruthTable("(A ∨ B) ∧ C");
    expect(loose.variables).toEqual(["A", "B", "C"]);
    expect(loose.columns.at(-1)).toBe("00011111");
    expect(tight.columns.at(-1)).toBe("00010101");
    expect(loose.columns.at(-1)).not.toBe(tight.columns.at(-1));
  });

  it("импликация, эквиваленция, XOR и двойное НЕ на каждом входе", () => {
    expect(evaluateTruthTable("A → B").columns.at(-1)).toBe("1101");
    expect(evaluateTruthTable("¬A → ¬B").columns.at(-1)).toBe("1011");
    expect(evaluateTruthTable("A ≡ B").columns.at(-1)).toBe("1001");
    expect(evaluateTruthTable("A ⊕ B").columns.at(-1)).toBe("0110");
    expect(evaluateTruthTable("¬¬A").columns).toEqual(["10", "01"]);
    expect(evaluateTruthTable("A ∧ B ∨ C").columns.at(-1)).toBe(evaluateTruthTable("(A ∧ B) ∨ C").columns.at(-1));
  });

  it("слова НЕ, И, ИЛИ и запись /\\ \\\\ /", () => {
    expect(evaluateTruthTable("НЕ A ИЛИ B").columns.at(-1)).toBe("1101");
    expect(evaluateTruthTable("A /\\ НЕ B").columns.at(-1)).toBe("0010");
    expect(evaluateTruthTable("A \\/ B").columns.at(-1)).toBe("0111");
  });
});

describe("проверка заполнения по клеткам", () => {
  const and = task("A \\land B", "<p>0001</p>");
  const conjNot = task("A \\land \\lnot B", "10 00 11 00");

  it("эталон из 4 цифр совпадает с результатом, ведущий ноль не теряется", () => {
    expect(gradeTruthTableAnswer("0001", and)).toBe(true);
    expect(gradeTruthTableAnswer("0 0 0 1", and)).toBe(true);
    expect(gradeTruthTableAnswer("1", and)).toBe(false);
    expect(gradeTruthTableAnswer("001", and)).toBe(false);
    expect(gradeTruthTableAnswer("1000", and)).toBe(false);
    expect(gradeTruthTableAnswer("", and)).toBe(false);
    expect(gradeTruthTableAnswer("   ", and)).toBe(false);
  });

  it("числовой 0 остаётся в своей клетке и переживает круг через строку", () => {
    const grid = [
      [0, 1],
      ["", 0],
      [0, "1"],
      ["0", ""],
    ];
    const saved = formatTruthTableAnswerFromGrid(grid);
    expect(saved).toBe("01 .0 01 0.");
    expect(parseTruthTableAnswerToGrid(saved, 4, 2)).toEqual([
      ["0", "1"],
      ["", "0"],
      ["0", "1"],
      ["0", ""],
    ]);
  });

  it("пустая клетка слева не переносит 0 и не заменяет собой столбец", () => {
    const shown = parseTruthTableAnswerToGrid(".0 .1 .0 .0", 4, 2);
    expect(shown).toEqual([
      ["", "0"],
      ["", "1"],
      ["", "0"],
      ["", "0"],
    ]);
    const shifted = parseTruthTableAnswerToGrid("0. 1. 0. 0.", 4, 2);
    expect(shifted[0]).toEqual(["0", ""]);
    expect(shifted[1]).toEqual(["1", ""]);
  });

  it("несколько столбцов сверяются только по строкам", () => {
    expect(gradeTruthTableAnswer("10 00 11 00", conjNot)).toBe(true);
    expect(gradeTruthTableAnswer("10001100", conjNot)).toBe(true);
    expect(gradeTruthTableAnswer("1010 0010", conjNot)).toBe(false);
    expect(gradeTruthTableAnswer("10100010", conjNot)).toBe(false);
    expect(gradeTruthTableAnswer("0010", conjNot)).toBe(false);
    expect(gradeTruthTableAnswer(".0 .0 .1 .0", conjNot)).toBe(false);
    expect(gradeTruthTableAnswer("00 00 11 00", conjNot)).toBe(false);
    expect(gradeTruthTableAnswer("0010 1010", conjNot)).toBe(false);
    expect(matchTruthTableAnswer("10 00 11 00", {
      prompt: conjNot.text,
      expected: "<p>1010 0010</p>",
      enabled: true,
    })).toBe(null);
    expect(matchTruthTableAnswer("10 00 11 0", {
      prompt: conjNot.text,
      expected: "10 00 11 00",
      enabled: true,
    })).toBe(false);
  });

  it("сохранение таблицы переживает круг по строкам", () => {
    const grid = [
      ["1", "0"],
      ["0", "0"],
      ["1", "1"],
      ["0", "0"],
    ];
    const saved = formatTruthTableAnswerFromGrid(grid);
    expect(saved).toBe("10 00 11 00");
    expect(parseTruthTableAnswerToGrid(saved, 4, 2)).toEqual(grid);
    expect(formatTruthTableAnswerFromGrid(parseTruthTableAnswerToGrid(saved, 4, 2))).toBe(saved);
  });

  it("эталон всех 16 формул — построчная таблица, не столбцы", () => {
    expect(canonicalTruthTableAnswer(prompt("A \\land B"))).toBe("0 0 0 1");
    expect(canonicalTruthTableAnswer(prompt("A \\land \\lnot B"))).toBe("10 00 11 00");
    expect(canonicalTruthTableAnswer(prompt("\\lnot (A \\lor \\lnot B)"))).toBe("110 001 110 010");
    for (const [formula, result] of BANK) {
      const canonical = canonicalTruthTableAnswer(prompt(formula));
      const rows = canonical.split(" ");
      expect(rows).toHaveLength(4);
      expect(rows.map((row) => row.at(-1)).join("")).toBe(result);
      expect(canonical.includes("1010 0010")).toBe(false);
    }
  });

  it("указание про четыре цифры убирается, формула остаётся", () => {
    const html = `${prompt("\\lnot (A \\lor \\lnot B)")}<p>В ответе запишите 4 цифры подряд — значения столбца результата для строк (A=0, B=0).</p>`;
    const stripped = stripTruthTableAnswerHint(html);
    expect(stripped).toContain("Заполните таблицу истинности");
    expect(stripped).toContain("lnot");
    expect(stripped).not.toContain("В ответе запишите");
    expect(stripTruthTableAnswerHint(stripped)).toBe(stripped);
  });

  it("конфиг виджета берётся из формулы, а не из шаблона A ∧ ¬B", () => {
    const cfg = buildTruthTableConfigFromPrompt(prompt("\\lnot (A \\lor B)"));
    expect(cfg.expression).toBe("¬(A ∨ B)");
    expect(cfg.steps).toEqual(["A ∨ B", "¬(A ∨ B)"]);
    expect(cfg.variables).toEqual(["A", "B"]);
  });

  it("чужое задание без таблицы не перехватывается", () => {
    expect(gradeTruthTableAnswer("4", {
      text: "Укажите фрукт. НЕ (гласная) ИЛИ (чётность)",
      answer: "4",
      truth_table_enabled: false,
    })).toBe(null);
  });
});
