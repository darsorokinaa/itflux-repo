const { test, expect } = require("@playwright/test");
const { skipIfNoSecrets } = require("./helpers/env");
const { skipIosFullRoomPlaywright } = require("./helpers/iosMicPermission");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const { openLessonRoom } = require("./helpers/room");
const { isBrowserStackInfraError } = require("./helpers/locators");

installErrorCapture(test);

test.describe("TEST 8 — error capture", () => {
  test("screenshot + infra vs product error classification", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    await runGuarded(test, async () => {
      await openLessonRoom(page);
      await screenshotNamed(page, testInfo, "08-error-capture-ok");

      const timeout = new Error("page.waitForFunction: Timeout 45000ms exceeded.");
      timeout.name = "TimeoutError";
      expect(isBrowserStackInfraError(timeout)).toBeFalsy();
      expect(isBrowserStackInfraError(new Error("session not created: BrowserStack device is busy"))).toBeTruthy();
      expect(isBrowserStackInfraError(new Error("board canvas has zero size"))).toBeFalsy();
    }, { page }, testInfo);
  });
});
