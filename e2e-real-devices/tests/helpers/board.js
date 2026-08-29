const { expect } = require("@playwright/test");
const path = require("path");
const { SELECTORS } = require("./locators");
const {
  completeRoomEntry,
  openBoardFromMaterials,
  switchToMaterials,
  materialsAside,
  cameraWithoutButton,
} = require("./room");

function assetPath(name) {
  return path.join(__dirname, "..", "assets", name);
}

function boardIframe(page) {
  return page.locator(SELECTORS.boardIframeSrc).first();
}

function freshBoardFrame(page) {
  return page.frameLocator(SELECTORS.boardIframeSrc).first();
}

async function boardIframeSrc(page) {
  return boardIframe(page).getAttribute("src");
}

async function waitForBoardReady(page) {
  const iframe = boardIframe(page);
  await expect(iframe, "board iframe").toBeVisible({ timeout: 45_000 });

  const scope = freshBoardFrame(page);
  const host = scope.locator(SELECTORS.boardHost).first();
  const canvas = scope.locator(SELECTORS.excalidrawCanvas).first();
  await expect(host, "board host inside iframe").toBeVisible({ timeout: 45_000 });
  await expect(canvas, "excalidraw canvas inside iframe").toBeVisible({ timeout: 45_000 });

  await expect.poll(async () => {
    const hostBox = await host.boundingBox();
    const canvasBox = await canvas.boundingBox();
    return Boolean(
      hostBox && hostBox.width > 0 && hostBox.height > 0
      && canvasBox && canvasBox.width > 0 && canvasBox.height > 0,
    );
  }, {
    timeout: 45_000,
    message: "board host or canvas has zero size",
  }).toBeTruthy();

  return scope;
}

async function ensureRoomEntryDone(page) {
  await expect(page.locator(SELECTORS.roomRoot)).toBeVisible({ timeout: 30_000 });
  if (await cameraWithoutButton(page).isVisible().catch(() => false)) {
    await completeRoomEntry(page);
  }
}

async function ensureBoardOpen(page) {
  await ensureRoomEntryDone(page);
  await openBoardFromMaterials(page);
  return waitForBoardReady(page);
}

async function currentBoardScope(page) {
  const iframe = boardIframe(page);
  if (!(await iframe.isVisible().catch(() => false))) {
    return ensureBoardOpen(page);
  }
  return waitForBoardReady(page);
}

async function hostBox(scope) {
  const host = scope.locator(SELECTORS.boardHost).first();
  await expect(host).toBeVisible();
  return host.boundingBox();
}

async function interactiveCanvas(scope) {
  const interactive = scope.locator(`${SELECTORS.excalidrawCanvas}.interactive`).first();
  if (await interactive.count()) return interactive;
  return scope.locator(SELECTORS.excalidrawCanvas).first();
}

async function selectTool(scope, testId) {
  const tool = scope.getByTestId(testId);
  await expect(tool).toBeVisible({ timeout: 20_000 });
  await tool.click();
}

async function selectFreedraw(scope) {
  await selectTool(scope, SELECTORS.toolFreedraw);
}

async function selectText(scope) {
  await selectTool(scope, SELECTORS.toolText);
}

async function selectImage(scope) {
  await selectTool(scope, SELECTORS.toolImage);
}

async function assertBoardSized(scope) {
  const box = await hostBox(scope);
  expect(box, "board host bounding box").toBeTruthy();
  expect(box.width, "board host width").toBeGreaterThan(0);
  expect(box.height, "board host height").toBeGreaterThan(0);
  const canvas = await interactiveCanvas(scope);
  await expect(canvas).toBeVisible();
  const cbox = await canvas.boundingBox();
  expect(cbox, "canvas bounding box").toBeTruthy();
  expect(cbox.width, "canvas width").toBeGreaterThan(0);
  expect(cbox.height, "canvas height").toBeGreaterThan(0);
  return { host: box, canvas: cbox };
}

async function assertBoardNotZeroIfPresent(page) {
  const iframe = boardIframe(page);
  if (!(await iframe.isVisible().catch(() => false))) return null;
  const scope = freshBoardFrame(page);
  const host = scope.locator(SELECTORS.boardHost).first();
  if (!(await host.isVisible().catch(() => false))) return null;
  const box = await host.boundingBox();
  expect(box, "board host bounding box").toBeTruthy();
  expect(box.width, "board host width").toBeGreaterThan(0);
  expect(box.height, "board host height").toBeGreaterThan(0);
  return box;
}

