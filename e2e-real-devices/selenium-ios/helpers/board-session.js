const { writeJson } = require("./artifacts");
const { waitFor, xpathButton, SELECTORS, displayed, FlowError } = require("./dom");
const { switchToCall, clickMaterialsTab, jitsiIframeCount } = require("./room");
const { throwIfRunDisposed, currentLifecycle, sleep, isRunAborted } = require("./lifecycle");
const {
  leaveBoardFrame,
  openExistingBoard,
  waitForBoardReady,
  insertTextIfSupported,
  panZoomIfSupported,
  enterBoardFrame,
  lookupCanvas,
  selectFreedrawTool,
  performTouchStroke,
  strokePoints,
  wrapDrawError,
  listIframes,
  countBoardIframes,
} = require("./board");
const {
  STROKE_HANG_MS,
  freezeFail,
  withActionTimeout,
  rethrowAsFreezeIfProven,
  captureHealthSnapshot,
  assertHealth,
  writeCheckpoint,
  checkpointMinutesFor,
  raceWithTimeout,
  probeBoardLiveness,
  captureStrokeHealth,
  assertStrokeHealth,
  classifyMeasuredStrokeFailure,
  strokeTimingStats,
  isStrokeWebDriverError,
  isTestInfraDrawError,
} = require("./board-health");

async function switchToMaterialsLight(browser) {
  await clickMaterialsTab(browser);
  await waitFor(browser, async () => {
    const openBtn = await browser.$(xpathButton(SELECTORS.boardOpenButton));
    if (await displayed(openBtn)) return true;
    const aside = await browser.$(SELECTORS.materialsPanel);
    return displayed(aside);
  }, {
    timeoutMs: 20_000,
    message: "Materials UI did not appear after tab click",
  });
}

async function performMeasuredStroke(browser, opened, { index = 1, variant = "normal", successCount = 0 } = {}) {
  throwIfRunDisposed();
  const record = {
    index: Number(index) || 0,
    startedAt: new Date().toISOString(),
    durationMs: null,
    actionCompleted: false,
    canvasFoundBefore: false,
    canvasFoundAfter: false,
    canvasWidth: 0,
    canvasHeight: 0,
    error: null,
  };
  const started = Date.now();
  const wrapOpts = { firstDraw: false, strokeSucceededBefore: successCount >= 1 };

  const stamp = (err) => {
    record.durationMs = Date.now() - started;
    if (err) {
      if (!record.error) record.error = String((err && err.message) || err);
      err.strokeRecord = record;
    }
  };

  try {
    await leaveBoardFrame(browser);
    if (!(opened && opened.navigation === "route")) {
      await enterBoardFrame(browser);
    }

    const before = await lookupCanvas(browser);
    record.canvasFoundBefore = Boolean(before && before.displayed && before.width > 0 && before.height > 0);
    if (!record.canvasFoundBefore) {
      record.error = `canvas not usable before stroke displayed=${before && before.displayed} ${before ? `${before.width}x${before.height}` : "missing"}`;
      const probe = await probeBoardLiveness(browser);
      record.canvasFoundAfter = probe.canvasFound;
      record.canvasWidth = probe.canvasWidth;
      record.canvasHeight = probe.canvasHeight;
      const classified = classifyMeasuredStrokeFailure({
        record: { ...record, actionCompleted: false },
        successCount,
        probe,
      });
      stamp(classified);
      throw classified;
    }

    await selectFreedrawTool(browser, { focusTap: false });
    const fresh = await lookupCanvas(browser);
    if (!fresh || !fresh.displayed || fresh.width < 1 || fresh.height < 1) {
      throw wrapDrawError(new Error("canvas missing after freedraw tool click"), wrapOpts);
    }

    const pts = strokePoints(fresh, Math.max(0, record.index - 1), variant);
    let actionErr = null;
    const raced = await raceWithTimeout(
      performTouchStroke(browser, pts.startX, pts.startY, pts.endX, pts.endY, {
        pauseMs: pts.pauseMs,
        moveMs: pts.moveMs,
      }).catch((err) => {
        actionErr = err;
        return null;
      }),
      STROKE_HANG_MS,
    );

    if (raced.timedOut) {
      const life = currentLifecycle();
      if (life) life.abortOperation();
      record.actionCompleted = false;
      record.error = `stroke action hang after ${STROKE_HANG_MS}ms`;
      const probed = await raceWithTimeout(probeBoardLiveness(browser), 25_000);
      if (probed.timedOut) {
        record.error = `${record.error}; liveness probe also did not complete`;
        const classified = classifyMeasuredStrokeFailure({
          record,
          successCount,
          probe: { sessionAlive: true, domResponds: false, canvasFound: false },
        });
        stamp(classified);
        throw classified;
      }
      const probe = probed.value;
      record.canvasFoundAfter = probe.canvasFound;
      record.canvasWidth = probe.canvasWidth;
      record.canvasHeight = probe.canvasHeight;
      const classified = classifyMeasuredStrokeFailure({ record, successCount, probe });
      stamp(classified);
      throw classified;
    }

    if (actionErr) {
      record.actionCompleted = false;
      record.error = String((actionErr && actionErr.message) || actionErr);
      if (isStrokeWebDriverError(actionErr) || isTestInfraDrawError(actionErr)) {
        const wrapped = wrapDrawError(actionErr, wrapOpts);
        stamp(wrapped);
        throw wrapped;
      }
      const probe = await probeBoardLiveness(browser);
      record.canvasFoundAfter = probe.canvasFound;
      record.canvasWidth = probe.canvasWidth;
      record.canvasHeight = probe.canvasHeight;
      const classified = classifyMeasuredStrokeFailure({ record, successCount, probe });
      stamp(classified);
      throw classified;
    }

    record.actionCompleted = true;
    const after = await lookupCanvas(browser);
    record.canvasFoundAfter = Boolean(after && after.displayed && after.width > 0 && after.height > 0);
    record.canvasWidth = after ? after.width : 0;
    record.canvasHeight = after ? after.height : 0;
    if (!record.canvasFoundAfter) {
      record.error = `canvas gone after stroke ${record.canvasWidth}x${record.canvasHeight}`;
      const classified = successCount >= 1
        ? freezeFail(record.error)
        : wrapDrawError(new Error(record.error), wrapOpts);
      stamp(classified);
      throw classified;
    }
    stamp();
    return record;
  } catch (err) {
    record.durationMs = Date.now() - started;
    if (!record.error) record.error = String((err && err.message) || err);
    if (err && typeof err === "object") err.strokeRecord = record;
    if (err && (err.classification || err.code === "BOARD FREEZE")) throw err;
    throw wrapDrawError(err, wrapOpts);
  } finally {
    try {
      await leaveBoardFrame(browser);
    } catch {
      /* ignore */
    }
  }
}

