/**
 * Проверка доступности видеосервиса с устройства пользователя.
 * Не создаёт конференцию, не выпускает использование комнаты и не подтверждает WebRTC.
 */

import { fetchVideoMeetingReachabilityConfig } from "../../utils/cabinetAuth";

export const REACHABILITY_SCRIPT_TIMEOUT_MS = 8000;
export const REACHABILITY_SOCKET_TIMEOUT_MS = 4000;

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function isOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/** iOS и Safari ломают no-cors fetch с cache: "no-store": TypeError «Load failed» при живом скрипте. */
export function omitOpaqueFetchCacheMode() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints) > 1) return true;
  return /Safari\//.test(ua) && /AppleWebKit/i.test(ua) && !/Chrome|CriOS|FxiOS|Edg\//.test(ua);
}

/** Ярлык «На экран Домой»: сторонний скрипт видеосвязи там часто не грузится, в Safari — грузится. */
export function isIosHomeScreen() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  const ios = /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints) > 1);
  if (!ios) return false;
  try {
    return window.navigator.standalone === true
      || window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  } catch {
    return false;
  }
}

export function isScriptProbeTimeout(error) {
  const code = String(error?.code || "");
  return error?.name === "AbortError" || code === "timeout" || code === "jitsi_script_timeout";
}

async function defaultLoadApi(domain, scriptUrl, timeoutMs) {
  const mod = await import("../jitsiMeet");
  return mod.loadJitsiExternalApi(domain, { scriptUrl, timeoutMs });
}

/** Не вставляет script в страницу: во время урока тот же файл уже грузит конференция. */
function scriptProbeUrl(domain, scriptUrl) {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0];
  return String(scriptUrl || "").trim() || (host ? `https://${host}/libs/external_api.min.js` : "");
}

function timeoutError() {
  const error = new Error("timeout");
  error.name = "AbortError";
  error.code = "timeout";
  return error;
}

async function fetchOpaqueScript(url, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = {
      method: "GET",
      mode: "no-cors",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    };
    if (!omitOpaqueFetchCacheMode()) init.cache = "no-store";
    await fetch(url, init);
  } finally {
    window.clearTimeout(timer);
  }
}

/** Не исполняет скрипт. Тот же путь, что у тега конференции: script-src, не connect-src. */
function probeScriptByPreload(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new TypeError("Load failed"));
      return;
    }
    const link = document.createElement("link");
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        link.remove();
      } catch {
        /* ignore */
      }
      if (error) reject(error);
      else resolve();
    };
    const timer = window.setTimeout(() => finish(timeoutError()), timeoutMs);
    link.setAttribute("rel", "preload");
    link.setAttribute("as", "script");
    link.href = url;
    link.addEventListener("load", () => finish(null), { once: true });
    link.addEventListener("error", () => finish(new TypeError("Load failed")), { once: true });
    (document.head || document.documentElement).appendChild(link);
  });
}

export async function loadJaasScriptByFetch(domain, scriptUrl, timeoutMs = REACHABILITY_SCRIPT_TIMEOUT_MS) {
  const url = scriptProbeUrl(domain, scriptUrl);
  if (!url) {
    throw new Error("no-script-url");
  }
  const started = nowMs();
  try {
    await fetchOpaqueScript(url, timeoutMs);
  } catch (error) {
    if (isScriptProbeTimeout(error)) throw error;
    // iOS/Safari: no-cors fetch бросает Load failed при живом скрипте.
    // <link rel=preload as=script> на тот же URL конференция тоже грузит тегом.
    // Снятие preload обрывает общий запрос WebKit, и урок получает ложный таймаут скрипта.
    if (omitOpaqueFetchCacheMode()) return;
    const left = Math.max(1000, timeoutMs - (nowMs() - started));
    await probeScriptByPreload(url, left);
  }
}

function signalingUrl(domain) {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0];
  if (!host) return "";
  return `wss://${host}/xmpp-websocket`;
}

function defaultOpenSocket(url, timeoutMs) {
  return new Promise((resolve) => {
    if (typeof WebSocket !== "function" || !url) {
      resolve("unknown");
      return;
    }
    let settled = false;
    let socket = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    let timer = 0;
    try {
      socket = new WebSocket(url);
    } catch {
      finish("unknown");
      return;
    }
    timer = window.setTimeout(() => finish("timeout"), timeoutMs);
    socket.onopen = () => finish("open");
    socket.onerror = () => finish("error");
  });
}

async function defaultQueryPermission(name) {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name });
    return status?.state || "unknown";
  } catch {
    return "unknown";
  }
}

