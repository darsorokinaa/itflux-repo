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

async function defaultLoadApi(domain, scriptUrl, timeoutMs) {
  const mod = await import("../jitsiMeet");
  return mod.loadJitsiExternalApi(domain, { scriptUrl, timeoutMs });
}

/** Не вставляет script в страницу: во время урока тот же файл уже грузит конференция. */
export async function loadJaasScriptByFetch(domain, scriptUrl, timeoutMs = REACHABILITY_SCRIPT_TIMEOUT_MS) {
  const host = String(domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "").split("/")[0];
  const url = String(scriptUrl || "").trim() || (host ? `https://${host}/libs/external_api.min.js` : "");
  if (!url) {
    throw new Error("no-script-url");
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
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
    return {
      status: "fail",
      code: "script",
      failureClass: "dns_or_https",
      dnsSeparated: false,
      httpsSeparated: false,
      label: "Видеосервис недоступен с этой сети",
      message: "Страница видеосвязи с этого устройства не открылась. Браузер не сообщает отдельно, DNS это или обрыв HTTPS. Это ещё не список всех операторов и не доказательство блокировки.",
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
  let scriptMs = null;
  if (domain) {
    try {
      const scriptStarted = nowMs();
      await loadApi(domain, scriptUrl, timeoutMs);
      scriptMs = nowMs() - scriptStarted;
      scriptLoaded = true;
    } catch {
      scriptLoaded = false;
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
