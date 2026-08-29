const test = require("node:test");
const assert = require("node:assert/strict");
const { MATRIX } = require("./classify");
const {
  shouldRetryRun,
  mergeRetryRows,
  matrixExitCode,
  compactStatus,
  createSessionGate,
  skippedBeforeSessionRow,
  rowLooksLikeQuota,
} = require("../matrix");

test("retry PASS does not collapse the first FAIL to PASS", () => {
  const [first, second] = mergeRetryRows(
    { RESULT: MATRIX.PRODUCT_FAIL, failedStep: "LOGIN", exactError: "Login did not leave /cabinet/login" },
    { RESULT: MATRIX.PASS, failedStep: null, exactError: null },
  );
  assert.equal(first.RESULT, MATRIX.PRODUCT_FAIL);
  assert.equal(first.ATTEMPT, 1);
  assert.equal(second.RESULT, MATRIX.PASS);
  assert.equal(second.ATTEMPT, 2);
  assert.match(second.note, /not collapsed/);
  assert.equal(first.confirmedProductFail, undefined);
  assert.equal(matrixExitCode([first, second]), 0);
});

test("two independent same-step PRODUCT_FAILs confirm", () => {
  const [first, second] = mergeRetryRows(
    { RESULT: MATRIX.PRODUCT_FAIL, failedStep: "CANVAS", classification: "PRODUCT BUG" },
    { RESULT: MATRIX.PRODUCT_FAIL, failedStep: "CANVAS", classification: "PRODUCT BUG" },
  );
  assert.equal(first.confirmedProductFail, true);
  assert.equal(second.confirmedProductFail, true);
  assert.equal(matrixExitCode([first, second]), 1);
});

test("quick retries LOGIN TEST_BUG and INFRA_SKIP, but not random TEST_BUG", () => {
  assert.equal(shouldRetryRun({ RESULT: MATRIX.TEST_BUG, failedStep: "LOGIN" }, "quick"), true);
  assert.equal(shouldRetryRun({ RESULT: MATRIX.INFRA_SKIP, failedStep: "LOGIN", sessionId: "abc" }, "quick"), true);
  assert.equal(shouldRetryRun({ RESULT: MATRIX.TEST_BUG, failedStep: "LOGIN" }, "core"), false);
  assert.equal(shouldRetryRun({ RESULT: MATRIX.PRODUCT_FAIL, failedStep: "BOARD" }, "core"), true);
});

test("BrowserStack quota exhaustion is not retried", () => {
  const row = {
    RESULT: MATRIX.INFRA_SKIP,
    failedStep: null,
    exactError: "WebDriverError: Automate testing time expired. when running session",
    classification: "BROWSERSTACK_QUOTA_EXPIRED",
    sessionStarted: false,
    quotaSkip: true,
  };
  assert.equal(rowLooksLikeQuota(row), true);
  assert.equal(shouldRetryRun(row, "quick"), false);
  assert.equal(shouldRetryRun(row, "core"), false);
});

test("quota skip rows are not CORE FAIL", () => {
  const run = {
    device: "iPhone 17 Pro",
    osFamily: "ios",
    osVersion: "26",
    browserName: "Safari",
    orientation: "portrait",
  };
  const row = skippedBeforeSessionRow(run, {
    code: "BROWSERSTACK_QUOTA_EXPIRED",
    message: "Automate testing time expired",
  }, { opts: { mode: "quick" } });
  const compact = compactStatus(row);
  assert.equal(compact.CORE, "-");
  assert.equal(compact.BOARD, "-");
  assert.equal(compact.RESULT, MATRIX.INFRA_SKIP);
  assert.equal(row.sessionStarted, false);
  assert.equal(row.quotaSkip, true);
});

test("session gate stops remaining devices without creating extra rows to retry", () => {
  const gate = createSessionGate();
  assert.equal(gate.stopped, false);
  gate.stop({ code: "BROWSERSTACK_QUOTA_EXPIRED", message: "Automate testing time expired" });
  assert.equal(gate.stopped, true);
  gate.stop({ code: "other", message: "ignored" });
  assert.equal(gate.reason.code, "BROWSERSTACK_QUOTA_EXPIRED");
});
