#!/usr/bin/env node
/**
 * Independent BrowserStack room-entry repeats.
 * Does not open the board, draw, or run smoke.
 * Each attempt is a new session and a separate result — no retry-as-pass.
 */

const fs = require("fs");
const path = require("path");
const { remote } = require("webdriverio");
const { secrets } = require("./helpers/env");
const {
  setArtifactRoot,
  resetArtifactRoot,
  redactSecrets,
  DEFAULT_ROOT,
} = require("./helpers/artifacts");
const {
  fetchAutomateBrowsers,
  buildDeviceMatrix,
  sanitizeDeviceSlug,
} = require("./helpers/catalog");
const { DeviceRunLifecycle, runWithLifecycle } = require("./helpers/lifecycle");
const { isSessionGone } = require("./helpers/classify");
const { runRoomEntryAttempt } = require("./helpers/entry-repeat-flow");
const { firstDivergence } = require("./helpers/entry-diag");

function parseEntryRepeatEnv(env = process.env) {
  const raw = env.ROOM_ENTRY_REPEAT;
  const repeats = raw == null || raw === "" ? 20 : Number(raw);
  const deviceName = String(env.DEVICE_NAME || "iPad Air 11 2026").trim();
  const osVersion = String(env.DEVICE_OS_VERSION || "26").trim();
  return {
    repeats: Number.isFinite(repeats) && repeats > 0 ? Math.min(50, Math.floor(repeats)) : 20,
    deviceName,
    osVersion,
  };
}

function capabilities(creds, run) {
  const caps = {
    browserName: run.browserName,
    "bstack:options": {
      deviceName: run.device,
      osVersion: run.osVersion,
      realMobile: true,
      deviceOrientation: run.orientation || "portrait",
      projectName: "itflux lesson-room",
      buildName: "e2e-real-devices room-entry-repeat",
      sessionName: `entry-repeat ${run.device} ${run.osVersion} #${run.attempt || 1}`,
      debug: true,
      networkLogs: true,
      idleTimeout: 180,
      userName: creds.username,
      accessKey: creds.accessKey,
    },
  };
  if (run.osFamily === "ios") caps["appium:safariAllowPopups"] = true;
  return caps;
}

function summarizeRuns(rows) {
  const pass = rows.filter((row) => row.RESULT === "pass");
  const fail = rows.filter((row) => row.RESULT === "fail");
  const infra = rows.filter((row) => row.classification === "INFRA_SKIP");
  const suspects = fail.filter((row) => row.classification === "INTERMITTENT_PRODUCTION_SUSPECT");
  const passRep = pass[0] || null;
  const failRep = suspects[0] || fail[0] || null;
  const divergence = passRep && failRep
    ? firstDivergence(passRep.timeline, failRep.timeline)
    : null;
  const confirmed = suspects.length >= 2;
  return {
    TOTAL_ATTEMPTS: rows.length,
    PASS: pass.length,
    FAIL: fail.length,
    INFRA_SKIP: infra.length,
    FAIL_RATE: rows.length ? Number(((fail.length / rows.length) * 100).toFixed(1)) : 0,
    INTERMITTENT_PRODUCTION_SUSPECT: suspects.length,
    PRODUCT_FAIL_CONFIRMED: confirmed,
    FIRST_DIVERGENCE: divergence,
    PASS_TIMELINE: passRep ? passRep.timeline : null,
    FAIL_TIMELINE: failRep ? failRep.timeline : null,
  };
}

