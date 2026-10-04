import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushClientTelemetry, isChunkLoadError, recoverChunkLoadOnce, reportClientEvent } from "./clientTelemetry";

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

    it("batches allowed events into one request and does not retry 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, headers: { get: () => null } });
    vi.stubGlobal("fetch", fetchMock);
    expect(reportClientEvent("collaboration_connected")).toBe(true);
    expect(reportClientEvent("screen_share_started")).toBe(true);
    expect(reportClientEvent("pip_opened")).toBe(true);
    expect(reportClientEvent("RESUME_START", { pwa: true, stage: "start" })).toBe(true);
    await flushClientTelemetry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.events).toHaveLength(4);
    expect(body.events[0].extra || {}).not.toHaveProperty("scene");
    await flushClientTelemetry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds the batch on 429 until Retry-After", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name) => (name === "Retry-After" ? "60" : null) },
    });
    vi.stubGlobal("fetch", fetchMock);
    reportClientEvent("collaboration_connected");
    await flushClientTelemetry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await flushClientTelemetry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("treats Unexpected token '<' as a stale chunk that can recover once", () => {
    expect(isChunkLoadError({ message: "Unexpected token '<'" })).toBe(true);
    expect(reportClientEvent("APP_FATAL_ERROR", { message: "boom" })).toBe(true);
    expect(reportClientEvent("APP_RENDER_ERROR", { route: "/cabinet/meetings/x" })).toBe(true);
    expect(reportClientEvent("MAIN_THREAD_STALL", { delayMs: 8000 })).toBe(true);
    expect(reportClientEvent("JITSI_DUPLICATE", { existing: 1 })).toBe(true);
    expect(reportClientEvent("SW_CONTROLLER_CHANGE")).toBe(true);
  });
});
