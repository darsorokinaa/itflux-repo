const { FlowError } = require("./dom");
const { isWebDriverInfraError } = require("./classify");
const { writeJson, screenshot, redactSecrets } = require("./artifacts");
const { executeJson } = require("./execute-json");
const { captureViewport, jitsiIframeCount, joinError } = require("./room");
const { currentLifecycle, isRunAborted } = require("./lifecycle");
const {
  waitForBoardReady,
  listIframes,
  countBoardIframes,
  isStaleElementError,
  isReleaseActionsUnsupported,
  isFrameSwitchError,
  lookupCanvas,
  leaveBoardFrame,
  pickBoardIframe,
} = require("./board");

const STROKE_DEGRADE_MS = 10_000;
const BOARD_SWITCH_DEGRADE_MS = 10_000;
const ACTION_HANG_MS = 20_000;
const STROKE_HANG_MS = 90_000;
const CHECKPOINT_MINUTES = [0, 10, 20, 30, 45, 60];

function freezeFail(message, extras = {}) {
  return new FlowError("BOARD FREEZE", message, {
    productFailure: true,
    classification: "BOARD FREEZE",
    boardClick: extras.boardClick || "PASS",
    strokeSucceededBefore: true,
    ...extras,
  });
}

function isSessionDeadError(err) {
  const message = String((err && err.message) || err || "");
  return /invalid session id|session deleted|session not created|session not started|not started or terminated|terminated|disconnected|ECONNRESET|ECONNREFUSED|testing time expired/i.test(message);
}

function isTestInfraDrawError(err) {
  if (!err) return false;
  if (isStaleElementError(err) || isReleaseActionsUnsupported(err) || isWebDriverInfraError(err)) return true;
  const code = String((err && err.code) || "");
  const classification = String((err && err.classification) || "");
  return /TEST BUG|TEST INFRA|TEST SELECTOR/i.test(code)
    || /TEST BUG|TEST INFRA/i.test(classification);
}

function isActionEndpointError(err) {
  const message = String((err && err.message) || err || "");
  return isReleaseActionsUnsupported(err)
    || /when running "actions"|\/actions\b|unsupported.*actions|unknown command.*actions|action endpoint/i.test(message);
}

function isStrokeWebDriverError(err) {
  if (!err) return false;
  return isStaleElementError(err)
    || isReleaseActionsUnsupported(err)
    || isFrameSwitchError(err)
    || isActionEndpointError(err)
    || isWebDriverInfraError(err)
    || isTestInfraDrawError(err);
}

function strokeTimingStats(records) {
  const times = (records || [])
    .filter((row) => row && row.actionCompleted && !row.error)
    .map((row) => Number(row.durationMs))
    .filter((ms) => Number.isFinite(ms));
  if (!times.length) {
    return {
      firstStrokeMs: null,
      medianStrokeMs: null,
      lastStrokeMs: null,
      maxStrokeMs: null,
    };
  }
  const sorted = [...times].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianStrokeMs = sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return {
    firstStrokeMs: times[0],
    lastStrokeMs: times[times.length - 1],
    maxStrokeMs: sorted[sorted.length - 1],
    medianStrokeMs,
  };
}

function classifyMeasuredStrokeFailure({ record = {}, successCount = 0, probe = {} } = {}) {
  const message = String(record.error || "stroke failed");
  const errLike = { message };
  if (isSessionDeadError(errLike) || probe.sessionAlive === false) {
    return new FlowError("DRAW", message, {
      productFailure: false,
      classification: "TEST BUG",
      strokeSucceededBefore: successCount >= 1,
    });
  }
  if (isStrokeWebDriverError(errLike)) {
    return new FlowError("DRAW", message, {
      productFailure: false,
      classification: "TEST BUG",
      strokeSucceededBefore: successCount >= 1,
    });
  }
  const hung = record.actionCompleted === false;
  const sessionAlive = probe.sessionAlive !== false;
  const domResponds = probe.domResponds === true;
  if (successCount >= 1 && hung && sessionAlive && domResponds && probe.canvasFound) {
    return freezeFail(
      `board interaction stopped completing on stroke #${record.index}: canvas still found ${probe.canvasWidth}x${probe.canvasHeight}, session alive, DOM responding`,
    );
  }
  if (successCount >= 1 && hung && sessionAlive && domResponds && !probe.canvasFound && !isStrokeWebDriverError(errLike)) {
    return freezeFail(
      `board interaction stopped completing on stroke #${record.index} and canvas is no longer found`,
    );
  }
  return new FlowError("DRAW", message, {
    productFailure: false,
    classification: "TEST BUG",
    strokeSucceededBefore: successCount >= 1,
  });
}

