/** @vitest-environment jsdom */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE = fs.readFileSync(path.resolve("public/boot-watchdog.js"), "utf8");

function boot() {
  delete window.__ITFLUX_WATCHDOG__;
  window.__itfluxBootMark = vi.fn();
  window.eval(SOURCE);
}

describe("boot watchdog", () => {
  let replace;
  let getRegistrations;
  let unregister;
  let cacheDelete;

  function useLocation(pathname, search = "") {
    const href = `https://itflux.test${pathname}${search ? `?${search.replace(/^\?/, "")}` : ""}`;
    vi.stubGlobal("location", {
      pathname,
      search: search ? (search.startsWith("?") ? search : `?${search}`) : "",
      href,
      hostname: "itflux.test",
      origin: "https://itflux.test",
      replace,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    replace = vi.fn();
    useLocation("/");
    unregister = vi.fn().mockResolvedValue(true);
    getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    cacheDelete = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations },
    });
    window.caches = {
      keys: vi.fn().mockResolvedValue(["itflux"]),
      delete: cacheDelete,
    };
    Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    delete window.__ITFLUX_WATCHDOG__;
    delete window.__itfluxBootMark;
    delete window.caches;
  });

  it("does not clear the service worker or reload when the timer expires", async () => {
    useLocation("/cabinet");
    boot();
    await vi.advanceTimersByTimeAsync(21000);
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(document.getElementById("itflux-boot-reload")).toBeTruthy();
    expect(window.__itfluxBootMark).toHaveBeenCalledWith("watchdog_hang");
  });

  it("does not recover again on its own after a previous recovery", async () => {
    useLocation("/cabinet", "_recover=1");
    boot();
    await vi.advanceTimersByTimeAsync(23000);
    await vi.advanceTimersByTimeAsync(23000);
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps waiting while the document is still loading, then offers a manual reload", async () => {
    Object.defineProperty(document, "readyState", { configurable: true, value: "loading" });
    useLocation("/");
    boot();
    await vi.advanceTimersByTimeAsync(21000);
    expect(document.body.textContent).toContain("Загружаем кабинет");
    expect(getRegistrations).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(12000);
    expect(document.getElementById("itflux-boot-reload")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not reload an open meeting or lesson board by itself", async () => {
    useLocation("/cabinet/meetings/abc");
    boot();
    await vi.advanceTimersByTimeAsync(21000);
    expect(replace).not.toHaveBeenCalled();
    delete window.__ITFLUX_WATCHDOG__;
    useLocation("/cabinet/boards/board-1");
    boot();
    await vi.advanceTimersByTimeAsync(21000);
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("still clears caches and reloads when the user asks", async () => {
    useLocation("/cabinet");
    boot();
    await vi.advanceTimersByTimeAsync(21000);
    document.getElementById("itflux-boot-reload").click();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(unregister).toHaveBeenCalled();
    expect(cacheDelete).toHaveBeenCalledWith("itflux");
    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0][0])).toContain("_recover=");
  });

  it("reloads a manual recovery even if the service worker promise never settles", async () => {
    getRegistrations.mockReturnValue(new Promise(() => {}));
    useLocation("/cabinet");
    boot();
    await vi.advanceTimersByTimeAsync(21000);
    document.getElementById("itflux-boot-reload").click();
    await vi.advanceTimersByTimeAsync(2000);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("stays quiet once the application has painted", async () => {
    document.getElementById("root").appendChild(document.createElement("main"));
    boot();
    await vi.advanceTimersByTimeAsync(40000);
    expect(document.getElementById("itflux-boot-recover")).toBeNull();
    expect(window.__itfluxBootMark).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
