#!/usr/bin/env node
/**
 * BrowserStack Automate real-mobile matrix for the lesson-room Selenium flow.
 * Device list comes from GET /automate/browsers.json (not App Automate).
 * Concurrency is min(devices, BrowserStack parallel_sessions_max_allowed) unless DEVICE_CONCURRENCY is set.
 */

const fs = require("fs");
const path = require("path");
const { remote } = require("webdriverio");
const { secrets } = require("./helpers/env");
const {
  setArtifactRoot,
  resetArtifactRoot,
  screenshot,
  markSession,
  redactSecrets,
  DEFAULT_ROOT,
  browserStackSessionUrl,
} = require("./helpers/artifacts");
const { classifyVendorError, MATRIX, boardSummaryLines, isSessionGone, isBrowserStackQuotaError } = require("./helpers/classify");
const {
  fetchAutomateBrowsers,
  buildDeviceMatrix,
  sanitizeDeviceSlug,
  parseMatrixEnv,
} = require("./helpers/catalog");
const { fetchAutomatePlan, planMaxAllowed, resolveConcurrency } = require("./helpers/plan");
const { deviceRunTimeoutMs, browserStackIdleTimeout, withWatchdog } = require("./helpers/timeouts");
const { captureFailureContext, failedStepOf } = require("./helpers/board-health");
const { DeviceRunLifecycle, runWithLifecycle } = require("./helpers/lifecycle");
const { runRoomFlow } = require("./tests/01-room-flow");

const QUICK_SUMMARY_KEYS = [
  "DEVICE",
  "OS",
  "BROWSER",
  "ORIENTATION",
  "ATTEMPT",
  "LOGIN",
  "MIC",
  "JITSI",
  "MATERIALS",
  "BOARD",
  "CANVAS",
  "QUICK",
  "ROUND_1",
  "ROUND_2",
  "ROUND_3",
  "CONTROL",
  "SESSION_CLEANUP",
  "RESULT",
  "DURATION",
  "loginMs",
  "jitsiJoinMs",
  "boardOpenMs",
  "tabCycleMs",
];

const CORE_SUMMARY_KEYS = [
  "DEVICE",
  "OS",
  "BROWSER",
  "ORIENTATION",
  "LOGIN",
  "MIC",
  "JITSI",
  "CALL",
  "MATERIALS",
  "OVERFLOW",
  "BOARD",
  "CANVAS",
  "DRAW_1",
  "DRAW_2",
  "DRAW_3",
  "TAB_CYCLE",
  "DRAW_AFTER_TAB",
  "SESSION_CLEANUP",
  "RESULT",
  "DURATION",
];

const SUMMARY_KEYS = [
  "DEVICE",
  "OS",
  "BROWSER",
  "ORIENTATION",
  "MODE",
  "SESSION_CLEANUP",
  "LOGIN",
  "MIC",
  "JITSI",
  "CALL",
  "MATERIALS",
  "OVERFLOW",
  "BOARD",
  "CANVAS",
  "DRAW",
  "DRAW_1",
  "DRAW_2",
  "DRAW_3",
  "TAB_CYCLE",
  "DRAW_AFTER_TAB",
  "CORE_FLOW",
  "SMOKE",
  "SMOKE_STARTED",
  "SMOKE_COMPLETED",
  "STRESS",
  "FREEZE",
  "FREEZE_CHECKED",
  "RESULT",
  "DURATION",
];

function summaryKeysFor(mode) {
  if (mode === "quick") return QUICK_SUMMARY_KEYS;
  if (mode === "core") return CORE_SUMMARY_KEYS;
  return SUMMARY_KEYS;
}

function capabilities(creds, run, opts = {}) {
  const mode = opts.mode || "core";
  const caps = {
    browserName: run.browserName,
    "bstack:options": {
      deviceName: run.device,
      osVersion: run.osVersion,
      realMobile: true,
      deviceOrientation: run.orientation,
      projectName: "itflux lesson-room",
      buildName: mode === "stress"
        ? "e2e-real-devices stress-matrix"
        : (mode === "quick"
          ? "e2e-real-devices quick-matrix"
          : (mode === "core" ? "e2e-real-devices core-matrix" : "e2e-real-devices smoke-matrix")),
      idleTimeout: browserStackIdleTimeout(mode),
      sessionName: `${mode} ${run.device} ${run.osVersion} ${run.browserName} ${run.orientation}`,
      debug: true,
      networkLogs: true,
      userName: creds.username,
      accessKey: creds.accessKey,
    },
  };
  if (run.osFamily === "ios") {
    caps["appium:safariAllowPopups"] = true;
  }
  return caps;
}

