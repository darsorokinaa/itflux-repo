import { describe, expect, it } from "vitest";
import { buildWorkbookHtml, VARIANT_PDF_OPTIONS, variantTasksToWorkbookTasks } from "./buildWorkbookHtml";

function displayNumbersFromHtml(html: string): number[] {
  const matches = [...html.matchAll(/data-display-number="(\d+)"/g)];
  return matches.map((m) => Number(m[1]));
}

describe("buildWorkbookHtml numbering", () => {
  it("starts at 1 for a single task and never shows 0", () => {
    const html = buildWorkbookHtml(
      [{ id: 10, task_number: 0, text: "Условие" }],
      { title: "Тетрадь", mode: "workbook" }
    );
    expect(displayNumbersFromHtml(html)).toEqual([1]);
    expect(html).not.toMatch(/data-display-number="0"/);
    expect(html).toContain('class="tdoc-pos__num tdoc-task__num wb-task__num" aria-hidden="true">1<');
  });

  it("keeps 1..N through 10 and 30 tasks", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, task_number: i, text: "t" }));
    const thirty = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, task_number: 15, text: "t" }));
    expect(displayNumbersFromHtml(buildWorkbookHtml(ten, { title: "10", mode: "workbook" }))).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1)
    );
    expect(displayNumbersFromHtml(buildWorkbookHtml(thirty, { title: "30", mode: "workbook" }))).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1)
    );
  });

  it("does not restart after exam parts in a variant", () => {
    const tasks = variantTasksToWorkbookTasks([
      { id: 1, number: 1, part: 1, text: "p1a" },
      { id: 2, number: 2, part: 1, text: "p1b" },
      { id: 3, number: 13, part: 2, text: "p2a" },
      { id: 4, number: 15, part: 2, text: "p2b" },
    ]);
    const html = buildWorkbookHtml(tasks, {
      title: "Вариант",
      mode: "variant",
      level: "ege",
      subject: "math",
    });
    expect(displayNumbersFromHtml(html)).toEqual([1, 2, 3, 4]);
    expect(html).toContain("Часть 1");
    expect(html).toContain("Часть 2");
    expect(html).toContain("ЕГЭ №13");
  });

  it("uses a 5mm linear-gradient solution grid and A4 print rules", () => {
    const html = buildWorkbookHtml([{ id: 1, task_number: 1, text: "x" }], {
      title: "PDF",
      mode: "workbook",
      options: { showSolutionSpace: true },
    });
    expect(html).toContain("linear-gradient(to right");
    expect(html).toContain("background-size: 5mm 5mm");
    expect(html).toContain("print-color-adjust: exact");
    expect(html).toContain("@page");
    expect(html).toContain("size: A4");
    expect(html).toContain("margin: 12mm 14mm 14mm");
    expect(html).not.toContain("repeating-linear-gradient");
    expect(html).not.toContain("position: fixed !important");
    expect(html).toContain('class="wb-toolbar no-print"');
    expect(html).not.toMatch(/<input[^>]*type="text"/i);
  });

  it("includes solution grid in variant PDF by default", () => {
    const html = buildWorkbookHtml(
      [{ id: 1, task_number: 1, text: "x", part: 1 }],
      { title: "Вариант", mode: "variant", level: "ege", options: VARIANT_PDF_OPTIONS }
    );
    expect(html).toContain("tdoc-solution");
    expect(html).toContain("background-size: 5mm 5mm");
    expect(html).not.toMatch(/<body class="[^"]*no-solution-fields/);
  });
});
