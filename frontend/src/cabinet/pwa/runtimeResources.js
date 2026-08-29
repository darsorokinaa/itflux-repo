/**
 * Runtime resource / lifecycle diagnostics for iOS PWA hang hunts.
 * Counts must stay flat across background → foreground cycles.
 */

import { reportClientEvent } from "../../utils/clientTelemetry";

export const MAX_JITSI_INSTANCES = 1;
export const MAX_AUTO_RECOVERY_FAILURES = 3;

let seq = 0;
const realtimeSockets = new Set();
const jitsiSessions = new Set();
const lifecycleLog = [];

export function resetRuntimeResourceState() {
  seq = 0;
  realtimeSockets.clear();
  jitsiSessions.clear();
  lifecycleLog.length = 0;
}

export function nextLifecycleSeq() {
  seq += 1;
  return seq;
}

export function logLifecycle(event, extra = {}) {
  const item = {
    seq: nextLifecycleSeq(),
    event: String(event || "").slice(0, 64),
    t: Date.now(),
    ...extra,
  };
  lifecycleLog.push(item);
  if (lifecycleLog.length > 80) lifecycleLog.shift();
  if (shouldLogRuntimeDiag()) {
    // eslint-disable-next-line no-console
    console.info(`[PWA_SEQ ${item.seq}] ${item.event}`, extra && typeof extra === "object" ? extra : {});
  }
  return item;
}

export function getLifecycleLog() {
  return lifecycleLog.slice();
}

export function shouldLogRuntimeDiag({
  win = typeof window !== "undefined" ? window : null,
} = {}) {
  if (!win) return false;
  try {
    if (win.localStorage?.getItem("itflux.diag") === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    if (new URLSearchParams(win.location.search).get("itflux_diag") === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

export function trackRealtimeSocket(ws) {
  if (!ws) return () => {};
  realtimeSockets.add(ws);
  return () => {
    realtimeSockets.delete(ws);
  };
}

export function countTrackedWebSockets() {
  let live = 0;
  realtimeSockets.forEach((ws) => {
    try {
      if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
        live += 1;
      }
    } catch {
      /* ignore */
    }
  });
  return live;
}

export function registerJitsiSession(session) {
  if (!session) return;
  if (jitsiSessions.size >= MAX_JITSI_INSTANCES) {
    logLifecycle("JITSI_DUPLICATE", { existing: jitsiSessions.size });
    try {
      reportClientEvent("JITSI_DUPLICATE", { existing: jitsiSessions.size });
    } catch {
      /* ignore */
    }
    [...jitsiSessions].forEach((prev) => {
      try {
        prev.dispose?.();
      } catch {
        /* ignore */
      }
    });
    jitsiSessions.clear();
  }
  jitsiSessions.add(session);
}

export function unregisterJitsiSession(session) {
  if (session) jitsiSessions.delete(session);
}

export function getLiveJitsiSessionCount() {
  return jitsiSessions.size;
}

export function countJitsiIframes(doc = typeof document !== "undefined" ? document : null) {
  if (!doc?.querySelectorAll) return 0;
  return [...doc.querySelectorAll("iframe")].filter((el) => {
    const src = `${el.getAttribute("src") || el.src || ""}`;
    const name = `${el.getAttribute("name") || ""}`;
    return /jitsi|meet\.|lesson\./i.test(src) || /jitsi/i.test(name);
  }).length;
}

export function countBoardIframes(doc = typeof document !== "undefined" ? document : null) {
  if (!doc?.querySelectorAll) return 0;
  return doc.querySelectorAll(
    "iframe.video-lesson-workspace__frame--board, iframe.video-lesson-workspace__frame",
  ).length;
}

export function snapshotRuntimeResources({
  doc = typeof document !== "undefined" ? document : null,
} = {}) {
  let heap = 0;
  try {
    heap = Number(performance.memory?.usedJSHeapSize) || 0;
  } catch {
    heap = 0;
  }
  return {
    seq,
    jitsiSessions: getLiveJitsiSessionCount(),
    jitsiIframes: countJitsiIframes(doc),
    boardIframes: countBoardIframes(doc),
    iframes: doc?.querySelectorAll ? doc.querySelectorAll("iframe").length : 0,
    webSockets: countTrackedWebSockets(),
    heap,
  };
}

export function resourcesGrew(before, after, { allowJitsi = 0, allowWs = 0, allowIframes = 0 } = {}) {
  if (!before || !after) return false;
  return (
    after.jitsiSessions > before.jitsiSessions + allowJitsi
    || after.jitsiIframes > before.jitsiIframes + allowJitsi
    || after.webSockets > before.webSockets + allowWs
    || after.iframes > before.iframes + allowIframes
  );
}

/** Remount Jitsi only if the live instance is gone. Never because the shell is iOS PWA. */
export function shouldRemountJitsi({
  hasLiveApi = false,
  iframeConnected = false,
  consecutiveFailures = 0,
  maxAutoFailures = MAX_AUTO_RECOVERY_FAILURES,
} = {}) {
  if (consecutiveFailures >= maxAutoFailures) return false;
  if (!hasLiveApi) return true;
  if (!iframeConnected) return true;
  return false;
}

/** Remount the board iframe only if it disappeared. Never on every iOS resume. */
export function shouldRemountBoardWorkspace({
  frameConnected = true,
  consecutiveFailures = 0,
  maxAutoFailures = MAX_AUTO_RECOVERY_FAILURES,
} = {}) {
  if (consecutiveFailures >= maxAutoFailures) return false;
  return !frameConnected;
}

export function shouldAutoResume({
  consecutiveFailures = 0,
  reason = "",
  maxAutoFailures = MAX_AUTO_RECOVERY_FAILURES,
} = {}) {
  if (reason === "manual") return true;
  return consecutiveFailures < maxAutoFailures;
}

export function markResumeStage(stage) {
  const name = String(stage || "").slice(0, 32);
  try {
    performance.mark(`resume:${name}`);
  } catch {
    /* ignore */
  }
  logLifecycle(`resume:${name}`);
}

export function startMainThreadWatchdog({
  intervalMs = 4000,
  stallMs = 5000,
  now = () => Date.now(),
  onStall,
  getContext = () => ({}),
} = {}) {
  let expected = now() + intervalMs;
  const timer = setInterval(() => {
    const arrived = now();
    const delayMs = arrived - expected + intervalMs;
    expected = arrived + intervalMs;
    if (delayMs >= stallMs + intervalMs) {
      const extra = {
        delayMs: Math.round(delayMs),
        ...(typeof getContext === "function" ? getContext() : {}),
      };
      logLifecycle("MAIN_THREAD_STALL", extra);
      try {
        reportClientEvent("MAIN_THREAD_STALL", extra);
      } catch {
        /* ignore */
      }
      onStall?.(extra);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