function stepStatus(report, key) {
  const value = report && report[key];
  if (value == null || value === "pending") return "pending";
  if (value === "PASS" || value === "passed" || value === "ok") return "PASS";
  if (value === "FAIL" || value === "failed") return "FAIL";
  if (typeof value === "object") {
    if (value.status === "ok") return "PASS";
    if (value.status === "fail") return "FAIL";
    if (value.status === "skip") return "SKIP";
  }
  return String(value);
}

function durationLabel(ms) {
  const seconds = Math.max(0, Number(ms) || 0) / 1000;
  return `${seconds.toFixed(1)}s`;
}

function rowFromReport(run, report, result, durationMs, slug) {
  const mode = (report && report.MODE) || run.mode || "core";
  const smokeStarted = Boolean(report && report.SMOKE_STARTED);
  const smokeCompleted = Boolean(report && report.SMOKE_COMPLETED);
  const freezeChecked = Boolean(report && report.FREEZE_CHECKED);
  const freezeValue = report && report.FREEZE;
  const freeze = freezeValue && freezeValue !== "not_checked"
    ? freezeValue
    : (freezeChecked ? (freezeValue || "none") : "not_checked");
  return {
    DEVICE: run.device,
    OS: `${run.osFamily} ${run.osVersion}`,
    BROWSER: run.browserName,
    ORIENTATION: run.orientation,
    MODE: mode,
    SESSION_CLEANUP: (report && report.SESSION_CLEANUP) || "pending",
    LOGIN: stepStatus(report, "LOGIN"),
    MIC: stepStatus(report, "NATIVE MIC ALLOW"),
    JITSI: stepStatus(report, "JITSI JOIN"),
    CALL: stepStatus(report, "CALL"),
    MATERIALS: stepStatus(report, "MATERIALS"),
    BOARD: stepStatus(report, "BOARD"),
    CANVAS: stepStatus(report, "CANVAS"),
    DRAW: stepStatus(report, "DRAW"),
    DRAW_1: stepStatus(report, "DRAW_1"),
    DRAW_2: stepStatus(report, "DRAW_2"),
    DRAW_3: stepStatus(report, "DRAW_3"),
    TAB_CYCLE: stepStatus(report, "TAB_CYCLE"),
    DRAW_AFTER_TAB: stepStatus(report, "DRAW_AFTER_TAB"),
    CORE_FLOW: report && report.CORE_FLOW ? report.CORE_FLOW : (
      mode === "core"
        ? (stepStatus(report, "DRAW_AFTER_TAB") === "PASS" ? "PASS" : "incomplete")
        : (stepStatus(report, "DRAW") === "PASS" ? "PASS" : "incomplete")
    ),
    SMOKE: mode === "smoke" ? stepStatus(report, "SMOKE") : "skip",
    SMOKE_STARTED: smokeStarted ? "yes" : "no",
    SMOKE_COMPLETED: smokeCompleted ? "yes" : "no",
    STRESS: mode === "stress" ? stepStatus(report, "STRESS") : "skip",
    OVERFLOW: stepStatus(report, "OVERFLOW"),
    FREEZE: freeze,
    FREEZE_CHECKED: freezeChecked ? "yes" : "no",
    RESULT: result,
    DURATION: durationLabel(durationMs),
    ATTEMPT: (report && report.attempt) || 1,
    QUICK: mode === "quick" ? stepStatus(report, "QUICK") : "skip",
    ROUND_1: stepStatus(report, "ROUND_1"),
    ROUND_2: stepStatus(report, "ROUND_2"),
    ROUND_3: stepStatus(report, "ROUND_3"),
    CONTROL: stepStatus(report, "CONTROL"),
    loginMs: report && report.loginMs != null ? report.loginMs : (report && report.durations && report.durations.LOGIN) || null,
    jitsiJoinMs: report && report.jitsiJoinMs != null ? report.jitsiJoinMs : (report && report.durations && report.durations["JITSI JOIN"]) || null,
    boardOpenMs: report && report.boardOpenMs != null ? report.boardOpenMs : (report && report.durations && report.durations.BOARD) || null,
    tabCycleMs: report && report.tabCycleMs != null ? report.tabCycleMs : null,
    strokeMs: report && report.strokeMs ? report.strokeMs : null,
    loginDiag: report && report.loginDiag ? report.loginDiag : null,
    submitClicked: report && report.submitClicked != null ? report.submitClicked : null,
    durationMs,
    slug,
    viewport: report && report.viewport ? report.viewport : null,
    classification: (report && (report.CLASSIFICATION || report.classification)) || result,
    checkpoints: report && report.checkpoints ? report.checkpoints : null,
    failedStep: (report && report.failedStep) || failedStepOf(report),
    exactError: (report && report.exactError) || (report && report.error) || null,
    productFailure: Boolean(report && report.productFailure),
    sessionId: (report && report.sessionId) || null,
    sessionUrl: browserStackSessionUrl((report && report.sessionId) || null),
    durations: (report && report.durations) || null,
  };
}

