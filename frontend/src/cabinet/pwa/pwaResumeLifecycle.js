/**
 * iOS PWA / tab resume: explicit state machine, one attempt at a time.
 * Does not treat a frozen WebSocket/Jitsi object as alive.
 */

import { reportClientEvent } from "../../utils/clientTelemetry";
import { isIosStandaloneDisplay, isStandaloneDisplay } from "./pwaHelpers";
import {
  MAX_AUTO_RECOVERY_FAILURES,
  logLifecycle,
  markResumeStage,
  shouldAutoResume,
} from "./runtimeResources";

export {
  MAX_AUTO_RECOVERY_FAILURES,
  shouldRemountBoardWorkspace,
  shouldRemountJitsi,
} from "./runtimeResources";

export const RESUME_STATES = Object.freeze({
  ACTIVE: "ACTIVE",
  BACKGROUND: "BACKGROUND",
  RESUMING: "RESUMING",
  RECONNECTING: "RECONNECTING",
  READY: "READY",
  DEGRADED: "DEGRADED",
  FAILED: "FAILED",
});

export const RESUME_TIMING = Object.freeze({
  MIN_BACKGROUND_MS: 2500,
  SLOW_MS: 8000,
  FAIL_MS: 14000,
  PING_ACK_MS: 2500,
});

export const RESUME_MESSAGE = "ITFLUX_PWA_RESUME";

export const PWA_RESUME_EVENTS = Object.freeze([
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
]);

let attemptSeq = 0;

export function nextResumeAttemptId() {
  attemptSeq += 1;
  const rand = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : String(Math.random()).slice(2, 10);
  return `rs-${Date.now().toString(36)}-${attemptSeq}-${rand}`;
}

export function shouldVerifyAfterBackground(backgroundDurationMs, reason = "") {
  if (reason === "online" || reason === "manual") return true;
  if (backgroundDurationMs == null) return true;
  return Number(backgroundDurationMs) >= RESUME_TIMING.MIN_BACKGROUND_MS;
}

export function isBackgroundLifecycleReason(reason, visibilityState) {
  if (reason === "pagehide" || reason === "freeze") return true;
  if (reason === "visibility" && visibilityState === "hidden") return true;
  return false;
}

export function classifyResumeUi(state, elapsedMs = 0, online = true) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  if (state === RESUME_STATES.FAILED) {
    return {
      phase: "failed",
      title: "Не удалось восстановить соединение.",
      showReconnect: true,
      showReload: true,
      offline: !online,
    };
  }
  if (!online && (
    state === RESUME_STATES.RESUMING
    || state === RESUME_STATES.RECONNECTING
    || state === RESUME_STATES.DEGRADED
    || state === RESUME_STATES.BACKGROUND
  )) {
    return {
      phase: "reconnecting",
      title: "Нет сети. Восстановим соединение, когда интернет появится.",
      showReconnect: false,
      showReload: false,
      offline: true,
    };
  }
  if (state === RESUME_STATES.DEGRADED || elapsed >= RESUME_TIMING.FAIL_MS) {
    if (elapsed >= RESUME_TIMING.FAIL_MS || state === RESUME_STATES.FAILED) {
      return {
        phase: "failed",
        title: "Не удалось восстановить соединение.",
        showReconnect: true,
        showReload: true,
        offline: !online,
      };
    }
    return {
      phase: "slow",
      title: "Соединение восстанавливается дольше обычного.",
      showReconnect: true,
      showReload: false,
      offline: !online,
    };
  }
  if (
    state === RESUME_STATES.RESUMING
    || state === RESUME_STATES.RECONNECTING
    || (state === RESUME_STATES.DEGRADED && elapsed < RESUME_TIMING.FAIL_MS)
  ) {
    if (elapsed >= RESUME_TIMING.SLOW_MS) {
      return {
        phase: "slow",
        title: "Соединение восстанавливается дольше обычного.",
        showReconnect: true,
        showReload: false,
        offline: !online,
      };
    }
    return {
      phase: "reconnecting",
      title: "Восстанавливаем соединение…",
      showReconnect: false,
      showReload: false,
      offline: !online,
    };
  }
  return {
    phase: "hidden",
    title: "",
    showReconnect: false,
    showReload: false,
    offline: !online,
  };
}

