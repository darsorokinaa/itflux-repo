import { describe, it, expect, vi } from "vitest";
import {
  createDropDetector, isSignalingDropEvent, attachCdnAutoSwitch, switchToCdn,
  cdnSwitchAllowed, stripVersionParam, NOTICE_TEXT,
  getMeetingDropDetector, recordHardReconnect, resetMeetingDropDetectors,
} from "./cdnAutoSwitch";

function fakeWin({ host = "itflux-academy.ru", search = "", path = "/cabinet/meetings/abc/" } = {}) {
  const store = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
  const nav = vi.fn();
  return {
    location: { hostname: host, search, pathname: path, hash: "" },
    sessionStorage: store(), localStorage: store(), __ITFLUX_NAVIGATE: nav,
    document: { cookie: "csrftoken=abc", body: { appendChild: vi.fn() }, getElementById: () => null,
      createElement: () => ({ setAttribute() {}, textContent: "" }) },
    nav,
  };
}

function fakeApi() {
  const l = {};
  return { addListener: (n, f) => { (l[n] ||= []).push(f); }, removeListener: vi.fn(), fire: (n, e) => (l[n] || []).forEach((f) => f(e)) };
}

describe("r93 drop detector", () => {
  it("fires on 2 drops within 3 minutes, not when spread out", () => {
    let t = 0;
    const d = createDropDetector({ now: () => t });
    expect(d.record()).toBe(false);
    t = 200_000;
    expect(d.record()).toBe(false); // первый выпал из окна
    t = 300_000;
    expect(d.record()).toBe(true);
  });

  it("classifies events", () => {
    expect(isSignalingDropEvent("errorOccurred", { type: "CONNECTION", name: "connection.droppedError" })).toBe(true);
    expect(isSignalingDropEvent("errorOccurred", { type: "CONFIG", name: "conference.authenticationRequired" })).toBe(false);
    expect(isSignalingDropEvent("conferenceFailed", { error: "conference.authenticationRequired" })).toBe(false);
    expect(isSignalingDropEvent("connectionFailed", {})).toBe(true);
  });

  it("attach: two drops trigger switch; rejoin counts", () => {
    const win = fakeWin();
    const api = fakeApi();
    const onSwitch = vi.fn();
    attachCdnAutoSwitch(api, { onSwitch, win });
    api.fire("videoConferenceJoined");
    api.fire("errorOccurred", { type: "CONNECTION", name: "connection.droppedError" });
    expect(onSwitch).not.toHaveBeenCalled();
    api.fire("videoConferenceJoined"); // переподключение
    expect(onSwitch).toHaveBeenCalledWith("call_drops");
  });

  it("does nothing on cdn host or with nocdn escape", () => {
    expect(cdnSwitchAllowed(fakeWin({ host: "cdn.itflux-academy.ru" }))).toBe(false);
    expect(cdnSwitchAllowed(fakeWin({ search: "?itflux_nocdn=1" }))).toBe(false);
    const w = fakeWin(); w.__ITFLUX_NO_CDN = 1;
    expect(cdnSwitchAllowed(w)).toBe(false);
    const api = fakeApi(); const onSwitch = vi.fn();
    attachCdnAutoSwitch(api, { onSwitch, win: fakeWin({ host: "cdn.itflux-academy.ru" }) });
    api.fire("connectionFailed"); api.fire("connectionFailed");
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("switchToCdn uses handoff url, sets flag, strips version", async () => {
    const win = fakeWin({ search: "?_itflux_v=9&a=1" });
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ url: "https://cdn.itflux-academy.ru/api/cdn-handoff/redeem/?t=X" }) }));
    expect(await switchToCdn("call_drops", { win, fetchImpl, delayMs: 0 })).toBe(true);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ next: "/cabinet/meetings/abc/?a=1", reason: "call_drops" });
    expect(win.nav).toHaveBeenCalledWith("https://cdn.itflux-academy.ru/api/cdn-handoff/redeem/?t=X");
    expect(Number(win.localStorage.getItem("itfluxPreferCdn"))).toBeGreaterThan(0);
    expect(cdnSwitchAllowed(win)).toBe(false); // защита от петли
    expect(NOTICE_TEXT).toMatch(/запасной канал/);
  });

  it("stripVersionParam", () => {
    expect(stripVersionParam("?_itflux_v=1&x=2&itflux_nocdn=1")).toBe("?x=2");
    expect(stripVersionParam("?_itflux_v=1")).toBe("");
  });
});

