/**
 * Диагностика реального пути загрузки Jitsi (External API + комната),
 * без VideoMeeting и без участия в уроке.
 *
 * Пороги пробы завязаны на JOIN_TIMEOUT_MS (15 с, мягкий порог урока).
 * Урок больше не считает 15 с без videoConferenceJoined fatal:
 * fatal watchdog — JOIN_FATAL_TIMEOUT_MS (60 с).
 */

import {
  fetchVideoMeetingConnectionProbe,
  reportVideoMeetingConnectionProbe,
} from "../../utils/cabinetAuth";
import {
  JOIN_TIMEOUT_MS,
  buildJitsiConfigOverwrite,
  buildJitsiInterfaceConfigOverwrite,
  loadJitsiExternalApi,
} from "../jitsiMeet";
import { browserHint, deviceHint } from "./storage";

export const JITSI_SCRIPT_GOOD_MS = 3000;
export const JITSI_SCRIPT_FAIR_MS = 8000;
export const JITSI_JOIN_GOOD_MS = 8000;

let activeProbe = null;

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

function createProbeContainer() {
  const el = document.createElement("div");
  el.className = "cc-jitsi-probe";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return el;
}

function disposeApi(api, container) {
  try {
    api?.executeCommand?.("hangup");
  } catch {
    /* ignore */
  }
  try {
    api?.dispose?.();
  } catch {
    /* ignore */
  }
  if (!container) return;
  try {
    const iframe = api?.getIFrame?.();
    if (iframe) iframe.src = "about:blank";
  } catch {
    /* ignore */
  }
  try {
    container.innerHTML = "";
    container.remove();
  } catch {
    /* ignore */
  }
}

export function abortJitsiConnectionProbe() {
  const current = activeProbe;
  activeProbe = null;
  current?.abort?.();
}

export function classifyJitsiProbe({
  online = true,
  scriptLoaded = false,
  scriptMs = null,
  iframeLoaded = false,
  conferenceJoined = false,
  conferenceMs = null,
  errorCode = "",
  authMode = "",
  jwtReady = true,
} = {}) {
  if (errorCode === "aborted") {
    return { status: "idle", code: "aborted", label: "", message: "" };
  }
  if (errorCode === "offline" || online === false) {
    return {
      status: "fail",
      code: "offline",
      label: "Нет интернета",
      message: "Проверьте Wi‑Fi или мобильную сеть и повторите проверку.",
    };
  }
  if (errorCode === "config") {
    return {
      status: "fail",
      code: "config",
      label: "Не удалось подключиться к серверу видеосвязи",
      message: "Платформа не смогла получить настройки видеоурока. Обновите страницу и попробуйте ещё раз.",
    };
  }
  if (errorCode === "script" || errorCode === "jitsi_script_timeout" || !scriptLoaded) {
    return {
      status: "fail",
      code: "jitsi_unreachable",
      label: "Не удалось подключиться к серверу видеосвязи",
      message: "Интернет работает, но сервер видеосвязи сейчас недоступен. Если урок открыт с иконки на рабочем столе, откройте его в Safari или Chrome и повторите проверку.",
    };
  }
  if (errorCode === "jwt" || (authMode === "jwt" && jwtReady === false)) {
    return {
      status: "fail",
      code: "jwt",
      label: "Не удалось подключиться к серверу видеосвязи",
      message: "Сервер видеосвязи отвечает, но вход в комнату сейчас недоступен. Обновите страницу или повторите проверку через минуту.",
    };
  }
  if (errorCode === "conference_failed" || errorCode === "connection_failed") {
    return {
      status: "fail",
      code: "conference",
      label: "Не удалось подключиться к серверу видеосвязи",
      message: "Интерфейс видеосвязи открылся, но комната не запустилась. Повторите проверку через минуту.",
    };
  }
  if (conferenceJoined) {
    const total = Number(conferenceMs) || 0;
    const script = Number(scriptMs) || 0;
    if (total <= JITSI_JOIN_GOOD_MS && script <= JITSI_SCRIPT_GOOD_MS) {
      return {
        status: "ok",
        code: "ok",
        label: "Комната урока загружается быстро",
        message: "",
      };
    }
    return {
      status: "fair",
      code: "slow",
      label: "Комната урока загружается медленнее обычного",
      message: "Сервер видеосвязи отвечает, но дольше обычного. Если урок начнётся с задержкой, обновите страницу.",
    };
  }
  if (iframeLoaded && !conferenceJoined) {
    if (authMode !== "jwt") {
      return {
        status: "fair",
        code: "ui_only",
        label: "Комната урока загружается медленнее обычного",
        message: "Интерфейс видеосвязи открылся. Полное подключение на этом сервере может занять больше времени.",
      };
    }
    return {
      status: "fail",
      code: "join_timeout",
      label: "Не удалось подключиться к серверу видеосвязи",
      message: "Интернет работает, но сервер видеосвязи сейчас отвечает медленно. Попробуйте повторить проверку через минуту или обновить страницу.",
    };
  }
  return {
    status: "fail",
    code: "join_timeout",
    label: "Не удалось подключиться к серверу видеосвязи",
    message: "Комната урока не успела открыться за отведённое время. Повторите проверку.",
  };
}

