const assert = require("node:assert/strict");
const { screenshot } = require("../helpers/artifacts");
const { FlowError } = require("../helpers/dom");
const { login, enableBoardDebug } = require("../helpers/auth");
const { allowMicrophonePrompt } = require("../helpers/permissions");
const {
  openLessonRoom,
  clickWithoutCamera,
  waitForSuccessfulJoin,
  isLiveRoomUi,
  switchToCall,
  assertMaterialsUsable,
  assertClickableRoom,
  captureViewport,
  jitsiIframeCount,
  joinError,
} = require("../helpers/room");
const {
  leaveBoardFrame,
  openExistingBoard,
  waitForBoardReady,
  drawStroke,
  listIframes,
  countBoardIframes,
} = require("../helpers/board");
const { parseBoardTestEnv } = require("../helpers/catalog");
const { isSessionGone } = require("../helpers/classify");
const { runSmokeBoardSession, runStressBoardSession, runQuickBoardSession, performMeasuredStroke, runCoreTabRestore } = require("../helpers/board-session");

async function runRoomFlow(browser, secrets, options = {}) {
  const platform = String(options.platform || "ios").toLowerCase();
  const deviceLabel = options.deviceLabel || "iPhone 15 Pro Max / iOS 17 / Safari";
  const boardEnv = parseBoardTestEnv(process.env);
  const mode = options.boardTestMode || boardEnv.mode;
  const testMinutes = options.testMinutes || boardEnv.testMinutes;
  const report = {
    DEVICE: deviceLabel,
    PLATFORM: platform,
    ORIENTATION: options.orientation || "portrait",
    MODE: mode,
    LOGIN: "pending",
    PREJOIN: "pending",
    "NATIVE MIC ALLOW": "pending",
    "JITSI JOIN": "pending",
    CALL: "pending",
    MATERIALS: "pending",
    OVERFLOW: "pending",
    BOARD: "pending",
    CANVAS: "pending",
    DRAW: "pending",
    DRAW_1: "pending",
    DRAW_2: "pending",
    DRAW_3: "pending",
    TAB_CYCLE: "pending",
    DRAW_AFTER_TAB: "pending",
    SMOKE: "pending",
    STRESS: "pending",
    QUICK: "pending",
    ROUND_1: "pending",
    ROUND_2: "pending",
    ROUND_3: "pending",
    CONTROL: "pending",
    FREEZE: "not_checked",
    CORE_FLOW: "pending",
    SMOKE_STARTED: false,
    SMOKE_COMPLETED: false,
    FREEZE_CHECKED: false,
    "BOARD CLICK": "pending",
    "BOARD NAVIGATION": "pending",
    "BOARD CONTAINER": "pending",
    CLASSIFICATION: "pending",
    viewport: null,
    durations: {},
    sessionId: options.sessionId || null,
    RESULT: "pending",
  };

  let openedBoard = null;

  const coreFailKeys = [
    "LOGIN", "PREJOIN", "NATIVE MIC ALLOW", "JITSI JOIN", "CALL", "MATERIALS",
    "BOARD", "CANVAS", "DRAW", "DRAW_1", "DRAW_2", "DRAW_3", "TAB_CYCLE", "DRAW_AFTER_TAB",
    "QUICK",
  ];

  const step = async (key, fn) => {
    console.log(`STEP ${key}`);
    const started = Date.now();
    try {
      const detail = await fn();
      report.durations[key] = Date.now() - started;
      report[key] = detail && typeof detail === "object" && detail.status
        ? detail
        : { status: "ok", detail: detail || null };
      return detail;
    } catch (err) {
      report.durations[key] = Date.now() - started;
      report[key] = { status: "fail", error: String((err && err.message) || err) };
      report.failedStep = key;
      report.exactError = String((err && err.message) || err);
      if (err && err.boardClick) report["BOARD CLICK"] = err.boardClick;
      if (err && err.navigation) report["BOARD NAVIGATION"] = err.navigation;
      if (err && err.container) report["BOARD CONTAINER"] = err.container;
      if (err && err.classification) report.CLASSIFICATION = err.classification;
      if (err && err.loginDiag) report.loginDiag = err.loginDiag;
      if (err && err.submitClicked != null) report.submitClicked = err.submitClicked;
      if (isSessionGone(err)) {
        report.sessionDead = true;
        report.CLASSIFICATION = report.CLASSIFICATION && /BOARD FREEZE/i.test(report.CLASSIFICATION)
          ? report.CLASSIFICATION
          : "TEST BUG";
      }
      if (key === "CANVAS" && report["BOARD CLICK"] === "pending") report["BOARD CLICK"] = "PASS";
      if (coreFailKeys.includes(key)) {
        report.CORE_FLOW = "FAIL";
        report.FREEZE_CHECKED = false;
        report.FREEZE = "not_checked";
      }
      err.boardReport = report;
      err.failedStep = key;
      throw err;
    }
  };

  await step("LOGIN", async () => {
    const result = await login(browser, secrets, { platform });
    await enableBoardDebug(browser);
    await screenshot(browser, "01-login");
    return result;
  });

  await step("PREJOIN", async () => {
    await openLessonRoom(browser, secrets.lessonRoomUrl);
    await screenshot(browser, "02-room-prejoin");
    const camera = await clickWithoutCamera(browser);
    await screenshot(browser, "03-before-native-permission");
    return camera;
  });

  await step("NATIVE MIC ALLOW", async () => {
    const result = await allowMicrophonePrompt(browser, {
      platform,
      timeoutMs: 20_000,
      isAlreadyLive: () => isLiveRoomUi(browser),
    });
    await screenshot(browser, "04-after-native-allow");
    return result;
  });

  await step("JITSI JOIN", async () => {
    try {
      const join = await waitForSuccessfulJoin(browser, { timeoutMs: 60_000 });
      await screenshot(browser, "05-room-live");
      return join;
    } catch (err) {
      if (isSessionGone(err)) throw err;
      const liveErr = await joinError(browser);
      const url = await browser.getUrl();
      await screenshot(browser, "jitsi-join-error");
      if (liveErr) {
        throw new FlowError(
          "Jitsi did not join after permission",
          `${liveErr.title}${liveErr.subtitle ? ` — ${liveErr.subtitle}` : ""} url=${url}`,
        );
      }
      throw err;
    }
  });

  if (mode !== "quick") {
    await step("CALL", async () => {
      await switchToCall(browser);
      await assertClickableRoom(browser);
      const count = await jitsiIframeCount(browser);
      assert.ok(count <= 1, `Jitsi iframe count ${count} > 1`);
      return { jitsiIframes: count };
    });
  } else {
    report.CALL = { status: "skip" };
  }

  await step("MATERIALS", async () => {
    const switched = await assertMaterialsUsable(browser);
    await screenshot(browser, "06-materials");
    await assertClickableRoom(browser);
    return {
      classification: switched && switched.verdict ? switched.verdict.classification : "MATERIALS = SELECTOR BUG",
      outcome: switched && switched.verdict ? switched.verdict.outcome : null,
      wait: "aside.video-lesson-aside / aria-label=Материалы урока (not role=complementary)",
    };
  });

  if (mode !== "quick") {
    await step("OVERFLOW", async () => {
      const viewport = await captureViewport(browser);
      report.viewport = viewport;
      if (!viewport.overflowOk) {
        throw new FlowError(
          "LAYOUT",
          `horizontal overflow scrollWidth=${viewport.scrollWidth} clientWidth=${viewport.clientWidth} viewport=${viewport.width}x${viewport.height}`,
          { productFailure: true },
        );
      }
      return viewport;
    });
  } else {
    report.OVERFLOW = { status: "skip" };
  }

  await step("BOARD", async () => {
    openedBoard = await openExistingBoard(browser);
    report["BOARD CLICK"] = openedBoard.boardClick || "PASS";
    report["BOARD NAVIGATION"] = openedBoard.navigation || "other";
    report.CLASSIFICATION = openedBoard.classification || "";
    await screenshot(browser, "07-board-open");
    return {
      navigation: openedBoard.navigation,
      container: openedBoard.container,
      classification: openedBoard.classification,
      clickedSelector: openedBoard.clickedSelector,
    };
  });

  await step("CANVAS", async () => {
    const size = await waitForBoardReady(browser, openedBoard);
    await leaveBoardFrame(browser);
    const boardCount = countBoardIframes(await listIframes(browser));
    if (boardCount !== 1) {
      throw new FlowError(
        "CANVAS",
        `board iframe count ${boardCount} after board open`,
        {
          productFailure: boardCount < 1,
          classification: boardCount < 1 ? "PRODUCT BUG" : "TEST BUG",
          boardClick: "PASS",
        },
      );
    }
    report["BOARD CONTAINER"] = "PASS";
    await screenshot(browser, "07b-board-canvas");
    return { ...size, boardIframes: boardCount };
  });

  if (mode === "quick") {
    await step("QUICK", async () => {
      const quick = await runQuickBoardSession(browser, openedBoard);
      openedBoard = quick.opened;
      report.CORE_FLOW = "PASS";
      report.ROUND_1 = { status: "ok", detail: { strokes: 3 } };
      report.ROUND_2 = { status: "ok", detail: { strokes: 3 } };
      report.ROUND_3 = { status: "ok", detail: { strokes: 3 } };
      report.CONTROL = { status: "ok", detail: { strokes: 1 } };
      report.loginMs = report.durations.LOGIN || null;
      report.jitsiJoinMs = report.durations["JITSI JOIN"] || null;
      report.boardOpenMs = report.durations.BOARD || null;
      report.strokeMs = quick.strokeMs;
      report.tabCycleMs = quick.tabCycleMs;
      report.tabCycles = quick.tabCycles;
      report.FREEZE_CHECKED = Boolean(quick.freezeChecked);
      report.FREEZE = quick.freezeChecked ? "none" : "not_checked";
      console.log(`QUICK timings loginMs=${report.loginMs} jitsiJoinMs=${report.jitsiJoinMs} boardOpenMs=${report.boardOpenMs} tabCycleMs=${report.tabCycleMs} strokeMs=${JSON.stringify(report.strokeMs)}`);
      return quick;
    });
  } else if (mode === "core") {
    const coreDraws = [];
    await step("DRAW_1", async () => {
      const record = await performMeasuredStroke(browser, openedBoard, { index: 1, variant: "normal", successCount: 0 });
      coreDraws.push(record);
      await screenshot(browser, "08-draw-1");
      console.log(`CORE stroke 1/3 PASS ${record.durationMs}ms`);
      return record;
    });
    await step("DRAW_2", async () => {
      const record = await performMeasuredStroke(browser, openedBoard, { index: 2, variant: "normal", successCount: 1 });
      coreDraws.push(record);
      await screenshot(browser, "08-draw-2");
      console.log(`CORE stroke 2/3 PASS ${record.durationMs}ms`);
      return record;
    });
    await step("DRAW_3", async () => {
      const record = await performMeasuredStroke(browser, openedBoard, { index: 3, variant: "normal", successCount: 2 });
      coreDraws.push(record);
      await screenshot(browser, "08-draw-3");
      console.log(`CORE stroke 3/3 PASS ${record.durationMs}ms`);
      report.DRAW = { status: "ok", detail: { count: 3 } };
      return record;
    });
    await step("TAB_CYCLE", async () => {
      const restored = await runCoreTabRestore(browser, openedBoard);
      openedBoard = restored.opened;
      return restored;
    });
    await step("DRAW_AFTER_TAB", async () => {
      const record = await performMeasuredStroke(browser, openedBoard, { index: 4, variant: "normal", successCount: 3 });
      await screenshot(browser, "09-draw-after-tab");
      console.log(`CORE stroke after tab PASS ${record.durationMs}ms`);
      return record;
    });
    report.CORE_FLOW = "PASS";
    report.coreDraws = coreDraws;
  } else {
    await step("DRAW", async () => {
      await drawStroke(browser, openedBoard, { firstDraw: true });
      await waitForBoardReady(browser, openedBoard);
      await screenshot(browser, "08-board-after-draw");
      await leaveBoardFrame(browser);
      report.CORE_FLOW = "PASS";
      return { stroke: true };
    });
  }

  if (mode === "smoke") {
    report.SMOKE_STARTED = true;
    await step("SMOKE", async () => {
      try {
        const smoke = await runSmokeBoardSession(browser, openedBoard);
        openedBoard = smoke.opened;
        report.SMOKE_COMPLETED = Boolean(smoke.completed);
        report.FREEZE_CHECKED = Boolean(smoke.freezeChecked);
        report.FREEZE = smoke.freezeChecked ? "none" : "not_checked";
        report.firstStrokeMs = smoke.firstStrokeMs;
        report.medianStrokeMs = smoke.medianStrokeMs;
        report.lastStrokeMs = smoke.lastStrokeMs;
        report.maxStrokeMs = smoke.maxStrokeMs;
        return smoke;
      } catch (err) {
        report.SMOKE_STARTED = true;
        report.SMOKE_COMPLETED = false;
        report.FREEZE_CHECKED = false;
        if (err && err.classification === "BOARD FREEZE") report.FREEZE = "BOARD FREEZE";
        else report.FREEZE = "not_checked";
        throw err;
      }
    });
  } else if (mode === "stress") {
    report.SMOKE_STARTED = false;
    await step("STRESS", async () => {
      try {
        const stress = await runStressBoardSession(browser, openedBoard, { testMinutes });
        openedBoard = stress.opened;
        report.FREEZE_CHECKED = Boolean(stress.freezeChecked);
        report.FREEZE = stress.freezeChecked ? "none" : "not_checked";
        report.checkpoints = stress.checkpoints;
        return stress;
      } catch (err) {
        report.FREEZE_CHECKED = false;
        if (err && err.classification === "BOARD FREEZE") report.FREEZE = "BOARD FREEZE";
        else report.FREEZE = "not_checked";
        throw err;
      }
    });
  }

  report.RESULT = "passed";
  return report;
}

module.exports = { runRoomFlow };