export async function probeAuthSession({
  fetchImpl = (typeof fetch === "function" ? fetch.bind(globalThis) : null),
  url = "/api/cabinet/me/",
} = {}) {
  if (typeof fetchImpl !== "function") {
    return { ok: false, code: "no_fetch" };
  }
  try {
    const sep = url.includes("?") ? "&" : "?";
    const response = await fetchImpl(`${url}${sep}_r=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "auth_expired" };
    }
    if (!response.ok) {
      return { ok: false, code: "auth_http" };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "auth_network" };
  }
}

/** Same-origin room reload. If the board is iframed, reload the parent meeting. */
export function reloadSameOriginRoom({
  win = typeof window !== "undefined" ? window : null,
} = {}) {
  if (!win) return "none";
  try {
    const top = win.top;
    if (top && top !== win && top.location.origin === win.location.origin) {
      top.location.reload();
      return "parent";
    }
  } catch {
    /* cross-origin or missing top */
  }
  win.location.reload();
  return "self";
}

export function postResumeToBoardFrames(attemptId, {
  doc = typeof document !== "undefined" ? document : null,
  origin = typeof window !== "undefined" ? window.location.origin : "",
} = {}) {
  if (!doc) return 0;
  const frames = doc.querySelectorAll("iframe.video-lesson-workspace__frame--board, iframe.video-lesson-workspace__frame");
  let sent = 0;
  frames.forEach((frame) => {
    try {
      frame.contentWindow?.postMessage(
        { type: RESUME_MESSAGE, attemptId: String(attemptId || "").slice(0, 64) },
        origin || "*",
      );
      sent += 1;
    } catch {
      /* ignore */
    }
  });
  return sent;
}

export function isResumeMessage(data) {
  return Boolean(data && typeof data === "object" && data.type === RESUME_MESSAGE);
}

function readOnline() {
  try {
    return typeof navigator === "undefined" ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
}

export function createPwaResumeController({
  now = () => Date.now(),
  target = typeof window !== "undefined" ? window : null,
  documentRef = typeof document !== "undefined" ? document : null,
  onResume = null,
  onStateChange = null,
  getContext = () => ({}),
  reportEvent = reportClientEvent,
} = {}) {
  let state = RESUME_STATES.ACTIVE;
  let backgroundStartedAt = 0;
  let resumeStartedAt = 0;
  let attemptId = "";
  let inProgress = false;
  let autoFailCount = 0;
  let recoveryPromise = null;
  let slowTimer = null;
  let failTimer = null;
  let attached = false;

  const extraBase = (more = {}) => {
    const ctx = typeof getContext === "function" ? (getContext() || {}) : {};
    const elapsedMs = resumeStartedAt ? Math.max(0, now() - resumeStartedAt) : 0;
    const backgroundDurationMs = backgroundStartedAt
      ? Math.max(0, now() - backgroundStartedAt)
      : (typeof more.backgroundDurationMs === "number" ? more.backgroundDurationMs : 0);
    return {
      connectionAttemptId: attemptId,
      meetingId: String(ctx.meetingId || ctx.meetingUuid || "").slice(0, 64),
      role: String(ctx.role || "").slice(0, 32),
      backgroundDurationMs,
      stage: String(more.stage || state).slice(0, 32),
      elapsedMs,
      errorCode: String(more.errorCode || "").slice(0, 64),
      pwa: isStandaloneDisplay(),
      iosStandalone: isIosStandaloneDisplay(),
      ...more,
    };
  };

  const emit = (event, more = {}) => {
    const payload = extraBase(more);
    logLifecycle(event, {
      attemptId: payload.connectionAttemptId,
      reason: more.reason || "",
      stage: payload.stage,
    });
    try {
      reportEvent(event, payload);
    } catch {
      /* ignore */
    }
  };

  const notify = (next, more = {}) => {
    state = next;
    const elapsedMs = resumeStartedAt ? Math.max(0, now() - resumeStartedAt) : 0;
    onStateChange?.(next, { attemptId, elapsedMs, online: readOnline(), ...more });
  };

  const clearTimers = () => {
    if (slowTimer != null) {
      window.clearTimeout(slowTimer);
      slowTimer = null;
    }
    if (failTimer != null) {
      window.clearTimeout(failTimer);
      failTimer = null;
    }
  };

  const fail = (errorCode = "timeout") => {
    clearTimers();
    inProgress = false;
    recoveryPromise = null;
    autoFailCount += 1;
    notify(RESUME_STATES.FAILED, { errorCode, consecutiveFailures: autoFailCount });
    emit("RESUME_TIMEOUT", {
      stage: "failed",
      errorCode,
      consecutiveFailures: autoFailCount,
    });
  };

  const succeed = () => {
    clearTimers();
    inProgress = false;
    recoveryPromise = null;
    autoFailCount = 0;
    backgroundStartedAt = 0;
    markResumeStage("ready");
    notify(RESUME_STATES.READY);
    emit("RESUME_READY", { stage: "ready" });
    notify(RESUME_STATES.ACTIVE);
  };

  const markDegraded = (errorCode = "degraded") => {
    notify(RESUME_STATES.DEGRADED, { errorCode });
    emit("RESUME_START", { stage: "degraded", errorCode });
  };

  const considerResume = (reason) => {
    if (reason === "manual") {
      inProgress = false;
      recoveryPromise = null;
      autoFailCount = 0;
    }
    if (reason === "online" && (state === RESUME_STATES.DEGRADED || state === RESUME_STATES.FAILED)) {
      inProgress = false;
    }
    if (!shouldAutoResume({ consecutiveFailures: autoFailCount, reason })) {
      notify(RESUME_STATES.FAILED, { errorCode: "circuit_open" });
      return null;
    }
    if (inProgress) return recoveryPromise;
    const hiddenMs = backgroundStartedAt ? now() - backgroundStartedAt : null;
    if (reason === "focus" && hiddenMs == null) return null;
    if (!shouldVerifyAfterBackground(hiddenMs, reason)) {
      backgroundStartedAt = 0;
      return null;
    }

    inProgress = true;
    attemptId = nextResumeAttemptId();
    resumeStartedAt = now();
    const backgroundDurationMs = hiddenMs == null ? 0 : hiddenMs;
    const unknownDuration = hiddenMs == null;
    backgroundStartedAt = 0;
    notify(RESUME_STATES.RESUMING, { reason, backgroundDurationMs });
    emit("PWA_FOREGROUND", { reason, backgroundDurationMs, stage: "foreground" });
    emit("RESUME_START", { reason, backgroundDurationMs, stage: "start" });
    notify(RESUME_STATES.RECONNECTING, { reason, backgroundDurationMs });

    slowTimer = window.setTimeout(() => {
      if (!inProgress) return;
      notify(RESUME_STATES.DEGRADED, { reason: "slow" });
    }, RESUME_TIMING.SLOW_MS);
    failTimer = window.setTimeout(() => {
      if (!inProgress) return;
      fail("timeout");
    }, RESUME_TIMING.FAIL_MS);

    const ctx = {
      attemptId,
      reason,
      backgroundDurationMs,
      unknownDuration,
      online: readOnline(),
      pwa: isStandaloneDisplay(),
      iosStandalone: isIosStandaloneDisplay(),
    };
    markResumeStage("start");
    try {
      const result = onResume?.(ctx);
      recoveryPromise = Promise.resolve(result).catch((err) => {
        fail(err?.code || err?.message || "resume_error");
      });
    } catch (err) {
      fail(err?.code || err?.message || "resume_error");
      recoveryPromise = null;
    }
    return ctx;
  };

  const markBackground = (reason) => {
    if (!backgroundStartedAt) backgroundStartedAt = now();
    notify(RESUME_STATES.BACKGROUND, { reason });
    emit("PWA_BACKGROUND", { reason, stage: "background" });
  };

  const onVisibility = () => {
    const vis = documentRef?.visibilityState || "visible";
    if (vis === "hidden") {
      markBackground("visibility");
      return;
    }
    considerResume("visibility");
  };

  const onPageHide = () => markBackground("pagehide");
  const onPageShow = () => considerResume("pageshow");
  const onFocus = () => considerResume("focus");
  const onOnline = () => considerResume("online");
  const onOffline = () => markDegraded("offline");
  const onFreeze = () => markBackground("freeze");
  const onResumeEvent = () => considerResume("resume");

  const attach = () => {
    if (attached || !target || !documentRef) return;
    attached = true;
    documentRef.addEventListener("visibilitychange", onVisibility);
    target.addEventListener("pagehide", onPageHide);
    target.addEventListener("pageshow", onPageShow);
    target.addEventListener("focus", onFocus);
    target.addEventListener("online", onOnline);
    target.addEventListener("offline", onOffline);
    target.addEventListener("freeze", onFreeze);
    target.addEventListener("resume", onResumeEvent);
  };

  const detach = () => {
    clearTimers();
    inProgress = false;
    if (!attached || !target || !documentRef) return;
    attached = false;
    documentRef.removeEventListener("visibilitychange", onVisibility);
    target.removeEventListener("pagehide", onPageHide);
    target.removeEventListener("pageshow", onPageShow);
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("online", onOnline);
    target.removeEventListener("offline", onOffline);
    target.removeEventListener("freeze", onFreeze);
    target.removeEventListener("resume", onResumeEvent);
  };

  attach();

  return {
    attach,
    detach,
    considerResume,
    markBackground,
    succeed,
    fail,
    markDegraded,
    manualReconnect() {
      emit("MANUAL_RECONNECT_CLICK", { stage: "manual" });
      inProgress = false;
      clearTimers();
      return considerResume("manual");
    },
    manualReload() {
      emit("MANUAL_RELOAD_CLICK", { stage: "manual" });
      return reloadSameOriginRoom({ win: target });
    },
    getState: () => state,
    getAttemptId: () => attemptId,
    getFailCount: () => autoFailCount,
    isInProgress: () => inProgress,
  };
}