async function assertUiAlive(page, scope) {
  const canvas = await interactiveCanvas(scope);
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box && box.width, "canvas width").toBeGreaterThan(0);
  expect(box && box.height, "canvas height").toBeGreaterThan(0);
  const tool = scope.getByTestId(SELECTORS.toolFreedraw);
  await expect(tool).toBeVisible();
  await tool.click();
}

async function boardEditorCount(page) {
  const iframe = boardIframe(page);
  if (!(await iframe.count())) return 0;
  const scope = freshBoardFrame(page);
  return scope.locator(SELECTORS.boardEditor).count();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pointerStroke(page, canvas, points, { moveDelayMs = 12, steps = 4 } = {}) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  const abs = (p) => ({
    x: box.x + Math.min(Math.max(p.x, 4), box.width - 4),
    y: box.y + Math.min(Math.max(p.y, 4), box.height - 4),
  });
  const start = abs(points[0]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) {
    const pt = abs(points[i]);
    await page.mouse.move(pt.x, pt.y, { steps });
    if (moveDelayMs) await sleep(moveDelayMs);
  }
  await page.mouse.up();
}

function shortStrokePoints(i, box) {
  const cx = 40 + (i % 6) * (box.width / 8);
  const cy = 50 + Math.floor(i / 6) * 28;
  return [
    { x: cx, y: cy },
    { x: cx + 18, y: cy + 6 },
    { x: cx + 28, y: cy - 4 },
  ];
}

function longStrokePoints(i, box) {
  const y = 80 + i * 22;
  return [
    { x: 24, y },
    { x: box.width * 0.35, y: y + 8 },
    { x: box.width * 0.55, y: y - 10 },
    { x: box.width * 0.72, y: y + 6 },
  ];
}

async function drawShortStrokes(page, canvas, count) {
  const box = await canvas.boundingBox();
  for (let i = 0; i < count; i += 1) {
    await pointerStroke(page, canvas, shortStrokePoints(i, box), { moveDelayMs: 16, steps: 3 });
  }
}

async function drawLongStrokes(page, canvas, count) {
  const box = await canvas.boundingBox();
  for (let i = 0; i < count; i += 1) {
    await pointerStroke(page, canvas, longStrokePoints(i, box), { moveDelayMs: 22, steps: 6 });
  }
}

async function drawBurst(page, canvas, count) {
  const box = await canvas.boundingBox();
  for (let i = 0; i < count; i += 1) {
    await pointerStroke(page, canvas, shortStrokePoints(i, box), { moveDelayMs: 4, steps: 2 });
  }
}

async function typeOnCanvas(page, scope, text) {
  await selectText(scope);
  const canvas = await interactiveCanvas(scope);
  const box = await canvas.boundingBox();
  await canvas.click({
    position: { x: Math.round(box.width * 0.4), y: Math.round(box.height * 0.35) },
  });
  const editor = scope.locator(SELECTORS.wysiwyg);
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.fill(text);
  await page.keyboard.press("Escape");
  await editor.waitFor({ state: "hidden", timeout: 8_000 }).catch(() => {});
}

async function insertImageViaUi(page, scope, fileName) {
  const file = assetPath(fileName);
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 8_000 }).catch(() => null);
  await selectImage(scope);
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(file);
    return { ok: true, method: "filechooser" };
  }
  const input = scope.locator(SELECTORS.fileInput).first();
  if (await input.count()) {
    try {
      await input.setInputFiles(file);
      return { ok: true, method: "input" };
    } catch (err) {
      return {
        ok: false,
        unsupported: true,
        reason: String((err && err.message) || err),
      };
    }
  }
  return {
    ok: false,
    unsupported: true,
    reason: "BrowserStack real iOS file chooser / file input is not available",
  };
}

async function assertImageAppeared(scope, beforePng) {
  const canvas = await interactiveCanvas(scope);
  await expect(canvas).toBeVisible();
  if (beforePng && beforePng.length) {
    await expect.poll(async () => {
      const after = await canvas.screenshot();
      return Buffer.compare(beforePng, after) !== 0;
    }, {
      timeout: 15_000,
      message: "canvas pixels did not change after image insert",
    }).toBeTruthy();
  }
  const box = await canvas.boundingBox();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  return { after: await canvas.screenshot() };
}

async function controlBox(locator) {
  if (!(await locator.count())) return null;
  if (!(await locator.first().isVisible().catch(() => false))) return null;
  return locator.first().boundingBox();
}

async function assertControlReachable(locator, label) {
  const box = await controlBox(locator);
  expect(box, `${label} should have a bounding box`).toBeTruthy();
  expect(box.width, `${label} width`).toBeGreaterThan(0);
  expect(box.height, `${label} height`).toBeGreaterThan(0);
  return box;
}

