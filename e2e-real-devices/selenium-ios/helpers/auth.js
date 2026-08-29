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

async function login(browser, { login: username, password }, { platform } = {}) {
  await browser.url(loginUrl());

  const loginInputXpath = `xpath://label[.//span[contains(., ${JSON.stringify(SELECTORS.loginField)})]]//input`;
  let submitted = false;
  try {
    const appeared = await waitFor(browser, async () => {
      const url = String(await browser.getUrl());
      if (!url.includes("/cabinet/login")) return "already";
      const input = await browser.$(loginInputXpath);
      if (await displayed(input)) return "form";
      return false;
    }, { timeoutMs: 25_000, message: "Neither login form nor authenticated cabinet appeared" });

    if (appeared === "already") {
      return { alreadyAuthenticated: true, url: await browser.getUrl(), submitted: false };
    }

    const loginTab = await browser.$(xpathTab(SELECTORS.loginTab));
    if (await displayed(loginTab)) await loginTab.click();

    const loginInput = await browser.$(loginInputXpath);
    await loginInput.waitForDisplayed({ timeout: 20_000 });
    await loginInput.click();
    await loginInput.setValue(username);

    const passwordInput = await browser.$(
      `xpath://label[.//span[contains(., ${JSON.stringify(SELECTORS.passwordField)})]]//input`,
    );
    await passwordInput.click();
    await passwordInput.setValue(password);

    const submit = await browser.$(xpathButton(SELECTORS.submitLogin));
    await submit.click();
    submitted = true;

    await waitFor(browser, async () => {
      const url = String(await browser.getUrl());
      return !url.includes("/cabinet/login");
    }, { timeoutMs: 45_000, message: "Login did not leave /cabinet/login" });

    const url = await browser.getUrl();
    if (String(url).includes("/cabinet/login")) {
      throw new Error("Login did not leave /cabinet/login");
    }
    return { alreadyAuthenticated: false, url, submitted: true };
  } catch (err) {
    if (isSessionGone(err)) throw err;
    const message = String((err && err.message) || err);
    const stillLogin = /Login did not leave|Neither login form|Still on login page/i.test(message);
    if (stillLogin) {
      const diag = await captureLoginFailure(browser, { submitted, platform }).catch((captureErr) => {
        if (isSessionGone(captureErr)) throw captureErr;
        return { submitted, captureError: String((captureErr && captureErr.message) || captureErr) };
      });
      const wrapped = new FlowError("LOGIN", message, {
        productFailure: false,
        classification: "TEST BUG",
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

module.exports = { login, enableBoardDebug, captureLoginFailure };
