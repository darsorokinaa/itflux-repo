#!/usr/bin/env node
/**
 * BrowserStack Automate real-mobile matrix for the lesson-room Selenium flow.
 * Device list comes from GET /automate/browsers.json (not App Automate).
 * Default: sequential (DEVICE_CONCURRENCY=1). One device FAIL does not stop the matrix.
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
} = require("./helpers/artifacts");
const { classifyVendorError, MATRIX, boardSummaryLines, isSessionGone } = require("./helpers/classify");
const {
  fetchAutomateBrowsers,
  buildDeviceMatrix,
  sanitizeDeviceSlug,
  parseMatrixEnv,
} = require("./helpers/catalog");
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
      idleTimeout: mode === "quick" ? 240 : 300,
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

async function runOne(creds, run, { attempt = 1, opts = parseMatrixEnv(process.env) } = {}) {
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
    let cleanup = { status: "FAIL", ok: false, timers: -1, pending: -1, browser: "unset" };
    try {
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
      const sessionId = browser.sessionId || null;
      const report = await life.track(runRoomFlow(browser, creds, {
        platform: run.osFamily,
        deviceLabel,
        orientation: run.orientation,
        boardTestMode: opts.mode,
        testMinutes: opts.testMinutes,
        sessionId,
      }));
      report.sessionId = sessionId;
      await markSession(browser, "passed", `PASS ${opts.mode} ${deviceLabel}`.slice(0, 255));
      row = rowFromReport(run, report, MATRIX.PASS, Date.now() - started, slug);
    } catch (err) {
      if (browser && browser.sessionId) err.sessionWasAlive = true;
      const classified = classifyVendorError(err);
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
    } finally {
      cleanup = await life.dispose();
      browser = null;
      resetArtifactRoot();
      console.log(`SESSION_CLEANUP=${cleanup.status} timers=${cleanup.timers} pending=${cleanup.pending} browser=${cleanup.browser}`);
      if (cleanup.status !== "PASS") {
        console.log(`SESSION_CLEANUP FAIL deleteOk=${cleanup.deleteOk} deleteError=${cleanup.deleteError || ""}`);
      }
    }

    if (!row) {
      row = rowFromReport(run, {}, MATRIX.TEST_BUG, Date.now() - started, slug);
    }
    row.SESSION_CLEANUP = cleanup.status;
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

async function runOneWithRetry(creds, run, opts) {
  const first = await runOne(creds, run, { attempt: 1, opts });
  first.ATTEMPT = 1;
  first.attempt = 1;
  if (!shouldRetryRun(first, opts.mode)) return [first];
  console.log(`${first.RESULT} on ${run.device} — independent retry; first FAIL is kept even if retry PASSes`);
  const second = await runOne(creds, run, { attempt: 2, opts });
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
  console.log(JSON.stringify({
    DEVICE_OS: opts.os,
    DEVICE_KIND: opts.kind,
    MAX_DEVICES: opts.maxDevices,
    DEVICE_CONCURRENCY: opts.concurrency,
    BOARD_TEST_MODE: opts.mode,
    TEST_MINUTES: opts.testMinutes,
    DEVICE_NAME: opts.deviceNames,
    DEVICE_OS_VERSION: opts.deviceOsVersion,
  }));

  let catalog;
  try {
    catalog = await fetchAutomateBrowsers(creds);
  } catch (err) {
    console.error(`Failed to fetch BrowserStack Automate browsers.json: ${err.message}`);
    process.exit(2);
  }

  const matrix = buildDeviceMatrix(catalog, process.env);
  console.log(`catalog real-mobile candidates: ${matrix.selected.length}; runs: ${matrix.runs.length}`);
  if (!matrix.runs.length) {
    console.log("No matching real-mobile Automate devices after filters.");
    writeSummary([], totalsOf([]), matrix.opts, Array.isArray(catalog) ? catalog.length : 0);
    process.exit(0);
  }

  const nested = await mapPool(matrix.runs, matrix.opts.concurrency, (run) => runOneWithRetry(creds, run, matrix.opts));
  const rows = nested.flat();
  const totals = totalsOf(rows);
  totals.CONFIRMED_PRODUCT_FAIL = rows.filter((row) => row.confirmedProductFail).length;
  const paths = writeSummary(rows, totals, matrix.opts, Array.isArray(catalog) ? catalog.length : 0);

  console.log("\nDEVICE MATRIX");
  printTable(rows, summaryKeysFor(matrix.opts.mode));
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
};

if (require.main === module) {
  main();
}
