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

  it("keeps image size from the teacher editor", () => {
    const out = sanitizeTaskHtml(
      '<img class="teacher-task-img" src="/media/x.png" width="240" style="width: 240px; height: auto;">',
    );
    expect(out).toContain("teacher-task-img");
    expect(out).toContain("240");
    expect(out.toLowerCase()).toContain("width");
  });
});