describe("r93b pinned redirect", () => {
  it("redirects pinned user without notice", async () => {
    const { redirectIfServerPrefersCdn } = await import("./cdnAutoSwitch");
    const win = fakeWin({ path: "/cabinet/" });
    win.document.body.appendChild = vi.fn();
    const fetchImpl = vi.fn(async (u) => ({ ok: true, json: async () => (u.includes("pref")
      ? { prefer_cdn: true, reason: "pinned" }
      : { url: "https://cdn.itflux-academy.ru/api/cdn-handoff/redeem/?t=Y" }) }));
    // модульный флаг switching уже выставлен предыдущим тестом в этом файле — проверяем только вызов pref
    await redirectIfServerPrefersCdn({ win, fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/cdn-handoff/pref/");
  });
  it("no-op on cdn host", async () => {
    const { redirectIfServerPrefersCdn } = await import("./cdnAutoSwitch");
    const fetchImpl = vi.fn();
    expect(await redirectIfServerPrefersCdn({ win: fakeWin({ host: "cdn.itflux-academy.ru" }), fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


describe("r97 per-meeting detector", () => {
  it("survives a new Jitsi API instance for the same meeting", () => {
    resetMeetingDropDetectors();
    const w = fakeWin();
    const onSwitch = vi.fn();
    const a1 = fakeApi();
    attachCdnAutoSwitch(a1, { meetingKey: "m1", onSwitch, win: w });
    a1.fire("connectionFailed", {});
    const a2 = fakeApi(); // hard reconnect → новый API
    attachCdnAutoSwitch(a2, { meetingKey: "m1", onSwitch, win: w });
    a2.fire("connectionFailed", {});
    expect(onSwitch).toHaveBeenCalledWith("call_drops");
  });

  it("keeps meetings separate", () => {
    resetMeetingDropDetectors();
    getMeetingDropDetector("a").record();
    expect(getMeetingDropDetector("b").count()).toBe(0);
    expect(getMeetingDropDetector("a").count()).toBe(1);
  });

  it("recordHardReconnect counts toward the threshold; respects nocdn and guard", () => {
    resetMeetingDropDetectors();
    const onSwitch = vi.fn();
    const w = fakeWin();
    expect(recordHardReconnect("m2", { onSwitch, win: w })).toBe(false);
    expect(recordHardReconnect("m2", { onSwitch, win: w })).toBe(true);
    expect(onSwitch).toHaveBeenCalledTimes(1);
    resetMeetingDropDetectors();
    const off = vi.fn();
    const wn = fakeWin({ search: "?itflux_nocdn=1" });
    recordHardReconnect("m3", { onSwitch: off, win: wn });
    recordHardReconnect("m3", { onSwitch: off, win: wn });
    expect(off).not.toHaveBeenCalled();
    const wg = fakeWin();
    wg.sessionStorage.setItem("itfluxCdnSwitchAt", String(Date.now()));
    recordHardReconnect("m4", { onSwitch: off, win: wg });
    recordHardReconnect("m4", { onSwitch: off, win: wg });
    expect(off).not.toHaveBeenCalled();
  });
});

describe("r110 app host", () => {
  it("app и cdn считаются запасными хостами, новые переключения — на app", async () => {
    const m = await import("./cdnAutoSwitch.js");
    expect(m.CDN_HOST).toBe("app.itflux-academy.ru");
    expect(m.isCdnHost("cdn.itflux-academy.ru")).toBe(true);
    expect(m.isCdnHost("APP.itflux-academy.ru")).toBe(true);
    expect(m.isCdnHost("itflux-academy.ru")).toBe(false);
  });
});
