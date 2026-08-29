const { test } = require("@playwright/test");
const { skipIfNoSecrets } = require("./helpers/env");
const { skipIosFullRoomPlaywright } = require("./helpers/iosMicPermission");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const { openLessonRoom } = require("./helpers/room");
const {
  ensureBoardOpen,
  currentBoardScope,
  typeOnCanvas,
  assertUiAlive,
} = require("./helpers/board");

installErrorCapture(test);

test.describe("TEST 3 — text", () => {
  test("insert text through Excalidraw UI", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    await runGuarded(test, async () => {
      await openLessonRoom(page);
      await ensureBoardOpen(page);
      const scope = await currentBoardScope(page);
      await typeOnCanvas(page, scope, "BrowserStack iPhone test");
      const live = await currentBoardScope(page);
      await assertUiAlive(page, live);
      await screenshotNamed(page, testInfo, "board-after-text");
    }, { page }, testInfo);
  });
});
