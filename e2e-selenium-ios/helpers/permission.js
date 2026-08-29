/**
 * Native iOS Safari microphone dialog via BrowserStack Selenium / Appium.
 *
 * Official docs (Selenium, not Playwright):
 * https://www.browserstack.com/docs/automate/selenium/handle-permission-pop-ups
 *
 * iOS camera/mic sample (Node WebdriverIO):
 *   const contexts = await browser.getContexts()
 *   await browser.switchContext(contexts[0])          // NATIVE_APP
 *   const popUp = await $('[name="Allow"]')
 *   await popUp.click()
 *   await browser.switchContext(contexts[1])          // web / Safari
 *
 * Java iOS locators from the same page: By.id("Allow") / By.name("Allow")
 * Required capability before click logic: safariAllowPopups: true
 *
 * Do not use tap coordinates when a native locator exists.
 */

function isNativeContext(name) {
  return String(name || "").toUpperCase() === "NATIVE_APP";
}

function nativeContextName(contexts) {
  const named = (contexts || []).find((ctx) => isNativeContext(ctx));
  if (named) return named;
  return contexts && contexts[0] ? contexts[0] : "NATIVE_APP";
}

function webContextName(contexts, preferred) {
  const list = contexts || [];
  if (preferred && list.includes(preferred) && !isNativeContext(preferred)) {
    return preferred;
  }
  const named = list.find((ctx) => !isNativeContext(ctx));
  if (named) return named;
  if (list.length > 1) return list[1];
  throw new Error(`No web/Safari context. contexts=${JSON.stringify(list)}`);
}

/**
 * Documented iOS Allow locators, in docs order.
 * 1. [name="Allow"]  — BrowserStack Node iOS camera/mic sample
 * 2. id=Allow        — Java By.id("Allow")
 * 3. name=Allow      — Java/Python By.name("Allow")
 * Extra predicate/class-chain only if those three are not displayed.
 */
const ALLOW_SELECTORS = [
  '[name="Allow"]',
  "id=Allow",
  "~Allow",
  '-ios predicate string:name == "Allow" OR label == "Allow"',
  '-ios class chain:**/XCUIElementTypeButton[`name == "Allow" OR label == "Allow"`]',
  '//XCUIElementTypeButton[@name="Allow"]',
  '//XCUIElementTypeButton[@label="Allow"]',
];

async function findAllowButton(browser) {
  for (const selector of ALLOW_SELECTORS) {
    try {
      const el = await browser.$(selector);
      if (el && await el.isDisplayed().catch(() => false)) {
        return { el, selector };
      }
    } catch {
      /* try next locator */
    }
  }
  return null;
}

async function allowIosMicrophonePrompt(browser, { timeoutMs = 20_000, intervalMs = 1_500 } = {}) {
  const started = Date.now();
  const initial = await browser.getContexts();
  const preferredWeb = webContextName(initial, null);
  let clicked = false;
  let usedSelector = "";
  let lastError = "";
  let contextsBeforeClick = initial;

  while (Date.now() - started < timeoutMs) {
    let contexts = [];
    try {
      contexts = await browser.getContexts();
      contextsBeforeClick = contexts;
      await browser.switchContext(nativeContextName(contexts));
      const found = await findAllowButton(browser);
      if (found) {
        await found.el.click();
        clicked = true;
        usedSelector = found.selector;
        break;
      }
    } catch (err) {
      lastError = String((err && err.message) || err);
    } finally {
      try {
        const after = await browser.getContexts().catch(() => contexts);
        await browser.switchContext(webContextName(after, preferredWeb));
      } catch (err) {
        lastError = String((err && err.message) || err);
      }
    }
    await browser.pause(intervalMs);
  }

  return {
    clicked,
    usedSelector,
    lastError,
    waitedMs: Date.now() - started,
    contextsBeforeClick,
  };
}

module.exports = {
  allowIosMicrophonePrompt,
  findAllowButton,
  ALLOW_SELECTORS,
  isNativeContext,
  nativeContextName,
  webContextName,
};