async function raceWithTimeout(promise, timeoutMs) {
  const life = currentLifecycle();
  const work = life ? life.track(promise) : Promise.resolve(promise);
  let timer;
  const timeout = new Promise((resolve) => {
    const fire = () => resolve({ timedOut: true });
    timer = life ? life.setTimeout(fire, timeoutMs) : setTimeout(fire, timeoutMs);
  });
  try {
    return await Promise.race([
      work.then((value) => ({ timedOut: false, value })),
      timeout,
    ]);
  } finally {
    if (life) life.clearTimeout(timer);
    else clearTimeout(timer);
  }
}

async function probeBoardLiveness(browser) {
  if (isRunAborted()) {
    return {
      sessionAlive: false,
      domResponds: false,
      canvasFound: false,
      canvasWidth: 0,
      canvasHeight: 0,
      boardIframes: -1,
      jitsiIframes: -1,
      errorScreen: null,
      probeError: "device run aborted",
    };
  }
  const probe = {
    sessionAlive: false,
    domResponds: false,
    canvasFound: false,
    canvasWidth: 0,
    canvasHeight: 0,
    boardIframes: -1,
    jitsiIframes: -1,
    errorScreen: null,
    probeError: null,
  };
  try {
    await leaveBoardFrame(browser);
  } catch (err) {
    if (isSessionDeadError(err)) {
      probe.sessionAlive = false;
      probe.probeError = String((err && err.message) || err);
      return probe;
    }
  }
  try {
    await browser.getUrl();
    probe.sessionAlive = true;
  } catch (err) {
    probe.probeError = String((err && err.message) || err);
    probe.sessionAlive = !isSessionDeadError(err);
    if (!probe.sessionAlive) return probe;
  }
  try {
    probe.errorScreen = await joinError(browser);
    probe.jitsiIframes = await jitsiIframeCount(browser);
    const iframes = await listIframes(browser);
    probe.boardIframes = countBoardIframes(iframes);
    probe.domResponds = true;
    const picked = pickBoardIframe(iframes);
    if (picked && picked.el) {
      try {
        await browser.switchFrame(picked.el);
        const inner = await lookupCanvas(browser);
        if (inner && inner.displayed && inner.width > 0 && inner.height > 0) {
          probe.canvasFound = true;
          probe.canvasWidth = inner.width;
          probe.canvasHeight = inner.height;
        }
      } catch (err) {
        if (isSessionDeadError(err)) {
          probe.sessionAlive = false;
          probe.probeError = String((err && err.message) || err);
        } else if (!probe.probeError) {
          probe.probeError = String((err && err.message) || err);
        }
      }
      try {
        await leaveBoardFrame(browser);
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    probe.probeError = String((err && err.message) || err);
    if (isSessionDeadError(err)) probe.sessionAlive = false;
  }
  return probe;
}

async function captureStrokeHealth(browser) {
  const snapshot = {
    errorScreen: null,
    jitsiIframes: -1,
    boardIframes: -1,
    canvas: { displayed: false, width: 0, height: 0 },
    probeError: null,
  };
  try {
    await leaveBoardFrame(browser);
    snapshot.errorScreen = await joinError(browser);
    snapshot.jitsiIframes = await jitsiIframeCount(browser);
    const iframes = await listIframes(browser);
    snapshot.boardIframes = countBoardIframes(iframes);
    const picked = pickBoardIframe(iframes);
    if (picked && picked.el) {
      try {
        await browser.switchFrame(picked.el);
        const inner = await lookupCanvas(browser);
        if (inner) {
          snapshot.canvas = {
            displayed: Boolean(inner.displayed),
            width: Number(inner.width) || 0,
            height: Number(inner.height) || 0,
          };
        }
      } catch (err) {
        snapshot.probeError = String((err && err.message) || err);
      }
      try {
        await leaveBoardFrame(browser);
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    snapshot.probeError = String((err && err.message) || err);
  }
  return snapshot;
}

function assertStrokeHealth(snapshot, { successCount = 0 } = {}) {
  if (snapshot && snapshot.probeError && isStrokeWebDriverError({ message: snapshot.probeError })) {
    throw new FlowError("DRAW", snapshot.probeError, {
      productFailure: false,
      classification: "TEST BUG",
      strokeSucceededBefore: successCount >= 1,
    });
  }
  if (snapshot && (snapshot.jitsiIframes < 0 || snapshot.boardIframes < 0)) {
    throw new FlowError("DRAW", snapshot.probeError || "stroke health probe failed", {
      productFailure: false,
      classification: "TEST BUG",
      strokeSucceededBefore: successCount >= 1,
    });
  }
  assertHealth(snapshot, { successCount, requireBoard: true });
  if (successCount >= 1 && snapshot.jitsiIframes !== 1) {
    throw freezeFail(`Jitsi iframe count ${snapshot.jitsiIframes} !== 1 after working board stroke`);
  }
}

function checkpointMinutesFor(testMinutes) {
  const cap = Number(testMinutes) || 60;
  const marks = CHECKPOINT_MINUTES.filter((m) => m <= cap);
  if (!marks.includes(cap)) marks.push(cap);
  return marks;
}

async function withActionTimeout(fn, { timeoutMs = ACTION_HANG_MS, label = "board action", successCount = 0 } = {}) {
  const life = currentLifecycle();
  const work = life ? life.track(Promise.resolve().then(fn)) : Promise.resolve().then(fn);
  let timer;
  const timeout = new Promise((_, reject) => {
    const fire = () => {
      if (life) life.abortOperation();
      reject(new FlowError("DRAW", `board action timeout after ${timeoutMs}ms: ${label}`, {
        productFailure: false,
        classification: "TEST BUG",
        strokeSucceededBefore: successCount >= 1,
      }));
    };
    timer = life ? life.setTimeout(fire, timeoutMs) : setTimeout(fire, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (life) life.clearTimeout(timer);
    else clearTimeout(timer);
  }
}

function rethrowAsFreezeIfProven(err, { successCount = 0, context = "board" } = {}) {
  if (isSessionDeadError(err)) throw err;
  if (isTestInfraDrawError(err) || isWebDriverInfraError(err)) throw err;
  if (err instanceof FlowError && err.classification === "BOARD FREEZE") throw err;
  if (successCount >= 1 && err && err.productFailure === true) {
    throw freezeFail(`${context}: ${String((err && err.message) || err)}`, {
      boardClick: err && err.boardClick,
      navigation: err && err.navigation,
      container: err && err.container,
    });
  }
  throw err;
}

async function captureRuntimeMetrics(browser) {
  try {
    return await executeJson(browser, () => {
      let heap = null;
      try {
        const mem = performance && performance.memory;
        if (mem) {
          heap = {
            usedJSHeapSize: Number(mem.usedJSHeapSize) || 0,
            totalJSHeapSize: Number(mem.totalJSHeapSize) || 0,
          };
        }
      } catch (e) {
        heap = null;
      }
      let longTasks = null;
      try {
        if (performance && typeof performance.getEntriesByType === "function") {
          longTasks = performance.getEntriesByType("longtask").length;
        }
      } catch (e) {
        longTasks = null;
      }
      let ws = null;
      try {
        const entries = performance && typeof performance.getEntriesByType === "function"
          ? performance.getEntriesByType("resource")
          : [];
        ws = entries.filter((e) => {
          const name = String((e && e.name) || "");
          return /^wss?:/i.test(name);
        }).length;
      } catch (e) {
        ws = null;
      }
      return JSON.stringify({
        heap,
        domNodes: document.getElementsByTagName("*").length,
        longTasks,
        websocketResources: ws,
      });
    }, "runtime-metrics");
  } catch {
    return { available: false };
  }
}

async function captureHealthSnapshot(browser, opened, extras = {}) {
  await browser.switchFrame(null).catch(() => {});
  const url = redactSecrets(String(await browser.getUrl().catch(() => "")));
  const errorScreen = await joinError(browser).catch(() => null);
  const viewport = await captureViewport(browser).catch(() => null);
  const jitsiCount = await jitsiIframeCount(browser).catch(() => -1);
  const iframes = await listIframes(browser).catch(() => []);
  const boardCount = countBoardIframes(iframes);
  let canvas = { displayed: false, width: 0, height: 0 };
  try {
    canvas = await waitForBoardReady(browser, opened || { navigation: "iframe" });
  } catch (err) {
    canvas = {
      displayed: false,
      width: 0,
      height: 0,
      error: String((err && err.message) || err),
    };
  }
  const metrics = await captureRuntimeMetrics(browser);
  return {
    at: new Date().toISOString(),
    url,
    errorScreen,
    viewport,
    jitsiIframes: jitsiCount,
    boardIframes: boardCount,
    canvas: {
      displayed: Boolean(canvas.displayed),
      width: Number(canvas.canvasW != null ? canvas.canvasW : canvas.width) || 0,
      height: Number(canvas.canvasH != null ? canvas.canvasH : canvas.height) || 0,
      error: canvas.error || null,
    },
    metrics,
    ...extras,
  };
}

function assertHealth(snapshot, { successCount = 0, requireBoard = true } = {}) {
  if (snapshot.errorScreen) {
    throw freezeFail(
      `error screen while room/session still open: ${snapshot.errorScreen.title}`,
    );
  }
  if (snapshot.jitsiIframes > 1) {
    throw freezeFail(`Jitsi iframe count ${snapshot.jitsiIframes} > 1 (stale iframe still alive)`);
  }
  if (snapshot.boardIframes > 1) {
    throw freezeFail(`board iframe count ${snapshot.boardIframes} > 1 (stale iframe still alive)`);
  }
  if (requireBoard && snapshot.boardIframes !== 1 && successCount >= 1) {
    throw freezeFail(`board iframe count ${snapshot.boardIframes} after board was working`);
  }
  if (snapshot.viewport && snapshot.viewport.overflowOk === false) {
    throw new FlowError(
      "LAYOUT",
      `horizontal overflow scrollWidth=${snapshot.viewport.scrollWidth} clientWidth=${snapshot.viewport.clientWidth}`,
      { productFailure: true },
    );
  }
  const canvas = snapshot.canvas || {};
  if (requireBoard && successCount >= 1) {
    if (!canvas.displayed || canvas.width < 1 || canvas.height < 1) {
      throw freezeFail(
        `canvas was working then became unusable displayed=${canvas.displayed} ${canvas.width}x${canvas.height} ${canvas.error || ""}`.trim(),
      );
    }
  }
}

async function writeCheckpoint(browser, opened, name, extras = {}) {
  const snapshot = await captureHealthSnapshot(browser, opened, extras);
  writeJson(`${name}.json`, snapshot);
  await screenshot(browser, name).catch(() => {});
  return snapshot;
}

function failedStepOf(report) {
  const keys = [
    "LOGIN", "PREJOIN", "NATIVE MIC ALLOW", "JITSI JOIN", "CALL", "MATERIALS",
    "OVERFLOW", "BOARD", "CANVAS", "DRAW", "DRAW_1", "DRAW_2", "DRAW_3",
    "TAB_CYCLE", "DRAW_AFTER_TAB", "SMOKE", "STRESS",
  ];
  for (const key of keys) {
    const value = report && report[key];
    if (value && typeof value === "object" && value.status === "fail") return key;
    if (value === "FAIL" || value === "failed") return key;
  }
  return report && report.failedStep ? report.failedStep : null;
}

async function captureFailureContext(browser, extras = {}) {
  try {
    await leaveBoardFrame(browser);
  } catch {
    /* ignore */
  }
  await screenshot(browser, extras.screenshotName || "failure").catch(() => {});
  const viewport = extras.viewport || await captureViewport(browser).catch(() => null);
  const jitsiIframes = await jitsiIframeCount(browser).catch(() => -1);
  const iframes = await listIframes(browser).catch(() => []);
  const boardIframeCount = countBoardIframes(iframes);
  const picked = pickBoardIframe(iframes);
  let canvas = { width: 0, height: 0, displayed: false };
  if (picked) {
    canvas = {
      width: Number(picked.width) || 0,
      height: Number(picked.height) || 0,
      displayed: Boolean(picked.displayed),
      from: "board-iframe-box",
    };
    try {
      await browser.switchFrame(picked.el);
      const inner = await lookupCanvas(browser);
      if (inner) {
        canvas = {
          width: inner.width,
          height: inner.height,
          displayed: inner.displayed,
          from: "fresh-canvas",
        };
      }
    } catch {
      /* keep iframe box */
    }
    try {
      await leaveBoardFrame(browser);
    } catch {
      /* ignore */
    }
  }
  const payload = {
    failedStep: extras.failedStep || null,
    exactError: extras.exactError || null,
    productFailure: extras.productFailure,
    classification: extras.classification || null,
    device: extras.device || null,
    os: extras.os || null,
    viewport,
    boardIframeCount,
    jitsiIframes,
    canvas,
    at: new Date().toISOString(),
  };
  writeJson("failure-context.json", payload);
  return payload;
}

module.exports = {
  STROKE_DEGRADE_MS,
  BOARD_SWITCH_DEGRADE_MS,
  ACTION_HANG_MS,
  STROKE_HANG_MS,
  CHECKPOINT_MINUTES,
  freezeFail,
  isSessionDeadError,
  isTestInfraDrawError,
  isActionEndpointError,
  isStrokeWebDriverError,
  strokeTimingStats,
  classifyMeasuredStrokeFailure,
  raceWithTimeout,
  probeBoardLiveness,
  captureStrokeHealth,
  assertStrokeHealth,
  checkpointMinutesFor,
  withActionTimeout,
  rethrowAsFreezeIfProven,
  captureRuntimeMetrics,
  captureHealthSnapshot,
  assertHealth,
  writeCheckpoint,
  captureFailureContext,
  failedStepOf,
};