async function runMeasuredStrokeSeries(browser, opened, count, variant, successCount, { logPrefix = "SMOKE" } = {}) {
  const records = [];
  for (let i = 0; i < count; i += 1) {
    const n = i + 1;
    try {
      const record = await performMeasuredStroke(browser, opened, {
        index: n,
        variant,
        successCount: successCount + i,
      });
      const health = await captureStrokeHealth(browser);
      assertStrokeHealth(health, { successCount: successCount + n });
      records.push(record);
      console.log(`${logPrefix} stroke ${n}/${count} PASS ${record.durationMs}ms`);
    } catch (err) {
      console.log(`${logPrefix} stroke ${n}/${count} FAIL ${String((err && err.message) || err)}`);
      rethrowAsFreezeIfProven(err, {
        successCount: successCount + i,
        context: `${variant} stroke ${n}/${count}`,
      });
    }
  }
  return {
    count: records.length,
    variant,
    records,
    stats: strokeTimingStats(records),
  };
}

async function timedControlStroke(browser, opened, { successCount, index = 1, logPrefix = "SMOKE" } = {}) {
  try {
    const record = await performMeasuredStroke(browser, opened, {
      index,
      variant: "normal",
      successCount,
    });
    const health = await captureStrokeHealth(browser);
    assertStrokeHealth(health, { successCount: successCount + 1 });
    console.log(`${logPrefix} control PASS ${record.durationMs}ms`);
    return record;
  } catch (err) {
    console.log(`${logPrefix} control FAIL ${String((err && err.message) || err)}`);
    rethrowAsFreezeIfProven(err, { successCount, context: "control stroke" });
  }
}

