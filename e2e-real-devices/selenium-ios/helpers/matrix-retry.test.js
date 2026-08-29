const test = require("node:test");
const assert = require("node:assert/strict");
const { MATRIX } = require("./classify");
const { shouldRetryRun, mergeRetryRows, matrixExitCode } = require("../matrix");

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

test("quick retries LOGIN TEST_BUG but not INFRA_SKIP", () => {
  assert.equal(shouldRetryRun({ RESULT: MATRIX.TEST_BUG, failedStep: "LOGIN" }, "quick"), true);
  assert.equal(shouldRetryRun({ RESULT: MATRIX.INFRA_SKIP, failedStep: "LOGIN" }, "quick"), false);
  assert.equal(shouldRetryRun({ RESULT: MATRIX.TEST_BUG, failedStep: "LOGIN" }, "core"), false);
  assert.equal(shouldRetryRun({ RESULT: MATRIX.PRODUCT_FAIL, failedStep: "BOARD" }, "core"), true);
});
