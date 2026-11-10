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
    expect(isModuleLoadError({ message: "Importing a module script failed." })).toBe(true);
    expect(isModuleLoadError({ message: "Unable to preload CSS for /assets/board.css" })).toBe(true);
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

  it("retries a resolved module with no default export and then rejects cleanly", async () => {
    vi.useFakeTimers();
    const importer = vi.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ default: undefined })
      .mockResolvedValueOnce(undefined);
    const pending = importWithRetry(importer, { attempts: 3 });
    const captured = pending.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );
    await vi.runAllTimersAsync();
    const result = await captured;
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(TypeError);
    expect(result.error.message).toBe("Importing a module script failed");
    expect(importer).toHaveBeenCalledTimes(3);
  });

  it("resolves after a missing default export is retried", async () => {
    vi.useFakeTimers();
    const module = { default: function Board() {} };
    const importer = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(module);
    const pending = importWithRetry(importer, { attempts: 3 });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe(module);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
