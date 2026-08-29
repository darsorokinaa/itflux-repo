const { test, expect } = require("@playwright/test");
const { skipIfNoSecrets, requiredSecrets } = require("./helpers/env");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const { loginIfNeeded, enableBoardSyncDebug } = require("./helpers/login");
const {
  installEntryDiagnostics,
  screenshotEntry,
} = require("./helpers/entryDiagnostics");
const {
  startLessonIfWaiting,
  cameraWithoutButton,
  cameraPrompt,
  stopPlaywrightIosAtNativeMic,
} = require("./helpers/room");
const { SELECTORS } = require("./helpers/locators");
const {
  BrowserStackLimitationError,
  isBrowserStackIosProject,
  isRealIosSafariUserAgent,
} = require("./helpers/iosMicPermission");

installErrorCapture(test);

test.describe("PLAYWRIGHT iOS — diagnostic up to native microphone permission", () => {
  test("login, Без камеры, stop at Safari Allow sheet (do not wait for join)", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    const uaEarly = await page.evaluate(() => navigator.userAgent).catch(() => "");
    const ios = isBrowserStackIosProject(testInfo) || isRealIosSafariUserAgent(uaEarly);
    test.skip(!ios, "Playwright native-mic diagnostic is for real iOS Safari only");

    await runGuarded(test, async () => {
      await loginIfNeeded(page);
      await enableBoardSyncDebug(page);
      installEntryDiagnostics(page, testInfo);
      await page.goto(requiredSecrets().lessonRoomUrl, { waitUntil: "domcontentloaded" });
      await expect(page.locator(SELECTORS.roomRoot)).toBeVisible({ timeout: 60_000 });
      await startLessonIfWaiting(page);

      const without = cameraWithoutButton(page);
      if (await without.isVisible().catch(() => false)) {
        await screenshotNamed(page, testInfo, "before-camera-choice");
        await without.click();
        await expect(cameraPrompt(page)).toBeHidden({ timeout: 30_000 });
      }

      await screenshotNamed(page, testInfo, "after-no-camera-native-mic");
      await screenshotEntry(page, testInfo, "after-no-camera-native-mic");
      await page.locator(SELECTORS.jitsiIframe).first()
        .waitFor({ state: "attached", timeout: 15_000 })
        .catch(() => {});
      await screenshotNamed(page, testInfo, "native-mic-stage");

      await stopPlaywrightIosAtNativeMic(page, { diagnostic: true });
      throw new BrowserStackLimitationError(
        "Playwright iOS stopped at native microphone permission. Use npm run test:browserstack:ios-selenium",
      );
    }, { page }, testInfo);
  });
});
