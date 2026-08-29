const { expect, test } = require("@playwright/test");
const { SELECTORS } = require("./locators");
const { requiredSecrets } = require("./env");
const { loginIfNeeded, enableBoardSyncDebug } = require("./login");
const {
  installEntryDiagnostics,
  recordEntrySnapshot,
  attachEntryDiagnostics,
  screenshotEntry,
  readEntrySnapshot,
} = require("./entryDiagnostics");
const {
  BrowserStackLimitationError,
  isBrowserStackIosProject,
  isRealIosSafariUserAgent,
  iosNativeMicPermissionSkipMessage,
} = require("./iosMicPermission");

function cameraWithoutButton(page) {
  return page.getByRole("button", { name: SELECTORS.cameraWithout.name });
}

function cameraPrompt(page) {
  return page.getByText(SELECTORS.cameraPromptTitle, { exact: true });
}

function startLessonButton(page) {
  return page.getByRole("button", { name: SELECTORS.startLesson.name });
}

function callTab(page) {
  return page.getByRole("tab", { name: SELECTORS.tabCall.name });
}

function materialsTab(page) {
  return page.getByRole("tab", { name: SELECTORS.tabMaterials.name });
}

function materialsHeaderButton(page) {
  return page.getByRole("button", { name: SELECTORS.headerMaterials.name });
}

function materialsAside(page) {
  return page.getByRole("complementary", { name: SELECTORS.materialsAside.name });
}

function screenModeTablist(page) {
  return page.getByRole("tablist", { name: SELECTORS.screenModeTablist.name });
}

function liveUiLocator(page) {
  return screenModeTablist(page)
    .or(callTab(page))
    .or(materialsTab(page))
    .or(materialsHeaderButton(page))
    .or(page.locator(SELECTORS.jitsiContainer));
}

async function roomStage(page) {
  if (await cameraWithoutButton(page).isVisible().catch(() => false)) return "camera";
  if (await cameraPrompt(page).isVisible().catch(() => false)) return "camera";
  if (await startLessonButton(page).isVisible().catch(() => false)) return "waiting";
  if (await page.getByText("Онлайн-урок ещё не начался").isVisible().catch(() => false)) return "waiting-student";
  if (await page.getByText("Урок отменён").isVisible().catch(() => false)) return "cancelled";
  if (await page.getByText(SELECTORS.roomJoinError).isVisible().catch(() => false)) return "error";
  if (await page.getByText("Видеозвонок завершён").isVisible().catch(() => false)) return "finished";
  if (await page.getByText("Урок завершён").isVisible().catch(() => false)) return "finished";
  if (await liveUiLocator(page).first().isVisible().catch(() => false)) return "live";
  return "loading";
}

function entryCtx() {
  const testInfo = test.info();
  return { testInfo, log: testInfo && testInfo._itfluxEntryLog };
}

async function skipIfIosNativeMicPermission(page, extra = {}) {
  const testInfo = test.info();
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => "");
  const snap = await readEntrySnapshot(page).catch(() => null);
  const ios = isRealIosSafariUserAgent(ua) || isBrowserStackIosProject(testInfo);
  const iframeCount = snap ? Number(snap.jitsiIframeCount) : 0;
  if (!ios || iframeCount < 1) return false;
  const { log } = entryCtx();
  await screenshotEntry(page, testInfo, "ios-native-mic-permission");
  if (log) await recordEntrySnapshot(page, log, "ios-native-mic-permission");
  await attachEntryDiagnostics(page, testInfo, log, {
    classification: "BROWSERSTACK AUTOMATION LIMITATION",
    jitsiIframeCreated: true,
    microphonePermissionDialog: "unanswered",
    videoConferenceJoinedWait: "invalid while OS prompt is open",
    ...extra,
  });
  throw new BrowserStackLimitationError(iosNativeMicPermissionSkipMessage({
    jitsiIframeCreated: true,
    joinErrorVisible: Boolean(snap && snap.errorTitleVisible),
  }));
}

async function failRoomEntry(page, message) {
  const { testInfo, log } = entryCtx();
  const snap = await readEntrySnapshot(page).catch(() => null);
  await skipIfIosNativeMicPermission(page, { failMessage: message });
  await screenshotEntry(page, testInfo, "room-entry-failure");
  if (log) await recordEntrySnapshot(page, log, "room-entry-failure");
  await attachEntryDiagnostics(page, testInfo, log, { message, snapshot: snap });
  const subtitle = snap && snap.errorSubtitle ? ` subtitle=${JSON.stringify(snap.errorSubtitle)}` : "";
  const iframe = snap ? ` iframeCount=${snap.jitsiIframeCount}` : "";
  const camera = snap ? ` cameraWithout=${snap.cameraWithoutVisible}` : "";
  throw new Error(`${message}${subtitle}${iframe}${camera} url=${snap ? snap.url : page.url()}`);
}

