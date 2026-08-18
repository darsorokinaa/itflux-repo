import { describe, expect, it } from "vitest";
import { formatOgeInf6TaskHtml } from "./formatOgeInf6TaskHtml";

describe("formatOgeInf6TaskHtml", () => {
  it("converts {l} python listings to pre/code", () => {
    const html = String.raw`$$\begin{array}{l} s = int(input()) \\ print(s) \end{array}$$`;
    const out = formatOgeInf6TaskHtml(html);
    expect(out).toContain("task-code-block");
    expect(out).toContain("int(input())");
    expect(out).not.toContain("\\begin{array}");
  });

  it("does not convert bordered search-query tables", () => {
    const html = String.raw`$$\begin{array}{|c|c|} \hline \text{Запрос} & 840 \\ \hline \text{Динамо \& Спартак} & 440 \\ \hline \end{array}$$`;
    const out = formatOgeInf6TaskHtml(html);
    expect(out).toBe(html);
    expect(out).not.toContain("task-code-block");
  });
});