function writeDeviceResult(dir, payload) {
  const file = path.join(dir, "result.json");
  const redacted = JSON.parse(redactSecrets(JSON.stringify(payload)));
  fs.writeFileSync(file, JSON.stringify(redacted, null, 2));
  return file;
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function passish(value) {
  return value === "PASS" || value === "SKIP" || value === "ok";
}

function compactStatus(row) {
  if (row && (row.quotaSkip || row.sessionStarted === false)) {
    return { CORE: "-", BOARD: "-", DRAW: "-", FREEZE: "-", RESULT: row.RESULT };
  }
  const core = passish(row.LOGIN) && passish(row.MIC) && passish(row.JITSI) && passish(row.CALL) && passish(row.MATERIALS)
    ? "PASS"
    : "FAIL";
  const board = passish(row.BOARD) && passish(row.CANVAS) ? "PASS" : "FAIL";
  const draw = passish(row.DRAW) || (passish(row.DRAW_1) && (passish(row.DRAW_AFTER_TAB) || passish(row.QUICK)))
    ? "PASS"
    : (row.DRAW === "pending" && row.DRAW_1 === "pending" ? "-" : "FAIL");
  const freeze = row.FREEZE === "BOARD FREEZE" || row.FREEZE === "FAIL"
    ? "FAIL"
    : (row.RESULT === MATRIX.PASS || (row.FREEZE_CHECKED === "yes" && row.FREEZE === "none") ? "PASS" : "-");
  return { CORE: core, BOARD: board, DRAW: draw, FREEZE: freeze, RESULT: row.RESULT };
}

function printCompact(rows, extras = {}) {
  if (extras.globalReason === "BROWSERSTACK_QUOTA_EXPIRED") {
    console.log("\nBROWSERSTACK_QUOTA_EXPIRED");
    console.log("BrowserStack quota unavailable — matrix execution skipped before test steps.");
    console.log(JSON.stringify({
      planned: extras.planned != null ? extras.planned : (rows || []).length,
      sessionsStarted: extras.sessionsStarted != null ? extras.sessionsStarted : (rows || []).filter((row) => row.sessionStarted).length,
      skippedBeforeSession: extras.skippedBeforeSession != null
        ? extras.skippedBeforeSession
        : (rows || []).filter((row) => row.sessionStarted === false).length,
    }));
    const ran = (rows || []).filter((row) => row.sessionStarted);
    const skipped = (rows || []).filter((row) => !row.sessionStarted);
    if (ran.length) {
      const keys = ["DEVICE", "CORE", "BOARD", "DRAW", "FREEZE", "RESULT"];
      const view = ran.map((row) => ({ DEVICE: row.DEVICE, ...compactStatus(row) }));
      console.log("\nRAN");
      printTable(view, keys);
    }
    if (skipped.length) {
      console.log("\nSKIPPED (no BrowserStack session)");
      skipped.forEach((row) => {
        console.log(`${row.DEVICE} — ${row.RESULT} — ${row.classification || "BROWSERSTACK_QUOTA_EXPIRED"}`);
      });
    }
    return;
  }
  const keys = ["DEVICE", "CORE", "BOARD", "DRAW", "FREEZE", "RESULT"];
  const view = (rows || []).map((row) => ({ DEVICE: row.DEVICE, ...compactStatus(row) }));
  printTable(view, keys);
  const fails = (rows || []).filter((row) => row.RESULT && row.RESULT !== MATRIX.PASS);
  if (!fails.length) {
    console.log("\nROOM WORKS");
    return;
  }
  console.log("\nROOM BROKEN");
  console.log("FAILURES");
  fails.forEach((row, index) => {
    console.log(`${index + 1}. ${row.DEVICE} — ${row.failedStep || row.RESULT} — ${row.classification || row.RESULT}${row.sessionUrl ? ` ${row.sessionUrl}` : ""}`);
  });
}

function printTable(rows, keys = SUMMARY_KEYS) {
  const widths = {};
  for (const key of keys) {
    widths[key] = key.length;
    for (const row of rows) {
      widths[key] = Math.max(widths[key], String(row[key] == null ? "" : row[key]).length);
    }
  }
  const line = (row) => keys.map((key) => String(row[key] == null ? "" : row[key]).padEnd(widths[key])).join("  ");
  const header = {};
  for (const key of keys) header[key] = key;
  console.log(line(header));
  console.log(keys.map((key) => "-".repeat(widths[key])).join("  "));
  for (const row of rows) console.log(line(row));
}

function totalsOf(rows) {
  const totals = {
    TOTAL: rows.length,
    PASS: 0,
    PRODUCT_FAIL: 0,
    INFRA_SKIP: 0,
    PERMISSION_LIMITATION: 0,
    TEST_BUG: 0,
    UNSUPPORTED: 0,
  };
  for (const row of rows) {
    if (row.RESULT === MATRIX.PASS) totals.PASS += 1;
    else if (row.RESULT === MATRIX.PRODUCT_FAIL) totals.PRODUCT_FAIL += 1;
    else if (row.RESULT === MATRIX.INFRA_SKIP) totals.INFRA_SKIP += 1;
    else if (row.RESULT === MATRIX.PERMISSION_LIMITATION) totals.PERMISSION_LIMITATION += 1;
    else if (row.RESULT === MATRIX.TEST_BUG) totals.TEST_BUG += 1;
    else if (row.RESULT === MATRIX.UNSUPPORTED_DEVICE) totals.UNSUPPORTED += 1;
  }
  return totals;
}

function writeSummary(rows, totals, opts, catalogCount) {
  fs.mkdirSync(DEFAULT_ROOT, { recursive: true });
  const keys = summaryKeysFor(opts.mode);
  const stem = opts.mode === "stress"
    ? "stress-matrix-summary"
    : (opts.mode === "quick"
      ? "quick-matrix-summary"
      : (opts.mode === "core" ? "core-matrix-summary" : "device-matrix-summary"));
  const jsonPath = path.join(DEFAULT_ROOT, `${stem}.json`);
  const csvPath = path.join(DEFAULT_ROOT, `${stem}.csv`);
  const payload = {
    generatedAt: new Date().toISOString(),
    filters: opts,
    catalogCount,
    plannedDevices: totals.PLANNED != null ? totals.PLANNED : rows.length,
    sessionsStarted: totals.SESSIONS_STARTED != null
      ? totals.SESSIONS_STARTED
      : rows.filter((row) => row.sessionStarted).length,
    skippedBeforeSession: totals.SKIPPED_BEFORE_SESSION != null
      ? totals.SKIPPED_BEFORE_SESSION
      : rows.filter((row) => row.sessionStarted === false).length,
    globalReason: totals.GLOBAL_REASON || null,
    totals,
    rows: rows.map((row) => {
      const copy = {};
      for (const key of keys) copy[key] = row[key];
      copy.slug = row.slug;
      copy.viewport = row.viewport || null;
      copy.classification = row.classification || null;
      copy.failedStep = row.failedStep || null;
      copy.exactError = row.exactError || null;
      copy.productFailure = Boolean(row.productFailure);
      copy.confirmedProductFail = Boolean(row.confirmedProductFail);
      copy.checkpoints = row.checkpoints || null;
      copy.retried = row.retried || false;
      copy.attempt = row.ATTEMPT || row.attempt || 1;
      copy.loginMs = row.loginMs != null ? row.loginMs : null;
      copy.jitsiJoinMs = row.jitsiJoinMs != null ? row.jitsiJoinMs : null;
      copy.boardOpenMs = row.boardOpenMs != null ? row.boardOpenMs : null;
      copy.tabCycleMs = row.tabCycleMs != null ? row.tabCycleMs : null;
      copy.strokeMs = row.strokeMs || null;
      copy.loginDiag = row.loginDiag || null;
      copy.submitClicked = row.submitClicked != null ? row.submitClicked : null;
      copy.note = row.note || null;
      copy.sessionId = row.sessionId || null;
      copy.sessionUrl = row.sessionUrl || null;
      copy.sessionStarted = row.sessionStarted !== false && Boolean(row.sessionId);
      copy.quotaSkip = Boolean(row.quotaSkip);
      copy.durations = row.durations || null;
      return copy;
    }),
  };
  fs.writeFileSync(jsonPath, redactSecrets(JSON.stringify(payload, null, 2)));
  const csv = [
    keys.join(","),
    ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(",")),
  ].join("\n");
  fs.writeFileSync(csvPath, csv);
  return { jsonPath, csvPath };
}

