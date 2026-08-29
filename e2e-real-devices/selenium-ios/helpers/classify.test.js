const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyVendorError, MATRIX } = require("./classify");
const { FlowError } = require("./dom");

test("unsupported device/version is UNSUPPORTED_DEVICE, not product fail", () => {
  const classified = classifyVendorError(new Error("OS version is not supported on this device"));
  assert.equal(classified.matrixResult, MATRIX.UNSUPPORTED_DEVICE);
  assert.equal(classified.productFailure, false);
});

test("quota expiry is INFRA_SKIP ENVIRONMENT BUG, not a device CORE FAIL", () => {
  const classified = classifyVendorError(new Error(
    'WebDriverError: Automate testing time expired. when running "https://hub.browserstack.com/wd/hub/session" with method "POST"',
  ));
  assert.equal(classified.matrixResult, MATRIX.INFRA_SKIP);
  assert.equal(classified.productFailure, false);
  assert.equal(classified.code, "BROWSERSTACK_QUOTA_EXPIRED");
  assert.equal(classified.classification, "ENVIRONMENT BUG");
});

test("isBrowserStackQuotaError matches Automate testing time expired", () => {
  const { isBrowserStackQuotaError } = require("./classify");
  assert.equal(isBrowserStackQuotaError(new Error("Automate testing time expired")), true);
  assert.equal(isBrowserStackQuotaError(new Error("UND_ERR_CLOSED: socket closed")), false);
});

test("login stuck on /cabinet/login is TEST_BUG, not PRODUCT_FAIL or INFRA timeout", () => {
  const err = new FlowError("LOGIN", "Login did not leave /cabinet/login", {
    productFailure: false,
    classification: "TEST BUG",
  });
  err.submitClicked = true;
  const classified = classifyVendorError(err);
  assert.equal(classified.productFailure, false);
  assert.equal(classified.matrixResult, MATRIX.TEST_BUG);
});

test("generic timeout is not product failure", () => {
  const classified = classifyVendorError(new Error("waitFor timed out"));
  assert.equal(classified.productFailure, false);
  assert.equal(classified.matrixResult, MATRIX.INFRA_SKIP);
});

test("permission miss is PERMISSION_LIMITATION", () => {
  const err = new FlowError(
    "Android Allow not found",
    "Android microphone Allow was not found after 20000ms",
    { productFailure: false, classification: "PERMISSION_LIMITATION" },
  );
  const classified = classifyVendorError(err);
  assert.equal(classified.matrixResult, MATRIX.PERMISSION_LIMITATION);
  assert.equal(classified.productFailure, false);
});

test("BOARD FREEZE is PRODUCT_FAIL even if message contains timeout", () => {
  const err = new FlowError("BOARD FREEZE", "board action timeout after 20000ms: control stroke", {
    productFailure: true,
    classification: "BOARD FREEZE",
    strokeSucceededBefore: true,
  });
  const classified = classifyVendorError(err);
  assert.equal(classified.productFailure, true);
  assert.equal(classified.matrixResult, MATRIX.PRODUCT_FAIL);
});

test("first DRAW WebDriver/tool error is TEST_BUG, not PRODUCT_FAIL", () => {
  const err = new FlowError("DRAW", "freedraw tool not displayed", {
    productFailure: true,
    classification: "PRODUCT BUG",
  });
  const classified = classifyVendorError(err);
  assert.equal(classified.productFailure, false);
  assert.equal(classified.matrixResult, MATRIX.TEST_BUG);
});

test("frame switch error is TEST INFRA BUG, matrix stays TEST_BUG", () => {
  const classified = classifyVendorError(new Error("Can't switch to frame with selector iframe.video-lesson-workspace__frame--board because it doesn't exist"));
  assert.equal(classified.productFailure, false);
  assert.equal(classified.classification, "TEST INFRA BUG");
  assert.equal(classified.matrixResult, MATRIX.TEST_BUG);
});

test("stale element is TEST INFRA BUG, not freeze or PRODUCT_FAIL", () => {
  const err = new FlowError("DRAW", "stale canvas during stroke: stale element reference", {
    productFailure: false,
    classification: "TEST BUG",
  });
  const classified = classifyVendorError(err);
  assert.equal(classified.classification, "TEST INFRA BUG");
  assert.equal(classified.matrixResult, MATRIX.TEST_BUG);
  assert.equal(classified.productFailure, false);
});

test("cookie banner click intercepted is TEST INFRA BUG", () => {
  const classified = classifyVendorError(new Error(
    'element click intercepted: Element <input type="password"> is not clickable. Other element would receive the click: <p class="cookie-banner-text">',
  ));
  assert.equal(classified.productFailure, false);
  assert.equal(classified.classification, "TEST INFRA BUG");
  assert.equal(classified.matrixResult, MATRIX.TEST_BUG);
});

test("WebDriver frame command error is TEST INFRA BUG", () => {
  const classified = classifyVendorError(new Error(
    'WebDriverError: An unknown server-side error occurred while processing the command. when running "frame"',
  ));
  assert.equal(classified.productFailure, false);
  assert.equal(classified.classification, "TEST INFRA BUG");
  assert.equal(classified.matrixResult, MATRIX.TEST_BUG);
});

test("session terminated without a live session is TEST_BUG, not PRODUCT_FAIL", () => {
  const classified = classifyVendorError(new Error("Session not started or terminated"));
  assert.equal(classified.productFailure, false);
  assert.equal(classified.matrixResult, MATRIX.TEST_BUG);
});

test("session terminated after a live BrowserStack session is INFRA_SKIP", () => {
  const err = new Error("Session not started or terminated");
  err.sessionWasAlive = true;
  const classified = classifyVendorError(err);
  assert.equal(classified.productFailure, false);
  assert.equal(classified.matrixResult, MATRIX.INFRA_SKIP);
});

test("UND_ERR_CLOSED is INFRA_SKIP, not PRODUCT_FAIL", () => {
  const classified = classifyVendorError(new Error("UND_ERR_CLOSED: socket closed"));
  assert.equal(classified.productFailure, false);
  assert.equal(classified.matrixResult, MATRIX.INFRA_SKIP);
});

test("CANVAS failure after session terminated stays TEST_BUG", () => {
  const err = new FlowError("CANVAS", "Session not started or terminated", {
    productFailure: true,
    classification: "PRODUCT BUG",
  });
  const classified = classifyVendorError(err);
  assert.equal(classified.productFailure, false);
  assert.equal(classified.matrixResult, MATRIX.TEST_BUG);
});
