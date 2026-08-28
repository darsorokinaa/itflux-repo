import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recoverChunkLoadOnce, reportClientEvent } from "./clientTelemetry";

describe("clientTelemetry", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => true),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("ignores unknown events", () => {
    expect(reportClientEvent("not_a_real_event")).toBe(false);
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
  });

  it("sends allowed events without scene payloads", () => {
    expect(reportClientEvent("board_ws_closed", { code: 1006 })).toBe(true);
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(1);
    const body = navigator.sendBeacon.mock.calls[0][1];
    expect(body).toBeInstanceOf(Blob);
  });

  it("recovers a missing chunk only once per tab", () => {
    const replace = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet",
      replace,
    });
    expect(recoverChunkLoadOnce()).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0][0])).toContain("_itflux_v=");
    expect(recoverChunkLoadOnce()).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
