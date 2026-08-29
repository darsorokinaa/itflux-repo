#!/usr/bin/env node
/**
 * BrowserStack Selenium real iOS — lesson-room E2E.
 * Does not run Playwright. Session is on BrowserStack Automate (no local Appium).
 *
 * Docs: https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups
 */

const { remote } = require("webdriverio");
const { secrets } = require("./helpers/env");
const { markSession, screenshot } = require("./helpers/artifacts");
const { classifyVendorError, boardSummaryLines } = require("./helpers/classify");
const { DeviceRunLifecycle, runWithLifecycle } = require("./helpers/lifecycle");
const { runRoomFlow } = require("./tests/01-room-flow");

function capabilities(creds) {
  // W3C: Appium vendor caps must be appium:-prefixed (Selenium 4.9+ rejects
  // unprefixed safariAllowPopups). BrowserStack docs still call this safariAllowPopups.
  // https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups
  // https://github.com/SeleniumHQ/selenium/issues/12851
  return {
    browserName: "safari",
    "appium:safariAllowPopups": true,
    "bstack:options": {
      deviceName: "iPhone 15 Pro Max",
      osVersion: "17",
      realMobile: true,
      projectName: "itflux lesson-room",
      buildName: "e2e-real-devices selenium-ios",
      sessionName: "SELENIUM iOS room flow + native mic Allow",
      debug: true,
      networkLogs: true,
      idleTimeout: 300,
      userName: creds.username,
      accessKey: creds.accessKey,
    },
  };
}

async function main() {
  let creds;
  try {
    creds = secrets();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  const life = new DeviceRunLifecycle();
  await runWithLifecycle(life, async () => {
    let browser = null;
    try {
      browser = await remote({
        protocol: "https",
        hostname: "hub.browserstack.com",
        port: 443,
        path: "/wd/hub",
        user: creds.username,
        key: creds.accessKey,
        logLevel: "warn",
        capabilities: capabilities(creds),
      });
      life.attachBrowser(browser);

      const report = await life.track(runRoomFlow(browser, creds, {
        boardTestMode: process.env.BOARD_TEST_MODE || "core",
      }));
      await markSession(
        browser,
        "passed",
        "Real iOS Safari: native microphone allowed, Jitsi joined, materials and board usable",
      );
      report.RESULT = "passed";
      console.log(JSON.stringify(report, null, 2));
      for (const line of boardSummaryLines(report)) console.log(line);
    } catch (err) {
      const classified = classifyVendorError(err);
      const summarySource = Object.assign({}, classified, err && err.boardReport ? err.boardReport : {});
      classified["BOARD CLICK"] = summarySource["BOARD CLICK"] || classified["BOARD CLICK"];
      classified["BOARD NAVIGATION"] = summarySource["BOARD NAVIGATION"] || classified["BOARD NAVIGATION"];
      classified["BOARD CONTAINER"] = summarySource["BOARD CONTAINER"] || classified["BOARD CONTAINER"];
      classified.CLASSIFICATION = summarySource.CLASSIFICATION || classified.classification;
      classified.CANVAS = summarySource.CANVAS || classified.CANVAS;
      if (browser && life.isLive()) {
        await screenshot(browser, "failure").catch(() => {});
        await markSession(browser, classified.RESULT === "blocked" ? "failed" : "failed", classified.code);
      }
      console.error(JSON.stringify(classified, null, 2));
      for (const line of boardSummaryLines(summarySource)) console.error(line);
      if (classified.code !== "BROWSERSTACK QUOTA EXPIRED") console.error(err);
      process.exitCode = classified.code === "BROWSERSTACK QUOTA EXPIRED" ? 3 : 1;
    } finally {
      if (!life.disposed) {
        const cleanup = await life.dispose();
        console.log(`SESSION_CLEANUP=${cleanup.status} timers=${cleanup.timers} pending=${cleanup.pending}`);
      }
    }
  });
}

main();