function createSessionGate() {
  let reason = null;
  return {
    get stopped() { return Boolean(reason); },
    get reason() { return reason; },
    stop(next) {
      if (!reason && next) reason = next;
    },
  };
}

function quotaReason(err) {
  const classified = err && err.matrixResult ? err : classifyVendorError(err);
  return {
    code: "BROWSERSTACK_QUOTA_EXPIRED",
    message: String((classified && classified.error) || (err && err.message) || err || "Automate testing time expired"),
    classification: "ENVIRONMENT BUG",
  };
}

function skippedBeforeSessionRow(run, reason, { attempt = 1, opts = {} } = {}) {
  const slug = sanitizeDeviceSlug(run);
  const message = String((reason && reason.message) || reason || "Automate testing time expired");
  const report = {
    MODE: opts.mode || run.mode || "core",
    attempt,
    CLASSIFICATION: "ENVIRONMENT BUG",
    failedStep: null,
    exactError: message,
    SESSION_CLEANUP: "skip",
  };
  const row = rowFromReport(run, report, MATRIX.INFRA_SKIP, 0, slug);
  row.sessionStarted = false;
  row.quotaSkip = true;
  row.classification = "BROWSERSTACK_QUOTA_EXPIRED";
  row.code = "BROWSERSTACK_QUOTA_EXPIRED";
  row.exactError = message;
  row.note = "BrowserStack quota unavailable — matrix execution skipped before test steps.";
  row.SESSION_CLEANUP = "skip";
  return row;
}

