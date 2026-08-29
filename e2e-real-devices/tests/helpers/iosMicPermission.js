/**
 * BrowserStack Playwright on real iOS Safari cannot grant or tap the native
 * TCC dialog: "… Would Like to Access the Microphone" [Cancel] [Allow].
 *
 * Official sources (do not copy Selenium/Appium caps into Playwright YAML):
 * - Playwright iOS: https://www.browserstack.com/docs/automate/playwright/playwright-ios/nodejs
 *   Unsupported caps: playwrightLogs, consoleLogs, resolution, geoLocation.
 *   No microphone / autoAccept / grantPermissions capability is listed.
 * - Playwright capabilities: https://www.browserstack.com/docs/automate/playwright/playwright-capabilities
 *   No autoAcceptAlerts, no NATIVE_APP, no media-permission grant.
 * - Selenium (NOT Playwright): https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups
 *   Camera/mic on mobile: switch context to NATIVE_APP and click Allow.
 * - Appium (native apps, NOT Playwright Safari): autoAcceptAlerts
 *   https://www.browserstack.com/docs/app-automate/appium/advanced-features/handle-permission-pop-ups
 *
 * Playwright context.grantPermissions() is a desktop/Chromium (and bundled
 * WebKit mock-stream) API. It does not tap iOS SpringBoard permission sheets
 * on real Safari. page.on('dialog') is JS alert/confirm/prompt only.
 */

const LIMITATION = "BROWSERSTACK AUTOMATION LIMITATION";

class BrowserStackLimitationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BrowserStackLimitationError";
    this.limitation = LIMITATION;
  }
}

function isBrowserStackLimitationError(err) {
  return Boolean(err && (err.name === "BrowserStackLimitationError" || err.limitation === LIMITATION));
}

function isBrowserStackIosProject(testInfo) {
  const name = String((testInfo && testInfo.project && testInfo.project.name) || "");
  return /iphone|ipad|ios/i.test(name);
}

function isRealIosSafariUserAgent(userAgent) {
  const ua = String(userAgent || "");
  if (!/iPhone|iPad|iPod/i.test(ua)) return false;
  if (/CriOS|FxiOS|EdgiOS|Chrome\//i.test(ua) && !/Safari/i.test(ua)) return false;
  return true;
}

function shouldClassifyAsIosNativeMicPermissionLimitation({
  userAgent = "",
  projectName = "",
  jitsiIframeCount = 0,
  joinErrorVisible = false,
  reachedLive = false,
} = {}) {
  const ios = isRealIosSafariUserAgent(userAgent) || /iphone|ipad|ios/i.test(String(projectName || ""));
  if (!ios) return false;
  if (!Number(jitsiIframeCount)) return false;
  if (reachedLive) return false;
  // iframe exists, join never completed: native Allow was not tapped.
  return true;
}

function iosNativeMicPermissionSkipMessage({
  jitsiIframeCreated = false,
  joinErrorVisible = false,
} = {}) {
  return [
    LIMITATION,
    "Playwright real iOS Safari cannot auto-Allow the native microphone dialog.",
    `jitsi_iframe_created=${jitsiIframeCreated ? "yes" : "no"}`,
    "microphone_permission_dialog=unanswered (automation cannot tap Allow)",
    "videoConferenceJoined wait is invalid while the OS prompt is open",
    joinErrorVisible
      ? "app_showed_join_error=yes (not a proven Jitsi/Prosody failure)"
      : "app_did_not_reach_live_ui=yes",
    "Docs: Playwright iOS https://www.browserstack.com/docs/automate/playwright/playwright-ios/nodejs",
    "Full real-iOS lesson-room: npm run test:browserstack:ios-selenium",
    "Selenium NATIVE_APP Allow: https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups",
  ].join(" | ");
}

function iosFullRoomPlaywrightSkipMessage() {
  return [
    LIMITATION,
    "Playwright iOS cannot tap the native Safari microphone Allow dialog.",
    "Full-room tests (join, drawing, tab cycles) are Selenium-only on real iOS.",
    "Use: npm run test:browserstack:ios-selenium",
  ].join(" | ");
}

function skipIosFullRoomPlaywright(test) {
  const testInfo = test.info();
  if (isBrowserStackIosProject(testInfo)) {
    test.skip(true, iosFullRoomPlaywrightSkipMessage());
  }
}

module.exports = {
  LIMITATION,
  BrowserStackLimitationError,
  isBrowserStackLimitationError,
  isBrowserStackIosProject,
  isRealIosSafariUserAgent,
  shouldClassifyAsIosNativeMicPermissionLimitation,
  iosNativeMicPermissionSkipMessage,
  iosFullRoomPlaywrightSkipMessage,
  skipIosFullRoomPlaywright,
};
