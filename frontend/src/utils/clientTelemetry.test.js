import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushClientTelemetry,
  isChunkLoadError,
  preloadChunkConfirmed,
  preloadTargetUrl,
  recoverChunkLoadOnce,
  reportClientEvent,
  startClientTelemetry,
} from "./clientTelemetry";

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
    try {
      delete window.top;
    } catch {
      /* top stays on the prototype */
    }
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
      pathname: "/cabinet",
      replace,
    });
    expect(recoverChunkLoadOnce()).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0][0])).toContain("_itflux_v=");
    expect(recoverChunkLoadOnce()).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("does not hard-reload a board iframe inside a meeting", () => {
    const reload = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace,
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: { location: { pathname: "/lesson/join" } },
    });
    expect(recoverChunkLoadOnce()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("itflux.chunk-recover")).toBeNull();
  });

  it("does not hard-reload a live meeting after a chunk error", async () => {
    const replace = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/meetings/abc",
      pathname: "/cabinet/meetings/abc",
      replace,
      reload,
    });
    expect(recoverChunkLoadOnce()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("itflux.chunk-recover")).toBeNull();
    await flushClientTelemetry({ beacon: true });
    const payload = await navigator.sendBeacon.mock.calls.at(-1)[1].text();
    expect(payload).toContain("CHUNK_RECOVERY_BLOCKED_LIVE_SESSION");
    expect(recoverChunkLoadOnce()).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it("treats Safari Load failed as a missing module", () => {
    expect(isChunkLoadError({ name: "TypeError", message: "Load failed" })).toBe(false); // r34: bare Load failed is any fetch
    expect(isChunkLoadError({ name: "Error", message: "Load failed" })).toBe(false);
    expect(isChunkLoadError({ message: "Importing a module script failed." })).toBe(true);
    expect(isChunkLoadError({ message: "Unable to preload CSS for https://itflux.test/assets/a.css" })).toBe(true);
  });

  it("reloads a top-level board tab once and never a lesson join page", () => {
    const reload = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace,
    });
    expect(recoverChunkLoadOnce()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(recoverChunkLoadOnce()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    sessionStorage.clear();
    reload.mockClear();
    vi.stubGlobal("location", {
      href: "https://itflux.test/lesson/join",
      pathname: "/lesson/join",
      reload,
      replace,
    });
    expect(recoverChunkLoadOnce()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("itflux.chunk-recover")).toBeNull();
  });

  it("confirms a WebKit preload error with no URL only on a board tab", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace: vi.fn(),
    });
    const event = { payload: { message: "Importing a module script failed." } };
    expect(preloadTargetUrl(event)).toBe("");
    await expect(preloadChunkConfirmed(event)).resolves.toBe(true);

    const withUrl = {
      payload: {
        message: "Importing a module script failed.",
        url: "https://itflux.test/assets/Board-abc.js",
      },
    };
    expect(preloadTargetUrl(withUrl)).toBe("https://itflux.test/assets/Board-abc.js");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 404,
      headers: { get: () => "text/html" },
    }));
    await expect(preloadChunkConfirmed(withUrl)).resolves.toBe(true);

    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet",
      pathname: "/cabinet",
      reload,
      replace: vi.fn(),
    });
    await expect(preloadChunkConfirmed(event)).resolves.toBe(false);
  });

  it("recovers a board tab when vite:preloadError has no URL", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", {
      href: "https://itflux.test/cabinet/boards/board-1",
      pathname: "/cabinet/boards/board-1",
      reload,
      replace: vi.fn(),
    });
    const stop = startClientTelemetry();
    const event = new Event("vite:preloadError", { cancelable: true });
    event.payload = new TypeError("Importing a module script failed.");
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    stop();
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

describe("isOpaqueCrossOriginScriptError (r92)", () => {
  it("flags only detail-less cross-origin Script error events", async () => {
    const { isOpaqueCrossOriginScriptError } = await import("./clientTelemetry");
    expect(isOpaqueCrossOriginScriptError({ message: "Script error.", filename: "", lineno: 0, error: null })).toBe(true);
    expect(isOpaqueCrossOriginScriptError({ message: "Script error.", filename: "https://itflux-academy.ru/assets/a.js", lineno: 3 })).toBe(false);
    expect(isOpaqueCrossOriginScriptError({ message: "boom", error: new Error("boom") })).toBe(false);
    expect(isOpaqueCrossOriginScriptError(null)).toBe(false);
  });
});