async function cycleCallMaterialsBoard(browser, opened, { cycleIndex, successCount }) {
  await leaveBoardFrame(browser);
  try {
    await switchToCall(browser);
    await browser.pause(500);
    await switchToMaterialsLight(browser);
  } catch (err) {
    rethrowAsFreezeIfProven(err, { successCount, context: "Call/Materials tab switch" });
  }

  const switchStarted = Date.now();
  let reopened;
  try {
    reopened = await withActionTimeout(
      () => openExistingBoard(browser, { quiet: true, artifactPrefix: `cycle-${cycleIndex}` }),
      { timeoutMs: 30_000, label: "Materials → Board", successCount },
    );
  } catch (err) {
    rethrowAsFreezeIfProven(err, { successCount, context: "board did not restore after Call/Materials" });
  }
  const switchMs = Date.now() - switchStarted;

  try {
    await waitForBoardReady(browser, reopened);
  } catch (err) {
    rethrowAsFreezeIfProven(err, { successCount, context: "canvas not restored after tab cycle" });
  }

  return { opened: reopened, switchMs };
}

async function assertLiveBoard(browser, opened, successCount) {
  const snapshot = await captureHealthSnapshot(browser, opened);
  assertHealth(snapshot, { successCount, requireBoard: true });
  return snapshot;
}

async function runSmokeBoardSession(browser, opened) {
  let current = opened;
  let successCount = 1;

  const normal10 = await runMeasuredStrokeSeries(browser, current, 10, "normal", successCount, { logPrefix: "SMOKE" });
  successCount += 10;
  await browser.pause(800);

  const fast20 = await runMeasuredStrokeSeries(browser, current, 20, "fast", successCount, { logPrefix: "SMOKE" });
  successCount += 20;
  await browser.pause(800);

  const cycles = [];
  for (let i = 0; i < 3; i += 1) {
    const cycle = await cycleCallMaterialsBoard(browser, current, { cycleIndex: i + 1, successCount });
    current = cycle.opened;
    cycles.push(cycle);
    await assertLiveBoard(browser, current, successCount);
    await browser.pause(600);
  }

  const postCycle = await runMeasuredStrokeSeries(browser, current, 5, "normal", successCount, { logPrefix: "SMOKE" });
  successCount += 5;
  const control = await timedControlStroke(browser, current, { successCount, index: 99, logPrefix: "SMOKE" });
  successCount += 1;

  const health = await assertLiveBoard(browser, current, successCount);
  const stats = strokeTimingStats(normal10.records);
  const summary = {
    mode: "smoke",
    completed: true,
    freezeChecked: true,
    successCount,
    cycles: cycles.map((c) => c.switchMs),
    controlStrokeMs: control.durationMs,
    firstStrokeMs: stats.firstStrokeMs,
    medianStrokeMs: stats.medianStrokeMs,
    lastStrokeMs: stats.lastStrokeMs,
    maxStrokeMs: stats.maxStrokeMs,
    fastStats: fast20.stats,
    postCycleStats: postCycle.stats,
    health,
  };
  writeJson("smoke-strokes.json", {
    normal: normal10,
    fast: fast20,
    postCycle,
    control,
    stats,
  });
  writeJson("smoke-summary.json", summary);
  return { opened: current, ...summary };
}

async function idleKeepalive(browser, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (isRunAborted()) return;
    await sleep(Math.min(15_000, Math.max(0, until - Date.now())));
    if (isRunAborted()) return;
    await browser.getUrl().catch(() => {});
  }
}

