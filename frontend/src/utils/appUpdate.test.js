import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("appUpdateGuard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("blocks meeting and assignment detail paths", async () => {
    const { isAppUpdateUnsafe, registerAppUpdateBlocker } = await import("./appUpdateGuard.js");
    window.history.pushState({}, "", "/cabinet/meetings/abc");
    expect(isAppUpdateUnsafe()).toBe(true);
    window.history.pushState({}, "", "/cabinet/student/assignments/12");
    expect(isAppUpdateUnsafe()).toBe(true);
    window.history.pushState({}, "", "/cabinet/students");
    expect(isAppUpdateUnsafe()).toBe(false);
    const unregister = registerAppUpdateBlocker(() => true);
    expect(isAppUpdateUnsafe()).toBe(true);
    unregister();
    expect(isAppUpdateUnsafe()).toBe(false);
  });
});

describe("appVersion schema migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("removes legacy interactives key once", async () => {
    localStorage.setItem("cabinet-interactives-v1", "[]");
    const { migrateClientDataSchema, DATA_SCHEMA_VERSION } = await import("./appVersion.js");
    migrateClientDataSchema();
    expect(localStorage.getItem("cabinet-interactives-v1")).toBeNull();
    expect(localStorage.getItem("itflux.data-schema-version")).toBe(String(DATA_SCHEMA_VERSION));
    localStorage.setItem("cabinet-interactives-v1", "again");
    migrateClientDataSchema();
    // already at schema version — do not wipe again
    expect(localStorage.getItem("cabinet-interactives-v1")).toBe("again");
  });
});

describe("live session hard reload", () => {
  let replace;
  let reload;

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    replace = vi.fn();
    reload = vi.fn();
    window.__APP_VERSION__ = "1.0.0";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: "2.0.0" }),
      headers: { get: () => null },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__APP_VERSION__;
    sessionStorage.clear();
  });

  function stubLocation(pathname) {
    vi.stubGlobal("location", {
      pathname,
      href: `https://itflux.test${pathname}`,
      origin: "https://itflux.test",
      replace,
      reload,
    });
  }

  it("does not reload a meeting for an app update, even when forced by recovery", async () => {
    stubLocation("/cabinet/meetings/abc");
    const { applyAppUpdate } = await import("./appUpdate.js");
    expect(applyAppUpdate({
      force: true,
      reason: "sw-controllerchange",
      source: "appUpdate.onControllerChange",
    })).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("itflux.reload-for-version")).toBeNull();
  });

  it("does not reload a meeting when the service worker controller changes", async () => {
    stubLocation("/cabinet/meetings/abc");
    const listeners = new Map();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: (type) => listeners.delete(type),
        getRegistration: vi.fn().mockResolvedValue(null),
        getRegistrations: vi.fn().mockResolvedValue([]),
        controller: { scriptURL: "/sw.js" },
      },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const { startAppUpdateMonitor } = await import("./appUpdate.js");
    const stop = startAppUpdateMonitor();
    await Promise.resolve();
    await Promise.resolve();
    listeners.get("controllerchange")?.();
    await Promise.resolve();
    await Promise.resolve();
    listeners.get("message")?.({ data: { type: "ITFLUX_SW_ACTIVATED", version: "2.0.0" } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(replace).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it("still reloads a normal cabinet page, and a manual meeting reload still works", async () => {
    stubLocation("/cabinet");
    const { applyAppUpdate, markUpdateFromClientRequired } = await import("./appUpdate.js");
    markUpdateFromClientRequired("2.0.0");
    expect(applyAppUpdate({ reason: "poll", source: "appUpdate.poll" })).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);

    replace.mockClear();
    stubLocation("/cabinet/meetings/abc");
    expect(applyAppUpdate({
      force: true,
      manual: true,
      reason: "user-banner",
      source: "AppUpdateBanner",
    })).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
