/**
 * Замер ввода на странице из 16 таблиц, как ВПР /vpr/inf/variant/2096.
 * Родитель держит все ответы одним state и заново собирает конфиг на каждый рендер —
 * так же, как ExamPage.
 */
import { Profiler, useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TruthTableInput from "./TruthTableInput";
import { getTruthTableConfig } from "../utils/truthTable";

const FORMULAS = [
  "A \\land B",
  "A \\lor B",
  "\\lnot A \\land B",
  "A \\land \\lnot B",
  "\\lnot A \\lor B",
  "A \\lor \\lnot B",
  "\\lnot A \\land \\lnot B",
  "\\lnot A \\lor \\lnot B",
  "\\lnot (A \\land B)",
  "\\lnot (A \\lor B)",
  "\\lnot (\\lnot A \\land B)",
  "\\lnot (A \\land \\lnot B)",
  "\\lnot (\\lnot A \\lor B)",
  "\\lnot (A \\lor \\lnot B)",
  "\\lnot (\\lnot A \\land \\lnot B)",
  "\\lnot (\\lnot A \\lor \\lnot B)",
];

function taskText(formula) {
  return `<p>Заполните таблицу истинности выражения.</p><p><span class="math-inline">&#92;(${formula.replace(/\\/g, "&#92;")}&#92;&#41;</span></p>`;
}

const TASKS = FORMULAS.map((formula, index) => ({
  id: 1300 + index,
  number: 6,
  vpr_class: 8,
  vpr_advanced: true,
  truth_table_enabled: true,
  text: taskText(formula),
}));

const CTX = { level: "vpr", subject: "inf" };

function VariantLikePage({ onCommit }) {
  const [answers, setAnswers] = useState({});
  return (
    <Profiler id="variant" onRender={onCommit}>
      <div>
        {TASKS.map((task) => {
          const cfg = getTruthTableConfig(task, CTX);
          return (
            <TruthTableInput
              key={task.id}
              variables={cfg.variables}
              expression={cfg.expression}
              steps={cfg.steps}
              mode={cfg.mode}
              value={answers[task.id] || ""}
              onChange={(next) => setAnswers((prev) => ({ ...prev, [task.id]: next }))}
            />
          );
        })}
      </div>
    </Profiler>
  );
}

describe("ввод в 16 таблицах варианта", () => {
  it("печатает цифры по клеткам и замеряет коммиты", () => {
    const commits = [];
    const { container } = render(
      <VariantLikePage onCommit={(_id, phase, actualDuration) => {
        commits.push({ phase, actualDuration });
      }} />
    );
    const inputs = container.querySelectorAll("input.truth-input");
    expect(inputs.length).toBeGreaterThan(40);
    const target = inputs[0];
    const samples = [];
    for (const digit of ["1", "0", "1", "0", "1", "0", "1", "0"]) {
      const before = commits.length;
      const t0 = performance.now();
      fireEvent.change(document.activeElement === target ? target : inputs[0], { target: { value: digit } });
      // после смены фокуса печатаем в текущую клетку
      const active = document.activeElement?.classList?.contains("truth-input")
        ? document.activeElement
        : container.querySelector("input.truth-input");
      if (active && active !== inputs[0]) {
        fireEvent.change(active, { target: { value: digit } });
      }
      const ms = performance.now() - t0;
      const fresh = commits.slice(before);
      samples.push({
        ms,
        commits: fresh.length,
        actual: fresh.reduce((sum, row) => sum + row.actualDuration, 0),
      });
    }
    const meanActual = samples.reduce((s, row) => s + row.actual, 0) / samples.length;
    const maxActual = Math.max(...samples.map((row) => row.actual));
    console.log("TRUTH_INPUT_PROFILE", JSON.stringify({
      tables: TASKS.length,
      inputs: inputs.length,
      meanCommitMs: Number(meanActual.toFixed(2)),
      maxCommitMs: Number(maxActual.toFixed(2)),
      samples,
    }));
    expect(meanActual).toBeGreaterThan(0);
  });
});
