const { test, expect } = require("@playwright/test");
const { skipIfNoSecrets } = require("./helpers/env");
const { skipIosFullRoomPlaywright } = require("./helpers/iosMicPermission");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const { openLessonRoom } = require("./helpers/room");
const {
  boardIframeSrc,
  createBoardViaUi,
  currentBoardScope,
  selectFreedraw,
  interactiveCanvas,
  pointerStroke,
  assertBoardSized,
  assertUiAlive,
} = require("./helpers/board");

installErrorCapture(test);

test.describe("TEST 9 — create board", () => {
  test("create a new board through materials UI, open it, and draw", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    test.setTimeout(5 * 60 * 1000);
    await runGuarded(test, async () => {
      await openLessonRoom(page);
      const srcBefore = await boardIframeSrc(page).catch(() => null);
      const title = `E2E BrowserStack ${Date.now()}`;
      const scope = await createBoardViaUi(page, title);
      await assertBoardSized(scope);

      const srcAfter = await boardIframeSrc(page);
      expect(srcAfter, "new board iframe src").toBeTruthy();
      expect(srcAfter).toContain("/cabinet/boards/");
      if (srcBefore) {
        expect(srcAfter).not.toBe(srcBefore);
      }

      const live = await currentBoardScope(page);
      await selectFreedraw(live);
      const canvas = await interactiveCanvas(live);
      await pointerStroke(page, canvas, [
        { x: 36, y: 48 },
        { x: 90, y: 80 },
        { x: 140, y: 52 },
      ]);
      await assertUiAlive(page, await currentBoardScope(page));
      await screenshotNamed(page, testInfo, "new-board");
    }, { page }, testInfo);
  });
});
