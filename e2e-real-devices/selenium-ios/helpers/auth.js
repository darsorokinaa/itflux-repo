const { TIMEOUTS } = require("./timeouts");
const { loginUrl } = require("./env");
const { SELECTORS, xpathButton, xpathTab, displayed, waitFor, FlowError } = require("./dom");
const { executeJson } = require("./execute-json");
const { screenshot, writeJson, redactSecrets } = require("./artifacts");
const { isSessionGone } = require("./classify");

async function captureLoginFailure(browser, extras = {}) {
  const url = await browser.getUrl().catch(() => "");
  let snap = {
    visibleError: "",
    formVisible: false,
    submitVisible: false,
    title: "",
  };
  try {
    snap = await executeJson(browser, () => {
      const alert = document.querySelector(".cabinet-auth-error, [role='alert']");
      const password = document.querySelector("input[type='password']");
      const submit = Array.from(document.querySelectorAll("button, [role='button']"))
        .find((el) => /Войти/.test(String(el.textContent || "")));
      return JSON.stringify({
        url: String(location.href || ""),
        visibleError: String((alert && alert.innerText) || "").replace(/\s+/g, " ").trim().slice(0, 300),
        formVisible: Boolean(password),
        submitVisible: Boolean(submit && submit.getBoundingClientRect().width > 1),
        title: String(document.title || "").slice(0, 80),
      });
    }, "login-fail");
  } catch (err) {
    if (isSessionGone(err)) throw err;
    snap.error = String((err && err.message) || err);
  }
  await screenshot(browser, extras.screenshotName || "login-fail").catch(() => {});
  const payload = {
    url: redactSecrets(String(snap.url || url || "")),
    visibleError: snap.visibleError || "",
    formVisible: Boolean(snap.formVisible),
    submitVisible: Boolean(snap.submitVisible),
    submitted: Boolean(extras.submitted),
    platform: extras.platform || null,
    title: snap.title || "",
  };
  writeJson("login-fail.json", payload);
  return payload;
}

function isClickIntercepted(err) {
  return /click intercepted|not clickable|Other element would receive the click|not interactable/i
    .test(String((err && err.message) || err || ""));
}

async function cookieBannerVisible(browser) {
  const banner = await browser.$(SELECTORS.cookieBanner);
  return displayed(banner);
}

async function dismissCookieBanner(browser) {
  let dismissed = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!(await cookieBannerVisible(browser))) {
      return { dismissed: dismissed > 0, attempts: dismissed };
    }
    const btn = await browser.$(SELECTORS.cookieAcceptBtn);
    const named = await browser.$(xpathButton(SELECTORS.cookieAccept));
    const target = (await displayed(btn)) ? btn : ((await displayed(named)) ? named : null);
    if (!target) return { dismissed: dismissed > 0, attempts: dismissed };
    if (typeof target.waitForClickable === "function") {
      await target.waitForClickable({ timeout: 3_000 }).catch(() => {});
    }
    await target.click();
    dismissed += 1;
    console.log(`LOGIN cookie banner detected and accepted attempt=${attempt}`);
    const gone = await waitFor(browser, async () => !(await cookieBannerVisible(browser)), {
      timeoutMs: 4_000,
      intervalMs: 150,
      message: "cookie banner still visible after Принять",
    }).catch(() => false);
    if (gone) return { dismissed: true, attempts: dismissed };
  }
  return { dismissed: dismissed > 0, attempts: dismissed };
}

