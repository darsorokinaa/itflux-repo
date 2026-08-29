import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BOOT_STAGES,
  CHUNK_RECOVER_KEY,
  cabinetHomePath,
  clearChunkRecoveryFlag,
  clearStaleCallOwners,
  isColdStart,
  markAppReady,
  resetTransientSessionState,
} from "./appBoot";

describe("appBoot", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.__ITFLUX_BOOTED = false;
    window.__ITFLUX_BOOT_STAGE = "";
    document.body.innerHTML = '<div id="root"></div>';
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("treats a fresh window as cold start and ignores back_forward as resume", () => {
    expect(isColdStart({ win: { __ITFLUX_BOOTED: false } })).toBe(true);
    expect(isColdStart({
      win: {
        __ITFLUX_BOOTED: false,
        performance: {
          getEntriesByType: () => [{ type: "back_forward" }],
        },
      },
    })).toBe(false);
  });

  it("drops persisted reconnect flags on cold start", () => {
    sessionStorage.setItem("itflux.reconnecting", "true");
    sessionStorage.setItem("itflux.isResuming", "1");
    localStorage.setItem("itflux.loadingRoom", "1");
    localStorage.setItem("itflux-pwa-install-dismissed", "1");
    const removed = resetTransientSessionState({
      session: sessionStorage,
      local: localStorage,
      iosStandalone: false,
    });
    expect(removed).toEqual(expect.arrayContaining([
      "itflux.reconnecting",
      "itflux.isResuming",
      "itflux.loadingRoom",
    ]));
    expect(sessionStorage.getItem("itflux.reconnecting")).toBeNull();
    expect(localStorage.getItem("itflux-pwa-install-dismissed")).toBe("1");
  });

  it("clears stale call-owner keys only on iOS standalone", () => {
    localStorage.setItem("itflux-call-owner:meet-1", "dead-tab");
    resetTransientSessionState({
      session: sessionStorage,
      local: localStorage,
      iosStandalone: false,
    });
    expect(localStorage.getItem("itflux-call-owner:meet-1")).toBe("dead-tab");
    expect(clearStaleCallOwners({ storage: localStorage })).toEqual(["itflux-call-owner:meet-1"]);
    expect(localStorage.getItem("itflux-call-owner:meet-1")).toBeNull();
  });

  it("does not mark READY while #root is empty", () => {
    expect(markAppReady()).toBe(false);
    expect(window.__ITFLUX_BOOTED).toBe(false);
    document.getElementById("root").appendChild(document.createElement("div"));
    expect(markAppReady()).toBe(true);
    expect(window.__ITFLUX_BOOTED).toBe(true);
    expect(window.__ITFLUX_BOOT_STAGE).toBe(BOOT_STAGES.READY);
  });

  it("clears the one-shot chunk flag after a successful paint", () => {
    sessionStorage.setItem(CHUNK_RECOVER_KEY, "1");
    document.getElementById("root").appendChild(document.createElement("div"));
    markAppReady();
    expect(sessionStorage.getItem(CHUNK_RECOVER_KEY)).toBeNull();
    expect(clearChunkRecoveryFlag()).toBe(true);
  });

  it("sends a failed room back to cabinet, not a blank route", () => {
    expect(cabinetHomePath("/cabinet/meetings/abc")).toBe("/cabinet");
    expect(cabinetHomePath("/cabinet/student/lessons")).toBe("/cabinet/student");
  });
});
