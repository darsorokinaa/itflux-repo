/** Client build identity — injected by Vite (`__APP_VERSION__` / index.html). */

export const DATA_SCHEMA_VERSION = 3;

export function getAppVersion() {
  if (typeof window !== "undefined" && window.__APP_VERSION__) {
    return String(window.__APP_VERSION__);
  }
  try {
    // eslint-disable-next-line no-undef
    if (typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__) {
      // eslint-disable-next-line no-undef
      return String(__APP_VERSION__);
    }
  } catch {
    /* ignore */
  }
  return "dev";
}

export function getAppBuildTime() {
  if (typeof window !== "undefined" && window.__APP_BUILD_TIME__) {
    return String(window.__APP_BUILD_TIME__);
  }
  try {
    // eslint-disable-next-line no-undef
    if (typeof __APP_BUILD_TIME__ !== "undefined" && __APP_BUILD_TIME__) {
      // eslint-disable-next-line no-undef
      return String(__APP_BUILD_TIME__);
    }
  } catch {
    /* ignore */
  }
  return "";
}

const SCHEMA_KEY = "itflux.data-schema-version";

/** Drop only known legacy app keys when schema bumps (not all browser data). */
const LEGACY_KEYS_BY_SCHEMA = {
  1: ["cabinet-interactives-v1"],
  2: [],
};

export function migrateClientDataSchema() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const raw = localStorage.getItem(SCHEMA_KEY);
    const prev = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(prev) && prev >= DATA_SCHEMA_VERSION) return;

    for (let v = Math.max(0, prev); v < DATA_SCHEMA_VERSION; v += 1) {
      const keys = LEGACY_KEYS_BY_SCHEMA[v] || [];
      keys.forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      });
    }
    localStorage.setItem(SCHEMA_KEY, String(DATA_SCHEMA_VERSION));
  } catch {
    /* ignore */
  }
}
