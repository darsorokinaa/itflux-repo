import { describe, expect, it } from "vitest";
import { isEmbeddedWindow, shouldShowCookieBanner } from "./cookieBanner";

describe("shouldShowCookieBanner (r73)", () => {
  it("shows on a regular page until accepted", () => {
    expect(shouldShowCookieBanner({})).toBe(true);
    expect(shouldShowCookieBanner({ cookieAccepted: true })).toBe(false);
  });

  it("never covers the lesson room (iframe with the variant and its finish button)", () => {
    expect(shouldShowCookieBanner({ isVideoMeetingPage: true })).toBe(false);
    expect(shouldShowCookieBanner({ isBoardEditorPage: true })).toBe(false);
  });

  it("is hidden inside any iframe and in lesson/homework contexts", () => {
    expect(shouldShowCookieBanner({ inIframe: true })).toBe(false);
    expect(shouldShowCookieBanner({ isLessonOrHomeworkContext: true })).toBe(false);
    expect(shouldShowCookieBanner({ isChromelessPage: true })).toBe(false);
  });
});

describe("isEmbeddedWindow", () => {
  it("detects top window vs iframe", () => {
    const top = {};
    top.self = top;
    top.top = top;
    expect(isEmbeddedWindow(top)).toBe(false);
    expect(isEmbeddedWindow({ self: {}, top: {} })).toBe(true);
  });

  it("treats a cross-origin parent as embedded", () => {
    const win = {};
    Object.defineProperty(win, "top", { get() { throw new Error("blocked"); } });
    win.self = win;
    expect(isEmbeddedWindow(win)).toBe(true);
  });
});

describe("cookie banner CSS on the variant page (r73)", () => {
  it("stays under the tasks sheet and hides while it is open", async () => {
    const { readFileSync } = await import("node:fs");
    const { cwd } = await import("node:process");
    const css = readFileSync(`${cwd()}/src/styles/styles.css`, "utf8");
    expect(css).toMatch(/body:has\(#main-wrapper\.exam-page--edu\) \.cookie-banner \{\s*z-index: 600;/);
    expect(css).toMatch(/body:has\(\.mobile-panel-backdrop\) \.cookie-banner,\s*body:has\(\.mobile-panel-backdrop\) \.support-fab,\s*body:has\(\.mobile-panel-backdrop\) \.seasonal-appearance-fab-dock \{\s*display: none;/);
    expect(css).toMatch(/body:has\(#main-wrapper\.exam-page--edu\) \.seasonal-appearance-fab-dock \{\s*right: auto;\s*left: 16px;/);
  });
});

describe("app update banner CSS on the variant page (r73)", () => {
  it("moves to the top and hides while the tasks sheet is open", async () => {
    const { readFileSync } = await import("node:fs");
    const { cwd } = await import("node:process");
    const css = readFileSync(`${cwd()}/src/components/AppUpdateBanner.css`, "utf8");
    expect(css).toMatch(/body:has\(#main-wrapper\.exam-page--edu\) \.itflux-update-banner-stack \{[^}]*bottom: auto;/);
    expect(css).toMatch(/body:has\(\.mobile-panel-backdrop\) \.itflux-update-banner-stack \{\s*display: none;/);
  });
});
