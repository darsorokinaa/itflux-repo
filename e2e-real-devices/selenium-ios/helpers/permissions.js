/**
 * BrowserStack Selenium iOS native permission popup.
 * Docs: https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups
 *
 * Required W3C capability: appium:safariAllowPopups = true
 * (BrowserStack docs name this safariAllowPopups; unprefixed keys are illegal in Selenium 4.9+)
 *
 * Node sample: getContexts → switchContext(NATIVE_APP) → $('[name="Allow"]') → web context
 * Java iOS: By.id("Allow") / By.name("Allow")
 * Do not use tap coordinates when a native locator exists.
 */

const { writeJson, writeText, screenshot } = require("./artifacts");
const { FlowError } = require("./dom");

function isNativeContext(name) {
  return String(name || "").toUpperCase() === "NATIVE_APP";
}

function isWebContext(name) {
  const value = String(name || "").toUpperCase();
  if (!value || isNativeContext(value)) return false;
  return /WEBVIEW|SAFARI|WEBVIEW_/i.test(String(name)) || !isNativeContext(name);
}

function nativeContextName(contexts) {
  const named = (contexts || []).find((ctx) => isNativeContext(ctx));
  return named || "NATIVE_APP";
}

function webContextName(contexts, preferred) {
  const list = contexts || [];
  if (preferred && list.includes(preferred) && isWebContext(preferred)) return preferred;
  const safari = list.find((ctx) => /SAFARI|WEBVIEW/i.test(String(ctx)) && !isNativeContext(ctx));
  if (safari) return safari;
  const web = list.find((ctx) => isWebContext(ctx));
  if (web) return web;
  throw new Error(`No Safari/web context in ${JSON.stringify(list)}`);
}

const ALLOW_SELECTORS = [
  '[name="Allow"]',
  "id=Allow",
  "~Allow",
  '-ios predicate string:name == "Allow" OR label == "Allow"',
  '-ios class chain:**/XCUIElementTypeButton[`name == "Allow" OR label == "Allow"`]',
  '//XCUIElementTypeButton[@name="Allow"]',
  '//XCUIElementTypeButton[@label="Allow"]',
];

const ANDROID_ALLOW_SELECTORS = [
  "id=com.android.permissioncontroller:id/permission_allow_foreground_only_button",
  "id=com.android.permissioncontroller:id/permission_allow_button",
  "id=com.android.permissioncontroller:id/permission_allow_one_time_button",
  "id=com.android.chrome:id/positive_button",
  "id=android:id/button1",
  "android=new UiSelector().resourceId(\"com.android.permissioncontroller:id/permission_allow_foreground_only_button\")",
  "android=new UiSelector().text(\"While using the app\")",
  "android=new UiSelector().text(\"Allow\")",
  "android=new UiSelector().textContains(\"Allow\")",
  "android=new UiSelector().text(\"Allow this time\")",
  "android=new UiSelector().text(\"WHILE USING THE APP\")",
  "android=new UiSelector().text(\"При использовании приложения\")",
  "android=new UiSelector().text(\"Разрешить\")",
  "android=new UiSelector().text(\"Только в этот раз\")",
  "//*[@text=\"While using the app\"]",
  "//*[@text=\"Allow\"]",
  "//*[@text=\"Allow this time\"]",
  "//*[@text=\"При использовании приложения\"]",
  "//*[@text=\"Разрешить\"]",
  "//*[@text=\"Только в этот раз\"]",
  "//*[@content-desc=\"Allow\"]",
  "//*[@content-desc=\"Разрешить\"]",
  "~Allow",
];

async function findAllowButton(browser, selectors = ALLOW_SELECTORS) {
  for (const selector of selectors) {
    try {
      const el = await browser.$(selector);
      if (el && await el.isDisplayed().catch(() => false)) {
        return { el, selector };
      }
    } catch {
      /* next */
    }
  }
  return null;
}

async function dumpNativeMiss(browser, extra = {}) {
  let pageSource = "";
  try {
    pageSource = await browser.getPageSource();
  } catch (err) {
    pageSource = String((err && err.message) || err);
  }
  writeText("native-page-source.xml", pageSource);
  await screenshot(browser, "native-allow-not-found");
  return extra;
}

async function switchToNative(browser) {
  const contexts = await browser.getContexts();
  writeJson("contexts-native.json", { contexts, at: new Date().toISOString() });
  await browser.switchContext(nativeContextName(contexts));
  return contexts;
}

async function switchToWeb(browser, preferred) {
  const contexts = await browser.getContexts();
  const web = webContextName(contexts, preferred);
  await browser.switchContext(web);
  return { contexts, web };
}

async function waitAllowGone(browser, { timeoutMs = 8_000, selectors = ALLOW_SELECTORS } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await findAllowButton(browser, selectors);
    if (!found) return true;
    await browser.pause(400);
  }
  return false;
}

/**
 * @param {object} browser
 * @param {{ isAlreadyLive?: () => Promise<boolean> }} opts
 */
