import { lazy } from "react";

import { isModuleLoadError, isStaleBoardModuleError } from "./moduleLoadError";

const RETRY_DELAYS_MS = [400, 1200];

export { isModuleLoadError, isStaleBoardModuleError };

function missingDefaultError() {
  return new TypeError("Importing a module script failed");
}

function retryWait(index) {
  return RETRY_DELAYS_MS[Math.min(index, RETRY_DELAYS_MS.length - 1)] ?? 400;
}

/**
 * Retries import() and attaches the rejection handler immediately.
 * Safari otherwise reports Load failed as an unhandled rejection.
 * A resolved module without default is the same failure: retry, then reject
 * so React never reads _result.default.
 */
export function importWithRetry(importer, { attempts = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const failOrRetry = (error, index) => {
      if (!isModuleLoadError(error) || index + 1 >= attempts) {
        reject(error);
        return;
      }
      window.setTimeout(() => run(index + 1), retryWait(index));
    };

    const acceptModule = (mod, index) => {
      if (mod?.default) {
        resolve(mod);
        return;
      }
      failOrRetry(missingDefaultError(), index);
    };

    const run = (index) => {
      let promise;
      try {
        promise = importer();
      } catch (error) {
        reject(error);
        return;
      }
      if (!promise || typeof promise.then !== "function") {
        acceptModule(promise, index);
        return;
      }
      promise.then(
        (mod) => acceptModule(mod, index),
        (error) => failOrRetry(error, index),
      );
    };

    run(0);
  });
}

export function lazyWithRetry(importer) {
  return lazy(() => importWithRetry(importer));
}