async function runAttempt(creds, run, index, total) {
  const slug = `${sanitizeDeviceSlug(run)}-entry-${String(index).padStart(2, "0")}`;
  const dir = path.join(DEFAULT_ROOT, "entry-repeat", slug);
  fs.mkdirSync(path.join(dir, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(dir, "diagnostics"), { recursive: true });
  setArtifactRoot(dir);
  const life = new DeviceRunLifecycle();
  return runWithLifecycle(life, async () => {
    let browser = null;
    let row = {
      RUN: index,
      DEVICE: run.device,
      OS: `${run.osFamily} ${run.osVersion}`,
      RESULT: "fail",
      classification: "TEST_BUG",
    };
    try {
      console.log(`\n=== ENTRY REPEAT ${index}/${total} ${run.device} / ${run.osFamily} ${run.osVersion} ===`);
      browser = await remote({
        protocol: "https",
        hostname: "hub.browserstack.com",
        port: 443,
        path: "/wd/hub",
        user: creds.username,
        key: creds.accessKey,
        logLevel: "warn",
        capabilities: capabilities(creds, { ...run, attempt: index }),
      });
      life.attachBrowser(browser);
      const report = await life.track(runRoomEntryAttempt(browser, creds, { platform: run.osFamily }));
      row = {
        RUN: index,
        DEVICE: run.device,
        OS: `${run.osFamily} ${run.osVersion}`,
        BROWSER: run.browserName,
        LOGIN: report.LOGIN,
        PREJOIN: report.PREJOIN,
        MIC: report.MIC,
        LIVE: report.LIVE,
        RESULT: report.RESULT,
        classification: report.classification,
        exactError: report.exactError || null,
        inferredPageState: report.inferredPageState || null,
        lastTimelineEvent: report.lastTimelineEvent ? report.lastTimelineEvent.name : null,
        staleElementCount: report.staleElementCount || 0,
        sessionId: browser.sessionId || null,
        timeline: report.timeline,
        reason: report.reason || null,
        failure: report.failure || null,
        slug,
      };
      console.log(`RUN ${index} = ${String(row.RESULT).toUpperCase()} last=${row.lastTimelineEvent || "-"} state=${row.inferredPageState || "-"}`);
      if (row.RESULT === "fail") {
        console.log(`  failedStage=${row.PREJOIN === "fail" ? "PREJOIN" : "LIVE"} exactError=${row.exactError}`);
      }
    } catch (err) {
      row.exactError = String((err && err.message) || err);
      row.classification = isSessionGone(err) ? "INFRA_SKIP" : "TEST_BUG";
      row.RESULT = "fail";
      console.log(`RUN ${index} = FAIL ${row.classification} ${row.exactError}`);
    } finally {
      const cleanup = await life.dispose();
      browser = null;
      row.SESSION_CLEANUP = cleanup.status;
      resetArtifactRoot();
      const file = path.join(dir, "result.json");
      fs.writeFileSync(file, redactSecrets(JSON.stringify(row, null, 2)));
    }
    return row;
  });
}

async function main() {
  let creds;
  try {
    creds = secrets();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const opts = parseEntryRepeatEnv(process.env);
  console.log(JSON.stringify({
    ROOM_ENTRY_REPEAT: opts.repeats,
    DEVICE_NAME: opts.deviceName,
    DEVICE_OS_VERSION: opts.osVersion,
  }));

  let catalog;
  try {
    catalog = await fetchAutomateBrowsers(creds);
  } catch (err) {
    console.error(`Failed to fetch BrowserStack catalog: ${err.message}`);
    process.exit(2);
  }

  let matrix = buildDeviceMatrix(catalog, {
    DEVICE_NAME: opts.deviceName,
    DEVICE_OS_VERSION: opts.osVersion,
    BOARD_TEST_MODE: "core",
    MAX_DEVICES: "1",
    DEVICE_CONCURRENCY: "1",
  });
  if (!matrix.runs.length) {
    const { selectRealMobileEntries, osFamily } = require("./helpers/catalog");
    const loose = selectRealMobileEntries(catalog).find((entry) => {
      const name = String(entry.device || "");
      return name === opts.deviceName
        || (opts.deviceName && name.includes(opts.deviceName))
        || (opts.deviceName && /iPad Air 11/i.test(opts.deviceName) && /iPad Air 11/i.test(name));
    });
    if (loose && (!opts.osVersion || String(loose.os_version) === opts.osVersion || String(loose.os_version).startsWith(opts.osVersion))) {
      matrix = {
        runs: [{
          device: loose.device,
          osVersion: String(loose.os_version || opts.osVersion),
          osFamily: osFamily(loose),
          kind: /ipad|tab/i.test(loose.device) ? "tablet" : "phone",
          orientation: "portrait",
          browserName: osFamily(loose) === "ios" ? "safari" : "chrome",
        }],
      };
    }
  }
  if (!matrix.runs.length) {
    console.error(`No catalog match for DEVICE_NAME=${opts.deviceName} DEVICE_OS_VERSION=${opts.osVersion}`);
    process.exit(2);
  }
  const run = matrix.runs[0];
  console.log(`device=${run.device} os=${run.osFamily} ${run.osVersion} browser=${run.browserName}`);

  const rows = [];
  for (let i = 1; i <= opts.repeats; i += 1) {
    rows.push(await runAttempt(creds, run, i, opts.repeats));
  }

  const summary = summarizeRuns(rows);
  const outDir = path.join(DEFAULT_ROOT, "entry-repeat");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    redactSecrets(JSON.stringify({ generatedAt: new Date().toISOString(), device: run, opts, summary, rows }, null, 2)),
  );

  console.log("\nROOM ENTRY REPEAT");
  console.log(`TOTAL ATTEMPTS ${summary.TOTAL_ATTEMPTS}`);
  console.log(`PASS ${summary.PASS}`);
  console.log(`FAIL ${summary.FAIL}`);
  console.log(`FAIL RATE ${summary.FAIL_RATE}%`);
  console.log(`INTERMITTENT_PRODUCTION_SUSPECT ${summary.INTERMITTENT_PRODUCTION_SUSPECT}`);
  console.log(`PRODUCT_FAIL confirmed (same UI, >=2 independent fails): ${summary.PRODUCT_FAIL_CONFIRMED ? "yes" : "no"}`);
  if (summary.FIRST_DIVERGENCE) {
    console.log("FIRST DIVERGENCE");
    console.log(JSON.stringify(summary.FIRST_DIVERGENCE, null, 2));
  }
  if (summary.PASS_TIMELINE) {
    console.log("PASS timeline representative:");
    console.log((summary.PASS_TIMELINE.events || []).map((e) => `  ${e.name} +${e.elapsedMs}ms`).join("\n"));
  }
  if (summary.FAIL_TIMELINE) {
    console.log("FAIL timeline representative:");
    console.log((summary.FAIL_TIMELINE.events || []).map((e) => `  ${e.name} +${e.elapsedMs}ms`).join("\n"));
  }
  for (const row of rows.filter((item) => item.RESULT === "fail")) {
    console.log(`FAIL RUN ${row.RUN} stage=${row.PREJOIN === "fail" ? "PREJOIN" : "LIVE"} last=${row.lastTimelineEvent} state=${row.inferredPageState} stale=${row.staleElementCount}`);
  }

  process.exit(0);
}

module.exports = { parseEntryRepeatEnv, summarizeRuns, capabilities };

if (require.main === module) {
  main();
}
