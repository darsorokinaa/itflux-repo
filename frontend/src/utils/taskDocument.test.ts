import { describe, expect, it } from "vitest";
import {
  answerAreaHtml,
  assignDisplayNumbers,
  examTypeCaption,
  examTypeNumber,
  examTypeShortLabel,
  formatTaskProgress,
  inferSolutionSize,
  orderVariantDocumentTasks,
  resolveTaskPosition,
  solutionAreaHtml,
  taskPositionAriaLabel,
} from "./taskDocument";

describe("assignDisplayNumbers", () => {
  it("starts at 1 and is consecutive across the whole list", () => {
    const numbered = assignDisplayNumbers([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(numbered.map((t) => t.displayNumber)).toEqual([1, 2, 3]);
  });

  it("never uses array index 0 as a visible number", () => {
    const numbered = assignDisplayNumbers([{ number: 0 }, { number: 0 }]);
    expect(numbered[0].displayNumber).toBe(1);
    expect(numbered.every((t) => t.displayNumber >= 1)).toBe(true);
  });

  it("keeps going through 30 tasks", () => {
    const numbered = assignDisplayNumbers(Array.from({ length: 30 }, (_, i) => ({ id: i })));
    expect(numbered.map((t) => t.displayNumber)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1)
    );
  });
});

describe("examTypeNumber", () => {
  it("ignores 0 and non-positive values", () => {
    expect(examTypeNumber({ number: 0 })).toBeNull();
    expect(examTypeNumber({ task_number: 0 })).toBeNull();
    expect(examTypeNumber({ number: 15 })).toBe(15);
  });
});

describe("orderVariantDocumentTasks", () => {
  it("does not restart numbering after parts: part 2 continues the sequence", () => {
    const tasks = [
      { id: 1, number: 1, part: 1 },
      { id: 2, number: 2, part: 1 },
      { id: 3, number: 13, part: 2 },
      { id: 4, number: 15, part: 2 },
    ];
    const ordered = assignDisplayNumbers(orderVariantDocumentTasks(tasks, { level: "ege", subject: "math" }));
    expect(ordered.map((t) => t.displayNumber)).toEqual([1, 2, 3, 4]);
    expect(ordered.map((t) => examTypeNumber(t))).toEqual([1, 2, 13, 15]);
  });

  it("uses document order, not exam slot, for mixed bank picks", () => {
    const tasks = [
      { id: 10, number: 15 },
      { id: 11, number: 8 },
      { id: 12, number: 15 },
    ];
    const numbered = assignDisplayNumbers(tasks);
    expect(numbered.map((t) => t.displayNumber)).toEqual([1, 2, 3]);
    expect(examTypeCaption(numbered[0], "ege", 1)).toBe("ЕГЭ №15");
  });

  it("keeps pick/DnD order instead of sorting by exam slot", () => {
    const tasks = [
      { id: 10, number: 15, part: 1 },
      { id: 11, number: 8, part: 1 },
      { id: 12, number: 15, part: 1 },
    ];
    const ordered = assignDisplayNumbers(orderVariantDocumentTasks(tasks, { level: "ege", subject: "math" }));
    expect(ordered.map((t) => t.id)).toEqual([10, 11, 12]);
    expect(ordered.map((t) => t.displayNumber)).toEqual([1, 2, 3]);
    expect(ordered.map((t) => examTypeNumber(t))).toEqual([15, 8, 15]);
  });
});

describe("task position labels", () => {
  it("never emits 0 or empty exam captions", () => {
    expect(formatTaskProgress(0)).toBe("");
    expect(formatTaskProgress(1, 12)).toBe("Задание 1 из 12");
    expect(examTypeShortLabel({ number: null }, "ege")).toBe("");
    expect(examTypeShortLabel({ number: 0 }, "ege")).toBe("");
    expect(examTypeShortLabel({ number: 15 }, "ege", 4)).toBe("ЕГЭ №15");
    expect(examTypeShortLabel({ number: 4 }, "", 4)).toBe("");
  });

  it("builds a screen-reader label with both numbers", () => {
    expect(
      taskPositionAriaLabel({ position: 4, total: 12, examNumber: 15, level: "ege" })
    ).toBe("Задание 4 из 12. ЕГЭ, задание 15.");
  });

  it("resolves position from index, not task id or exam number", () => {
    const model = resolveTaskPosition({
      index: 3,
      total: 10,
      examNumber: 15,
      level: "oge",
    });
    expect(model.position).toBe(4);
    expect(model.examNumber).toBe(15);
    expect(model.examLabel).toBe("ОГЭ №15");
    expect(model.progressLabel).toBe("Задание 4 из 10");
  });
});

describe("inferSolutionSize", () => {
  it("uses explicit size when present", () => {
    expect(inferSolutionSize({ solutionSize: "large", part: 1 })).toBe("large");
  });

  it("maps exam parts to stable sizes", () => {
    expect(inferSolutionSize({ part: 1, number: 3 }, { level: "ege", subject: "math" })).toBe("small");
    expect(inferSolutionSize({ part: 2, number: 13 }, { level: "ege", subject: "math" })).toBe("large");
  });
});

describe("print fragments", () => {
  it("emits CSS-grid solution markup without per-cell nodes", () => {
    const html = solutionAreaHtml("medium");
    expect(html).toContain("solution-grid");
    expect(html).toContain("tdoc-solution--medium");
    expect(html.match(/<div/g)?.length).toBe(2);
  });

  it("emits a printable answer line, not an input", () => {
    const html = answerAreaHtml();
    expect(html).toContain("Ответ:");
    expect(html).not.toContain("<input");
  });
});