function rowLooksLikeQuota(row) {
  if (!row) return false;
  if (row.quotaSkip) return true;
  return isBrowserStackQuotaError({
    message: row.exactError || row.error,
    code: row.code || row.classification,
  });
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: items.length ? n : 0 }, () => worker()));
  return out;
}

async function runOne(creds, run, { attempt = 1, opts = parseMatrixEnv(process.env), gate = null } = {}) {
  if (gate && gate.stopped) {
    return skippedBeforeSessionRow(run, gate.reason, { attempt, opts });
  }
  const life = new DeviceRunLifecycle();
  return runWithLifecycle(life, async () => {
    const slug = `${sanitizeDeviceSlug(run)}${attempt > 1 ? `-retry${attempt}` : ""}`;
    const dir = path.join(DEFAULT_ROOT, slug);
    fs.mkdirSync(path.join(dir, "screenshots"), { recursive: true });
    fs.mkdirSync(path.join(dir, "diagnostics"), { recursive: true });
    setArtifactRoot(dir);
    const started = Date.now();
    const deviceLabel = `${run.device} / ${run.osFamily} ${run.osVersion} / ${run.browserName} / ${run.orientation}`;
    console.log(`\n=== ${opts.mode} ${deviceLabel}${attempt > 1 ? ` retry ${attempt}` : ""} ===`);
    let browser = null;
    let row;
    let sessionStarted = false;
    let cleanup = { status: "FAIL", ok: false, timers: -1, pending: -1, browser: "unset" };
    try {
      if (gate && gate.stopped) {
        row = skippedBeforeSessionRow(run, gate.reason, { attempt, opts });
      } else {
      browser = await remote({
        protocol: "https",
        hostname: "hub.browserstack.com",
        port: 443,
        path: "/wd/hub",
        user: creds.username,
        key: creds.accessKey,
        logLevel: "warn",
        capabilities: capabilities(creds, run, opts),
      });
      life.attachBrowser(browser);
      sessionStarted = Boolean(browser && browser.sessionId);
      const sessionId = browser.sessionId || null;
      const report = await life.track(withWatchdog(
        () => runRoomFlow(browser, creds, {
          platform: run.osFamily,
          deviceLabel,
          orientation: run.orientation,
          boardTestMode: opts.mode,
          testMinutes: opts.testMinutes,
          sessionId,
        }),
        { timeoutMs: deviceRunTimeoutMs(opts.mode), label: `${opts.mode} ${deviceLabel}` },
      ));
      report.sessionId = sessionId;
      await markSession(browser, "passed", `PASS ${opts.mode} ${deviceLabel}`.slice(0, 255));
      row = rowFromReport(run, report, MATRIX.PASS, Date.now() - started, slug);
      }
    } catch (err) {
      if (browser && browser.sessionId) err.sessionWasAlive = true;
      sessionStarted = sessionStarted || Boolean(browser && browser.sessionId);
      const classified = classifyVendorError(err);
      if (isBrowserStackQuotaError(err) || isBrowserStackQuotaError(classified)) {
        const reason = quotaReason(classified);
        if (gate) gate.stop(reason);
        console.log("BROWSERSTACK_QUOTA_EXPIRED — stopping further BrowserStack session creation");
        row = skippedBeforeSessionRow(run, reason, { attempt, opts });
        row.DURATION = durationLabel(Date.now() - started);
        row.durationMs = Date.now() - started;
        writeDeviceResult(dir, {
          run,
          result: MATRIX.INFRA_SKIP,
          attempt,
          failedStep: null,
          exactError: reason.message,
          productFailure: false,
          classification: "BROWSERSTACK_QUOTA_EXPIRED",
          code: "BROWSERSTACK_QUOTA_EXPIRED",
          error: reason.message,
          report: classified,
          row,
        });
        console.log(`${deviceLabel} → ${MATRIX.INFRA_SKIP}`);
        console.log(`BROWSERSTACK_QUOTA_EXPIRED exactError=${reason.message}`);
      } else {
      const report = Object.assign({}, classified, err && err.boardReport ? err.boardReport : {});
      report.sessionId = (browser && browser.sessionId) || report.sessionId || null;
      report.failedStep = report.failedStep || (err && err.failedStep) || failedStepOf(report);
      report.exactError = classified.error || String((err && err.message) || err);
      report.productFailure = classified.productFailure;
      report.CLASSIFICATION = classified.classification || report.CLASSIFICATION;
      report.SMOKE_COMPLETED = Boolean(report.SMOKE_COMPLETED);
      report.FREEZE_CHECKED = Boolean(report.FREEZE_CHECKED);
      if (!report.SMOKE_COMPLETED && report.FREEZE !== "BOARD FREEZE") {
        report.FREEZE_CHECKED = false;
        if (report.FREEZE !== "BOARD FREEZE") report.FREEZE = report.FREEZE && report.FREEZE !== "pending" ? report.FREEZE : "not_checked";
      }
      let failContext = null;
      const sessionGone = isSessionGone(err) || Boolean(report.sessionDead);
      if (sessionGone) {
        console.log("BrowserStack session is gone — skip further DOM commands, cleanup, next device");
        if (life && life.isLive()) life.abortOperation();
      }
      if (browser && life.isLive() && !sessionGone) {
        failContext = await life.track(captureFailureContext(browser, {
          failedStep: report.failedStep,
          exactError: report.exactError,
          productFailure: classified.productFailure,
          classification: classified.classification,
          device: run.device,
          os: `${run.osFamily} ${run.osVersion}`,
          viewport: report.viewport,
          screenshotName: "failure",
        })).catch(() => null);
        await markSession(browser, "failed", String(classified.code || classified.matrixResult || "failed").slice(0, 255)).catch(() => {});
      }
      const result = classified.matrixResult || MATRIX.TEST_BUG;
      row = rowFromReport(run, report, result, Date.now() - started, slug);
      row.classification = classified.classification || classified.code || result;
      row.failedStep = report.failedStep;
      row.exactError = report.exactError;
      row.productFailure = classified.productFailure;
      row.loginDiag = report.loginDiag || (err && err.loginDiag) || null;
      row.submitClicked = report.submitClicked != null
        ? report.submitClicked
        : (err && err.submitClicked);
      if (failContext) {
        row.boardIframeCount = failContext.boardIframeCount;
        row.canvas = failContext.canvas;
        if (!row.viewport && failContext.viewport) row.viewport = failContext.viewport;
      }
      if (classified.classification === "BOARD FREEZE" && classified.productFailure) {
        row.FREEZE = "BOARD FREEZE";
      }
      if (!report.FREEZE_CHECKED) {
        row.FREEZE_CHECKED = "no";
        if (row.FREEZE !== "BOARD FREEZE") row.FREEZE = "not_checked";
      }
      writeDeviceResult(dir, {
        run,
        result,
        attempt,
        failedStep: report.failedStep,
        exactError: report.exactError,
        productFailure: classified.productFailure,
        classification: classified.classification,
        code: classified.code || null,
        error: classified.error || String((err && err.message) || err),
        failContext,
        report,
        row,
      });
      console.log(`${deviceLabel} → ${result}`);
      console.log(`failedStep=${report.failedStep} exactError=${report.exactError}`);
      for (const line of boardSummaryLines(report)) console.log(line);
      }
    } finally {
      cleanup = await life.dispose();
      browser = null;
      resetArtifactRoot();
      console.log(`SESSION_CLEANUP=${cleanup.status} timers=${cleanup.timers} pending=${cleanup.pending} browser=${cleanup.browser}`);
      if (cleanup.status !== "PASS" && !(row && row.quotaSkip)) {
        console.log(`SESSION_CLEANUP FAIL deleteOk=${cleanup.deleteOk} deleteError=${cleanup.deleteError || ""}`);
      }
    }

    if (!row) {
      row = rowFromReport(run, {}, MATRIX.TEST_BUG, Date.now() - started, slug);
    }
    row.sessionStarted = Boolean(sessionStarted) && !row.quotaSkip;
    if (row.quotaSkip) {
      row.SESSION_CLEANUP = cleanup.status === "PASS" ? "PASS" : "skip";
    } else {
      row.SESSION_CLEANUP = cleanup.status;
    }
    row.cleanup = cleanup;
    writeDeviceResult(dir, {
      run,
      row,
      attempt,
      cleanup,
      result: row.RESULT,
      failedStep: row.failedStep || null,
      exactError: row.exactError || null,
      classification: row.classification || null,
      productFailure: Boolean(row.productFailure),
    });
    if (row.RESULT === MATRIX.PASS) console.log(`${deviceLabel} → ${MATRIX.PASS}`);
    return row;
  });
}

