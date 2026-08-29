/**
 * Unit stand-ins for iPhone PWA resume cases A–I.
 * Device loops A–J need a real Home Screen PWA and cannot run in CI.
 */
import { describe, expect, it } from "vitest";
import {
  RESUME_STATES,
  RESUME_TIMING,
  classifyResumeUi,
  reloadSameOriginRoom,
  shouldRemountBoardWorkspace,
  shouldRemountJitsi,
  shouldVerifyAfterBackground,
} from "./pwaResumeLifecycle";

describe("iPhone PWA resume scenarios (unit)", () => {
  it("A/B: short and 30s background both require verification", () => {
    expect(shouldVerifyAfterBackground(5_000, "visibility")).toBe(true);
    expect(shouldVerifyAfterBackground(30_000, "pageshow")).toBe(true);
  });

  it("C: 2 min background still uses the same recovery path, not a full reload", () => {
    expect(shouldVerifyAfterBackground(120_000, "visibility")).toBe(true);
    expect(classifyResumeUi(RESUME_STATES.RECONNECTING, 2_000).showReload).toBe(false);
  });

  it("D: offline resume shows reconnecting without a fake reconnect button", () => {
    const ui = classifyResumeUi(RESUME_STATES.RECONNECTING, 1_000, false);
    expect(ui.offline).toBe(true);
    expect(ui.phase).toBe("reconnecting");
    expect(ui.showReconnect).toBe(false);
  });

  it("G: timeout surfaces both recovery actions", () => {
    const ui = classifyResumeUi(RESUME_STATES.FAILED, RESUME_TIMING.FAIL_MS);
    expect(ui.phase).toBe("failed");
    expect(ui.showReconnect).toBe(true);
    expect(ui.showReload).toBe(true);
    expect(ui.title).toMatch(/Не удалось восстановить/);
  });

  it("7: BFCache pageshow with unknown hide still starts a health check", () => {
    expect(shouldVerifyAfterBackground(null, "pageshow")).toBe(true);
  });

  it("does not remount Jitsi/board on iPhone PWA resume when instances are live", () => {
    expect(shouldRemountJitsi({
      hasLiveApi: true,
      iframeConnected: true,
    })).toBe(false);
    expect(shouldRemountBoardWorkspace({ frameConnected: true })).toBe(false);
  });

  it("I: room reload stays same-origin and prefers the parent meeting frame", () => {
    const parentReload = () => {};
    const selfReload = () => {};
    const win = {
      location: { origin: "https://itflux-academy.ru", reload: selfReload },
      top: { location: { origin: "https://itflux-academy.ru", reload: parentReload } },
    };
    expect(reloadSameOriginRoom({ win })).toBe("parent");
  });
});
