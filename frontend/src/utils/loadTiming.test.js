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
const script = html.match(/<script id="itflux-load-timing-script">([\s\S]*?)<\/script>/)[1];
const hintScript = html.match(/<script id="itflux-cdn-hint-script">([\s\S]*?)<\/script>/)[1];

function setup(url, { failMs = 1200, visible = true } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', { url, runScripts: "outside-only", pretendToBeVisual: visible });
  const w = dom.window;
  w.beacons = [];
  w.navigator.sendBeacon = (u, blob) => { w.beacons.push({ u, blob }); return true; };
  w.__ITFLUX_LT_FAIL_MS = failMs;
  return w;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const payload = async (b) => JSON.parse(await b.blob.text());

describe("index.html load timing beacon", () => {
  it("sends one ok beacon after app ready", async () => {
    const w = setup("https://cdn.itflux-academy.ru/cabinet");
    w.eval(script);
    w.__ITFLUX_BOOTED = true;
    await wait(1100);
    w.dispatchEvent(new w.Event("pagehide"));
    expect(w.beacons).toHaveLength(1);
    expect(w.beacons[0].u).toBe("/api/load-timing/");
    const p = await payload(w.beacons[0]);
    expect(p.ev).toBe("ok");
    expect(p.ready).toBeGreaterThanOrEqual(0);
    expect(Object.keys(p).sort()).toEqual(["dcl", "ev", "load", "nav", "ready", "sw", "ttfb", "vis"]);
  });
  it("no boot in time -> boot_fail", async () => {
    const w = setup("https://itflux-academy.ru/", { failMs: 300 });
    w.eval(script);
    await wait(1100);
    expect(w.beacons).toHaveLength(1);
    expect((await payload(w.beacons[0])).ev).toBe("boot_fail");
  });
  it("r111: hidden tab -> no boot_fail and no auto_switch, pagehide sends hidden", async () => {
    const w = setup("https://itflux-academy.ru/x", { failMs: 300, visible: false });
    let navigated = 0;
    w.__ITFLUX_CDN_HINT_MS = 20;
    w.__ITFLUX_NAVIGATE = () => { navigated += 1; };
    w.eval(hintScript);
    w.eval(script);
    await wait(1100);
    expect(w.beacons).toHaveLength(0);
    expect(navigated).toBe(0);
    w.dispatchEvent(new w.Event("pagehide"));
    const p = await payload(w.beacons[0]);
    expect(p.ev).toBe("hidden");
    expect(["hidden", "prerender"]).toContain(p.vis);
  });
  it("auto-switch to cdn reports auto_switch", async () => {
    const w = setup("https://itflux-academy.ru/x");
    w.__ITFLUX_CDN_HINT_MS = 20;
    w.__ITFLUX_NAVIGATE = () => {};
    w.eval(hintScript);
    w.eval(script);
    await wait(80);
    expect(w.beacons).toHaveLength(1);
    expect((await payload(w.beacons[0])).ev).toBe("auto_switch");
  });
  it("skips localhost and flag-redirect pages", async () => {
    const a = setup("http://localhost:5173/");
    a.eval(script);
    a.dispatchEvent(new a.Event("pagehide"));
    const b = setup("https://itflux-academy.ru/");
    b.__ITFLUX_CDN_REDIRECTING = 1;
    b.eval(script);
    b.dispatchEvent(new b.Event("pagehide"));
    expect(a.beacons.length + b.beacons.length).toBe(0);
  });
});
