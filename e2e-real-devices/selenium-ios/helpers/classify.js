const { FlowError } = require("./dom");
const { isExecuteSerializeError } = require("./execute-json");

const MATRIX = {
  PASS: "PASS",
  PRODUCT_FAIL: "PRODUCT_FAIL",
  INFRA_SKIP: "INFRA_SKIP",
  PERMISSION_LIMITATION: "PERMISSION_LIMITATION",
  TEST_BUG: "TEST_BUG",
  UNSUPPORTED_DEVICE: "UNSUPPORTED_DEVICE",
};

function errorText(err) {
  return String((err && err.message) || err || "");
}

function isWebDriverInfraError(err) {
  const message = errorText(err);
  const code = String((err && err.code) || "");
  return isExecuteSerializeError(err)
    || /stale element|not attached to the page document|element cache|cached element/i.test(message)
    || /unsupported.*actions|when running "actions"|DELETE.*actions|mapped resource/i.test(message)
    || /switchFrame|switch to frame|no such frame|no such window|doesn't exist/i.test(message)
    || /no such element|element not found|invalid selector|invalid element/i.test(message)
    || /cannot be transferred|Recursive object|circular structure|JSON\.parse/i.test(message)
    || /not interactable|element click intercepted|element not visible/i.test(message)
    || /webdriver|unknown command|unknown error:.*session/i.test(message)
    || /session not started|session deleted|invalid session id|session terminated|not started or terminated/i.test(message)
    || /UND_ERR_CLOSED|socket hang up|transport timeout|idle timeout/i.test(message)
    || /TEST INFRA|TEST SELECTOR/i.test(code)
    || /TEST INFRA|TEST SELECTOR/i.test(String((err && err.classification) || ""));
}

function isSessionGone(err) {
  const message = errorText(err);
  return /session not started|not started or terminated|invalid session id|session deleted|session terminated|UND_ERR_CLOSED|socket hang up|ECONNRESET|ECONNREFUSED/i.test(message);
}

function isInfraSkipError(err) {
  const message = errorText(err);
  return /UND_ERR_CLOSED|socket hang up|ECONNRESET|ECONNREFUSED|transport timeout|idle timeout|testing time expired|quota/i.test(message)
    || /device.*not (available|supported)|All parallel tests|could not start|session not created|failed to create session/i.test(message);
}

function classifyVendorError(err) {
  const message = errorText(err);
  if (/testing time expired/i.test(message)) {
    return {
      RESULT: "blocked",
      code: "BROWSERSTACK QUOTA EXPIRED",
      productFailure: false,
      matrixResult: MATRIX.INFRA_SKIP,
      error: message,
      hint: "BrowserStack Automate minutes are exhausted. This is not a lesson-room, Jitsi, or capability failure.",
    };
  }
  if (/unsupported WebDriver capabilities.*safariAllowPopups/i.test(message)) {
    return {
      RESULT: "failed",
      code: "W3C CAPABILITY",
      productFailure: false,
      matrixResult: MATRIX.TEST_BUG,
      error: message,
      hint: "Use appium:safariAllowPopups, never unprefixed safariAllowPopups (WebdriverIO W3C).",
    };
  }
  if (isExecuteSerializeError(err) || /TEST INFRA/i.test(String((err && err.code) || ""))) {
    return {
      RESULT: "failed",
      code: (err && err.code) || "BOARD = TEST INFRA BUG",
      productFailure: false,
      matrixResult: MATRIX.TEST_BUG,
      classification: "TEST INFRA BUG",
      "BOARD CLICK": "pending",
      "BOARD NAVIGATION": "pending",
      "BOARD CONTAINER": "pending",
      CANVAS: "pending",
      error: message,
    };
  }
  const code = (err && err.code) || (err instanceof FlowError ? err.code : "failed");
  const freeze = /BOARD FREEZE/i.test(String(code))
    || /BOARD FREEZE/i.test(String((err && err.classification) || ""));
  const boardish = /BOARD|CANVAS|DRAW|TEST SELECTOR|TEST INFRA|TEST BUG/i.test(String(code));
  const drawLike = /^(DRAW|CANVAS)/i.test(String(code));
  const strokeSucceededBefore = Boolean(err && err.strokeSucceededBefore);
  let productFailure = true;
  if (freeze && strokeSucceededBefore && !isWebDriverInfraError(err)) productFailure = true;
  else if (freeze && !strokeSucceededBefore) productFailure = false;
  else if (isWebDriverInfraError(err)) productFailure = false;
  else if (drawLike && !strokeSucceededBefore) productFailure = false;
  else if (typeof err.productFailure === "boolean") productFailure = err.productFailure;
  else if (boardish) productFailure = false;
  else if (/Native Allow not found|Android Allow not found/i.test(String(code))) productFailure = false;
  else if (/Login did not leave \/cabinet\/login/i.test(message)) {
    productFailure = false;
  }
  else if (/timeout|timed out|ECONNRESET|ECONNREFUSED|session not created|failed to create session|could not start|All parallel tests|Neither login form|not a valid device|unsupported device|unsupported version|os version.*not/i.test(message)) {
    productFailure = false;
  }

  let classification = (err && err.classification) || null;
  if (freeze && productFailure) classification = "BOARD FREEZE";
  else if (/Login did not leave \/cabinet\/login/i.test(message)) {
    classification = "TEST BUG";
  }
  else if (isWebDriverInfraError(err) || (drawLike && !strokeSucceededBefore)) {
    classification = /TEST INFRA/i.test(String(code)) ? "TEST INFRA BUG" : "TEST BUG";
  } else if (!classification) {
    classification = boardish ? "TEST BUG" : null;
  }

  return {
    RESULT: "failed",
    code,
    productFailure,
    classification,
    "BOARD CLICK": (err && err.boardClick) || null,
    "BOARD NAVIGATION": (err && err.navigation) || null,
    "BOARD CONTAINER": (err && err.container) || null,
    matrixResult: matrixResultFromError(err, { code, productFailure, message, classification }),
    error: message,
  };
}