function sameProductDefect(a, b) {
  if (!a || !b) return false;
  if (a.RESULT !== MATRIX.PRODUCT_FAIL || b.RESULT !== MATRIX.PRODUCT_FAIL) return false;
  if (a.failedStep && b.failedStep && a.failedStep !== b.failedStep) return false;
  const ac = String(a.classification || "");
  const bc = String(b.classification || "");
  if (ac && bc && ac !== bc) return false;
  return true;
}

function shouldRetryRun(row, mode) {
  if (!row) return false;
  if (rowLooksLikeQuota(row)) return false;
  if (row.RESULT === MATRIX.INFRA_SKIP) return true;
  if (row.RESULT === MATRIX.PRODUCT_FAIL) return true;
  if (
    mode === "quick"
    && row.failedStep === "LOGIN"
    && row.RESULT !== MATRIX.INFRA_SKIP
    && row.RESULT !== MATRIX.UNSUPPORTED_DEVICE
  ) {
    return true;
  }
  return false;
}

function mergeRetryRows(first, second) {
  const a = { ...first, ATTEMPT: 1, attempt: 1, retried: true };
  const b = {
    ...second,
    ATTEMPT: 2,
    attempt: 2,
    retried: true,
    firstResult: first.RESULT,
    firstError: first.exactError,
  };
  if (sameProductDefect(first, second)) {
    a.confirmedProductFail = true;
    b.confirmedProductFail = true;
    b.note = "same UI defect on two consecutive runs";
  } else if (b.RESULT === MATRIX.PASS) {
    b.note = "retry PASS; first FAIL kept separately — not collapsed to PASS";
  } else {
    b.note = "second attempt also failed; first FAIL kept separately";
  }
  return [a, b];
}

