import { getAppVersion } from "./appVersion";
import { isAppUpdateUnsafe } from "./appUpdateGuard";

const RELOAD_ONCE_KEY = "itflux.reload-for-version";
const VERSION_QUERY = "_itflux_v";
const UPDATE_CHECK_MS = 5 * 60 * 1000;
const STANDALONE_UPDATE_CHECK_MS = 30 * 1000;
const VERSION_URL = "/version.json";

let started = false;
let updateAvailable = false;
let remoteVersion = "";
const listeners = new Set();

function emit() {
  const snapshot = getAppUpdateState();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore */
    }
  });
}

export function getAppUpdateState() {
  return {
    updateAvailable,
    remoteVersion,
    localVersion: getAppVersion(),
  };
}

export function subscribeAppUpdate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isRemoteNewer(version) {
  const local = getAppVersion();
  if (!version || !local || local === "dev") return false;
  if (version.includes("__ITFLUX_APP_VERSION__")) return false;
  return version !== local;
}

function markUpdateAvailable(version = "") {
  if (version && !isRemoteNewer(version)) {
    return;
  }
  updateAvailable = true;
  if (version) remoteVersion = version;
  emit();
}

function alreadyReloadedFor(version) {
  try {
    return sessionStorage.getItem(RELOAD_ONCE_KEY) === version;
  } catch {
    return false;
  }
}

function markReloaded(version) {
  try {
    sessionStorage.setItem(RELOAD_ONCE_KEY, version);
  } catch {
    /* ignore */
  }
}

/** Backend reported incompatible client — force update banner. */
export function markUpdateFromClientRequired(minimumVersion = "") {
  updateAvailable = true;
  if (minimumVersion) remoteVersion = minimumVersion;
  emit();
}

function isStandaloneShell() {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true
    );
  } catch {
    return false;
  }
}

function reloadWithCacheBust(target) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(VERSION_QUERY, String(target || Date.now()));
    window.location.replace(url.href);
    return;
  } catch {
    /* fall through */
  }
  window.location.reload();
}

/** Hard reload once per target version — avoids infinite reload loops. */
export function applyAppUpdate({ force = false } = {}) {
  const target = remoteVersion || getAppVersion();
  if (!force && isAppUpdateUnsafe()) {
    markUpdateAvailable(target);
    return false;
  }
  if (alreadyReloadedFor(target) && !force) {
    markUpdateAvailable(target);
    return false;
  }
  markReloaded(target);
  reloadWithCacheBust(target);
  return true;
}

async function fetchRemoteVersion() {
  const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data?.version === "string" ? data.version : null;
}

export async function checkForAppUpdate() {
  try {
    const remote = await fetchRemoteVersion();
    if (!remote) return getAppUpdateState();
    if (isRemoteNewer(remote)) {
      markUpdateAvailable(remote);
    } else {
      remoteVersion = remote;
      emit();
    }
  } catch {
    /* offline / old deploy without version.json */
  }
  return getAppUpdateState();
}

async function unregisterForeignServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs.map(async (reg) => {
        const script = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || "";
        if (script && !script.endsWith("/sw.js")) {
          try {
            await reg.unregister();
          } catch {
            /* ignore */
          }
        }
      }),
    );
  } catch {
    /* ignore */
  }
}

async function requestSwUpdate() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
  } catch {
    /* ignore */
  }
}

function onControllerChange() {
  // New SW took control — verify against /version.json before reloading.
  checkForAppUpdate().then((state) => {
    if (!state.updateAvailable) return;
    if (!isAppUpdateUnsafe() && !alreadyReloadedFor(state.remoteVersion)) {
      applyAppUpdate();
    }
  });
}

function onSwMessage(event) {
  if (!event?.data) return;
  if (event.data.type === "ITFLUX_SW_ACTIVATED") {
    const version = event.data.version || "";
    if (!isRemoteNewer(version)) return;
    markUpdateAvailable(version);
    if (!isAppUpdateUnsafe() && !alreadyReloadedFor(version)) {
      applyAppUpdate();
    }
  }
}

/**
 * Start update polling + SW lifecycle. Safe to call once from main.jsx.
 */
export function startAppUpdateMonitor() {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  const pollMs = isStandaloneShell() ? STANDALONE_UPDATE_CHECK_MS : UPDATE_CHECK_MS;

  unregisterForeignServiceWorkers();
  checkForAppUpdate().then((state) => {
    if (state.updateAvailable && isStandaloneShell() && !isAppUpdateUnsafe()) {
      applyAppUpdate();
    }
  });
  requestSwUpdate();

  const intervalId = window.setInterval(() => {
    checkForAppUpdate().then((state) => {
      if (state.updateAvailable && isStandaloneShell() && !isAppUpdateUnsafe()) {
        applyAppUpdate();
      }
    });
    requestSwUpdate();
  }, pollMs);

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      checkForAppUpdate();
      requestSwUpdate();
      if (updateAvailable && !isAppUpdateUnsafe()) {
        applyAppUpdate();
      }
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker.addEventListener("message", onSwMessage);
  }

  return () => {
    window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", onVisible);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      navigator.serviceWorker.removeEventListener("message", onSwMessage);
    }
    started = false;
  };
}
