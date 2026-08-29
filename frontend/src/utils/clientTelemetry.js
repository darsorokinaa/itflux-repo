/**
 * Lightweight production telemetry for mobile stability.
 * No names, emails, JWT, scene contents, or file payloads.
 */

const ENDPOINT = "/api/cabinet/client-telemetry/";
const MAX_PER_MINUTE = 40;
const CHUNK_RECOVER_KEY = "itflux.chunk-recover";
const VERSION_QUERY = "_itflux_v";

export const CLIENT_TELEMETRY_EVENTS = Object.freeze([
  "material_ws_closed",
  "material_ws_reconnect",
  "board_ws_closed",
  "board_ws_reconnect",
  "jitsi_connection_failed",
  "chunk_load_failed",
  "service_worker_update_failed",
  "board_payload_large",
  "board_full_state_requested",
  "board_full_state_received",
  "board_error",
  "board_health_sample",
  "api_timeout",
  "PWA_BACKGROUND",
  "PWA_FOREGROUND",
  "RESUME_START",
  "RESUME_AUTH_OK",
  "RESUME_AUTH_FAIL",
  "RESUME_REALTIME_START",
  "RESUME_REALTIME_OK",
  "RESUME_REALTIME_FAIL",
  "RESUME_JITSI_START",
  "RESUME_JITSI_OK",
  "RESUME_JITSI_FAIL",
  "RESUME_BOARD_START",
  "RESUME_BOARD_OK",
  "RESUME_BOARD_FAIL",
  "RESUME_READY",
  "RESUME_TIMEOUT",
  "MANUAL_RECONNECT_CLICK",
  "MANUAL_RELOAD_CLICK",
  "APP_FATAL_ERROR",
  "APP_UNHANDLED_REJECTION",
  "APP_RENDER_ERROR",
  "MAIN_THREAD_STALL",
  "JITSI_DUPLICATE",
  "RESOURCE_SNAPSHOT",
  "SW_INSTALL",
  "SW_ACTIVATE",
  "SW_CONTROLLER_CHANGE",
  "SW_NAVIGATION_FETCH",
  "SW_UPDATE_FOUND",
]);

const ALLOWED = new Set(CLIENT_TELEMETRY_EVENTS);

let started = false;
let sentAt = [];

function pruneWindow(now) {
  sentAt = sentAt.filter((t) => now - t < 60_000);
}

function connectionType() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return "";
    return String(c.effectiveType || c.type || "").slice(0, 16);
  } catch {
    return "";
  }
}

function collectContext() {
  const ua = typeof navigator !== "undefined" ? String(navigator.userAgent || "").slice(0, 240) : "";
  const platform = typeof navigator !== "undefined" ? String(navigator.platform || "").slice(0, 64) : "";
  const screenInfo =
    typeof screen !== "undefined"
      ? `${Number(screen.width) || 0}x${Number(screen.height) || 0}`
      : "";
  const viewport =
    typeof window !== "undefined"
      ? `${Number(window.innerWidth) || 0}x${Number(window.innerHeight) || 0}`
      : "";
  let online = true;
  try {
    online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  } catch {
    online = true;
  }
  return {
    browser: ua,
    os: platform,
    screen: screenInfo,
    viewport,
    online,
    connection: connectionType(),
    page: typeof window !== "undefined" ? String(window.location.pathname || "").slice(0, 160) : "",
    visibility: typeof document !== "undefined" ? String(document.visibilityState || "") : "",
    dpr: typeof window !== "undefined" ? Number(window.devicePixelRatio) || 1 : 1,
    pwa: (() => {
      try {
        return Boolean(
          window.matchMedia?.("(display-mode: standalone)")?.matches
          || window.navigator?.standalone,
        );
      } catch {
        return false;
      }
    })(),
    appVersion: typeof window !== "undefined" ? String(window.__APP_VERSION__ || "").slice(0, 64) : "",
  };
}

export function isChunkLoadError(error) {
  const blob = [
    error?.name,
    error?.message,
    error?.error?.message,
    error?.reason?.message,
    error?.reason,
  ]
    .filter(Boolean)
    .join(" ");
  return /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unexpected token '<'/i.test(
    blob,
  );
}

function alreadyRecoveredChunk() {
  try {
    return sessionStorage.getItem(CHUNK_RECOVER_KEY) === "1";
  } catch {
    return false;
  }
}

function markChunkRecovered() {
  try {
    sessionStorage.setItem(CHUNK_RECOVER_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** One-shot cache-bust after a missing hashed chunk. Never loops. */
export function recoverChunkLoadOnce() {
  if (typeof window === "undefined") return false;
  if (alreadyRecoveredChunk()) return false;
  markChunkRecovered();
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(VERSION_QUERY, String(Date.now()));
    window.location.replace(url.href);
    return true;
  } catch {
    window.location.reload();
    return true;
  }
}

export function reportClientEvent(event, extra = {}) {
  const name = String(event || "").slice(0, 64);
  if (!ALLOWED.has(name) || typeof window === "undefined") return false;
  const now = Date.now();
  pruneWindow(now);
  if (sentAt.length >= MAX_PER_MINUTE) return false;
  sentAt.push(now);

  const body = JSON.stringify({
    event: name,
    t: now,
    context: collectContext(),
    extra: extra && typeof extra === "object" ? extra : {},
  });
  try {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return true;
  } catch {
    /* fall through */
  }
  try {
    fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function startClientTelemetry() {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  const onError = (event) => {
    const err = event?.error || event;
    if (isChunkLoadError(err) || isChunkLoadError(event)) {
      reportClientEvent("chunk_load_failed", {
        message: String(err?.message || event?.message || "chunk").slice(0, 240),
        recovered: alreadyRecoveredChunk(),
      });
      recoverChunkLoadOnce();
      return;
    }
    reportClientEvent("APP_FATAL_ERROR", {
      message: String(err?.message || event?.message || "error").slice(0, 240),
      stack: String(err?.stack || "").slice(0, 800),
    });
  };
  const onRejection = (event) => {
    const reason = event?.reason;
    if (isChunkLoadError(reason) || isChunkLoadError(event)) {
      reportClientEvent("chunk_load_failed", {
        message: String(reason?.message || reason || "chunk").slice(0, 240),
        recovered: alreadyRecoveredChunk(),
      });
      recoverChunkLoadOnce();
      return;
    }
    reportClientEvent("APP_UNHANDLED_REJECTION", {
      message: String(reason?.message || reason || "rejection").slice(0, 240),
      stack: String(reason?.stack || "").slice(0, 800),
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    started = false;
  };
}