function reportFailure(result, timings) {
  if (!result || result.status === "ok" || result.code === "aborted") return;
  void reportVideoMeetingConnectionProbe({
    stage: result.code,
    errorType: result.code,
    durationMs: Math.round(timings.totalMs || 0),
    online: isOnline(),
    browser: browserHint(),
    deviceType: deviceHint(),
  });
}

export async function probeJitsiInfrastructure({
  fetchConfig = fetchVideoMeetingConnectionProbe,
  loadApi = loadJitsiExternalApi,
  ExternalApi,
  timeoutMs = JOIN_TIMEOUT_MS,
} = {}) {
  abortJitsiConnectionProbe();

  const timings = { startedAt: Date.now() };
  const started = nowMs();
  let aborted = false;
  let api = null;
  let container = null;

  const handle = {
    abort() {
      aborted = true;
      disposeApi(api, container);
      api = null;
      container = null;
    },
  };
  activeProbe = handle;

  const finish = (partial) => {
    const classified = classifyJitsiProbe(partial);
    timings.totalMs = nowMs() - started;
    if (activeProbe === handle) activeProbe = null;
    disposeApi(api, container);
    api = null;
    container = null;
    if (aborted || classified.code === "aborted") {
      return { ...classified, status: "idle", aborted: true, timings };
    }
    if (classified.status !== "ok") {
      console.warn("[Jitsi probe]", {
        stage: classified.code,
        durationMs: Math.round(timings.totalMs),
        scriptMs: timings.scriptMs ?? null,
        iframeMs: timings.iframeMs ?? null,
        conferenceMs: timings.conferenceMs ?? null,
        online: isOnline(),
        authMode: partial.authMode || "",
      });
      reportFailure(classified, timings);
    } else {
      console.info("[Jitsi probe] ok", {
        durationMs: Math.round(timings.totalMs),
        scriptMs: timings.scriptMs ?? null,
        conferenceMs: timings.conferenceMs ?? null,
      });
    }
    return { ...classified, timings };
  };

  if (!isOnline()) {
    return finish({ online: false, errorCode: "offline" });
  }

  let config;
  try {
    const configStarted = nowMs();
    config = await fetchConfig();
    timings.configMs = nowMs() - configStarted;
  } catch {
    return finish({
      online: isOnline(),
      errorCode: isOnline() ? "config" : "offline",
    });
  }
  if (aborted) return finish({ errorCode: "aborted" });

  const domain = String(config?.domain || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const roomName = String(config?.roomName || "").trim();
  const authMode = String(config?.authMode || "");
  const jwtReady = config?.jwtReady !== false;
  if (!domain || !roomName) {
    return finish({ online: true, errorCode: "config", authMode, jwtReady });
  }

  try {
    const scriptStarted = nowMs();
    await loadApi(domain, { timeoutMs });
    timings.scriptMs = nowMs() - scriptStarted;
  } catch (error) {
    return finish({
      online: isOnline(),
      scriptLoaded: false,
      errorCode: isOnline() ? (error?.code || "script") : "offline",
      authMode,
      jwtReady,
    });
  }
  if (aborted) return finish({ errorCode: "aborted", scriptLoaded: true, scriptMs: timings.scriptMs, authMode, jwtReady });

  if (authMode === "jwt" && !jwtReady) {
    return finish({
      online: true,
      scriptLoaded: true,
      scriptMs: timings.scriptMs,
      authMode,
      jwtReady: false,
      errorCode: "jwt",
    });
  }

  const ApiCtor = ExternalApi || (typeof window !== "undefined" ? window.JitsiMeetExternalAPI : null);
  if (typeof ApiCtor !== "function") {
    return finish({
      online: true,
      scriptLoaded: true,
      scriptMs: timings.scriptMs,
      authMode,
      jwtReady,
      errorCode: "script",
    });
  }

  container = createProbeContainer();
  let iframeLoaded = false;
  let conferenceJoined = false;
  let conferenceError = "";

  try {
    api = new ApiCtor(domain, {
      roomName,
      parentNode: container,
      width: 2,
      height: 2,
      lang: "ru",
      configOverwrite: {
        ...buildJitsiConfigOverwrite({
          subject: "Проверка связи",
          startWithVideoMuted: true,
          startWithAudioMuted: true,
        }),
        startSilent: true,
      },
      interfaceConfigOverwrite: buildJitsiInterfaceConfigOverwrite(),
      userInfo: {
        displayName: config?.userInfo?.displayName || "Проверка связи",
      },
      ...(config?.jwt ? { jwt: config.jwt } : {}),
    });
  } catch {
    return finish({
      online: true,
      scriptLoaded: true,
      scriptMs: timings.scriptMs,
      authMode,
      jwtReady,
      errorCode: "conference_failed",
    });
  }

  try {
    const iframe = api.getIFrame?.();
    if (iframe) {
      iframe.addEventListener("load", () => {
        if (!timings.iframeMs) timings.iframeMs = nowMs() - started;
        iframeLoaded = true;
      }, { once: true });
    }
  } catch {
    /* ignore */
  }

  try {
    api.addListener?.("videoConferenceJoined", () => {
      conferenceJoined = true;
      if (!timings.conferenceMs) timings.conferenceMs = nowMs() - started;
    });
    api.addListener?.("conferenceFailed", () => {
      conferenceError = "conference_failed";
    });
    api.addListener?.("connectionFailed", () => {
      conferenceError = conferenceError || "connection_failed";
    });
    api.addListener?.("peerConnectionFailure", () => {
      conferenceError = conferenceError || "peer_connection_failure";
    });
    api.addListener?.("errorOccurred", (event) => {
      if (event?.isFatal) conferenceError = conferenceError || "conference_failed";
    });
  } catch {
    /* ignore */
  }

  await new Promise((resolve) => {
    const startedWait = nowMs();
    const tick = () => {
      if (aborted || conferenceJoined || conferenceError) {
        resolve();
        return;
      }
      if (nowMs() - startedWait >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 120);
    };
    tick();
  });

  if (aborted) {
    return finish({ errorCode: "aborted", scriptLoaded: true, scriptMs: timings.scriptMs, authMode, jwtReady });
  }

  if (!timings.conferenceMs && conferenceJoined) {
    timings.conferenceMs = nowMs() - started;
  }

  return finish({
    online: isOnline(),
    scriptLoaded: true,
    scriptMs: timings.scriptMs,
    iframeLoaded,
    conferenceJoined,
    conferenceMs: timings.conferenceMs,
    errorCode: conferenceError,
    authMode,
    jwtReady,
  });
}
