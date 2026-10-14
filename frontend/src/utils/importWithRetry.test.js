/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import { importWithRetry, isModuleLoadError } from "./importWithRetry";

afterEach(() => {
  vi.useRealTimers();
});

describe("importWithRetry", () => {
  it("treats Safari Load failed as a module load error", () => {
    expect(isModuleLoadError({ name: "TypeError", message: "Load failed" })).toBe(true);
    expect(isModuleLoadError({ name: "TypeError", message: "Failed to fetch dynamically imported module" })).toBe(true);
    expect(isModuleLoadError({ name: "Error", message: "Load failed" })).toBe(false);
  });

  it("retries a failed import and does not leave the first rejection unhandled", async () => {
    vi.useFakeTimers();
    const module = { default: function Board() {} };
    const importer = vi.fn()
      .mockRejectedValueOnce(Object.assign(new TypeError("Load failed"), { name: "TypeError" }))
      .mockResolvedValueOnce(module);
    const pending = importWithRetry(importer, { attempts: 3 });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
