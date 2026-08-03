/**
 * Shared PWA helpers — one installable app for teacher and student.
 */

const INSTALL_DISMISS_KEY = "itflux-pwa-install-dismissed";
const PUSH_PROMPT_DISMISS_KEY = "itflux-push-prompt-dismissed";

export function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true
  );
}

export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function notificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function wasInstallDismissed() {
  try {
    return localStorage.getItem(INSTALL_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissInstallPrompt() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function wasPushPromptDismissed() {
  try {
    return localStorage.getItem(PUSH_PROMPT_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissPushPrompt() {
  try {
    localStorage.setItem(PUSH_PROMPT_DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearPushPromptDismiss() {
  try {
    localStorage.removeItem(PUSH_PROMPT_DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

export async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    // Убрать чужие/устаревшие SW с другого script URL (service-worker.js и т.п.)
    const existingRegs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      existingRegs.map(async (reg) => {
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

    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    // Дождаться activate — иначе subscribe может упасть с «ещё не готов»
    if (reg.installing || reg.waiting) {
      await withTimeout(navigator.serviceWorker.ready, 8000, null);
    }
    // Не оставлять waiting: просим немедленную активацию (SW тоже делает skipWaiting)
    if (reg.waiting) {
      reg.waiting.postMessage({ type: "ITFLUX_SKIP_WAITING" });
    }
    reg.addEventListener?.("updatefound", () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "ITFLUX_SKIP_WAITING" });
        }
      });
    });
    // Периодическая проверка обновления SW (иначе Chrome может ждать до 24ч)
    try {
      await reg.update();
    } catch {
      /* ignore */
    }
    return reg;
  } catch (err) {
    console.warn("SW registration failed", err);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function subscribeWebPush({ publicKey, deviceLabel = "" } = {}) {
  if (!publicKey) {
    throw new Error("Web Push не настроен на сервере");
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Браузер не поддерживает push-уведомления");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Разрешение на уведомления не выдано");
  }
  const reg = await getPushRegistration();
  if (!reg?.pushManager) {
    throw new Error("Service Worker ещё не готов — обновите страницу и попробуйте снова");
  }
  // Старая подписка после смены VAPID-ключей становится невалидной —
  // всегда пересоздаём при явном «Включить».
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    try {
      await existing.unsubscribe();
    } catch {
      /* ignore */
    }
  }
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return {
    subscription: subscription.toJSON(),
    device_label: deviceLabel,
  };
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/** Prefer existing registration — `ready` can hang forever if SW never activates. */
async function getPushRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    let existing = await navigator.serviceWorker.getRegistration();
    if (!existing) {
      existing = await registerServiceWorker();
    }
    if (existing) {
      if (existing.active) return existing;
      const ready = await withTimeout(navigator.serviceWorker.ready, 8000, null);
      return ready || existing;
    }
    return await withTimeout(navigator.serviceWorker.ready, 1500, null);
  } catch {
    return null;
  }
}

export async function getCurrentPushEndpoint() {
  try {
    const reg = await getPushRegistration();
    if (!reg?.pushManager) return "";
    const sub = await reg.pushManager.getSubscription();
    return sub?.endpoint || "";
  } catch {
    return "";
  }
}

export async function unsubscribeCurrentPush() {
  try {
    const reg = await getPushRegistration();
    if (!reg?.pushManager) return "";
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return "";
    const endpoint = sub.endpoint;
    await withTimeout(sub.unsubscribe(), 2000, false);
    return endpoint;
  } catch {
    return "";
  }
}

/** Listen for SW notification clicks and navigate inside the SPA. */
export function bindPushNavigation() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }
  const handler = (event) => {
    if (!event.data || event.data.type !== "ITFLUX_NOTIFICATION_CLICK") return;
    const url = event.data.url;
    if (typeof url === "string" && url.startsWith("/")) {
      window.location.assign(url);
    }
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
