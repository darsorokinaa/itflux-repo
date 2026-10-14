import { lazy } from "react";

const RETRY_DELAYS_MS = [400, 1200];

/** Safari names a failed dynamic import TypeError: Load failed, with no URL. */
export function isModuleLoadError(error) {
  const message = String(error?.message || error || "");
  if (/ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unexpected token '<'/i.test(message)) {
    return true;
  }
  return error?.name === "TypeError" && message === "Load failed";
}

/**
 * Retries import() and attaches the rejection handler immediately.
 * Safari otherwise reports Load failed as an unhandled rejection.
 */
export function importWithRetry(importer, { attempts = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const run = (index) => {
      let promise;
      try {
        promise = importer();
      } catch (error) {
        reject(error);
        return;
      }
      if (!promise || typeof promise.then !== "function") {
        resolve(promise);
        return;
      }
      promise.then(resolve, (error) => {
        if (!isModuleLoadError(error) || index + 1 >= attempts) {
          reject(error);
          return;
        }
        const wait = RETRY_DELAYS_MS[Math.min(index, RETRY_DELAYS_MS.length - 1)] ?? 400;
        window.setTimeout(() => run(index + 1), wait);
      });
    };
    run(0);
  });
}

export function lazyWithRetry(importer) {
  return lazy(() => importWithRetry(importer));
}
