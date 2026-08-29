const { currentLifecycle, isRunAborted } = require("./lifecycle");
const { FlowError } = require("./dom");
const { isSessionGone } = require("./classify");

const TIMEOUTS = {
  LOGIN_FORM: 20_000,
  LOGIN_SUBMIT: 25_000,
  PREJOIN: 30_000,
  ROOM_ROOT: 25_000,
  MIC_PERMISSION: 15_000,
  JITSI: 35_000,
  TAB: 12_000,
  MATERIALS: 15_000,
  BOARD: 20_000,
  CANVAS: 20_000,
  DRAW: 25_000,
  COMMAND: 20_000,
  STROKE_HANG: 25_000,
  ACTION_HANG: 15_000,
  RELIABILITY_IDLE: 3_000,
  DEVICE_RUN: {
    quick: 6 * 60_000,
    reliability: 8 * 60_000,
    tabcycle: 8 * 60_000,
    permission: 3 * 60_000,
    entry: 4 * 60_000,
    stress: 16 * 60_000,
    smoke: 25 * 60_000,
    core: 12 * 60_000,
    full: 12 * 60_000,
    soak: 70 * 60_000,
  },
  BS_IDLE: {
    quick: 180,
    reliability: 200,
    tabcycle: 200,
    permission: 120,
    entry: 150,
    stress: 240,
    smoke: 300,
    core: 240,
    default: 240,
  },
};

function deviceRunTimeoutMs(mode) {
  return TIMEOUTS.DEVICE_RUN[mode] || TIMEOUTS.DEVICE_RUN.core;
}

function browserStackIdleTimeout(mode) {
  return TIMEOUTS.BS_IDLE[mode] || TIMEOUTS.BS_IDLE.default;
}

function watchdogError(label, timeoutMs, cause) {
  const message = String((cause && cause.message) || cause || `${label} watchdog ${timeoutMs}ms`);
  const err = new FlowError("WATCHDOG", `${label} did not finish within ${timeoutMs}ms: ${message}`, {
    productFailure: false,
    classification: isSessionGone(cause) ? "TEST BUG" : "TEST INFRA BUG",
  });
  err.watchdog = true;
  err.cause = cause || null;
  return err;
}

async function withWatchdog(fn, { timeoutMs = TIMEOUTS.COMMAND, label = "command" } = {}) {
  const life = currentLifecycle();
  const work = life ? life.track(Promise.resolve().then(fn)) : Promise.resolve().then(fn);
  let timer;
  let timedOut = false;
  const timeout = new Promise((_, reject) => {
    const fire = () => {
      timedOut = true;
      if (life) life.abortOperation();
      reject(watchdogError(label, timeoutMs));
    };
    timer = life ? life.setTimeout(fire, timeoutMs) : setTimeout(fire, timeoutMs);
  });
  try {
    if (isRunAborted()) throw watchdogError(label, timeoutMs, new Error("device run aborted"));
    return await Promise.race([work, timeout]);
  } catch (err) {
    if (timedOut || /device run aborted/i.test(String((err && err.message) || err))) {
      throw watchdogError(label, timeoutMs, err);
    }
    if (isSessionGone(err) || /stale element|DELETE.*actions|execute\/sync|frame timeout/i.test(String((err && err.message) || err))) {
      throw Object.assign(err, { watchdog: true, classification: err.classification || "TEST BUG" });
    }
    throw err;
  } finally {
    if (life) life.clearTimeout(timer);
    else clearTimeout(timer);
  }
}

module.exports = {
  TIMEOUTS,
  deviceRunTimeoutMs,
  browserStackIdleTimeout,
  withWatchdog,
};
