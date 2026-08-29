const { test } = require("@playwright/test");
const { skipIfNoSecrets, testMinutes } = require("./helpers/env");
const { skipIosFullRoomPlaywright } = require("./helpers/iosMicPermission");
const { installErrorCapture, runGuarded, screenshotNamed } = require("./helpers/capture");
const { openLessonRoom, jitsiIframeCount } = require("./helpers/room");
const {
  ensureBoardOpen,
  currentBoardScope,
  selectFreedraw,
  interactiveCanvas,
  drawShortStrokes,
  drawBurst,
  typeOnCanvas,
  insertImageViaUi,
  assertUiAlive,
  sleep,
} = require("./helpers/board");

installErrorCapture(test);

function checkpointsFor(minutes) {
  return [0, 10, 20, 30, 45, 60].filter((m) => m <= minutes);
}

function randBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function keepalive(page, ms) {
  const slice = 15_000;
  let remaining = ms;
  while (remaining > 0) {
    const wait = Math.min(slice, remaining);
    await sleep(wait);
    remaining -= wait;
    await page.evaluate(() => document.title);
  }
}

test.describe("TEST 5 — long session", () => {
  test("draw, type, insert image, rest, screenshot at checkpoints", async ({ page }, testInfo) => {
    skipIfNoSecrets(test);
    skipIosFullRoomPlaywright(test);
    const minutes = testMinutes();
    test.setTimeout(minutes * 60 * 1000 + 6 * 60 * 1000);

    await runGuarded(test, async () => {
      await openLessonRoom(page);
      await ensureBoardOpen(page);

      const started = Date.now();
      const endAt = started + minutes * 60 * 1000;
      const checkpoints = checkpointsFor(minutes);
      const taken = new Set();
      let lastBurst = started;
      let lastText = started;
      let lastImage = started;
      let lastLongRest = started;
      let imageToggle = 0;

      await screenshotNamed(page, testInfo, "05-checkpoint-0min");
      taken.add(0);

      while (Date.now() < endAt) {
        const elapsedMin = (Date.now() - started) / 60000;
        const scope = await currentBoardScope(page);

        for (const cp of checkpoints) {
          if (!taken.has(cp) && elapsedMin >= cp) {
            await screenshotNamed(page, testInfo, `05-checkpoint-${cp}min`);
            taken.add(cp);
          }
        }

        await selectFreedraw(scope);
        const canvas = await interactiveCanvas(scope);
        await drawShortStrokes(page, canvas, 2);
        await assertUiAlive(page, await currentBoardScope(page));

        if (Date.now() - lastBurst > 3 * 60 * 1000) {
          await drawBurst(page, await interactiveCanvas(await currentBoardScope(page)), 12);
          lastBurst = Date.now();
          await assertUiAlive(page, await currentBoardScope(page));
        }

        if (Date.now() - lastText > 8 * 60 * 1000) {
          await typeOnCanvas(page, await currentBoardScope(page), `e2e ${Math.round(elapsedMin)}m`);
          lastText = Date.now();
          await selectFreedraw(await currentBoardScope(page));
        }

        if (Date.now() - lastImage > 12 * 60 * 1000) {
          const file = imageToggle % 2 === 0 ? "photo-sample.jpg" : "diagram-sample.png";
          imageToggle += 1;
          await insertImageViaUi(page, await currentBoardScope(page), file);
          lastImage = Date.now();
          await selectFreedraw(await currentBoardScope(page));
        }

        const jitsi = await jitsiIframeCount(page);
        if (jitsi > 1) {
          throw new Error(`Jitsi iframe multiplied: ${jitsi}`);
        }

        const remainingMs = endAt - Date.now();
        if (remainingMs <= 0) break;
        if (Date.now() - lastLongRest > 4 * 60 * 1000) {
          await keepalive(page, Math.min(remainingMs, randBetween(30, 90) * 1000));
          lastLongRest = Date.now();
        } else {
          await keepalive(page, Math.min(remainingMs, randBetween(5, 20) * 1000));
        }
      }

      for (const cp of checkpoints) {
        if (!taken.has(cp)) {
          await screenshotNamed(page, testInfo, `05-checkpoint-${cp}min`);
        }
      }
    }, { page }, testInfo);
  });
});
