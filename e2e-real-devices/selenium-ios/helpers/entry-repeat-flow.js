const { xpathButton, SELECTORS, displayed } = require("./dom");
const { login } = require("./auth");
const { allowMicrophonePrompt } = require("./permissions");
const { isLiveRoomUi, joinError } = require("./room");
const { isSessionGone } = require("./classify");
const { sleep } = require("./lifecycle");
const {
  createTimeline,
  markTimeline,
  lastTimelineEvent,
  applySnapshotToTimeline,
  installEntryDiagHooks,
  captureEntrySnapshot,
  captureEntryFailure,
  classifyEntryFailure,
} = require("./entry-diag");

const { TIMEOUTS } = require("./timeouts");

async function freshCameraButton(browser) {
  return browser.$(xpathButton(SELECTORS.cameraWithout));
}

async function waitForPrejoinOrLive(browser, timeline) {
  const started = Date.now();
  let staleElementCount = 0;
  let lastSnap = null;
  while (Date.now() - started < TIMEOUTS.PREJOIN) {
    const snap = await captureEntrySnapshot(browser);
    lastSnap = snap;
    applySnapshotToTimeline(timeline, snap);
    if (snap.errorState) {
      return { outcome: "error", snap, staleElementCount };
    }
    if (snap.cameraWithoutDisplayed) {
      markTimeline(timeline, "T3_WITHOUT_CAMERA_RENDERED");
      return { outcome: "camera", snap, staleElementCount };
    }
    if (snap.liveUi) {
      markTimeline(timeline, "T9_LIVE_UI");
      return { outcome: "already-live", snap, staleElementCount };
    }
    try {
      const btn = await freshCameraButton(browser);
      if (await btn.isExisting().catch(() => false) && await displayed(btn)) {
        markTimeline(timeline, "T3_WITHOUT_CAMERA_RENDERED", { via: "fresh-webelement" });
        return { outcome: "camera", snap, staleElementCount };
      }
    } catch (err) {
      if (/stale element/i.test(String((err && err.message) || err))) staleElementCount += 1;
      else if (isSessionGone(err)) throw err;
    }
    if (await isLiveRoomUi(browser).catch((err) => {
      if (isSessionGone(err)) throw err;
      if (/stale element/i.test(String((err && err.message) || err))) staleElementCount += 1;
      return false;
    })) {
      markTimeline(timeline, "T9_LIVE_UI", { via: "isLiveRoomUi" });
      return { outcome: "already-live", snap, staleElementCount };
    }
    await sleep(400);
  }
  return { outcome: "timeout", snap: lastSnap, staleElementCount };
}

