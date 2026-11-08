import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
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
    expect(container.querySelector(".truth-formula").textContent).toBe("¬(A ∨ ¬B)");
    expect(screen.getByLabelText("Строка 1, ¬B").value).toBe("1");
    expect(screen.getByLabelText("Строка 1, ¬(A ∨ ¬B)").value).toBe("0");
    expect(screen.getByLabelText("Строка 2, ¬(A ∨ ¬B)").value).toBe("1");
  });

  it("на странице варианта нет отдельного поля ответа у таблицы", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../pages/ExamPage.jsx"), "utf8");
    expect(source.includes('className="hidden-answer"')).toBe(false);
    expect(source.includes("stripTruthTableAnswerHint")).toBe(true);
  });
});
