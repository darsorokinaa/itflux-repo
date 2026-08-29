const { test, expect } = require("@playwright/test");
const { skipIfNoSecrets } = require("./helpers/env");
const { skipIosFullRoomPlaywright } = require("./helpers/iosMicPermission");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const {
  openLessonRoom,
  switchToCall,
  switchToMaterials,
  jitsiIframeCount,
  assertNoHorizontalOverflow,
  callTab,
  materialsTab,
} = require("./helpers/room");
const {
  ensureBoardOpen,
  currentBoardScope,
  assertBoardSized,
  assertControlsInViewport,
  assertPipDoesNotCoverCanvas,
  assertPipDoesNotCoverCriticalControls,
  interactiveCanvas,
} = require("./helpers/board");
const { SELECTORS } = require("./helpers/locators");

installErrorCapture(test);

test.describe("TEST 6 — responsive / usability", () => {
  test("overflow, sizes, controls, PiP, single Jitsi", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    await runGuarded(test, async () => {
      await openLessonRoom(page);
      await assertNoHorizontalOverflow(page);

      await switchToCall(page);
      expect(await jitsiIframeCount(page)).toBeLessThanOrEqual(1);

      await switchToMaterials(page);
      await assertNoHorizontalOverflow(page);

      await ensureBoardOpen(page);
      const scope = await currentBoardScope(page);
      const sizes = await assertBoardSized(scope);
      expect(sizes.host.width).toBeGreaterThan(0);
      expect(sizes.host.height).toBeGreaterThan(0);

      await assertControlsInViewport(page, [
        [callTab(page), "tab Звонок"],
        [materialsTab(page), "tab Материалы"],
        [page.getByRole("button", { name: SELECTORS.headerMaterials.name }), "header Материалы"],
        [page.getByRole("button", { name: SELECTORS.fullscreen.name }), "fullscreen"],
        [scope.getByTestId(SELECTORS.toolFreedraw), "freedraw"],
        [scope.getByTestId(SELECTORS.toolText), "text"],
        [scope.getByRole("button", { name: SELECTORS.canvasSettings.name }), "canvas settings"],
      ]);

      await assertPipDoesNotCoverCanvas(page, scope);
      await assertPipDoesNotCoverCriticalControls(page);

      expect(await jitsiIframeCount(page)).toBeLessThanOrEqual(1);

      const canvas = await interactiveCanvas(scope);
      await canvas.click({ position: { x: 24, y: 24 } });
      const canvasBox = await canvas.boundingBox();
      expect(canvasBox.width).toBeGreaterThan(0);
      expect(canvasBox.height).toBeGreaterThan(0);

      await screenshotNamed(page, testInfo, "06-responsive");
    }, { page }, testInfo);
  });
});