async function runRoomEntryAttempt(browser, secrets, { platform = "ios" } = {}) {
  const timeline = createTimeline();
  const report = {
    LOGIN: "pending",
    PREJOIN: "pending",
    MIC: "pending",
    LIVE: "pending",
    RESULT: "pending",
    classification: null,
    timeline,
    staleElementCount: 0,
    inferredPageState: null,
  };

  report.LOGIN = "ok";
  await login(browser, secrets);
  markTimeline(timeline, "T0_NAVIGATION", { url: secrets.lessonRoomUrl });
  await browser.url(secrets.lessonRoomUrl);
  await installEntryDiagHooks(browser).catch(() => {});

  let prejoin;
  try {
    prejoin = await waitForPrejoinOrLive(browser, timeline);
  } catch (err) {
    if (isSessionGone(err)) {
      report.PREJOIN = "fail";
      report.RESULT = "fail";
      report.classification = "INFRA_SKIP";
      report.exactError = String(err.message || err);
      report.sessionDead = true;
      return report;
    }
    throw err;
  }
  report.staleElementCount = prejoin.staleElementCount;
  report.inferredPageState = prejoin.snap && prejoin.snap.inferredPageState;
  report.snapshot = prejoin.snap;

  if (prejoin.outcome === "timeout" || prejoin.outcome === "error") {
    const err = await joinError(browser).catch(() => null);
    const failure = await captureEntryFailure(browser, {
      failedStage: "PREJOIN",
      lastTimelineEvent: lastTimelineEvent(timeline),
      navigationToFailureMs: Date.now() - timeline.startedAtMs,
      staleElementCount: prejoin.staleElementCount,
      screenshotName: "entry-prejoin-fail",
    }).catch(() => ({ snapshot: prejoin.snap }));
    const classified = classifyEntryFailure({
      snapshot: failure.snapshot || prejoin.snap,
      sessionAlive: true,
      staleElementCount: prejoin.staleElementCount,
    });
    report.PREJOIN = "fail";
    report.RESULT = "fail";
    report.classification = classified.classification;
    report.exactError = prejoin.outcome === "error"
      ? (err ? `${err.title} ${err.subtitle || ""}`.trim() : "room error state without camera or live UI")
      : "Neither «Без камеры» nor live room UI appeared";
    report.reason = classified.reason;
    report.failure = failure;
    report.lastTimelineEvent = lastTimelineEvent(timeline);
    return report;
  }

  if (prejoin.outcome === "camera") {
    const btn = await freshCameraButton(browser);
    await btn.click();
    markTimeline(timeline, "T4_WITHOUT_CAMERA_CLICKED");
    report.PREJOIN = "ok";
  } else {
    report.PREJOIN = "ok";
    report.alreadyLive = true;
  }

  try {
    const mic = await allowMicrophonePrompt(browser, {
      platform,
      timeoutMs: 20_000,
      isAlreadyLive: () => isLiveRoomUi(browser),
    });
    markTimeline(timeline, "T5_NATIVE_PERMISSION", { clicked: Boolean(mic && mic.clicked) });
    report.MIC = mic && mic.alreadyGranted ? "already" : "ok";
  } catch (err) {
    if (isSessionGone(err)) {
      report.MIC = "fail";
      report.RESULT = "fail";
      report.classification = "INFRA_SKIP";
      report.exactError = String(err.message || err);
      report.sessionDead = true;
      report.lastTimelineEvent = lastTimelineEvent(timeline);
      return report;
    }
    report.MIC = "fail";
    report.RESULT = "fail";
    report.classification = err.classification || "PERMISSION_LIMITATION";
    report.exactError = String(err.message || err);
    report.lastTimelineEvent = lastTimelineEvent(timeline);
    return report;
  }

  const liveStarted = Date.now();
  let live = false;
  while (Date.now() - liveStarted < 60_000) {
    const snap = await captureEntrySnapshot(browser);
    applySnapshotToTimeline(timeline, snap);
    if (snap.liveUi || await isLiveRoomUi(browser).catch(() => false)) {
      live = true;
      markTimeline(timeline, "T9_LIVE_UI");
      break;
    }
    if (snap.errorState) break;
    await sleep(800);
  }
  report.LIVE = live ? "ok" : "fail";
  if (!live) {
    const failure = await captureEntryFailure(browser, {
      failedStage: "LIVE",
      lastTimelineEvent: lastTimelineEvent(timeline),
      navigationToFailureMs: Date.now() - timeline.startedAtMs,
      staleElementCount: report.staleElementCount,
      screenshotName: "entry-live-fail",
      jsonName: "entry-live-fail.json",
    }).catch(() => null);
    report.RESULT = "fail";
    report.classification = "INTERMITTENT_PRODUCTION_SUSPECT";
    report.exactError = "live room UI did not appear after prejoin";
    report.failure = failure;
    report.lastTimelineEvent = lastTimelineEvent(timeline);
    return report;
  }

  report.RESULT = "pass";
  report.classification = "PASS";
  report.lastTimelineEvent = lastTimelineEvent(timeline);
  return report;
}

module.exports = {
  runRoomEntryAttempt,
  waitForPrejoinOrLive,
  PREJOIN_TIMEOUT_MS: TIMEOUTS.PREJOIN,
};
