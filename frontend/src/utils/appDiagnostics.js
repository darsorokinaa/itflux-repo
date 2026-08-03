import { DATA_SCHEMA_VERSION, getAppBuildTime, getAppVersion } from "./appVersion";
import { getAppUpdateState } from "./appUpdate";

async function listCacheNames() {
  if (typeof caches === "undefined") return [];
  try {
    return await caches.keys();
  } catch {
    return [];
  }
}

async function swInfo() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return { supported: false };
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const regs = await navigator.serviceWorker.getRegistrations();
    let swVersion = "";
    if (reg?.active) {
      swVersion = await new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => resolve(""), 1500);
        channel.port1.onmessage = (event) => {
          window.clearTimeout(timer);
          resolve(event.data?.swVersion || event.data?.version || "");
        };
        reg.active.postMessage({ type: "ITFLUX_GET_VERSION" }, [channel.port2]);
      });
    }
    return {
      supported: true,
      controller: navigator.serviceWorker.controller?.scriptURL || null,
      active: reg?.active?.scriptURL || null,
      waiting: reg?.waiting?.scriptURL || null,
      installing: reg?.installing?.scriptURL || null,
      scope: reg?.scope || null,
      registrationCount: regs.length,
      scriptURLs: regs.map((r) => r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || ""),
      swVersion,
    };
  } catch (err) {
    return { supported: true, error: String(err?.message || err) };
  }
}

function loadedScriptUrls() {
  if (typeof document === "undefined") return [];
  return Array.from(document.scripts)
    .map((s) => s.src)
    .filter(Boolean)
    .filter((src) => src.includes("/static/") || src.includes("/assets/"));
}

export async function collectAppDiagnostics() {
  const update = getAppUpdateState();
  const [cachesList, sw] = await Promise.all([listCacheNames(), swInfo()]);
  let apiOk = null;
  try {
    const res = await fetch("/api/csrf/", { credentials: "same-origin", cache: "no-store" });
    apiOk = res.ok;
  } catch {
    apiOk = false;
  }

  return {
    appVersion: getAppVersion(),
    buildTime: getAppBuildTime(),
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    updateAvailable: update.updateAvailable,
    remoteVersion: update.remoteVersion,
    serviceWorker: sw,
    caches: cachesList,
    loadedScripts: loadedScriptUrls(),
    apiReachable: apiOk,
    standalone:
      typeof window !== "undefined"
      && (window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
}
