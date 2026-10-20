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
const KEY = "itfluxPreferCdn";

async function run(url, { booted = false, dismissed = false, flag, wait = 60 } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url, runScripts: "outside-only" });
  const w = dom.window;
  w.__ITFLUX_CDN_HINT_MS = 20;
  w.navs = [];
  w.__ITFLUX_NAVIGATE = (u) => w.navs.push(u);
  if (dismissed) w.sessionStorage.setItem("itfluxCdnHintDismissed", "1");
  if (flag !== undefined) w.localStorage.setItem(KEY, String(flag));
  w.eval(script);
  if (booted) w.__ITFLUX_BOOTED = true;
  await new Promise((r) => setTimeout(r, wait));
  return w;
}
const hint = (w) => w.document.querySelector("#itflux-cdn-hint a")?.href || null;

describe("index.html cdn fallback", () => {
  it("main host: no boot in time -> banner, flag, navigate to same path on cdn", async () => {
    const w = await run("https://itflux-academy.ru/cabinet/x?a=1#h");
    expect(hint(w)).toBe("https://cdn.itflux-academy.ru/cabinet/x?a=1#h");
    expect(w.navs).toEqual(["https://cdn.itflux-academy.ru/cabinet/x?a=1#h"]);
    expect(Number(w.localStorage.getItem(KEY))).toBeGreaterThan(0);
  });
  it("main host: fresh flag redirects immediately, expired flag is dropped", async () => {
    const w = await run("https://www.itflux-academy.ru/p?q=2", { flag: Date.now() - 1000, booted: true, wait: 5 });
    expect(w.navs).toEqual(["https://cdn.itflux-academy.ru/p?q=2"]);
    const old = await run("https://itflux-academy.ru/", { flag: Date.now() - 8 * 24 * 3600 * 1000, booted: true });
    expect(old.navs).toEqual([]);
    expect(old.localStorage.getItem(KEY)).toBeNull();
  });
  it("main host: ?itflux_nocdn=1 clears flag and never redirects", async () => {
    const w = await run("https://itflux-academy.ru/?itflux_nocdn=1", { flag: Date.now() });
    expect(w.navs).toEqual([]);
    expect(w.localStorage.getItem(KEY)).toBeNull();
    expect(hint(w)).toContain("cdn.itflux-academy.ru");
  });
  it("main host: booted app -> nothing", async () => {
    const w = await run("https://itflux-academy.ru/", { booted: true });
    expect(w.navs).toEqual([]);
    expect(hint(w)).toBeNull();
    expect(w.localStorage.getItem(KEY)).toBeNull();
  });
  it("banner close button hides it for the session", async () => {
    const w = await run("https://itflux-academy.ru/");
    w.document.querySelector("#itflux-cdn-hint button").click();
    expect(w.document.getElementById("itflux-cdn-hint")).toBeNull();
    expect(w.sessionStorage.getItem("itfluxCdnHintDismissed")).toBe("1");
  });
  it("cdn host: never auto-navigates (no loop); slow boot shows link to main with nocdn", async () => {
    const w = await run("https://cdn.itflux-academy.ru/t?a=1#z", { flag: Date.now() });
    expect(w.navs).toEqual([]);
    expect(hint(w)).toBe("https://itflux-academy.ru/t?a=1&itflux_nocdn=1#z");
    const ok = await run("https://cdn.itflux-academy.ru/", { booted: true });
    expect(hint(ok)).toBeNull();
  });
  it("lesson and other hosts: nothing", async () => {
    for (const u of ["https://lesson.itflux-academy.ru/", "https://itflux.ru/", "http://localhost/"]) {
      const w = await run(u, { flag: Date.now() });
      expect(w.navs).toEqual([]);
      expect(hint(w)).toBeNull();
    }
  });
  it("makes no network requests itself", () => {
    expect(script).not.toMatch(/fetch\(|XMLHttpRequest|\.src\s*=/);
  });
});
