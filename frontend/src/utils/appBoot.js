/**
 * Cold-start vs resume. Transient reconnect flags must not survive a new PWA launch.
 */

import { isIosStandaloneDisplay, isStandaloneDisplay } from "../cabinet/pwa/pwaHelpers";

export const BOOT_STAGES = Object.freeze({
  BOOTSTRAPPING: "BOOTSTRAPPING",
  AUTH_LOADING: "AUTH_LOADING",
  ROUTE_LOADING: "ROUTE_LOADING",
  READY: "READY",
  BOOTSTRAP_FAILED: "BOOTSTRAP_FAILED",
});

export const CHUNK_RECOVER_KEY = "itflux.chunk-recover";

const TRANSIENT_SESSION_KEYS = [
  "itflux.resume.state",
  "itflux.resume.inProgress",
  "itflux.reconnecting",
  "itflux.room.reconnecting",
  "itflux.joining",
  "itflux.isResuming",
  "itflux.isJoining",
  "itflux.loadingRoom",
  "itflux.shouldRecover",
  "itflux.jitsiInitializing",
  "itflux.boardInitializing",
  "itflux.connectionLocked",
];

const TRANSIENT_LOCAL_KEYS = [
  "itflux.resume.state",
  "itflux.reconnecting",
  "itflux.room.reconnecting",
  "itflux.isResuming",
  "itflux.isJoining",
  "itflux.loadingRoom",
  "itflux.shouldRecover",
  "itflux.jitsiInitializing",
  "itflux.boardInitializing",
  "itflux.connectionLocked",
];

export function isColdStart({ win = typeof window !== "undefined" ? window : null } = {}) {
  if (!win) return true;
  try {
    if (win.performance?.getEntriesByType) {
      const nav = win.performance.getEntriesByType("navigation")[0];
      if (nav && nav.type === "back_forward") return false;
    }
  } catch {
    /* ignore */
  }
  return !win.__ITFLUX_BOOTED;
}

export function markBootStage(stage, extra = {}) {
  if (typeof window === "undefined") return;
  window.__ITFLUX_BOOT_STAGE = String(stage || "").slice(0, 40);
  const debug = Boolean(
    import.meta.env?.DEV
    || (() => {
      try {
        return window.localStorage?.getItem("itflux.app.boot.debug") === "1";
      } catch {
        return false;
      }
    })(),
  );
  if (debug) {
    // eslint-disable-next-line no-console
    console.info(`[APP_BOOT] ${stage}`, extra && typeof extra === "object" ? extra : {});
  }
}

function removeKeys(storage, keys) {
  if (!storage) return [];
  const removed = [];
  keys.forEach((key) => {
    try {
      if (storage.getItem(key) != null) {
        storage.removeItem(key);
        removed.push(key);
      }
    } catch {
      /* ignore */
    }
  });
  return removed;
}

export function clearStaleCallOwners({
  storage = typeof localStorage !== "undefined" ? localStorage : null,
} = {}) {
  if (!storage) return [];
  const removed = [];
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith("itflux-call-owner:")) keys.push(key);
    }
    keys.forEach((key) => {
      storage.removeItem(key);
      removed.push(key);
    });
  } catch {
    /* ignore */
  }
  return removed;
}

export function resetTransientSessionState({
  session = typeof sessionStorage !== "undefined" ? sessionStorage : null,
  local = typeof localStorage !== "undefined" ? localStorage : null,
  iosStandalone = isIosStandaloneDisplay(),
} = {}) {
  const removed = [
    ...removeKeys(session, TRANSIENT_SESSION_KEYS),
    ...removeKeys(local, TRANSIENT_LOCAL_KEYS),
  ];
  if (iosStandalone) {
    removed.push(...clearStaleCallOwners({ storage: local }));
  }
  markBootStage(BOOT_STAGES.BOOTSTRAPPING, {
    pwa: isStandaloneDisplay(),
    iosStandalone,
    reset: removed,
  });
  return removed;
}

export function clearChunkRecoveryFlag({
  session = typeof sessionStorage !== "undefined" ? sessionStorage : null,
} = {}) {
  try {
    session?.removeItem(CHUNK_RECOVER_KEY);
    return true;
  } catch {
    return false;
  }
}

export function markAppReady() {
  if (typeof window === "undefined") return false;
  const root = document.getElementById("root");
  if (!root || root.childElementCount < 1) return false;
  window.__ITFLUX_BOOTED = true;
  markBootStage(BOOT_STAGES.READY);
  clearChunkRecoveryFlag();
  try {
    document.getElementById("itflux-boot-recover")?.remove();
  } catch {
    /* ignore */
  }
  return true;
}

export function cabinetHomePath(pathname = "") {
  const path = String(pathname || "");
  if (path.startsWith("/cabinet/student")) return "/cabinet/student";
  return "/cabinet";
}
