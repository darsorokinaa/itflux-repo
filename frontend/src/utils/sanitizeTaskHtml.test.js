import { beforeAll, describe, expect, it } from "vitest";
import { ensureSanitizer, sanitizeTaskHtml } from "./sanitizeTaskHtml";

describe("sanitizeTaskHtml", () => {
  beforeAll(async () => {
    await ensureSanitizer();
  });

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

  it("keeps an inline svg figure and its viewBox", () => {
    const out = sanitizeTaskHtml(
      '<p>На рисунке изображены графики.</p><div class="fig"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="120" height="40"><path d="M0 30 L40 10 L80 28" fill="none" stroke="#111" stroke-width="2"/></svg></div>',
    );
    expect(out).toContain('class="fig"');
    expect(out).toMatch(/<svg\b/i);
    expect(out).toMatch(/viewBox="0 0 120 40"/i);
    expect(out).toContain("M0 30 L40 10 L80 28");
    expect(out).toMatch(/stroke="#111"/i);
  });

  it("neutralises a malicious svg", () => {
    const out = sanitizeTaskHtml(
      '<div class="fig"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">' +
        "<script>alert(1)</script>" +
        '<foreignObject width="10" height="10"><iframe src="javascript:alert(1)"></iframe><img src="x" onerror="alert(1)"></foreignObject>' +
        '<a href="javascript:alert(1)">ссылка</a>' +
        '<use href="https://evil.example/sprite.svg#icon"/>' +
        '<use href="#local"/>' +
        '<path d="M0 0 H10" stroke="#111"/>' +
        "</svg></div>",
    );
    const lower = out.toLowerCase();
    expect(lower).not.toContain("<script");
    expect(lower).not.toContain("onload");
    expect(lower).not.toContain("onerror");
    expect(lower).not.toContain("foreignobject");
    expect(lower).not.toContain("javascript:");
    expect(lower).not.toContain("evil.example");
    expect(out).toContain('href="#local"');
    expect(out).toContain("M0 0 H10");
  });

  it("strips cross-origin and javascript hrefs on image and feImage", () => {
    const out = sanitizeTaskHtml(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">' +
        '<image href="https://evil.example/a.png" width="10" height="10"/>' +
        '<image xlink:href="https://evil.example/b.png" width="10" height="10"/>' +
        '<image href="/media/fig.png" width="10" height="10"/>' +
        '<image href="#local" width="10" height="10"/>' +
        '<feImage href="javascript:alert(1)"/>' +
        '<feImage xlink:href="data:image/svg+xml;base64,PHN2Zy8+"/>' +
        "</svg>",
    );
    const lower = out.toLowerCase();
    expect(lower).not.toContain("evil.example");
    expect(lower).not.toContain("javascript:");
    expect(lower).not.toContain("data:image");
    expect(out).toContain("/media/fig.png");
    expect(out).toContain('href="#local"');
  });
});
