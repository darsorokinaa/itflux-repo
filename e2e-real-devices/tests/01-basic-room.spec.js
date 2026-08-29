const { test, expect } = require("@playwright/test");
const { skipIfNoSecrets } = require("./helpers/env");
const { skipIosFullRoomPlaywright } = require("./helpers/iosMicPermission");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const {
  openLessonRoom,
  switchToCall,
  switchToMaterials,
  assertMaterialsPanelUsable,
  jitsiIframeCount,
  assertNoHorizontalOverflow,
  cameraPrompt,
  callTab,
} = require("./helpers/room");
const { SELECTORS } = require("./helpers/locators");
const { assertLessonRoomTopLevelOrigin } = require("../helpers/lessonRoomOrigin");

installErrorCapture(test);

test.describe("TEST 1 — basic room", () => {
  test("entry, camera bypass, call, materials, layout — no board hunt before room is live", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    await runGuarded(test, async () => {
      await openLessonRoom(page);
      assertLessonRoomTopLevelOrigin(page.url());
      await expect(page.locator(SELECTORS.roomRoot)).toBeVisible();
      await expect(page.getByLabel(SELECTORS.passwordField)).toHaveCount(0);
      await expect(cameraPrompt(page)).toBeHidden();
      await screenshotNamed(page, testInfo, "room-after-entry");

      const call = callTab(page);
      if (await call.isVisible().catch(() => false)) {
        await expect(call).toBeEnabled();
        await switchToCall(page);
      } else {
        await expect(
          page.locator(SELECTORS.jitsiContainer).or(page.locator(SELECTORS.callMain)),
        ).toBeVisible({ timeout: 20_000 });
        await switchToCall(page);
      }
      expect(await jitsiIframeCount(page)).toBeLessThanOrEqual(1);
      await screenshotNamed(page, testInfo, "call-tab");

      await switchToMaterials(page);
      await assertMaterialsPanelUsable(page);
      await screenshotNamed(page, testInfo, "materials-tab");

      await switchToCall(page);
      expect(await jitsiIframeCount(page)).toBeLessThanOrEqual(1);
      await expect(page.locator(SELECTORS.roomRoot)).toBeVisible();
      assertLessonRoomTopLevelOrigin(page.url());

      await assertNoHorizontalOverflow(page);
    }, { page }, testInfo);
  });
});
