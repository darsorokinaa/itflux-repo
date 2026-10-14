/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("boot trace", () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.__itfluxBootMark;
    delete window.__ITFLUX_BOOT_LOG;
    delete window.__ITFLUX_BOOT_SEEN;
    delete window.__ITFLUX_API_PROBE;
    delete window.__ITFLUX_API_MARKED;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.__ITFLUX_API_PROBE;
    delete window.__ITFLUX_API_MARKED;
  });

  it("records one relative timestamp and does not repeat a stage", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { markBoot } = await import("./bootTrace.js");
    markBoot("html");
    markBoot("html");
    expect(window.__ITFLUX_BOOT_LOG).toEqual([
      expect.objectContaining({ stage: "html", t: expect.any(Number) }),
    ]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toMatch(/\[ITFLUX_BOOT\] \+\d+ms html — HTML загружен/);
    expect(String(info.mock.calls[0][0])).not.toMatch(/token|cookie|password/i);
  });

  it("marks the first API result without the address or body", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const payload = { access: "secret-token", email: "a@b.c" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetchMock);
    const { installFirstApiProbe } = await import("./bootTrace.js");
    installFirstApiProbe();
    const response = await window.fetch("/api/cabinet/me/?token=secret", {
      body: JSON.stringify(payload),
    });
    await response.json();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const lines = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).toMatch(/api_ok — первый API-запрос завершился/);
    expect(lines).not.toContain("secret");
    expect(lines).not.toContain("/api/cabinet");
    expect(lines).not.toContain("a@b.c");
  });

  it("marks auth success and failure once", async () => {
    document.cookie = "csrftoken=csrf-value";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, user: { email: "a@b.c" } }),
        headers: { get: () => null },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: "fail", token: "hidden" }),
        headers: { get: () => null },
      });
    vi.stubGlobal("fetch", fetchMock);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { fetchCabinetSession } = await import("./cabinetAuth.js");
    const session = await fetchCabinetSession();
    expect(session.authenticated).toBe(true);
    await expect(fetchCabinetSession({ fresh: true })).rejects.toThrow();
    const lines = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).toContain("auth_start");
    expect(lines).toContain("auth_ok");
    expect(lines).not.toContain("auth_error");
    expect(lines).not.toContain("csrf-value");
    expect(lines).not.toContain("a@b.c");
    expect(lines).not.toContain("hidden");
  });
});
