import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("service worker live lesson", () => {
  const source = readFileSync("public/sw.js", "utf8");

  it("does not take control while a meeting page is open", () => {
    expect(source).toContain("function liveLessonIsOpen");
    expect(source).toContain('path.includes("/cabinet/meetings/")');
    expect(source).toContain("if (!live) self.skipWaiting()");
    expect(source).toContain("if (!live) tasks.unshift(self.clients.claim())");
    expect(source).not.toMatch(/addEventListener\("install"[\s\S]{0,80}self\.skipWaiting\(\)/);
  });

  it("treats an open board tab like a live lesson", () => {
    const start = source.indexOf("function isLiveLessonUrl");
    const end = source.indexOf("async function liveLessonIsOpen");
    const body = source.slice(start, end);
    expect(body).toContain('path.includes("/cabinet/boards/")');
    expect(body).toContain('path.includes("/cabinet/meetings/")');
    expect(body).toContain('path.includes("/lesson/join")');
    expect(source).toContain("if (await liveLessonIsOpen()) return");
    expect(source).toContain("if (!live) self.skipWaiting()");
    expect(source).toContain("if (!live) tasks.unshift(self.clients.claim())");
  });
});
