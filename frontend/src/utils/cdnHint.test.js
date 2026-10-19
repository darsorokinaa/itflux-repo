// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../index.html"),
  "utf8",
);
const script = html.match(/<script id="itflux-cdn-hint-script">([\s\S]*?)<\/script>/)[1];

function run(url, { booted = false, dismissed = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
    url,
    runScripts: "outside-only",
  });
  const w = dom.window;
  w.__ITFLUX_CDN_HINT_MS = 20;
  if (dismissed) w.sessionStorage.setItem("itfluxCdnHintDismissed", "1");
  w.eval(script);
  if (booted) w.__ITFLUX_BOOTED = true;
  return new Promise((r) => setTimeout(() => r(w), 60));
}

describe("index.html cdn fallback hint", () => {
  it("shows link to same path on cdn when app did not boot", async () => {
    const w = await run("https://itflux-academy.ru/cabinet/x?a=1#h");
    const a = w.document.querySelector("#itflux-cdn-hint a");
    expect(a.href).toBe("https://cdn.itflux-academy.ru/cabinet/x?a=1#h");
    expect(w.document.getElementById("itflux-cdn-hint").textContent).toContain("Сайт грузится медленно?");
    w.document.querySelector("#itflux-cdn-hint button").click();
    expect(w.document.getElementById("itflux-cdn-hint")).toBeNull();
    expect(w.sessionStorage.getItem("itfluxCdnHintDismissed")).toBe("1");
  });
  it("is silent when booted, dismissed, or on cdn/lesson hosts", async () => {
    for (const w of [
      await run("https://itflux-academy.ru/", { booted: true }),
      await run("https://www.itflux-academy.ru/", { dismissed: true }),
      await run("https://cdn.itflux-academy.ru/"),
      await run("https://lesson.itflux-academy.ru/"),
    ]) expect(w.document.getElementById("itflux-cdn-hint")).toBeNull();
  });
  it("makes no external requests (no src/href attributes in the inline block)", () => {
    expect(script).not.toMatch(/fetch\(|XMLHttpRequest|\.src\s*=/);
  });
});
