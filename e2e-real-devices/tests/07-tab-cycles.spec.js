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
  assertAfterPaneChange,
} = require("./helpers/room");
const {
  ensureBoardOpen,
  currentBoardScope,
  assertBoardSized,
  assertBoardNotZeroIfPresent,
  assertUiAlive,
  selectFreedraw,
  interactiveCanvas,
  pointerStroke,
  assertPipDoesNotCoverCriticalControls,
} = require("./helpers/board");
const { SELECTORS } = require("./helpers/locators");

installErrorCapture(test);

test.describe("TEST 7 — tab cycles", () => {
  test("board → call → materials → open board, several times, with fresh locators", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    test.setTimeout(8 * 60 * 1000);
    await runGuarded(test, async () => {
      await openLessonRoom(page);
      await ensureBoardOpen(page);

      const cycles = 3;
      for (let i = 0; i < cycles; i += 1) {
        let scope = await currentBoardScope(page);
        await assertBoardSized(scope);
        await assertAfterPaneChange(page, { expectBoard: true });
        await assertBoardNotZeroIfPresent(page);
        await assertPipDoesNotCoverCriticalControls(page);

        await switchToCall(page);
        await assertAfterPaneChange(page);
        await expect(page.locator(SELECTORS.roomRoot)).toBeVisible();
        expect(await jitsiIframeCount(page)).toBeLessThanOrEqual(1);

        await switchToMaterials(page);
        await assertAfterPaneChange(page);
        await expect(page.getByRole("complementary", { name: SELECTORS.materialsAside.name })).toBeVisible();
        await assertNoHorizontalOverflow(page);

        scope = await ensureBoardOpen(page);
        await assertBoardSized(scope);
        await assertAfterPaneChange(page, { expectBoard: true });
        await assertBoardNotZeroIfPresent(page);
        expect(await jitsiIframeCount(page)).toBeLessThanOrEqual(1);

        await switchToCall(page);
        await assertAfterPaneChange(page);

        await switchToMaterials(page);
        await assertAfterPaneChange(page);

        scope = await ensureBoardOpen(page);
        await selectFreedraw(scope);
        const canvas = await interactiveCanvas(scope);
        await pointerStroke(page, canvas, [
          { x: 30 + i * 8, y: 40 },
          { x: 70 + i * 8, y: 70 },
        ]);
        await assertUiAlive(page, await currentBoardScope(page));
        await assertPipDoesNotCoverCriticalControls(page);
      }

      await screenshotNamed(page, testInfo, "after-tab-cycle");
    }, { page }, testInfo);
  });
});