async function isPlaywrightIosSession(page) {
  const testInfo = test.info();
  if (isBrowserStackIosProject(testInfo)) return true;
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => "");
  return isRealIosSafariUserAgent(ua);
}

async function stopPlaywrightIosAtNativeMic(page, extra = {}) {
  if (!(await isPlaywrightIosSession(page))) return false;
  const { testInfo, log } = entryCtx();
  await screenshotEntry(page, testInfo, "ios-native-mic-permission");
  if (log) await recordEntrySnapshot(page, log, "ios-native-mic-permission");
  const snap = await readEntrySnapshot(page).catch(() => null);
  await attachEntryDiagnostics(page, testInfo, log, {
    classification: "BROWSERSTACK AUTOMATION LIMITATION",
    microphonePermissionDialog: "unanswered",
    videoConferenceJoinedWait: "not started — Playwright cannot tap native Allow",
    seleniumCommand: "npm run test:browserstack:ios-selenium",
    ...extra,
  });
  throw new BrowserStackLimitationError(iosNativeMicPermissionSkipMessage({
    jitsiIframeCreated: Boolean(snap && Number(snap.jitsiIframeCount) >= 1),
    joinErrorVisible: Boolean(snap && snap.errorTitleVisible),
  }));
}

async function bypassCameraChoice(page) {
  const without = cameraWithoutButton(page);
  if (!(await without.isVisible().catch(() => false))) return false;
  const { testInfo, log } = entryCtx();
  if (log) await recordEntrySnapshot(page, log, "before-camera-choice");
  await screenshotEntry(page, testInfo, "before-camera-choice");
  if (log) log.events.push({ tMs: Date.now() - log.startedAt, name: "click-without-camera" });
  await without.click();
  await expect(cameraPrompt(page)).toBeHidden({ timeout: 30_000 });
  await expect(without).toBeHidden({ timeout: 30_000 });
  if (log) await recordEntrySnapshot(page, log, "after-camera-bypass");
  await screenshotEntry(page, testInfo, "after-camera-bypass");
  await screenshotEntry(page, testInfo, "jitsi-starting");
  if (log) await recordEntrySnapshot(page, log, "jitsi-starting");
  await stopPlaywrightIosAtNativeMic(page, { after: "Без камеры" });
  return true;
}

async function startLessonIfWaiting(page) {
  const start = startLessonButton(page);
  if (!(await start.isVisible().catch(() => false))) return false;
  await start.click();
  return true;
}

async function waitUntilRoomNotLoading(page) {
  await expect.poll(() => roomStage(page), {
    timeout: 60_000,
    intervals: [200, 400, 800, 1200],
    message: "Room stayed on loading after .video-lesson-page appeared",
  }).not.toBe("loading");
}

async function completeRoomEntry(page) {
  const { testInfo, log } = entryCtx();
  await expect(page.locator(SELECTORS.roomRoot)).toBeVisible({ timeout: 60_000 });
  if (log) await recordEntrySnapshot(page, log, "room-root-visible");

  for (let i = 0; i < 5; i += 1) {
    await waitUntilRoomNotLoading(page);
    const stage = await roomStage(page);
    if (log) await recordEntrySnapshot(page, log, `stage-${stage}`);
    if (stage === "camera") {
      await bypassCameraChoice(page);
      continue;
    }
    if (stage === "waiting") {
      await startLessonIfWaiting(page);
      continue;
    }
    if (stage === "waiting-student") {
      await failRoomEntry(page, "Room did not load: онлайн-урок ещё не начался (ожидание учителя)");
    }
    if (stage === "error") {
      await failRoomEntry(page, "Room did not load: Не удалось войти во встречу");
    }
    if (stage === "cancelled") {
      await failRoomEntry(page, "Room did not load: Урок отменён");
    }
    if (stage === "finished") {
      await failRoomEntry(page, "Room did not load: урок уже завершён");
    }
    if (stage === "live") break;
  }

  await stopPlaywrightIosAtNativeMic(page, { after: "camera-or-waiting-loop" });

  try {
    await expect.poll(() => roomStage(page), {
      timeout: 60_000,
      message: "Room did not reach live UI after camera/waiting",
    }).toBe("live");
  } catch (err) {
    await skipIfIosNativeMicPermission(page, { wait: "live-ui" });
    throw err;
  }

  await expect(page.locator(SELECTORS.roomRoot)).toBeVisible();
  await expect(liveUiLocator(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(cameraPrompt(page)).toBeHidden();
  if (log) await recordEntrySnapshot(page, log, "room-live");
}

async function waitForRoom(page) {
  await completeRoomEntry(page);
}

async function openLessonRoom(page) {
  await loginIfNeeded(page);
  await enableBoardSyncDebug(page);
  const testInfo = test.info();
  installEntryDiagnostics(page, testInfo);
  await page.goto(requiredSecrets().lessonRoomUrl, { waitUntil: "domcontentloaded" });
  await completeRoomEntry(page);
}

async function switchToCall(page) {
  const tab = callTab(page);
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  } else {
    const expand = page.getByRole("button", { name: SELECTORS.compactExpand.name });
    const close = page.getByRole("button", { name: SELECTORS.closeMaterial.name });
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
    } else if (await close.isVisible().catch(() => false)) {
      await close.click();
    }
  }
  await expect(page.locator(SELECTORS.roomRoot)).toBeVisible();
  await expect.poll(async () => jitsiIframeCount(page), {
    timeout: 30_000,
    message: "Jitsi iframe multiplied after switching to Call",
  }).toBeLessThanOrEqual(1);
}

