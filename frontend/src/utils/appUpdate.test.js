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