async function assertControlsInViewport(page, locators) {
  const viewport = page.viewportSize();
  for (const [locator, label] of locators) {
    if (!(await locator.count()) || !(await locator.first().isVisible().catch(() => false))) {
      continue;
    }
    const box = await assertControlReachable(locator, label);
    if (!viewport) continue;
    expect(box.x + 2, `${label} left`).toBeLessThan(viewport.width);
    expect(box.y + 2, `${label} top`).toBeLessThan(viewport.height);
    expect(box.x + box.width - 2, `${label} not fully past right`).toBeGreaterThan(0);
    expect(box.y + box.height - 2, `${label} not fully past bottom`).toBeGreaterThan(0);
  }
}

async function assertPipDoesNotCoverCanvas(page, scope) {
  const pip = page.locator(`${SELECTORS.compactCallPage} ${SELECTORS.callMain}`);
  if (!(await pip.count()) || !(await pip.first().isVisible().catch(() => false))) {
    return;
  }
  const position = await pip.first().evaluate((el) => getComputedStyle(el).position);
  expect(position, "PiP should be position:fixed").toBe("fixed");
  const pipBox = await pip.first().boundingBox();
  const canvas = await interactiveCanvas(scope);
  const canvasBox = await canvas.boundingBox();
  if (!pipBox || !canvasBox) return;
  const overlapW = Math.max(0, Math.min(pipBox.x + pipBox.width, canvasBox.x + canvasBox.width) - Math.max(pipBox.x, canvasBox.x));
  const overlapH = Math.max(0, Math.min(pipBox.y + pipBox.height, canvasBox.y + canvasBox.height) - Math.max(pipBox.y, canvasBox.y));
  const overlap = overlapW * overlapH;
  const canvasArea = canvasBox.width * canvasBox.height;
  expect(overlap / canvasArea).toBeLessThan(0.85);
}

async function assertPipDoesNotCoverCriticalControls(page) {
  const pip = page.locator(`${SELECTORS.compactCallPage} ${SELECTORS.callMain}`);
  if (!(await pip.count()) || !(await pip.first().isVisible().catch(() => false))) {
    return;
  }
  const pipBox = await pip.first().boundingBox();
  const tablist = page.getByRole("tablist", { name: SELECTORS.screenModeTablist.name });
  if (!pipBox || !(await tablist.isVisible().catch(() => false))) return;
  const tabBox = await tablist.boundingBox();
  if (!tabBox) return;
  const overlapW = Math.max(0, Math.min(pipBox.x + pipBox.width, tabBox.x + tabBox.width) - Math.max(pipBox.x, tabBox.x));
  const overlapH = Math.max(0, Math.min(pipBox.y + pipBox.height, tabBox.y + tabBox.height) - Math.max(pipBox.y, tabBox.y));
  const overlap = overlapW * overlapH;
  const tabArea = tabBox.width * tabBox.height;
  expect(overlap / tabArea, "PiP covering screen-mode tabs").toBeLessThan(0.8);
}

async function createBoardViaUi(page, title) {
  await switchToMaterials(page);
  const aside = materialsAside(page);
  const createBtn = aside.getByRole("button", { name: SELECTORS.boardCreateButton.name }).first();
  await expect(createBtn, "teacher create-board control in materials").toBeVisible({ timeout: 15_000 });
  await createBtn.click();

  const dialog = page.getByRole("dialog", { name: SELECTORS.boardCreateModalTitle });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel(SELECTORS.boardCreateTitleField).fill(title);
  await dialog.getByRole("button", { name: SELECTORS.boardCreateSubmit.name }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const openBtn = aside.getByRole("button", { name: SELECTORS.boardOpenButton.name }).first();
  await expect(openBtn, "Открыть after create").toBeVisible({ timeout: 30_000 });
  await openBtn.click();
  return waitForBoardReady(page);
}

module.exports = {
  assetPath,
  boardIframe,
  freshBoardFrame,
  boardIframeSrc,
  waitForBoardReady,
  ensureBoardOpen,
  currentBoardScope,
  hostBox,
  interactiveCanvas,
  selectTool,
  selectFreedraw,
  selectText,
  selectImage,
  assertBoardSized,
  assertBoardNotZeroIfPresent,
  assertUiAlive,
  boardEditorCount,
  pointerStroke,
  drawShortStrokes,
  drawLongStrokes,
  drawBurst,
  typeOnCanvas,
  insertImageViaUi,
  assertImageAppeared,
  assertControlReachable,
  assertControlsInViewport,
  assertPipDoesNotCoverCanvas,
  assertPipDoesNotCoverCriticalControls,
  createBoardViaUi,
  sleep,
};
