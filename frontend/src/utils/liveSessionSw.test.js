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
});
