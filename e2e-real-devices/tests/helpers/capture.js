const fs = require("fs");
const path = require("path");
const { isBrowserStackInfraError } = require("./locators");
const { isBrowserStackLimitationError } = require("./iosMicPermission");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function attachHttpCapture(page, bucket) {
  page.on("response", (res) => {
    const status = res.status();
    if (status >= 400) {
      bucket.push({
        at: new Date().toISOString(),
        status,
        method: res.request().method(),
        url: res.url(),
      });
    }
  });
}

async function writeCapture(testInfo, extra = {}) {
  const dir = testInfo.outputPath("capture");
  ensureDir(dir);
  const payload = {
    title: testInfo.title,
    status: testInfo.status,
    durationMs: testInfo.duration,
    retry: testInfo.retry,
    error: testInfo.error ? String(testInfo.error.message || testInfo.error) : null,
    ...extra,
  };
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(payload, null, 2));
  if (extra.httpFailures) {
    fs.writeFileSync(path.join(dir, "http-failures.json"), JSON.stringify(extra.httpFailures, null, 2));
  }
  if (testInfo.error) {
    fs.writeFileSync(path.join(dir, "error.txt"), String(testInfo.error.stack || testInfo.error.message || testInfo.error));
  }
}

async function screenshotNamed(page, testInfo, name) {
  const file = testInfo.outputPath(`${name}.png`);
  ensureDir(path.dirname(file));
  try {
    await page.screenshot({ path: file, fullPage: true });
  } catch {
    await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  }
  await testInfo.attach(name, { path: file, contentType: "image/png" }).catch(() => {});
  return file;
}

function installErrorCapture(test) {
  test.beforeEach(async ({ page }, testInfo) => {
    const httpFailures = [];
    attachHttpCapture(page, httpFailures);
    testInfo._itfluxHttpFailures = httpFailures;
    testInfo._itfluxStartedAt = Date.now();
  });

  test.afterEach(async ({ page }, testInfo) => {
    const httpFailures = testInfo._itfluxHttpFailures || [];
    const entryLog = testInfo._itfluxEntryLog;
    if (entryLog) {
      const dir = testInfo.outputPath("capture");
      ensureDir(dir);
      fs.writeFileSync(path.join(dir, "room-entry-diagnostics.json"), JSON.stringify(entryLog, null, 2));
    }
    await writeCapture(testInfo, {
      httpFailures,
      elapsedMs: Date.now() - (testInfo._itfluxStartedAt || Date.now()),
      url: page.url(),
      entryEvents: entryLog ? entryLog.events : undefined,
    });
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("failure-url.txt", {
        body: Buffer.from(String(page.url() || "")),
        contentType: "text/plain",
      }).catch(() => {});
      await screenshotNamed(page, testInfo, "failure").catch(() => {});
    }
  });
}

async function attachFailureContext(page, testInfo, err) {
  if (!page || !testInfo) return;
  try {
    await testInfo.attach("failure-url.txt", {
      body: Buffer.from(String(page.url() || "")),
      contentType: "text/plain",
    });
  } catch {
    /* page may be gone */
  }
  await screenshotNamed(page, testInfo, "failure").catch(() => {});
  if (err) {
    try {
      await testInfo.attach("failure-error.txt", {
        body: Buffer.from(String(err.stack || err.message || err)),
        contentType: "text/plain",
      });
    } catch {
      /* ignore */
    }
  }
}

async function runGuarded(test, fn, args, testInfo) {
  try {
    await fn(args, testInfo);
  } catch (err) {
    await attachFailureContext(args && args.page, testInfo, err);
    if (isBrowserStackLimitationError(err)) {
      test.skip(true, err.message);
    }
    if (isBrowserStackInfraError(err)) {
      test.skip(true, `BrowserStack infrastructure error (not a platform failure): ${err.message}`);
    }
    throw err;
  }
}

module.exports = {
  attachHttpCapture,
  writeCapture,
  screenshotNamed,
  installErrorCapture,
  runGuarded,
  attachFailureContext,
};
