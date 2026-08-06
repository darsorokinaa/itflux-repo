import { describe, expect, it } from "vitest";
import { sanitizeTaskHtml } from "./sanitizeTaskHtml";

describe("sanitizeTaskHtml", () => {
  it("strips script tags", () => {
    const out = sanitizeTaskHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).toContain("ok");
    expect(out.toLowerCase()).not.toContain("<script");
  });

  it("strips event handlers", () => {
    const out = sanitizeTaskHtml('<img src="x" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain("onerror");
  });

  it("keeps safe educational markup", () => {
    const out = sanitizeTaskHtml('<table><tr><td>1</td></tr></table><span class="math">x</span>');
    expect(out).toContain("<table");
    expect(out).toContain("math");
  });
});