function matrixResultFromError(err, classified = {}) {
  const message = String((classified.message || (err && err.message) || err || ""));
  const code = String(classified.code || (err && err.code) || "");
  const classification = String((err && err.classification) || classified.classification || "");
  if (/testing time expired|quota/i.test(message)) return MATRIX.INFRA_SKIP;
  if (isInfraSkipError({ message })) return MATRIX.INFRA_SKIP;
  if (/session not started or terminated|invalid session id|session deleted/i.test(message)
    && !/BOARD FREEZE/i.test(code) && !/BOARD FREEZE/i.test(classification)) {
    if (err && err.sessionWasAlive) return MATRIX.INFRA_SKIP;
    return MATRIX.TEST_BUG;
  }
  if (/BOARD FREEZE/i.test(code) || /BOARD FREEZE/i.test(classification)) {
    if (classified.productFailure === true) return MATRIX.PRODUCT_FAIL;
    return MATRIX.TEST_BUG;
  }
  if (/not a valid device|invalid device|device.*not (supported|available)|os version.*not|unsupported device|unsupported version/i.test(message)) {
    return MATRIX.UNSUPPORTED_DEVICE;
  }
  if (/Native Allow not found|Android Allow not found|PERMISSION/i.test(code) || /microphone Allow was not found/i.test(message)) {
    return MATRIX.PERMISSION_LIMITATION;
  }
  if (
    isWebDriverInfraError(err)
    || /TEST BUG|TEST INFRA|TEST SELECTOR/i.test(code)
    || /TEST BUG|TEST INFRA/i.test(classification)
    || /stale element|DELETE.*actions|skipRelease|switch to frame|freedraw tool not/i.test(message)
  ) {
    return MATRIX.TEST_BUG;
  }
  if (/Login did not leave \/cabinet\/login/i.test(message)) return MATRIX.TEST_BUG;
  if (/timeout|timed out|ECONNRESET|ECONNREFUSED|session not created|failed to create session|could not start|All parallel tests|Neither login form/i.test(message)) {
    return MATRIX.INFRA_SKIP;
  }
  if (classified.productFailure === true) return MATRIX.PRODUCT_FAIL;
  return MATRIX.TEST_BUG;
}

function boardSummaryLines(source) {
  const click = source["BOARD CLICK"] && source["BOARD CLICK"] !== "pending"
    ? source["BOARD CLICK"]
    : (source.BOARD && source.BOARD.status === "ok" ? "PASS" : "pending");
  const nav = source["BOARD NAVIGATION"] || "pending";
  const container = source["BOARD CONTAINER"] && source["BOARD CONTAINER"] !== "pending"
    ? source["BOARD CONTAINER"]
    : "pending";
  const canvas = source.CANVAS && source.CANVAS.status === "ok"
    ? "PASS"
    : (source.CANVAS && source.CANVAS.status === "fail" ? "FAIL" : "pending");
  const classification = source.CLASSIFICATION || source.classification || "pending";
  return [
    `BOARD CLICK = ${click}`,
    `BOARD NAVIGATION = ${nav}`,
    `BOARD CONTAINER = ${container}`,
    `CANVAS = ${canvas}`,
    `CLASSIFICATION = ${classification}`,
  ];
}

function stepPass(report, key) {
  const v = report && report[key];
  if (!v || v === "pending") return false;
  if (typeof v === "object") return v.status === "ok";
  return v === "PASS" || v === "passed" || v === "ok";
}

module.exports = {
  MATRIX,
  classifyVendorError,
  matrixResultFromError,
  boardSummaryLines,
  stepPass,
  isWebDriverInfraError,
  isSessionGone,
  isInfraSkipError,
  errorText,
};