async function switchToMaterials(page) {
  const tab = materialsTab(page);
  const header = materialsHeaderButton(page);
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
  } else if (await header.isVisible().catch(() => false)) {
    await header.click();
  } else {
    throw new Error("Materials control not found (tab Материалы / header Материалы)");
  }
  await expect(materialsAside(page)).toBeVisible({ timeout: 20_000 });
}

async function assertMaterialsPanelUsable(page) {
  const aside = materialsAside(page);
  await expect(aside).toBeVisible({ timeout: 20_000 });
  const overflow = await aside.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(overflow.scrollWidth, "materials panel horizontal overflow").toBeLessThanOrEqual(overflow.clientWidth + 2);

  const openBtn = aside.getByRole("button", { name: SELECTORS.boardOpenButton.name }).first();
  const createBtn = aside.getByRole("button", { name: SELECTORS.boardCreateButton.name }).first();
  const list = aside.getByRole("list");
  const rowButtons = aside.getByRole("button");
  const hasList = await list.isVisible().catch(() => false);
  const hasOpen = await openBtn.isVisible().catch(() => false);
  const hasCreate = await createBtn.isVisible().catch(() => false);
  expect(
    hasList || hasOpen || hasCreate || (await rowButtons.count()) > 0,
    "materials list or board actions should be available",
  ).toBeTruthy();

  const clickable = hasOpen ? openBtn : (hasCreate ? createBtn : rowButtons.first());
  if (await clickable.isVisible().catch(() => false)) {
    await expect(clickable).toBeEnabled();
  }
}

async function openBoardFromMaterials(page) {
  await switchToMaterials(page);
  const aside = materialsAside(page);
  await expect(aside).toBeVisible({ timeout: 20_000 });
  const openBtn = aside.getByRole("button", { name: SELECTORS.boardOpenButton.name }).first();
  await expect(openBtn, "existing board Открыть").toBeVisible({ timeout: 20_000 });
  await openBtn.click();
}

async function jitsiIframeCount(page) {
  return page.locator(SELECTORS.jitsiIframe).count();
}

async function pageOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      scrollHeight: de.scrollHeight,
      clientHeight: de.clientHeight,
    };
  });
}

async function assertNoHorizontalOverflow(page, slack = 2) {
  const box = await pageOverflow(page);
  expect(box.scrollWidth, "viewport horizontal overflow").toBeLessThanOrEqual(box.clientWidth + slack);
}

async function assertUiReactsToClicks(page) {
  await expect(page.locator(SELECTORS.roomRoot)).toBeVisible();
  const selected = page.locator('[role="tab"][aria-selected="true"]').first();
  if (await selected.isVisible().catch(() => false)) {
    await expect(selected).toBeEnabled();
    await selected.click();
  }
}

async function assertAfterPaneChange(page, { expectBoard = false } = {}) {
  await expect(page.locator(SELECTORS.roomRoot)).toBeVisible();
  expect(await jitsiIframeCount(page)).toBeLessThanOrEqual(1);
  await assertNoHorizontalOverflow(page);
  await assertUiReactsToClicks(page);
  if (expectBoard) {
    const iframe = page.locator(SELECTORS.boardIframeSrc).first();
    await expect(iframe).toBeVisible({ timeout: 20_000 });
  }
}

module.exports = {
  cameraWithoutButton,
  cameraPrompt,
  roomStage,
  bypassCameraChoice,
  startLessonIfWaiting,
  completeRoomEntry,
  waitForRoom,
  openLessonRoom,
  switchToCall,
  switchToMaterials,
  assertMaterialsPanelUsable,
  openBoardFromMaterials,
  jitsiIframeCount,
  pageOverflow,
  assertNoHorizontalOverflow,
  assertUiReactsToClicks,
  assertAfterPaneChange,
  materialsAside,
  callTab,
  materialsTab,
  stopPlaywrightIosAtNativeMic,
};
