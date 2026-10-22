import { describe, it, expect, vi } from "vitest";
import { withParam, reportFallbackArrival, switchToCdn, stripVersionParam } from "./cdnAutoSwitch";

function win({ host, search = "" }) {
  const m = {};
  const st = { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); } };
  return {
    location: { hostname: host, search, pathname: "/cabinet/meetings/abc/", hash: "" },
    history: { state: null, replaceState: vi.fn() },
    sessionStorage: st, localStorage: st, document: { cookie: "csrftoken=x" }, __ITFLUX_NAVIGATE: vi.fn(),
  };
}

describe("r95 cdn switch recording", () => {
  it("withParam keeps hash", () => {
    expect(withParam("/a?x=1#h", "k", "v")).toBe("/a?x=1&k=v#h");
    expect(withParam("/a", "k", "v")).toBe("/a?k=v");
  });
  it("strip removes fallback flag", () => {
    expect(stripVersionParam("?itflux_cdn_fb=call_drops&x=1")).toBe("?x=1");
  });
  it("fallback target is flagged when issue fails", async () => {
    const w = win({ host: "itflux-academy.ru" });
    const f = vi.fn().mockRejectedValue(new Error("down"));
    await switchToCdn("join_timeout", { win: w, fetchImpl: f, delayMs: 0 });
    expect(w.__ITFLUX_NAVIGATE).toHaveBeenCalledWith(
      "https://cdn.itflux-academy.ru/cabinet/meetings/abc/?itflux_cdn_fb=join_timeout");
  });
  it("reports arrival on cdn once and cleans url", async () => {
    const w = win({ host: "cdn.itflux-academy.ru", search: "?itflux_cdn_fb=call_drops&x=1" });
    const f = vi.fn().mockResolvedValue({ ok: true });
    expect(await reportFallbackArrival({ win: w, fetchImpl: f })).toBe(true);
    expect(f.mock.calls[0][0]).toBe("/api/cdn-handoff/event/");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ reason: "call_drops" });
    expect(w.history.replaceState.mock.calls[0][2]).toBe("/cabinet/meetings/abc/?x=1");
  });
  it("ignores main host and bad reasons", async () => {
    const f = vi.fn();
    expect(await reportFallbackArrival({ win: win({ host: "itflux-academy.ru", search: "?itflux_cdn_fb=call_drops" }), fetchImpl: f })).toBe(false);
    expect(await reportFallbackArrival({ win: win({ host: "cdn.itflux-academy.ru", search: "?itflux_cdn_fb=evil" }), fetchImpl: f })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});


describe("r97 fallback arrival request", () => {
  it("sends credentials, csrf and a same-origin referrer", async () => {
    const w = win({ host: "cdn.itflux-academy.ru", search: "?itflux_cdn_fb=call_drops" });
    w.location.href = "https://cdn.itflux-academy.ru/cabinet/meetings/abc/";
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    expect(await reportFallbackArrival({ win: w, fetchImpl })).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/cdn-handoff/event/");
    expect(init.credentials).toBe("include");
    expect(init.referrer).toBe("https://cdn.itflux-academy.ru/cabinet/meetings/abc/");
    expect(init.referrerPolicy).toBe("same-origin");
    expect(init.headers["X-CSRFToken"]).toBe("x");
  });
});
