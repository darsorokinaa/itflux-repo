import { describe, expect, it } from "vitest";
import { renderRazborMarkdown, taskLinkHref } from "./razborMarkdown";

describe("renderRazborMarkdown", () => {
  it("keeps LaTeX intact for MathJax", () => {
    const html = renderRazborMarkdown("Площадь $a_1 \\cdot b_2 = 3$ и $$\\dfrac{x_1}{y_2}$$");
    expect(html).toContain("$a_1 \\cdot b_2 = 3$");
    expect(html).toContain("$$\\dfrac{x_1}{y_2}$$");
    expect(html).not.toContain("<em>");
  });
  it("adds a task link to example headings", () => {
    const html = renderRazborMarkdown("### Пример 1 (шины), task_id 41378\n\nтекст");
    expect(html).toContain(`href="${taskLinkHref(41378)}"`);
    expect(html).toContain("<h3>Пример 1 (шины)</h3>");
  });
  it("strips scripts", () => {
    expect(renderRazborMarkdown("<script>alert(1)</script>ok")).not.toContain("<script");
  });
  it("wraps tables for mobile scroll", () => {
    expect(renderRazborMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("razbor-table-wrap");
  });
});
