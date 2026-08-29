#!/usr/bin/env node
/**
 * BrowserStack Selenium real iOS — full lesson-room flow.
 *
 * PLAYWRIGHT iOS cannot tap the native microphone Allow dialog.
 * This file uses Selenium/Appium NATIVE_APP as documented by BrowserStack:
 * https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups
 */

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { remote } = require("webdriverio");

const { requiredSecrets, hasSecrets, originFromLessonUrl } = require("../helpers/env");
const { allowIosMicrophonePrompt } = require("../helpers/permission");
const {
  loginIfNeeded,
  enableBoardDebug,
  clickWithoutCamera,
  clickStartLessonIfWaiting,
  waitForSuccessfulJoin,
  switchToCall,
  switchToMaterials,
  openExistingBoard,
  waitForBoardReady,
  drawStroke,
  addText,
  jitsiIframeCount,
  assertNoHorizontalOverflow,
  tryCreateBoard,
} = require("../helpers/room");

const SCREEN_DIR = path.join(__dirname, "..", "screenshots");

function capabilities(secrets) {
  // safariAllowPopups is required by BrowserStack iOS permission-popup docs
  // before any Allow click logic:
  // https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups
  return {
    browserName: "safari",
    safariAllowPopups: true,
    "appium:safariAllowPopups": true,
    "bstack:options": {
      deviceName: "iPhone 15 Pro Max",
      osVersion: "17",
      realMobile: "true",
      safariAllowPopups: true,
      "browserstack.safari.enablePopups": true,
      projectName: "itflux lesson-room",
      buildName: "e2e-selenium-ios lesson-room",
      sessionName: "SELENIUM iOS full lesson-room + native mic Allow",
      debug: true,
      networkLogs: true,
      idleTimeout: 300,
      userName: secrets.username,
      accessKey: secrets.accessKey,
    },
  };
}

async function screenshot(browser, name) {
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
  const file = path.join(SCREEN_DIR, `${name}.png`);
  try {
    await browser.saveScreenshot(file);
  } catch {
    /* session may be on NATIVE_APP */
  }
}

async function markSession(browser, status, reason) {
  try {
    await browser.execute(`browserstack_executor: ${JSON.stringify({
      action: "setSessionStatus",
      arguments: { status, reason: String(reason || "").slice(0, 240) },
    })}`);
  } catch {
    /* ignore */
  }
}

async function main() {
  if (!hasSecrets()) {
    console.error("Set TEST_LOGIN, TEST_PASSWORD, LESSON_ROOM_URL, BROWSERSTACK_USERNAME, BROWSERSTACK_ACCESS_KEY");
    process.exit(2);
  }
  const secrets = requiredSecrets();
  const origin = originFromLessonUrl();
  let browser;
  const report = {
    suite: "SELENIUM iOS",
    device: "iPhone 15 Pro Max / iOS 17 / Safari",
    playwrightLimitation: "PLAYWRIGHT iOS cannot tap native microphone Allow",
    seleniumPath: "safariAllowPopups + NATIVE_APP + Allow + web context",
    steps: [],
  };

  const step = async (name, fn) => {
    console.log(`STEP ${name}`);
    report.steps.push({ name, status: "running" });
    try {
      const detail = await fn();
      report.steps[report.steps.length - 1] = { name, status: "ok", detail: detail || null };
      return detail;
    } catch (err) {
      report.steps[report.steps.length - 1] = {
        name,
        status: "fail",
        error: String((err && err.message) || err),
      };
      throw err;
    }
  };

  try {
    browser = await remote({
      protocol: "https",
      hostname: "hub-cloud.browserstack.com",
      port: 443,
      path: "/wd/hub",
      user: secrets.username,
      key: secrets.accessKey,
      logLevel: "warn",
      capabilities: capabilities(secrets),
    });

    await step("open itflux origin", async () => {
      await browser.url(origin);
      return browser.getUrl();
    });

    await step("login teacher test account", async () => {
      const result = await loginIfNeeded(browser, {
        origin,
        login: secrets.login,
        password: secrets.password,
      });
      await enableBoardDebug(browser);
      return result;
    });

    await step("open LESSON_ROOM_URL", async () => {
      await browser.url(secrets.lessonRoomUrl);
      await screenshot(browser, "01-room");
      return browser.getUrl();
    });

    await step("start lesson if waiting", async () => {
      return { started: await clickStartLessonIfWaiting(browser) };
    });

    await step("click Без камеры", async () => {
      const clicked = await clickWithoutCamera(browser);
      await screenshot(browser, "02-after-no-camera");
      return { clicked };
    });

    await step("NATIVE_APP Allow microphone", async () => {
      const result = await allowIosMicrophonePrompt(browser, { timeoutMs: 20_000 });
      await screenshot(browser, "03-after-mic-allow");
      report.microphoneAllow = result;
      return result;
    });

    const join = await step("wait for Jitsi conference join + room UI", async () => {
      const result = await waitForSuccessfulJoin(browser, { timeoutMs: 60_000 });
      await screenshot(browser, "04-joined");
      return result;
    });
    assert.ok(join.iframeCount >= 1, "Jitsi iframe should exist after join");

    await step("tab Звонок", async () => {
      await switchToCall(browser);
      await screenshot(browser, "05-call");
      const count = await jitsiIframeCount(browser);
      assert.equal(count, 1, `expected one Jitsi iframe on Call, got ${count}`);
      return { jitsiIframes: count };
    });

    await step("tab Материалы", async () => {
      await switchToMaterials(browser);
      await screenshot(browser, "06-materials");
    });

    await step("open existing board + Excalidraw", async () => {
      await openExistingBoard(browser);
      const size = await waitForBoardReady(browser);
      await screenshot(browser, "07-board");
      return size;
    });

    await step("draw stroke", async () => {
      await drawStroke(browser);
      await screenshot(browser, "08-stroke");
    });

    await step("add text", async () => {
      await addText(browser, "BrowserStack iPhone Selenium");
      await screenshot(browser, "09-text");
    });

    await step("Звонок → Материалы → доска", async () => {
      await switchToCall(browser);
      assert.equal(await jitsiIframeCount(browser), 1, "Jitsi iframe multiplied after Call");
      await switchToMaterials(browser);
      await waitForBoardReady(browser);
      await screenshot(browser, "10-tab-cycle");
    });

    await step("no horizontal overflow + single Jitsi iframe", async () => {
      await assertNoHorizontalOverflow(browser);
      const count = await jitsiIframeCount(browser);
      assert.equal(count, 1, `expected exactly one Jitsi iframe, got ${count}`);
      return { jitsiIframes: count };
    });

    await step("optional create board", async () => {
      const created = await tryCreateBoard(browser, `E2E Selenium ${Date.now()}`);
      await screenshot(browser, "11-create-board");
      return created;
    });

    await markSession(browser, "passed", "SELENIUM iOS lesson-room passed after native mic Allow");
    report.status = "passed";
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    report.status = "failed";
    report.error = String((err && err.message) || err);
    if (browser) {
      await screenshot(browser, "failure");
      await markSession(browser, "failed", report.error);
    }
    console.error(JSON.stringify(report, null, 2));
    throw err;
  } finally {
    if (browser) {
      await browser.deleteSession().catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
