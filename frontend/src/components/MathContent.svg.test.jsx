/** @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/loadMathJax", () => ({
  loadMathJax: () => Promise.resolve(null),
}));

import MathContent from "./MathContent";

const FIGURE =
  '<p>На рисунке изображены графики.</p><div class="fig"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="120" height="40"><path d="M0 30 L40 10 L80 28" fill="none" stroke="#111" stroke-width="2"/></svg></div>';

const MALICIOUS =
  '<div class="fig"><svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script>' +
  '<foreignObject><img src="x" onerror="alert(1)"></foreignObject>' +
  '<a href="javascript:alert(1)">x</a><use href="https://evil.example/s.svg#a"/>' +
  '<path d="M0 0 H10" stroke="#111"/></svg></div>';

describe("MathContent inline svg", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it.each([
    ["full pipeline", false],
    ["plain html", true],
  ])("renders an svg figure inside a task statement (%s)", async (_label, plainHtml) => {
    const { container } = render(<MathContent html={FIGURE} className="task-text" plainHtml={plainHtml} />);
    await waitFor(() => {
      const svg = container.querySelector(".task-html .fig svg");
      expect(svg).toBeTruthy();
      expect(svg.getAttribute("viewBox") || svg.getAttribute("viewbox")).toBe("0 0 120 40");
      expect(svg.querySelector("path")?.getAttribute("d")).toContain("M0 30");
    });
  });

  it("does not render active content from a malicious svg", async () => {
    const { container } = render(<MathContent html={MALICIOUS} className="task-text" />);
    await waitFor(() => {
      expect(container.querySelector("svg")).toBeTruthy();
    });
    const html = container.innerHTML.toLowerCase();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onload");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("foreignobject");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("evil.example");
    expect(container.querySelector("path")?.getAttribute("d")).toContain("M0 0");
  });
});