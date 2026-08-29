const { test } = require("@playwright/test");
const { SELECTORS } = require("./locators");
const { requiredSecrets, originFromLessonUrl } = require("./env");

const LOGIN_TIMEOUT_MS = 45_000;

function isLoginPath(pathname) {
  return /^\/(cabinet\/)?login\/?$/.test(String(pathname || ""));
}

function isLoggedInUrl(urlString) {
  try {
    return !isLoginPath(new URL(String(urlString)).pathname);
  } catch {
    return false;
  }
}

function loginField(page) {
  return page.getByLabel(SELECTORS.loginField);
}

function loginHeading(page) {
  return page.getByRole("heading", { name: SELECTORS.authTitleLogin });
}

function authenticatedUi(page) {
  return page.getByRole("button", { name: SELECTORS.logout.name })
    .or(page.getByRole("button", { name: SELECTORS.openMenu.name }))
    .or(page.getByRole("button", { name: SELECTORS.closeMenu.name }))
    .or(page.getByRole("navigation", { name: SELECTORS.cabinetNav.name }));
}

async function loginFormVisible(page) {
  return (
    (await loginField(page).isVisible().catch(() => false))
    || (await loginHeading(page).isVisible().catch(() => false))
  );
}

async function hasAuthenticatedUi(page) {
  return authenticatedUi(page).first().isVisible().catch(() => false);
}

async function hasLeftLoginPage(page) {
  if (await hasAuthenticatedUi(page)) return true;
  if (isLoggedInUrl(page.url()) && !(await loginFormVisible(page))) return true;
  if (!(await loginFormVisible(page))) return true;
  return false;
}

async function readVisibleAuthError(page) {
  const alert = page.getByRole("alert");
  if (!(await alert.isVisible().catch(() => false))) return "";
  return String(await alert.innerText().catch(() => "")).trim();
}

async function attachLoginDiagnostics(page, extra = {}) {
  const info = test.info();
  const url = page.url();
  const authError = extra.authError != null ? extra.authError : await readVisibleAuthError(page);
  const payload = {
    url,
    authError,
    loginFormVisible: await loginFormVisible(page),
    authenticatedUi: await hasAuthenticatedUi(page),
    ...extra,
  };
  await info.attach("login-failure.json", {
    body: Buffer.from(JSON.stringify(payload, null, 2)),
    contentType: "application/json",
  }).catch(() => {});
  try {
    const png = await page.screenshot({ fullPage: true });
    await info.attach("login-failure.png", { body: png, contentType: "image/png" });
  } catch {
    try {
      const png = await page.screenshot({ fullPage: false });
      await info.attach("login-failure.png", { body: png, contentType: "image/png" });
    } catch {
      /* page may be gone */
    }
  }
}

async function failLogin(page, message, extra = {}) {
  const authError = extra.authError != null ? extra.authError : await readVisibleAuthError(page);
  await attachLoginDiagnostics(page, { ...extra, authError, message });
  throw new Error(`${message} url=${page.url()}${authError ? ` authError=${authError}` : ""}`);
}

function ignore(promise) {
  promise.catch(() => {});
  return promise;
}

async function waitForLoginFormOrRedirect(page) {
  const formReady = loginField(page).waitFor({ state: "visible", timeout: LOGIN_TIMEOUT_MS }).then(() => "form");
  const urlReady = page.waitForURL((url) => isLoggedInUrl(String(url)), {
    timeout: LOGIN_TIMEOUT_MS,
    waitUntil: "commit",
  }).then(() => "left");
  const uiReady = authenticatedUi(page).first().waitFor({
    state: "visible",
    timeout: LOGIN_TIMEOUT_MS,
  }).then(() => "left");

  let outcome;
  try {
    outcome = await Promise.race([formReady, urlReady, uiReady]);
  } catch (err) {
    ignore(formReady);
    ignore(urlReady);
    ignore(uiReady);
    if (await hasLeftLoginPage(page)) return "left";
    if (await loginFormVisible(page)) return "form";
    await failLogin(page, "Login page did not show the form or leave /cabinet/login.", {
      waitError: String(err && err.message || err),
    });
  }
  ignore(formReady);
  ignore(urlReady);
  ignore(uiReady);
  if (outcome === "form" && !(await hasLeftLoginPage(page))) return "form";
  if (await hasLeftLoginPage(page)) return "left";
  return outcome;
}

async function waitForLoginSuccess(page) {
  if (await hasLeftLoginPage(page)) return;

  const formGone = loginField(page).waitFor({ state: "hidden", timeout: LOGIN_TIMEOUT_MS }).then(() => "form-gone");
  const urlReady = page.waitForURL((url) => isLoggedInUrl(String(url)), {
    timeout: LOGIN_TIMEOUT_MS,
    waitUntil: "commit",
  }).then(() => "url");
  const uiReady = authenticatedUi(page).first().waitFor({
    state: "visible",
    timeout: LOGIN_TIMEOUT_MS,
  }).then(() => "ui");
  const alertReady = page.getByRole("alert").waitFor({
    state: "visible",
    timeout: LOGIN_TIMEOUT_MS,
  }).then(async () => {
    if (await loginFormVisible(page)) return "alert";
    return "stale-alert";
  });

  let outcome;
  try {
    outcome = await Promise.race([formGone, urlReady, uiReady, alertReady]);
  } catch (err) {
    ignore(formGone);
    ignore(urlReady);
    ignore(uiReady);
    ignore(alertReady);
    if (await hasLeftLoginPage(page)) return;
    const authError = await readVisibleAuthError(page);
    if (authError && await loginFormVisible(page)) {
      await failLogin(page, "Login failed.", { authError, waitError: String(err && err.message || err) });
    }
    await failLogin(page, "Login did not leave /cabinet/login.", {
      waitError: String(err && err.message || err),
    });
  }
  ignore(formGone);
  ignore(urlReady);
  ignore(uiReady);
  ignore(alertReady);

  if (outcome === "alert") {
    const authError = await readVisibleAuthError(page);
    await failLogin(page, "Login failed.", { authError });
  }

  if (await hasLeftLoginPage(page)) return;

  await failLogin(page, "Login did not leave /cabinet/login.");
}

async function loginIfNeeded(page) {
  const { login, password } = requiredSecrets();
  const origin = originFromLessonUrl();
  const loginUrl = `${origin}${SELECTORS.loginPath}`;

  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* private mode */
    }
  }, SELECTORS.boardSyncDebugKey);

  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  const ready = await waitForLoginFormOrRedirect(page);
  if (ready === "left" || await hasLeftLoginPage(page)) {
    return;
  }

  const loginTab = page.getByRole("tab", { name: SELECTORS.loginTab.name });
  if (await loginTab.isVisible().catch(() => false)) {
    await loginTab.click();
  }

  await loginField(page).fill(login);
  await page.getByLabel(SELECTORS.passwordField).fill(password);
  await page.getByRole("button", { name: SELECTORS.submitLogin.name }).click();

  await waitForLoginSuccess(page);
}

async function enableBoardSyncDebug(page) {
  await page.evaluate((key) => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* private mode */
    }
  }, SELECTORS.boardSyncDebugKey);
}

module.exports = {
  loginIfNeeded,
  enableBoardSyncDebug,
  isLoginPath,
  isLoggedInUrl,
};