export function classifyJaasReachability({
  online = true,
  scriptLoaded = false,
  scriptTimedOut = false,
  openedFromIosHomeScreen = false,
  signaling = "skipped",
  microphone = "unknown",
  camera = "unknown",
  aborted = false,
} = {}) {
  if (aborted) {
    return {
      status: "idle",
      code: "aborted",
      label: "",
      message: "",
      mediaConfirmed: false,
      conferenceJoined: false,
    };
  }
  if (!online) {
    return {
      status: "fail",
      code: "offline",
      label: "Нет интернета",
      message: "Проверьте Wi‑Fi или мобильную сеть. Проверка не создаёт звонок.",
      mediaConfirmed: false,
      conferenceJoined: false,
    };
  }
  if (!scriptLoaded) {
    if (scriptTimedOut) {
      return {
        status: "fair",
        code: "script_timeout",
        failureClass: "slow",
        dnsSeparated: false,
        httpsSeparated: false,
        label: "Видеосервис отвечает медленно",
        message: "Страница видеосвязи с этого устройства не успела открыться. Это не доказательство блокировки. Вход в урок не блокируется.",
        mediaConfirmed: false,
        conferenceJoined: false,
      };
    }
    const homeScreen = openedFromIosHomeScreen
      ? " Если урок открыт с иконки на рабочем столе, откройте его в Safari."
      : "";
    return {
      status: "fail",
      code: "script",
      failureClass: "dns_or_https",
      dnsSeparated: false,
      httpsSeparated: false,
      label: "Видеосервис недоступен с этой сети",
      message: `Страница видеосвязи с этого устройства не открылась. Браузер не сообщает отдельно, DNS это или обрыв HTTPS. Это ещё не список всех операторов и не доказательство блокировки.${homeScreen}`,
      mediaConfirmed: false,
      conferenceJoined: false,
    };
  }
  const notes = [];
  if (microphone === "denied") notes.push("Нет разрешения на микрофон.");
  if (camera === "denied") notes.push("Нет разрешения на камеру. Урок можно продолжить со звуком.");
  if (signaling === "error" || signaling === "timeout") {
    notes.push("Запасной адрес сигнализации не открылся. Это не доказывает, что звук заблокирован.");
  }
  notes.push("Ответ сервера не подтверждает звук и видео. Они проверяются в уроке.");
  return {
    status: microphone === "denied" ? "fair" : "partial",
    code: "script_only",
    label: "Сервер видеосвязи отвечает",
    message: notes.join(" "),
    mediaConfirmed: false,
    conferenceJoined: false,
  };
}

export async function probeJaasReachability({
  fetchConfig = fetchVideoMeetingReachabilityConfig,
  loadApi = defaultLoadApi,
  openSocket = defaultOpenSocket,
  queryPermission = defaultQueryPermission,
  timeoutMs = REACHABILITY_SCRIPT_TIMEOUT_MS,
  socketTimeoutMs = REACHABILITY_SOCKET_TIMEOUT_MS,
  checkSignaling = true,
  signal,
} = {}) {
  const started = nowMs();
  const aborted = () => Boolean(signal?.aborted);
  if (aborted()) {
    return {
      ...classifyJaasReachability({ aborted: true }),
      timings: { totalMs: 0 },
    };
  }

  if (!isOnline()) {
    return {
      ...classifyJaasReachability({ online: false }),
      timings: { totalMs: nowMs() - started },
    };
  }

  let config;
  try {
    config = await fetchConfig();
  } catch {
    return {
      ...classifyJaasReachability({ online: isOnline(), scriptLoaded: false }),
      code: isOnline() ? "config" : "offline",
      status: "fail",
      label: isOnline() ? "Не удалось подготовить проверку видеосвязи" : "Нет интернета",
      message: isOnline()
        ? "Платформа не ответила. Вход в урок этим не блокируется."
        : "Проверьте Wi‑Fi или мобильную сеть. Проверка не создаёт звонок.",
      timings: { totalMs: nowMs() - started },
    };
  }
  if (aborted()) {
    return { ...classifyJaasReachability({ aborted: true }), timings: { totalMs: nowMs() - started } };
  }

  const domain = String(config?.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0];
  const scriptUrl = String(config?.scriptUrl || "");
  let scriptLoaded = false;
  let scriptTimedOut = false;
  let scriptMs = null;
  if (domain) {
    try {
      const scriptStarted = nowMs();
      await loadApi(domain, scriptUrl, timeoutMs);
      scriptMs = nowMs() - scriptStarted;
      scriptLoaded = true;
    } catch (error) {
      scriptLoaded = false;
      scriptTimedOut = isScriptProbeTimeout(error);
    }
  }
  if (aborted()) {
    return { ...classifyJaasReachability({ aborted: true }), timings: { totalMs: nowMs() - started, scriptMs } };
  }

  let signaling = "skipped";
  if (checkSignaling && scriptLoaded) {
    signaling = await openSocket(signalingUrl(domain), socketTimeoutMs);
  }
  if (aborted()) {
    return { ...classifyJaasReachability({ aborted: true }), timings: { totalMs: nowMs() - started, scriptMs } };
  }

  const [microphone, camera] = await Promise.all([
    queryPermission("microphone"),
    queryPermission("camera"),
  ]);

  const classified = classifyJaasReachability({
    online: isOnline(),
    scriptLoaded,
    scriptTimedOut,
    openedFromIosHomeScreen: isIosHomeScreen(),
    signaling,
    microphone,
    camera,
  });
  return {
    ...classified,
    domain,
    signaling,
    microphone,
    camera,
    timings: { totalMs: nowMs() - started, scriptMs },
  };
}
