const { test } = require("@playwright/test");
const { skipIfNoSecrets } = require("./helpers/env");
const { skipIosFullRoomPlaywright } = require("./helpers/iosMicPermission");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const { openLessonRoom } = require("./helpers/room");
const {
  ensureBoardOpen,
  currentBoardScope,
  interactiveCanvas,
  insertImageViaUi,
  assertImageAppeared,
  assertUiAlive,
} = require("./helpers/board");

installErrorCapture(test);

test.describe("TEST 4 — image", () => {
  test("upload PNG through Excalidraw image tool", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    await runGuarded(test, async () => {
      await openLessonRoom(page);
      await ensureBoardOpen(page);
      const scope = await currentBoardScope(page);
      const canvas = await interactiveCanvas(scope);
      const before = await canvas.screenshot();
      const result = await insertImageViaUi(page, scope, "stroke-sample.png");

      if (!result.ok && result.unsupported) {
        testInfo.annotations.push({
          type: "unsupported-infra-capability",
          description: `BrowserStack real iOS file upload: ${result.reason}`,
        });
        await testInfo.attach("image-unsupported.txt", {
          body: Buffer.from(result.reason || "unsupported"),
          contentType: "text/plain",
        });
      } else {
        await assertImageAppeared(scope, before);
      }

      const live = await currentBoardScope(page);
      await assertUiAlive(page, live);
      await screenshotNamed(page, testInfo, "board-after-image");
    }, { page }, testInfo);
  });
});