async function clickLoginControl(browser, findEl, label) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await dismissCookieBanner(browser);
    const el = await findEl();
    try {
      if (typeof el.waitForClickable === "function") {
        await el.waitForClickable({ timeout: 4_000 });
      } else {
        await el.waitForDisplayed({ timeout: 4_000 });
      }
      const fresh = await findEl();
      await fresh.click();
      return fresh;
    } catch (err) {
      lastErr = err;
      const retryable = isClickIntercepted(err) || /stale element/i.test(String((err && err.message) || err || ""));
      if (!retryable) throw err;
      console.log(`LOGIN ${label} click intercepted attempt=${attempt}; retrying after cookie banner`);
      await dismissCookieBanner(browser);
    }
  }
  const wrapped = new FlowError("LOGIN", String((lastErr && lastErr.message) || lastErr || "login click intercepted"), {
    productFailure: false,
    classification: "TEST INFRA BUG",
    failedStep: "LOGIN",
  });
  wrapped.submitClicked = false;
  throw wrapped;
}

async function login(browser, { login: username, password }, { platform } = {}) {
  await browser.url(loginUrl());

  const loginInputXpath = `xpath://label[.//span[contains(., ${JSON.stringify(SELECTORS.loginField)})]]//input`;
  const passwordInputXpath = `xpath://label[.//span[contains(., ${JSON.stringify(SELECTORS.passwordField)})]]//input`;
  let submitted = false;
  try {
    await dismissCookieBanner(browser);
    const appeared = await waitFor(browser, async () => {
      const url = String(await browser.getUrl());
      if (!url.includes("/cabinet/login")) return "already";
      await dismissCookieBanner(browser);
      const input = await browser.$(loginInputXpath);
      if (await displayed(input)) return "form";
      return false;
    }, { timeoutMs: TIMEOUTS.LOGIN_FORM, message: "Neither login form nor authenticated cabinet appeared" });

    if (appeared === "already") {
      return { alreadyAuthenticated: true, url: await browser.getUrl(), submitted: false };
    }

    await dismissCookieBanner(browser);
    const loginTab = await browser.$(xpathTab(SELECTORS.loginTab));
    if (await displayed(loginTab)) await clickLoginControl(browser, async () => browser.$(xpathTab(SELECTORS.loginTab)), "login-tab");

    await clickLoginControl(browser, async () => browser.$(loginInputXpath), "login-input");
    const loginInput = await browser.$(loginInputXpath);
    await loginInput.setValue(username);

    await clickLoginControl(browser, async () => browser.$(passwordInputXpath), "password-input");
    const passwordInput = await browser.$(passwordInputXpath);
    await passwordInput.setValue(password);

    await clickLoginControl(browser, async () => browser.$(xpathButton(SELECTORS.submitLogin)), "submit");
    submitted = true;

    await waitFor(browser, async () => {
      const url = String(await browser.getUrl());
      return !url.includes("/cabinet/login");
    }, { timeoutMs: TIMEOUTS.LOGIN_SUBMIT, message: "Login did not leave /cabinet/login" });

    const url = await browser.getUrl();
    if (String(url).includes("/cabinet/login")) {
      throw new Error("Login did not leave /cabinet/login");
    }
    return { alreadyAuthenticated: false, url, submitted: true };
  } catch (err) {
    if (isSessionGone(err)) throw err;
    const message = String((err && err.message) || err);
    const overlay = isClickIntercepted(err) || /cookie banner/i.test(message);
    const stillLogin = /Login did not leave|Neither login form|Still on login page/i.test(message);
    if (stillLogin || overlay) {
      const diag = await captureLoginFailure(browser, { submitted, platform }).catch((captureErr) => {
        if (isSessionGone(captureErr)) throw captureErr;
        return { submitted, captureError: String((captureErr && captureErr.message) || captureErr) };
      });
      const wrapped = new FlowError("LOGIN", message, {
        productFailure: false,
        classification: overlay ? "TEST INFRA BUG" : "TEST BUG",
        failedStep: "LOGIN",
      });
      wrapped.submitClicked = submitted;
      wrapped.loginDiag = diag;
      throw wrapped;
    }
    throw err;
  }
}

async function enableBoardDebug(browser) {
  await browser.execute((key) => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* private mode */
    }
  }, SELECTORS.boardSyncDebugKey);
}

module.exports = { login, enableBoardDebug, captureLoginFailure, dismissCookieBanner, isClickIntercepted };