async function runStressBoardSession(browser, opened, { testMinutes = 60 } = {}) {
  const sessionStart = Date.now();
  const endAt = sessionStart + testMinutes * 60 * 1000;
  const marks = checkpointMinutesFor(testMinutes);
  let current = opened;
  let successCount = 1;
  const checkpoints = [];
  let nextMark = 0;

  async function maybeCheckpoint(forceName) {
    const elapsedMin = (Date.now() - sessionStart) / 60_000;
    while (nextMark < marks.length && elapsedMin >= marks[nextMark] - 0.05) {
      const minute = marks[nextMark];
      nextMark += 1;
      const control = await timedControlStroke(browser, current, { successCount, index: minute, logPrefix: "STRESS" });
      successCount += 1;
      const switchProbe = await cycleCallMaterialsBoard(browser, current, {
        cycleIndex: `cp-${minute}`,
        successCount,
      });
      current = switchProbe.opened;
      const snap = await writeCheckpoint(browser, current, `checkpoint-${minute}min`, {
        minute,
        sessionDurationMs: Date.now() - sessionStart,
        controlStrokeMs: control.durationMs,
        materialsToBoardMs: switchProbe.switchMs,
      });
      assertHealth(snap, { successCount, requireBoard: true });
      checkpoints.push({
        minute,
        controlStrokeMs: control.durationMs,
        materialsToBoardMs: switchProbe.switchMs,
        canvas: snap.canvas,
        jitsiIframes: snap.jitsiIframes,
        boardIframes: snap.boardIframes,
        overflowOk: snap.viewport ? snap.viewport.overflowOk : null,
        url: snap.url,
        errorScreen: snap.errorScreen,
        metrics: snap.metrics,
      });
    }
    if (forceName) {
      await writeCheckpoint(browser, current, forceName, {
        sessionDurationMs: Date.now() - sessionStart,
      });
    }
  }

  await maybeCheckpoint();

  while (Date.now() < endAt) {
    await runMeasuredStrokeSeries(browser, current, 3, "normal", successCount, { logPrefix: "STRESS" });
    successCount += 3;
    await runMeasuredStrokeSeries(browser, current, 8, "fast", successCount, { logPrefix: "STRESS" });
    successCount += 8;
    const text = await insertTextIfSupported(browser, current).catch((err) => {
      rethrowAsFreezeIfProven(err, { successCount, context: "text insert" });
    });
    const pan = await panZoomIfSupported(browser, current).catch((err) => {
      rethrowAsFreezeIfProven(err, { successCount, context: "pan/zoom" });
    });
    const cycle = await cycleCallMaterialsBoard(browser, current, {
      cycleIndex: `stress-${successCount}`,
      successCount,
    });
    current = cycle.opened;
    await timedControlStroke(browser, current, { successCount, logPrefix: "STRESS" });
    successCount += 1;
    await assertLiveBoard(browser, current, successCount);
    await maybeCheckpoint();
    const remaining = endAt - Date.now();
    if (remaining > 0) {
      await idleKeepalive(browser, Math.min(70_000, remaining));
    }
    void text;
    void pan;
  }

  await maybeCheckpoint();
  const summary = {
    mode: "stress",
    completed: true,
    freezeChecked: true,
    testMinutes,
    successCount,
    sessionDurationMs: Date.now() - sessionStart,
    checkpoints,
  };
  writeJson("stress-summary.json", summary);
  return { opened: current, ...summary };
}

async function assertIframeCounts(browser, { successCount, context }) {
  await leaveBoardFrame(browser);
  const boardIframes = countBoardIframes(await listIframes(browser));
  const jitsiIframes = await jitsiIframeCount(browser);
  if (jitsiIframes !== 1) {
    const extras = {
      productFailure: jitsiIframes > 1,
      classification: jitsiIframes > 1 ? "PRODUCT BUG" : "TEST BUG",
      strokeSucceededBefore: successCount >= 1,
    };
    throw new FlowError("QUICK", `Jitsi iframe count ${jitsiIframes} !== 1 after ${context}`, extras);
  }
  if (boardIframes !== 1) {
    throw new FlowError("QUICK", `board iframe count ${boardIframes} !== 1 after ${context}`, {
      productFailure: boardIframes < 1,
      classification: boardIframes < 1 ? "PRODUCT BUG" : "TEST BUG",
      boardClick: "PASS",
      strokeSucceededBefore: successCount >= 1,
    });
  }
  return { boardIframes, jitsiIframes };
}

