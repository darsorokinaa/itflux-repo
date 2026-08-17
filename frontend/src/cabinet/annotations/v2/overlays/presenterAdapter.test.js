import { describe, expect, it } from "vitest";

import { OVERLAY_MODES, isBrowserTabSurface, resolvePresenterOverlayPlan } from "./presenterAdapter";

describe("presenter overlay adapter", () => {
  it("uses platform tab overlay only for captured browser tabs", () => {
    expect(isBrowserTabSurface("browser")).toBe(true);
    expect(isBrowserTabSurface("monitor")).toBe(false);
    const plan = resolvePresenterOverlayPlan({ localSharing: true, displaySurface: "browser" });
    expect(plan.platformTab).toBe(true);
    expect(plan.drawingSurface).toBe(OVERLAY_MODES.PLATFORM_TAB_OVERLAY);
  });

  it("falls back on the web when PiP and native helper are unavailable", () => {
    const plan = resolvePresenterOverlayPlan({ localSharing: true, displaySurface: "monitor" });
    expect(plan.platformTab).toBe(false);
    expect(plan.nativeAvailable).toBe(false);
    expect(plan.toolbar).toBe(plan.pipAvailable ? OVERLAY_MODES.DOCUMENT_PIP_OVERLAY : OVERLAY_MODES.FALLBACK_WEB);
  });

  it("does not claim a native overlay exists in the web app", () => {
    const plan = resolvePresenterOverlayPlan({ localSharing: true, displaySurface: "window" });
    expect(plan.mode).not.toBe(OVERLAY_MODES.NATIVE_DESKTOP_OVERLAY);
  });
});
