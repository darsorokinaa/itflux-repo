import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TruthTableInput from "./TruthTableInput";

describe("TruthTableInput", () => {
  it("принимает ответ только в клетках таблицы", () => {
    const { container } = render(
      <TruthTableInput
        variables={["A", "B"]}
        expression="¬(A ∨ ¬B)"
        steps={["¬B", "A ∨ ¬B", "¬(A ∨ ¬B)"]}
        value="110 001 110 010"
      />
    );
    const inputs = container.querySelectorAll("input");
    expect(inputs).toHaveLength(12);
    inputs.forEach((input) => {
      expect(input.closest("td")).toBeTruthy();
      expect(input.className).toContain("truth-input");
    });
    expect(container.querySelector(".hidden-answer, .exam-task-input, .all-tasks-check__input")).toBeNull();
    expect(container.querySelector(".truth-title, .truth-formula")).toBeNull();
    expect(container.querySelector("th.result-col").textContent).toBe("¬(A ∨ ¬B)");
    expect(screen.getByLabelText("Строка 1, ¬B").value).toBe("1");
    expect(screen.getByLabelText("Строка 1, ¬(A ∨ ¬B)").value).toBe("0");
    expect(screen.getByLabelText("Строка 2, ¬(A ∨ ¬B)").value).toBe("1");
  });

  it("быстрые 0 и 1 остаются в соседних клетках и не ждут перерисовку страницы", () => {
    let parentUpdates = 0;
    const { container } = render(
      <TruthTableInput
        variables={["A", "B"]}
        expression="¬(A ∨ ¬B)"
        steps={["¬B", "A ∨ ¬B", "¬(A ∨ ¬B)"]}
        value=""
        onChange={() => {
          parentUpdates += 1;
        }}
      />
    );
    const inputs = [...container.querySelectorAll("input.truth-input")];
    const nextInColumn = inputs[3];
    inputs[0].focus();
    fireEvent.change(inputs[0], { target: { value: "1" } });
    expect(document.activeElement).toBe(nextInColumn);
    expect(inputs[0].value).toBe("1");
    fireEvent.change(nextInColumn, { target: { value: "0" } });
    expect(inputs[0].value).toBe("1");
    expect(nextInColumn.value).toBe("0");
    expect(parentUpdates).toBe(2);
  });

  it("на странице варианта нет отдельного поля ответа у таблицы", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../pages/ExamPage.jsx"), "utf8");
    expect(source.includes('className="hidden-answer"')).toBe(false);
    expect(source.includes("stripTruthTableAnswerHint")).toBe(true);
  });
});
