import { describe, expect, it } from "vitest";
import { preparePlainBankTaskHtml } from "../components/MathContent.jsx";
import {
  formatNumberedTaskBlocksHtml,
  formatPlainMathIdentifiersHtml,
  formatTaskProseHtml,
} from "./formatTaskProseHtml";

describe("formatPlainMathIdentifiersHtml", () => {
  it("wraps P_x, Q_1 and |P_x| for MathJax", () => {
    const html =
      "<p>Найдите P_x и Q_1. Целая часть |P_x|·10000 и |P_y|·10000.</p>";
    const out = formatPlainMathIdentifiersHtml(html);
    expect(out).toContain("$P_x$");
    expect(out).toContain("$Q_1$");
    expect(out).toContain("$|P_x|$");
    expect(out).toContain("$|P_y|$");
    expect(out).not.toContain("|$P_x$|");
  });

  it("does not wrap filenames like 27.05_A.txt", () => {
    const html = "<p>В файле 27.05_A.txt записаны координаты точек.</p>";
    const out = formatPlainMathIdentifiersHtml(html);
    expect(out).toContain("27.05_A.txt");
    expect(out).not.toContain("$A$");
    expect(out).not.toContain("$27$");
  });

  it("does not rewrite identifiers already inside math", () => {
    const html = "<p>Найдите $P_x$ и \\(Q_1\\).</p>";
    const out = formatPlainMathIdentifiersHtml(html);
    expect(out).toContain("$P_x$");
    expect(out).toContain("\\(Q_1\\)");
    expect(out).not.toContain("$$P_x$$");
  });
});

describe("formatNumberedTaskBlocksHtml", () => {
  it("turns consecutive 1. 2. 3. blocks into an ordered list", () => {
    const html = `
      <div class="task-html-block">Для файла A:</div>
      <div class="task-html-block">1. Определите центр каждого из двух кластеров.</div>
      <div class="task-html-block">2. Найдите P_x — минимальную из абсцисс.</div>
      <div class="task-html-block">3. Найдите P_y — минимальную из ординат.</div>
    `;
    const out = formatNumberedTaskBlocksHtml(html);
    expect(out).toContain('class="task-prose-list"');
    expect(out).toContain("<ol");
    expect(out).toMatch(/<li[^>]*>Определите центр/);
    expect(out).toMatch(/<li[^>]*>Найдите P_x/);
    expect(out).not.toMatch(/<li[^>]*>1\.\s*Определите/);
    expect(out).toContain("Для файла A:");
  });

  it("does not wrap a single numbered paragraph", () => {
    const html = "<p>1. Введение в тему кластеров.</p>";
    const out = formatNumberedTaskBlocksHtml(html);
    expect(out).not.toContain("<ol");
    expect(out).toContain("1. Введение в тему кластеров.");
  });

  it("promotes numbered lines split by <br>", () => {
    const html =
      "<p>Для файла B:<br>1. Определите центры трёх кластеров.<br>2. Найдите Q_1 — расстояние.<br>3. Найдите Q_2 — максимум.</p>";
    const out = formatNumberedTaskBlocksHtml(html);
    expect(out).toContain("<ol");
    expect(out).toMatch(/<li[^>]*>Определите центры/);
    expect(out).toContain("Для файла B:");
  });
});

describe("formatTaskProseHtml", () => {
  it("applies math identifiers inside converted list items", () => {
    const html = `
      <p>1. Найдите P_x — минимум.</p>
      <p>2. Найдите Q_1 — расстояние.</p>
    `;
    const out = formatTaskProseHtml(html);
    expect(out).toContain("<ol");
    expect(out).toContain("$P_x$");
    expect(out).toContain("$Q_1$");
  });
});

describe("preparePlainBankTaskHtml", () => {
  it("formats cluster-task prose the same way as the variant renderer", () => {
    const html = `
      <div class="task-html-block">Для файла A:</div>
      <div class="task-html-block">1. Определите центр каждого из двух кластеров.</div>
      <div class="task-html-block">2. Найдите P_x — минимальную из абсцисс центров кластеров.</div>
      <div class="task-html-block">3. Найдите P_y — минимальную из ординат центров кластеров.</div>
      <div class="task-html-block">первая строка — целая часть |P_x|·10000 и целая часть |P_y|·10000;</div>
    `;
    const out = preparePlainBankTaskHtml(html, { ogeMathChoiceEnhance: false });
    expect(out).toContain('class="task-prose-list"');
    expect(out).toContain("$P_x$");
    expect(out).toContain("$P_y$");
    expect(out).toContain("$|P_x|$");
    expect(out).toContain("$|P_y|$");
  });
});
