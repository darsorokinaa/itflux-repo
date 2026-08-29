const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { SELECTORS, isBrowserStackInfraError, isTimeoutLikeError } = require("./helpers/locators");
const {
  isRealIosSafariUserAgent,
  shouldClassifyAsIosNativeMicPermissionLimitation,
  isBrowserStackLimitationError,
  BrowserStackLimitationError,
  iosFullRoomPlaywrightSkipMessage,
} = require("./helpers/iosMicPermission");
const { hasProductionSecrets } = require("./helpers/env");
const { isLoginPath, isLoggedInUrl } = require("./helpers/login");
const { redactUrl, redactText, isMeetingOrJitsiUrl } = require("./helpers/entryDiagnostics");

const assetsDir = path.join(__dirname, "assets");
const helpersDir = path.join(__dirname, "helpers");

test.describe("suite ready", () => {
  test("assets and helpers exist", async () => {
    const png = path.join(assetsDir, "stroke-sample.png");
    const jpg = path.join(assetsDir, "photo-sample.jpg");
    const png2 = path.join(assetsDir, "diagram-sample.png");
    expect(fs.existsSync(png)).toBeTruthy();
    expect(fs.existsSync(jpg)).toBeTruthy();
    expect(fs.existsSync(png2)).toBeTruthy();
    expect(fs.statSync(png).size).toBeGreaterThan(50);
    expect(fs.statSync(jpg).size).toBeGreaterThan(50);

    for (const name of ["locators.js", "env.js", "login.js", "room.js", "board.js", "capture.js", "entryDiagnostics.js", "iosMicPermission.js"]) {
      expect(fs.existsSync(path.join(helpersDir, name))).toBeTruthy();
    }

    const specsDir = __dirname;
    for (const name of [
      "01-ios-permission-diagnostic.spec.js",
      "01-basic-room.spec.js",
      "02-drawing.spec.js",
      "03-text.spec.js",
      "04-image.spec.js",
      "06-responsive.spec.js",
      "07-tab-cycles.spec.js",
      "09-create-board.spec.js",
    ]) {
      expect(fs.existsSync(path.join(specsDir, name))).toBeTruthy();
    }
    expect(fs.existsSync(path.join(__dirname, "..", "selenium-ios", "run.js"))).toBeTruthy();
    expect(fs.existsSync(path.join(__dirname, "..", "selenium-ios", "tests", "01-room-flow.js"))).toBeTruthy();
  });

  test("locators match production source contracts", async () => {
    expect(SELECTORS.loginPath).toBe("/cabinet/login");
    expect(SELECTORS.jitsiContainer).toBe("#jitsi-container");
    expect(SELECTORS.boardHost).toBe(".cb-board-excalidraw-host");
    expect(SELECTORS.excalidrawCanvas).toBe("canvas.excalidraw__canvas");
    expect(SELECTORS.toolFreedraw).toBe("toolbar-freedraw");
    expect(SELECTORS.toolText).toBe("toolbar-text");
    expect(SELECTORS.toolImage).toBe("toolbar-image");
    expect(SELECTORS.boardIframeSrc).toContain("/cabinet/boards/");
    expect(SELECTORS.boardSyncDebugKey).toBe("itflux_board_sync_debug");
    expect(SELECTORS.tabCall.name).toBe("Звонок");
    expect(SELECTORS.tabMaterials.name).toBe("Материалы");
    expect(SELECTORS.cameraWithout.name).toBe("Без камеры");
    expect(SELECTORS.cameraPromptTitle).toBe("Включить камеру?");
    expect(SELECTORS.boardOpenButton.name).toBe("Открыть");
    expect(SELECTORS.boardCreateModalTitle).toBe("Создать доску");
    expect(SELECTORS.boardCreateTitleField).toBe("Название доски");
    expect(SELECTORS.logout.name).toBe("Выйти");
    expect(SELECTORS.openMenu.name).toBe("Открыть меню");
  });

  test("production secrets are documented, not required for this spec", async () => {
    expect(typeof hasProductionSecrets()).toBe("boolean");
  });

  test("login success is leaving /cabinet/login", async () => {
    expect(isLoginPath("/cabinet/login")).toBeTruthy();
    expect(isLoginPath("/cabinet/login/")).toBeTruthy();
    expect(isLoggedInUrl("https://example.test/cabinet")).toBeTruthy();
    expect(isLoggedInUrl("https://example.test/cabinet/student")).toBeTruthy();
    expect(isLoggedInUrl("https://example.test/cabinet/meetings/abc")).toBeTruthy();
    expect(isLoggedInUrl("https://example.test/cabinet/login")).toBeFalsy();
  });

  test("timeouts are product failures, not BrowserStack infra", async () => {
    const waitForFunctionTimeout = new Error("page.waitForFunction: Timeout 45000ms exceeded.");
    waitForFunctionTimeout.name = "TimeoutError";
    const locatorTimeout = new Error("locator.click: Timeout 30000ms exceeded.");
    locatorTimeout.name = "TimeoutError";
    const navTimeout = new Error("page.goto: Timeout 90000ms exceeded.");
    navTimeout.name = "TimeoutError";

    expect(isTimeoutLikeError(waitForFunctionTimeout)).toBeTruthy();
    expect(isBrowserStackInfraError(waitForFunctionTimeout)).toBeFalsy();
    expect(isBrowserStackInfraError(locatorTimeout)).toBeFalsy();
    expect(isBrowserStackInfraError(navTimeout)).toBeFalsy();
    expect(isBrowserStackInfraError(new Error("board canvas has zero size"))).toBeFalsy();

    expect(isBrowserStackInfraError(new Error("session not created: BrowserStack device is busy"))).toBeTruthy();
    expect(isBrowserStackInfraError(new Error("Could not start a new session"))).toBeTruthy();
    expect(isBrowserStackInfraError(new Error("unsupported device"))).toBeTruthy();
    expect(isBrowserStackInfraError(new Error("remote device is unavailable"))).toBeTruthy();

    const stale = new Error("expect(locator).toBeVisible() Element not found or stale");
    expect(isTimeoutLikeError(stale)).toBeTruthy();
    expect(isBrowserStackInfraError(stale)).toBeFalsy();
    expect(isBrowserStackInfraError(new Error("locator('.cb-board-excalidraw-host') Element not found or stale"))).toBeFalsy();
  });

  test("iOS native microphone Allow is a BrowserStack Playwright limitation", async () => {
    expect(isRealIosSafariUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBeTruthy();
    expect(isRealIosSafariUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")).toBeFalsy();

    expect(shouldClassifyAsIosNativeMicPermissionLimitation({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      jitsiIframeCount: 1,
      joinErrorVisible: true,
      reachedLive: false,
    })).toBeTruthy();

    expect(shouldClassifyAsIosNativeMicPermissionLimitation({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      jitsiIframeCount: 0,
      joinErrorVisible: true,
      reachedLive: false,
    })).toBeFalsy();

    expect(shouldClassifyAsIosNativeMicPermissionLimitation({
      projectName: "safari@iPhone 14:18@browserstack-mobile",
      jitsiIframeCount: 1,
      reachedLive: false,
    })).toBeTruthy();

    expect(shouldClassifyAsIosNativeMicPermissionLimitation({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      jitsiIframeCount: 1,
      reachedLive: true,
    })).toBeFalsy();

    const limitation = new BrowserStackLimitationError("BROWSERSTACK AUTOMATION LIMITATION");
    expect(isBrowserStackLimitationError(limitation)).toBeTruthy();
    expect(isBrowserStackInfraError(limitation)).toBeFalsy();
    expect(isTimeoutLikeError(limitation)).toBeFalsy();
    expect(iosFullRoomPlaywrightSkipMessage()).toMatch(/test:browserstack:ios-selenium/);
  });

  test("entry diagnostics redact jwt and classify meeting/jitsi urls", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb";
    const redacted = redactUrl(`https://meet.example/room?jwt=${jwt}`);
    expect(redacted).not.toContain(jwt);
    expect(redacted.toLowerCase()).toMatch(/redacted/);
    expect(redactText(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
    expect(isMeetingOrJitsiUrl("https://app.test/api/video-meetings/abc/join-config/")).toBeTruthy();
    expect(isMeetingOrJitsiUrl("https://jitsi.example/external_api.js")).toBeTruthy();
    expect(isMeetingOrJitsiUrl("https://cdn.example/app.js")).toBeFalsy();
  });
});
