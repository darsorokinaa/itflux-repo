function enabled() {
  if (typeof window === "undefined") return false;
  try {
    if (window.__ITFLUX_ANN_DEBUG) return true;
    if (window.localStorage?.getItem("itflux.ann.debug") === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

export function annDebug(event, payload) {
  if (!enabled()) return;
  try {
    console.debug("[ann-v2]", event, payload || "");
  } catch {
    /* ignore */
  }
}
