const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();
const DISPOSED = "device run disposed";
const ABORTED = "device run aborted";

function runnerError(message) {
  const err = new Error(message);
  err.productFailure = false;
  err.classification = "TEST BUG";
  return err;
}

function sleepUnmanaged(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DeviceRunLifecycle {
  constructor() {
    this.controller = new AbortController();
    this.operation = new AbortController();
    this.disposed = false;
    this.timers = new Set();
    this.pending = new Set();
    this.browser = null;
    this.cleanup = null;
  }

  get signal() {
    return this.controller.signal;
  }

  get timerCount() {
    return this.timers.size;
  }

  get pendingCount() {
    return this.pending.size;
  }

  attachBrowser(browser) {
    if (this.disposed) throw runnerError(DISPOSED);
    this.browser = browser;
  }

  isLive() {
    return !this.disposed && !this.controller.signal.aborted;
  }

  abortOperation() {
    if (!this.operation.signal.aborted) this.operation.abort();
    this.operation = new AbortController();
  }

  throwIfDisposed() {
    if (this.disposed || this.controller.signal.aborted) throw runnerError(DISPOSED);
  }

  setTimeout(fn, ms) {
    if (this.disposed) return null;
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  clearTimeout(id) {
    if (id == null) return;
    clearTimeout(id);
    this.timers.delete(id);
  }

  track(promise) {
    const p = Promise.resolve(promise);
    if (this.disposed) return Promise.reject(runnerError(DISPOSED));
    this.pending.add(p);
    return p.finally(() => this.pending.delete(p));
  }

  async dispose({ pendingTimeoutMs = 15_000, deleteSessionTimeoutMs = 15_000 } = {}) {
    this.disposed = true;
    if (!this.controller.signal.aborted) this.controller.abort();
    if (!this.operation.signal.aborted) this.operation.abort();
    for (const id of [...this.timers]) clearTimeout(id);
    this.timers.clear();

    let pendingLeft = this.pending.size;
    if (pendingLeft) {
      let pendingTimer;
      try {
        await Promise.race([
          Promise.allSettled([...this.pending]),
          new Promise((resolve) => {
            pendingTimer = setTimeout(resolve, pendingTimeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(pendingTimer);
      }
      pendingLeft = this.pending.size;
    }

    const browser = this.browser;
    this.browser = null;
    let deleteOk = true;
    let deleteError = null;
    if (browser && typeof browser.deleteSession === "function") {
      let deleteTimer;
      try {
        const outcome = await Promise.race([
          Promise.resolve(browser.deleteSession()).then(() => "deleted").catch((err) => {
            deleteOk = false;
            deleteError = String((err && err.message) || err);
            return "failed";
          }),
          new Promise((resolve) => {
            deleteTimer = setTimeout(() => resolve("timeout"), deleteSessionTimeoutMs);
          }),
        ]);
        if (outcome === "timeout") {
          deleteOk = false;
          deleteError = deleteError || "deleteSession timed out";
        }
      } catch (err) {
        deleteOk = false;
        deleteError = String((err && err.message) || err);
      } finally {
        clearTimeout(deleteTimer);
      }
    }

    await sleepUnmanaged(250);

    const ok = this.timers.size === 0 && this.browser == null && pendingLeft === 0 && deleteOk;
    this.cleanup = {
      ok,
      status: ok ? "PASS" : "FAIL",
      timers: this.timers.size,
      pending: pendingLeft,
      browser: this.browser,
      deleteOk,
      deleteError,
    };
    return this.cleanup;
  }
}

function currentLifecycle() {
  return storage.getStore() || null;
}

function runWithLifecycle(lifecycle, fn) {
  return storage.run(lifecycle, fn);
}

function isRunAborted(signal) {
  const life = currentLifecycle();
  if (signal && signal.aborted) return true;
  if (!life) return false;
  return life.disposed || life.signal.aborted || life.operation.signal.aborted;
}

function throwIfRunDisposed() {
  const life = currentLifecycle();
  if (life) life.throwIfDisposed();
}

function sleep(ms, signal) {
  const life = currentLifecycle();
  return new Promise((resolve, reject) => {
    if (isRunAborted(signal)) {
      reject(runnerError(ABORTED));
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      detach();
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (life) life.clearTimeout(id);
      else clearTimeout(id);
      detach();
      reject(runnerError(ABORTED));
    };
    const id = life ? life.setTimeout(finish, ms) : setTimeout(finish, ms);
    const signals = [signal, life && life.signal, life && life.operation && life.operation.signal].filter(Boolean);
    function detach() {
      for (const item of signals) item.removeEventListener("abort", onAbort);
    }
    for (const item of signals) item.addEventListener("abort", onAbort, { once: true });
  });
}

module.exports = {
  DeviceRunLifecycle,
  currentLifecycle,
  runWithLifecycle,
  sleep,
  sleepUnmanaged,
  isRunAborted,
  throwIfRunDisposed,
  DISPOSED,
  ABORTED,
};