async function runQuickBoardSession(browser, opened) {
  let current = opened;
  let successCount = 0;
  const strokeMs = [];
  const tabCycles = [];

  async function roundStrokes(label, count, startIndex) {
    const series = await runMeasuredStrokeSeries(browser, current, count, "normal", successCount, {
      logPrefix: label,
    });
    successCount += series.records.length;
    for (const record of series.records) strokeMs.push(record.durationMs);
    const canvas = await waitForBoardReady(browser, current);
    if (!canvas || !canvas.displayed || Number(canvas.canvasW) < 1 || Number(canvas.canvasH) < 1) {
      throw new FlowError("QUICK", `${label}: canvas not usable ${JSON.stringify(canvas)}`, {
        productFailure: successCount >= 1,
        classification: successCount >= 1 ? "PRODUCT BUG" : "TEST BUG",
        strokeSucceededBefore: successCount >= 1,
      });
    }
    return { series, canvas, startIndex };
  }

  const round1 = await roundStrokes("QUICK R1", 3, 1);

  const cycle2 = await cycleCallMaterialsBoard(browser, current, {
    cycleIndex: "quick-2",
    successCount,
  });
  current = cycle2.opened;
  tabCycles.push(cycle2.switchMs);
  await waitForBoardReady(browser, current);
  const round2 = await roundStrokes("QUICK R2", 3, 4);

  await idleKeepalive(browser, 30_000);
  const idleCounts = await assertIframeCounts(browser, { successCount, context: "30s idle" });
  await waitForBoardReady(browser, current);
  const round3 = await roundStrokes("QUICK R3", 3, 7);

  const cycle3 = await cycleCallMaterialsBoard(browser, current, {
    cycleIndex: "quick-control",
    successCount,
  });
  current = cycle3.opened;
  tabCycles.push(cycle3.switchMs);
  const control = await timedControlStroke(browser, current, {
    successCount,
    index: 10,
    logPrefix: "QUICK",
  });
  successCount += 1;
  strokeMs.push(control.durationMs);

  const health = await assertLiveBoard(browser, current, successCount);
  const finalCounts = await assertIframeCounts(browser, { successCount, context: "final tab cycle" });
  const summary = {
    mode: "quick",
    completed: true,
    freezeChecked: true,
    successCount,
    strokeMs,
    tabCycleMs: tabCycles[tabCycles.length - 1] || null,
    tabCycles,
    idleCounts,
    finalCounts,
    health,
    firstStrokeMs: strokeMs[0] || null,
    lastStrokeMs: strokeMs[strokeMs.length - 1] || null,
    rounds: {
      round1: round1.series.stats,
      round2: round2.series.stats,
      round3: round3.series.stats,
      controlMs: control.durationMs,
    },
  };
  writeJson("quick-summary.json", summary);
  writeJson("quick-strokes.json", {
    strokeMs,
    tabCycles,
    round1: round1.series,
    round2: round2.series,
    round3: round3.series,
    control,
  });
  return { opened: current, ...summary };
}

async function runCoreTabRestore(browser, opened) {
  const cycle = await cycleCallMaterialsBoard(browser, opened, {
    cycleIndex: "core",
    successCount: 3,
  });
  await leaveBoardFrame(browser);
  const iframes = await listIframes(browser);
  const boardIframes = countBoardIframes(iframes);
  const jitsiIframes = await jitsiIframeCount(browser);
  if (boardIframes !== 1) {
    const message = `board iframe count ${boardIframes} after Call → Materials → Board`;
    if (boardIframes < 1) {
      throw new FlowError("TAB_CYCLE", message, {
        productFailure: true,
        classification: "PRODUCT BUG",
        boardClick: "PASS",
        strokeSucceededBefore: true,
      });
    }
    throw new FlowError("TAB_CYCLE", message, {
      productFailure: false,
      classification: "TEST BUG",
      boardClick: "PASS",
    });
  }
  if (jitsiIframes > 1) {
    throw new FlowError("TAB_CYCLE", `Jitsi iframe count ${jitsiIframes} > 1 after tab cycle`, {
      productFailure: true,
      classification: "PRODUCT BUG",
      strokeSucceededBefore: true,
    });
  }
  const canvas = await waitForBoardReady(browser, cycle.opened);
  if (!canvas || !canvas.displayed || Number(canvas.canvasW) < 1 || Number(canvas.canvasH) < 1) {
    throw new FlowError("TAB_CYCLE", `canvas not usable after tab cycle ${JSON.stringify(canvas)}`, {
      productFailure: true,
      classification: "PRODUCT BUG",
      strokeSucceededBefore: true,
    });
  }
  return {
    opened: cycle.opened,
    switchMs: cycle.switchMs,
    boardIframes,
    jitsiIframes,
    canvas,
  };
}

module.exports = {
  runSmokeBoardSession,
  runStressBoardSession,
  runQuickBoardSession,
  runCoreTabRestore,
  cycleCallMaterialsBoard,
  switchToMaterialsLight,
  performMeasuredStroke,
  runMeasuredStrokeSeries,
  strokeTimingStats,
};
