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

/** iPhone/iPad «На экран Домой»: WebRTC/iframe звонка часто не стартует. */
export function isIosStandaloneDisplay() {
  return isIosDevice() && isStandaloneDisplay();
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
  const alreadyGranted = typeof Notification !== "undefined"
    && Notification.permission === "granted";
  if (!alreadyGranted) {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("Разрешение на уведомления не выдано");
    }
  }
  const reg = await getPushRegistration();
  if (!reg?.pushManager) {
    throw new Error("Service Worker ещё не готов — обновите страницу и попробуйте снова");
  }

  let existing = await reg.pushManager.getSubscription();
  if (existing && !subscriptionMatchesVapidKey(existing, publicKey)) {
    // Только смена VAPID-ключей делает старую подписку невалидной.
    try {
      await existing.unsubscribe();
    } catch {
      /* ignore */
    }
    existing = null;
  }
  if (existing) {
    return {
      subscription: existing.toJSON(),
      device_label: deviceLabel,
      reused: true,
    };
  }

  try {
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    return {
      subscription: subscription.toJSON(),
      device_label: deviceLabel,
      reused: false,
    };
  } catch (err) {
    if (alreadyGranted && isPushGestureError(err)) {
      const gestureError = new Error("NEED_USER_GESTURE");
      gestureError.code = "need_user_gesture";
      throw gestureError;
    }
    throw err;
  }
}

function subscriptionMatchesVapidKey(subscription, publicKey) {
  try {
    const raw = subscription?.options?.applicationServerKey;
    if (!raw) return true;
    const existing = new Uint8Array(raw);
    const expected = urlBase64ToUint8Array(publicKey);
    if (existing.length !== expected.length) return false;
    for (let i = 0; i < existing.length; i += 1) {
      if (existing[i] !== expected[i]) return false;
    }
    return true;
  } catch {
    return true;
  }
}

function isPushGestureError(err) {
  const name = err?.name || "";
  const message = String(err?.message || "").toLowerCase();
  return (
    name === "NotAllowedError"
    || name === "AbortError"
    || message.includes("gesture")
    || message.includes("user activation")
    || message.includes("not granted")
  );
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
  const sub = await getCurrentPushSubscription();
  return sub?.endpoint || "";
}

export async function getCurrentPushSubscription() {
  try {
    const reg = await getPushRegistration();
    if (!reg?.pushManager) return null;
    const sub = await reg.pushManager.getSubscription();
    return sub ? sub.toJSON() : null;
  } catch {
    return null;
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
