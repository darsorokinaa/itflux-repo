const { test, expect } = require("@playwright/test");
const { skipIfNoSecrets } = require("./helpers/env");
const { skipIosFullRoomPlaywright } = require("./helpers/iosMicPermission");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const { openLessonRoom } = require("./helpers/room");
const {
  ensureBoardOpen,
  currentBoardScope,
  selectFreedraw,
  interactiveCanvas,
  drawShortStrokes,
  drawLongStrokes,
  drawBurst,
  assertUiAlive,
  assertBoardSized,
} = require("./helpers/board");

installErrorCapture(test);

test.describe("TEST 2 — drawing", () => {
  test("open existing board and draw with real pointer strokes", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    test.setTimeout(5 * 60 * 1000);
    await runGuarded(test, async () => {
      await openLessonRoom(page);
      const opened = await ensureBoardOpen(page);
      await assertBoardSized(opened);
      await screenshotNamed(page, testInfo, "board-open");

      const scope = await currentBoardScope(page);
      await selectFreedraw(scope);
      const canvas = await interactiveCanvas(scope);
      await expect(canvas).toBeVisible();

      await drawShortStrokes(page, canvas, 1);
      await drawLongStrokes(page, canvas, 1);
      await drawBurst(page, canvas, 4);

      const live = await currentBoardScope(page);
      await assertUiAlive(page, live);
      await screenshotNamed(page, testInfo, "board-after-drawing");
    }, { page }, testInfo);
  });
});