function matrixExitCode(rows) {
  if ((rows || []).some((row) => row.confirmedProductFail)) return 1;
  if ((rows || []).some((row) => row.RESULT === MATRIX.PRODUCT_FAIL && !row.retried)) return 1;
  return 0;
}

async function runOneWithRetry(creds, run, opts, gate) {
  if (gate && gate.stopped) {
    return [skippedBeforeSessionRow(run, gate.reason, { attempt: 1, opts })];
  }
  const first = await runOne(creds, run, { attempt: 1, opts, gate });
  first.ATTEMPT = 1;
  first.attempt = 1;
  if (rowLooksLikeQuota(first) || (gate && gate.stopped) || !shouldRetryRun(first, opts.mode)) {
    return [first];
  }
  console.log(`${first.RESULT} on ${run.device} — independent retry; first FAIL is kept even if retry PASSes`);
  if (gate && gate.stopped) return [first];
  const second = await runOne(creds, run, { attempt: 2, opts, gate });
  return mergeRetryRows(first, second);
}

async function main() {
  let creds;
  try {
    creds = secrets();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const opts = parseMatrixEnv(process.env);
  let catalog;
  try {
    catalog = await fetchAutomateBrowsers(creds);
  } catch (err) {
    console.error(`Failed to fetch BrowserStack Automate browsers.json: ${err.message}`);
    process.exit(2);
  }

  const matrix = buildDeviceMatrix(catalog, process.env);
  let plan = null;
  try {
    plan = await fetchAutomatePlan(creds);
  } catch (err) {
    console.log(`BrowserStack plan.json unavailable (${err.message}); using DEVICE_CONCURRENCY or BROWSERSTACK_PARALLEL`);
  }
  const envFallback = Number(process.env.BROWSERSTACK_PARALLEL) || 0;
  const concurrency = resolveConcurrency({
    configured: matrix.opts.concurrency,
    envFallback,
    planMax: planMaxAllowed(plan),
    running: plan ? Number(plan.parallel_sessions_running) || 0 : 0,
    deviceCount: matrix.runs.length,
  });
  matrix.opts.resolvedConcurrency = concurrency;
  matrix.opts.planMax = planMaxAllowed(plan) || envFallback || null;
  console.log(JSON.stringify({
    DEVICE_OS: opts.os,
    DEVICE_KIND: opts.kind,
    MAX_DEVICES: opts.maxDevices,
    DEVICE_CONCURRENCY: opts.concurrency,
    RESOLVED_CONCURRENCY: concurrency,
    BROWSERSTACK_PARALLEL_MAX: matrix.opts.planMax,
    BOARD_TEST_MODE: opts.mode,
    DEVICE_NAME: opts.deviceNames,
    DEVICE_OS_VERSION: opts.deviceOsVersion,
  }));
  console.log(`catalog real-mobile candidates: ${matrix.selected.length}; runs: ${matrix.runs.length}; parallel: ${concurrency}`);
  if (!matrix.runs.length) {
    console.log("No matching real-mobile Automate devices after filters.");
    writeSummary([], totalsOf([]), matrix.opts, Array.isArray(catalog) ? catalog.length : 0);
    process.exit(0);
  }

  const gate = createSessionGate();
  const nested = await mapPool(matrix.runs, concurrency, (run) => runOneWithRetry(creds, run, matrix.opts, gate));
  const rows = nested.flat();
  const totals = totalsOf(rows);
  totals.PLANNED = matrix.runs.length;
  totals.SESSIONS_STARTED = rows.filter((row) => row.sessionStarted).length;
  totals.SKIPPED_BEFORE_SESSION = rows.filter((row) => row.sessionStarted === false).length;
  totals.CONFIRMED_PRODUCT_FAIL = rows.filter((row) => row.confirmedProductFail).length;
  totals.GLOBAL_REASON = gate.stopped || rows.some(rowLooksLikeQuota) ? "BROWSERSTACK_QUOTA_EXPIRED" : null;
  const paths = writeSummary(rows, totals, matrix.opts, Array.isArray(catalog) ? catalog.length : 0);

  console.log("\nDEVICE MATRIX");
  printCompact(rows, {
    globalReason: totals.GLOBAL_REASON,
    planned: totals.PLANNED,
    sessionsStarted: totals.SESSIONS_STARTED,
    skippedBeforeSession: totals.SKIPPED_BEFORE_SESSION,
  });
  if (matrix.opts.mode !== "quick") printTable(rows, summaryKeysFor(matrix.opts.mode));
  console.log("\nTOTALS");
  console.log(JSON.stringify(totals, null, 2));
  console.log(`summary json: ${paths.jsonPath}`);
  console.log(`summary csv: ${paths.csvPath}`);

  process.exit(matrixExitCode(rows));
}

module.exports = {
  QUICK_SUMMARY_KEYS,
  summaryKeysFor,
  shouldRetryRun,
  mergeRetryRows,
  matrixExitCode,
  sameProductDefect,
  compactStatus,
  createSessionGate,
  skippedBeforeSessionRow,
  rowLooksLikeQuota,
};

if (require.main === module) {
  main();
}