async function allowIosMicrophonePrompt(browser, { timeoutMs = 20_000, intervalMs = 1_200, isAlreadyLive } = {}) {
  const started = Date.now();
  const initial = await browser.getContexts();
  writeJson("contexts-before-permission.json", { contexts: initial, at: new Date().toISOString() });
  const preferredWeb = webContextName(initial, null);
  let clicked = false;
  let usedSelector = "";
  let lastError = "";
  let nativeSourceSaved = false;

  while (Date.now() - started < timeoutMs) {
    try {
      await switchToNative(browser);
      const found = await findAllowButton(browser, ALLOW_SELECTORS);
      if (found) {
        await found.el.click();
        clicked = true;
        usedSelector = found.selector;
        await waitAllowGone(browser, { selectors: ALLOW_SELECTORS });
        break;
      }
    } catch (err) {
      lastError = String((err && err.message) || err);
    }
    if (!clicked && !nativeSourceSaved && Date.now() - started > timeoutMs / 2) {
      await dumpNativeMiss(browser, { lastError });
      nativeSourceSaved = true;
    }
    try {
      await switchToWeb(browser, preferredWeb);
    } catch (err) {
      lastError = String((err && err.message) || err);
    }
    if (typeof isAlreadyLive === "function" && await isAlreadyLive().catch(() => false)) {
      const afterLive = await browser.getContexts().catch(() => []);
      writeJson("contexts-after-permission.json", { contexts: afterLive, alreadyLive: true });
      return {
        clicked: false,
        alreadyGranted: true,
        usedSelector: "",
        waitedMs: Date.now() - started,
      };
    }
    await browser.pause(intervalMs);
  }

  let after;
  try {
    after = await switchToWeb(browser, preferredWeb);
  } catch (err) {
    lastError = String((err && err.message) || err);
    after = { contexts: await browser.getContexts().catch(() => []), web: preferredWeb };
  }
  writeJson("contexts-after-permission.json", {
    contexts: after.contexts,
    web: after.web,
    clicked,
    usedSelector,
    at: new Date().toISOString(),
  });

  if (!clicked) {
    try {
      await switchToNative(browser);
      await dumpNativeMiss(browser, { lastError });
    } catch {
      /* already dumped */
    }
    try {
      await switchToWeb(browser, preferredWeb);
    } catch {
      /* ignore */
    }
    if (typeof isAlreadyLive === "function" && await isAlreadyLive().catch(() => false)) {
      return {
        clicked: false,
        alreadyGranted: true,
        usedSelector: "",
        waitedMs: Date.now() - started,
      };
    }
    throw new FlowError(
      "Native Allow not found",
      `Native microphone Allow was not found in NATIVE_APP after ${Date.now() - started}ms. ${lastError}`.trim(),
      { productFailure: false, classification: "PERMISSION_LIMITATION" },
    );
  }

  return {
    clicked,
    alreadyGranted: false,
    usedSelector,
    waitedMs: Date.now() - started,
    lastError,
  };
}

async function allowAndroidMicrophonePrompt(browser, { timeoutMs = 20_000, intervalMs = 1_200, isAlreadyLive } = {}) {
  const started = Date.now();
  let lastError = "";
  let initial = [];
  try {
    initial = await browser.getContexts();
  } catch (err) {
    lastError = String((err && err.message) || err);
  }
  writeJson("contexts-before-permission.json", { contexts: initial, platform: "android", at: new Date().toISOString() });
  let preferredWeb = null;
  try {
    preferredWeb = webContextName(initial, null);
  } catch (err) {
    lastError = String((err && err.message) || err);
  }
  let clicked = false;
  let usedSelector = "";
  let nativeSourceSaved = false;

  while (Date.now() - started < timeoutMs) {
    try {
      await switchToNative(browser);
      const found = await findAllowButton(browser, ANDROID_ALLOW_SELECTORS);
      if (found) {
        await found.el.click();
        clicked = true;
        usedSelector = found.selector;
        await waitAllowGone(browser, { selectors: ANDROID_ALLOW_SELECTORS });
        break;
      }
    } catch (err) {
      lastError = String((err && err.message) || err);
    }
    try {
      await switchToWeb(browser, preferredWeb);
      const webAllow = await findAllowButton(browser, ANDROID_ALLOW_SELECTORS);
      if (webAllow) {
        await webAllow.el.click();
        clicked = true;
        usedSelector = webAllow.selector;
        break;
      }
    } catch (err) {
      lastError = String((err && err.message) || err);
    }
    if (!clicked && !nativeSourceSaved && Date.now() - started > timeoutMs / 2) {
      await dumpNativeMiss(browser, { lastError, platform: "android" });
      nativeSourceSaved = true;
    }
    if (typeof isAlreadyLive === "function" && await isAlreadyLive().catch(() => false)) {
      return {
        clicked: false,
        alreadyGranted: true,
        usedSelector: "",
        waitedMs: Date.now() - started,
      };
    }
    await browser.pause(intervalMs);
  }

  try {
    await switchToWeb(browser, preferredWeb);
  } catch (err) {
    lastError = String((err && err.message) || err);
  }

  if (!clicked) {
    if (typeof isAlreadyLive === "function" && await isAlreadyLive().catch(() => false)) {
      return {
        clicked: false,
        alreadyGranted: true,
        usedSelector: "",
        waitedMs: Date.now() - started,
      };
    }
    throw new FlowError(
      "Android Allow not found",
      `Android microphone Allow was not found after ${Date.now() - started}ms. ${lastError}`.trim(),
      { productFailure: false, classification: "PERMISSION_LIMITATION" },
    );
  }

  return {
    clicked,
    alreadyGranted: false,
    usedSelector,
    waitedMs: Date.now() - started,
    lastError,
  };
}

async function allowMicrophonePrompt(browser, opts = {}) {
  const platform = String(opts.platform || "ios").toLowerCase();
  if (platform === "android") return allowAndroidMicrophonePrompt(browser, opts);
  return allowIosMicrophonePrompt(browser, opts);
}

module.exports = {
  allowIosMicrophonePrompt,
  allowAndroidMicrophonePrompt,
  allowMicrophonePrompt,
  findAllowButton,
  ALLOW_SELECTORS,
  ANDROID_ALLOW_SELECTORS,
  isNativeContext,
  nativeContextName,
  webContextName,
  switchToNative,
  switchToWeb,
};
