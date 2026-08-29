const { SELECTORS } = require("./locators");
const { screenshotNamed } = require("./capture");

const SECRET_QUERY = /^(jwt|token|access_token|refresh_token|authorization|auth|password|secret|key|cookie|sessionid|csrftoken)$/i;
const JWT_BLOB = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function redactText(value) {
  return String(value || "")
    .replace(JWT_BLOB, "[redacted-jwt]")
    .replace(/(authorization\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .replace(/(cookie\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .replace(/(password\s*[:=]\s*)\S+/gi, "$1[redacted]");
}

function redactUrl(url) {
  const raw = String(url || "");
  try {
    const parsed = new URL(raw);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY.test(key) || /jwt|token|secret|password|auth/i.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }
    return redactText(parsed.toString());
  } catch {
    return redactText(raw.replace(/([?&](?:jwt|token|password|authorization)=)[^&]*/gi, "$1[redacted]"));
  }
}

function isMeetingOrJitsiUrl(url) {
  const u = String(url || "");
  return (
    /\/api\/video-meetings\//i.test(u)
    || /external_api\.js/i.test(u)
    || /lib-jitsi-meet/i.test(u)
    || /http-bind/i.test(u)
    || /xmpp-websocket/i.test(u)
    || /colibri-ws/i.test(u)
    || /\/conference/i.test(u)
    || /jitsi/i.test(u)
  );
}

function emptyLog() {
  return {
    startedAt: Date.now(),
    events: [],
    httpMeetingJitsi: [],
    http4xx: [],
    requestFailed: [],
    pageErrors: [],
    consoleErrors: [],
    consoleListenerAttached: false,
  };
}

function pushEvent(log, name, extra = {}) {
  log.events.push({
    tMs: Date.now() - log.startedAt,
    name,
    ...extra,
  });
}

async function readEntrySnapshot(page) {
  const cameraBtn = page.getByRole("button", { name: SELECTORS.cameraWithout.name });
  const errorTitle = page.getByText(SELECTORS.roomJoinError, { exact: true });
  const errorSubtitle = page.locator(".video-lesson-state__text");
  const roomRoot = page.locator(SELECTORS.roomRoot);
  const jitsiHost = page.locator(SELECTORS.jitsiContainer);
  const jitsiIframes = page.locator(SELECTORS.jitsiIframe);
  const iframeCount = await jitsiIframes.count().catch(() => 0);
  const iframeSrcs = [];
  for (let i = 0; i < Math.min(iframeCount, 3); i += 1) {
    iframeSrcs.push(redactUrl(await jitsiIframes.nth(i).getAttribute("src").catch(() => "")));
  }
  const subtitleVisible = await errorTitle.isVisible().catch(() => false);
  return {
    url: redactUrl(page.url()),
    roomRootVisible: await roomRoot.isVisible().catch(() => false),
    cameraWithoutVisible: await cameraBtn.isVisible().catch(() => false),
    cameraPromptVisible: await page.getByText(SELECTORS.cameraPromptTitle, { exact: true }).isVisible().catch(() => false),
    errorTitleVisible: subtitleVisible,
    errorSubtitle: subtitleVisible
      ? redactText((await errorSubtitle.first().innerText().catch(() => "")).trim())
      : "",
    connectionHint: redactText(
      (await page.getByRole("status").first().innerText().catch(() => "")).trim(),
    ),
    jitsiContainerVisible: await jitsiHost.isVisible().catch(() => false),
    jitsiIframeCount: iframeCount,
    jitsiIframeSrc: iframeSrcs,
  };
}

function installEntryDiagnostics(page, testInfo) {
  const log = emptyLog();
  log.consoleListenerAttached = true;

  page.on("response", (res) => {
    const url = redactUrl(res.url());
    const status = res.status();
    const rec = {
      tMs: Date.now() - log.startedAt,
      status,
      method: res.request().method(),
      url,
    };
    if (isMeetingOrJitsiUrl(res.url())) {
      log.httpMeetingJitsi.push(rec);
    }
    if (status >= 400) {
      log.http4xx.push(rec);
    }
  });

  page.on("requestfailed", (req) => {
    log.requestFailed.push({
      tMs: Date.now() - log.startedAt,
      method: req.method(),
      url: redactUrl(req.url()),
      failure: redactText(req.failure()?.errorText || ""),
      meetingOrJitsi: isMeetingOrJitsiUrl(req.url()),
    });
  });

  page.on("pageerror", (err) => {
    log.pageErrors.push({
      tMs: Date.now() - log.startedAt,
      message: redactText(err && err.message),
      name: err && err.name,
    });
  });

  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    log.consoleErrors.push({
      tMs: Date.now() - log.startedAt,
      type: msg.type(),
      text: redactText(msg.text()),
    });
  });

  if (testInfo) testInfo._itfluxEntryLog = log;
  pushEvent(log, "listeners-installed");
  return log;
}

async function recordEntrySnapshot(page, log, name) {
  const snap = await readEntrySnapshot(page);
  pushEvent(log, name, snap);
  return snap;
}

async function attachEntryDiagnostics(page, testInfo, log, extra = {}) {
  if (!testInfo || !log) return;
  const snap = page ? await readEntrySnapshot(page).catch(() => null) : null;
  const payload = {
    note: "Passwords, JWT, Authorization, cookies are redacted or omitted.",
    consoleLogsOnBrowserStackIos: "BrowserStack Playwright iOS does not support consoleLogs/playwrightLogs capabilities; page.on('console') may be empty.",
    snapshot: snap,
    extra,
    log,
  };
  const body = JSON.stringify(payload, null, 2);
  await testInfo.attach("room-entry-diagnostics.json", {
    body: Buffer.from(body),
    contentType: "application/json",
  }).catch(() => {});
}

async function screenshotEntry(page, testInfo, name) {
  if (!page || !testInfo) return;
  await screenshotNamed(page, testInfo, name).catch(() => {});
}

module.exports = {
  redactText,
  redactUrl,
  isMeetingOrJitsiUrl,
  installEntryDiagnostics,
  readEntrySnapshot,
  recordEntrySnapshot,
  attachEntryDiagnostics,
  screenshotEntry,
};
