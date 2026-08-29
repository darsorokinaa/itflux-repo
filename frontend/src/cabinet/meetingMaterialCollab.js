/** WebSocket-синхронизация материалов видеоурока (не доска / не вариант). */

import { THROTTLE } from "./materials/collab/constants";
import { reportClientEvent } from "../utils/clientTelemetry";
import { trackRealtimeSocket } from "./pwa/runtimeResources";

export function inferSyncResourceKind(row) {
  if (!row) return null;
  const kind = String(row.kind || "").toLowerCase();
  if (kind === "board" || kind === "variant") return null;
  const url = String(row.url || "").toLowerCase().split("?")[0];
  const interactiveType = String(row.interactiveType || "").toLowerCase();
  if (kind === "interactive" || interactiveType) {
    if (interactiveType === "flashcards") return "cards";
    if (interactiveType === "quiz") return "test";
    if (interactiveType === "matching" || interactiveType === "ordering") return "exercise";
    return "interactive";
  }
  if (kind === "notes" || (row.text && !row.url)) return kind === "notes" ? "notes" : "text";
  if (url.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(url)) return "image";
  if (/\.(ppt|pptx|odp|key)$/.test(url)) return "presentation";
  if (/\.(xls|xlsx|ods|csv)$/.test(url) || kind === "spreadsheet") return "spreadsheet";
  if (kind === "library_lesson" || kind === "linked_lesson") return "embed";
  if (kind === "file") return "file";
  if (kind === "link") return "link";
  if (kind === "material") return url ? "file" : "text";
  return url ? "embed" : "text";
}

export function canSyncPresentRow(row) {
  return Boolean(inferSyncResourceKind(row));
}

function wsUrl(meetingUuid) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/video-meetings/${meetingUuid}/`;
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function throttle(fn, waitMs) {
  let last = 0;
  let timer = null;
  let pending = null;
  return (...args) => {
    pending = args;
    const now = Date.now();
    const remain = waitMs - (now - last);
    if (remain <= 0) {
      last = now;
      const a = pending;
      pending = null;
      fn(...a);
      return;
    }
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      last = Date.now();
      if (!pending) return;
      const a = pending;
      pending = null;
      fn(...a);
    }, remain);
  };
}

/** Exponential backoff for material WS reconnect. attempt is 1-based. */
export const MATERIAL_RECONNECT = {
  BASE_MS: 1000,
  FACTOR: 1.6,
  MAX_MS: 8000,
  JITTER: 0.2,
  MAX_ATTEMPT: 8,
  PONG_STALE_MS: 40000,
  HIDDEN_RESUME_MS: 2500,
  PING_ACK_MS: 2500,
};

function _isSocketLive(ws) {
  return Boolean(
    ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN),
  );
}

/**
 * delay = min(8000, round(1000 * 1.6^(attempt-1))) * (1 ± 20% jitter)
 * attempt 1 → 800–1200ms, then ~1.6s, ~2.6s, ~4.1s, then cap 6.4–9.6s.
 */
export function materialReconnectDelayMs(attempt, random = Math.random) {
  const n = Math.max(1, Math.min(Number(attempt) || 1, MATERIAL_RECONNECT.MAX_ATTEMPT));
  const base = Math.min(
    MATERIAL_RECONNECT.MAX_MS,
    Math.round(MATERIAL_RECONNECT.BASE_MS * MATERIAL_RECONNECT.FACTOR ** (n - 1)),
  );
  const jitterMul = 1 + (random() * 2 - 1) * MATERIAL_RECONNECT.JITTER;
  const delay = Math.round(base * jitterMul);
  const floor = Math.round(MATERIAL_RECONNECT.BASE_MS * (1 - MATERIAL_RECONNECT.JITTER));
  const ceil = Math.round(MATERIAL_RECONNECT.MAX_MS * (1 + MATERIAL_RECONNECT.JITTER));
  return Math.max(floor, Math.min(ceil, delay));
}

/**
 * @param {string} meetingUuid
 * @param {object} handlers
 */
export function createMeetingMaterialCollab(meetingUuid, handlers = {}) {
  let socket = null;
  let untrackSocket = () => {};
  let closed = false;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let heartbeatTimer = null;
  let version = 0;
  let sessionId = null;
  const seenOperationIds = new Set();
  let lastPresenceReplyAt = 0;
  const knownPeers = new Set();
  let lastPingAt = 0;
  let lastPongAt = 0;
  let lastHiddenAt = 0;
  let pingAckTimer = null;
  let awaitingPingAck = false;
  let resumeInProgress = false;
  let resumeUnlockTimer = null;
  let lastCloseCode = null;
  let eventsLastMinute = 0;
  let eventsWindowStart = Date.now();
  const pendingOps = new Map();

  const markSeen = (opId) => {
    if (!opId) return false;
    if (seenOperationIds.has(opId)) return true;
    seenOperationIds.add(opId);
    if (seenOperationIds.size > 500) {
      const first = seenOperationIds.values().next().value;
      seenOperationIds.delete(first);
    }
    return false;
  };

  const bumpEventCount = () => {
    const now = Date.now();
    if (now - eventsWindowStart > 60_000) {
      eventsWindowStart = now;
      eventsLastMinute = 0;
    }
    eventsLastMinute += 1;
  };

  const send = (payload) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      forceReconnect("send-failed");
      return false;
    }
    bumpEventCount();
    return true;
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      const now = Date.now();
      if (lastPongAt && now - lastPongAt > MATERIAL_RECONNECT.PONG_STALE_MS) {
        forceReconnect("pong-timeout");
        return;
      }
      lastPingAt = now;
      send({ type: "ping", t: lastPingAt });
    }, 25000);
  };

  const isPongStale = () => {
    if (!lastPongAt) return false;
    return Date.now() - lastPongAt > MATERIAL_RECONNECT.PONG_STALE_MS;
  };

  const clearPingAckTimer = () => {
    if (pingAckTimer != null) {
      window.clearTimeout(pingAckTimer);
      pingAckTimer = null;
    }
  };

  const unlockResume = () => {
    resumeInProgress = false;
    if (resumeUnlockTimer != null) {
      window.clearTimeout(resumeUnlockTimer);
      resumeUnlockTimer = null;
    }
  };

  const lockResume = () => {
    if (resumeInProgress) return false;
    resumeInProgress = true;
    if (resumeUnlockTimer != null) window.clearTimeout(resumeUnlockTimer);
    resumeUnlockTimer = window.setTimeout(() => {
      resumeUnlockTimer = null;
      resumeInProgress = false;
    }, 4000);
    return true;
  };

  const forceReconnect = (reason = "manual") => {
    if (closed) return;
    if (
      reason === "visibility"
      || reason === "pageshow"
      || reason === "pagehide"
      || reason === "online"
      || reason === "resume"
      || reason === "manual"
      || reason === "ping-ack-timeout"
    ) {
      reconnectAttempt = 0;
    }
    clearReconnectTimer();
    clearPingAckTimer();
    awaitingPingAck = false;
    const ws = socket;
    socket = null;
    untrackSocket();
    stopHeartbeat();
    detachSocket(ws);
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    handlers.onStatus?.("connecting");
    reportClientEvent("material_ws_reconnect", { reason: String(reason).slice(0, 32) });
    connect();
  };

  const verifyOpenSocket = (reason) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      forceReconnect(reason);
      return;
    }
    const pingAt = Date.now();
    lastPingAt = pingAt;
    awaitingPingAck = true;
    const sent = send({ type: "ping", t: pingAt });
    if (!sent) {
      awaitingPingAck = false;
      forceReconnect(`${reason}-ping-fail`);
      return;
    }
    send({
      type: "material.request_sync",
      client_revision: version || 0,
      session_id: sessionId,
    });
    clearPingAckTimer();
    pingAckTimer = window.setTimeout(() => {
      pingAckTimer = null;
      if (awaitingPingAck) {
        awaitingPingAck = false;
        forceReconnect("ping-ack-timeout");
        return;
      }
      unlockResume();
    }, MATERIAL_RECONNECT.PING_ACK_MS);
  };

  const resumeIfNeeded = (reason) => {
    if (closed) return;
    if (reason === "visibility" && document.visibilityState === "hidden") {
      lastHiddenAt = Date.now();
      return;
    }
    if (reason === "pagehide" || reason === "freeze") {
      lastHiddenAt = Date.now();
      return;
    }
    if (reason === "manual") unlockResume();
    if (!lockResume()) return;
    const hiddenMs = lastHiddenAt ? Date.now() - lastHiddenAt : null;
    lastHiddenAt = 0;
    const knownShort = hiddenMs != null && hiddenMs < MATERIAL_RECONNECT.HIDDEN_RESUME_MS;
    if (knownShort && reason !== "online" && reason !== "manual") {
      unlockResume();
      if (socket && socket.readyState === WebSocket.OPEN) {
        lastPingAt = Date.now();
        send({ type: "ping", t: lastPingAt });
      }
      return;
    }
    const open = Boolean(socket && socket.readyState === WebSocket.OPEN);
    const frozenOpen = open && hiddenMs != null && hiddenMs >= MATERIAL_RECONNECT.HIDDEN_RESUME_MS;
    if (!open || isPongStale() || frozenOpen) {
      forceReconnect(reason);
      return;
    }
    verifyOpenSocket(reason);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const detachSocket = (ws) => {
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer != null) return;
    if (_isSocketLive(socket)) return;
    reconnectAttempt += 1;
    if (reconnectAttempt > MATERIAL_RECONNECT.MAX_ATTEMPT) {
      unlockResume();
      handlers.onStatus?.("failed");
      return;
    }
    const delay = materialReconnectDelayMs(reconnectAttempt);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (closed) return;
      if (_isSocketLive(socket)) return;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closed) return;
    if (_isSocketLive(socket)) return;
    clearReconnectTimer();
    if (socket) {
      detachSocket(socket);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      socket = null;
    }
    handlers.onStatus?.("connecting");
    untrackSocket();
    const ws = new WebSocket(wsUrl(meetingUuid));
    socket = ws;
    untrackSocket = trackRealtimeSocket(ws);

    ws.onopen = () => {
      if (closed || socket !== ws) return;
      unlockResume();
      clearPingAckTimer();
      reconnectAttempt = 0;
      lastPongAt = Date.now();
      lastHiddenAt = 0;
      clearReconnectTimer();
      handlers.onStatus?.("open");
      startHeartbeat();
      send({
        type: "material.request_sync",
        client_revision: version || 0,
        session_id: sessionId,
      });
    };

    ws.onmessage = (event) => {
      if (closed || socket !== ws) return;
      let data;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;
      bumpEventCount();

      if (data.type === "pong") {
        lastPongAt = Date.now();
        awaitingPingAck = false;
        handlers.onPong?.({ pingAt: data.t, pongAt: lastPongAt });
        return;
      }

      if (data.type === "material.sync_state" || data.type === "STATE_SNAPSHOT" || data.type === "SYNC_RESPONSE") {
        const ms = data.materialSession;
        sessionId = ms?.sessionId || sessionId;
        version = ms?.version || data.server_revision || version;
        handlers.onSyncState?.(data);
        if (data.presented !== undefined) handlers.onPresented?.(data.presented);
        if (data.screenshareSession !== undefined) handlers.onScreenshareSync?.(data.screenshareSession);
        return;
      }
      if (data.type === "material.opened") {
        sessionId = data.session_id || data.materialSession?.sessionId || null;
        version = data.version || data.materialSession?.version || 1;
        handlers.onOpened?.(data);
        return;
      }
      if (data.type === "material.closed") {
        sessionId = null;
        version = 0;
        handlers.onClosed?.(data);
        return;
      }
      if (data.type === "resource.presented" || data.type === "RESOURCE_PRESENTED") {
        handlers.onPresented?.(data.presented || data.payload || data);
        return;
      }
      if (data.type === "resource.cleared" || data.type === "RESOURCE_CLEARED") {
        handlers.onPresented?.(null);
        return;
      }
      if (data.type === "material.permission_changed" || data.type === "control.transferred") {
        if (data.materialSession?.version) version = data.materialSession.version;
        handlers.onPermissionChanged?.(data);
        return;
      }
      if (data.type === "material.operation") {
        const opId = data.operation_id || data.operationId;
        if (markSeen(opId)) return;
        pendingOps.delete(opId);
        if (data.version) version = data.version;
        handlers.onOperation?.(data);
        return;
      }
      if (data.type === "material.annotation_preview") {
        handlers.onAnnotationPreview?.(data);
        return;
      }
      if (data.type === "material.cursor" || data.type === "material.pointer") {
        handlers.onCursor?.(data);
        return;
      }
      if (data.type === "material.student_viewport") {
        handlers.onStudentViewport?.(data);
        return;
      }
      if (data.type === "material.follow_status" || data.type === "FOLLOW_TEACHER_CHANGED") {
        handlers.onFollowStatus?.(data);
        return;
      }
      if (data.type === "material.presence_join") {
        const uid = data.user_id || data.author_id;
        const isNew = uid != null && !knownPeers.has(uid);
        if (uid != null) knownPeers.add(uid);
        handlers.onPresenceJoin?.(data);
        if (isNew) {
          const now = Date.now();
          if (now - lastPresenceReplyAt > 400) {
            lastPresenceReplyAt = now;
            send({ type: "material.presence_ping" });
          }
        }
        return;
      }
      if (data.type === "material.presence_leave") {
        const uid = data.user_id || data.author_id;
        if (uid != null) knownPeers.delete(uid);
        handlers.onPresenceLeave?.(data);
        return;
      }
      if (data.type === "material.error") {
        handlers.onError?.(data);
        return;
      }
      if (data.type === "material.operation_ack") {
        if (data.version) version = data.materialSession?.version || data.version;
        const opId = data.operation_id || data.operationId;
        if (opId) pendingOps.delete(opId);
        handlers.onOperationAck?.(data);
        return;
      }
      if (data.type === "screenshare.started" || data.type === "screenshare.ended" || data.type === "screenshare.state") {
        handlers.onScreenshareSync?.(data.screenshareSession || null, data.type);
        return;
      }
      if (data.type === "screenshare.permission") {
        handlers.onScreensharePermission?.(data);
        return;
      }
      if (data.type === "screenshare.operation") {
        const opId = data.operation_id || data.operationId;
        if (markSeen(opId)) return;
        pendingOps.delete(opId);
        handlers.onScreenshareOperation?.(data);
        return;
      }
      if (data.type === "screenshare.pointer") {
        handlers.onScreensharePointer?.(data);
        return;
      }
      if (data.type === "screenshare.operation_ack") {
        const opId = data.operation_id || data.operationId;
        if (opId) pendingOps.delete(opId);
        handlers.onScreenshareOperationAck?.(data);
      }
    };

    ws.onerror = () => {
      if (closed || socket !== ws) return;
      handlers.onStatus?.("error");
    };

    ws.onclose = (event) => {
      lastCloseCode = typeof event?.code === "number" ? event.code : null;
      if (socket === ws) {
        stopHeartbeat();
        socket = null;
      }
      if (closed) return;
      if (_isSocketLive(socket)) return;
      handlers.onStatus?.("closed");
      reportClientEvent("material_ws_closed", {
        code: lastCloseCode,
        reason: String(event?.reason || "").slice(0, 64),
        attempt: reconnectAttempt,
      });
      scheduleReconnect();
    };
  };

  connect();

  const onVisibility = () => resumeIfNeeded("visibility");
  const onPageShow = () => resumeIfNeeded("pageshow");
  const onPageHide = () => resumeIfNeeded("pagehide");
  const onOnline = () => resumeIfNeeded("online");
  const onResume = () => resumeIfNeeded("resume");
  const onFreeze = () => resumeIfNeeded("freeze");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("online", onOnline);
  window.addEventListener("resume", onResume);
  window.addEventListener("freeze", onFreeze);

  const sendCursorThrottled = throttle((x, y) => {
    send({
      type: "material.cursor",
      action: "cursor",
      session_id: sessionId,
      operation_id: newId(),
      payload: { x, y },
    });
  }, THROTTLE.CURSOR_MS);

  const sendPointerThrottled = throttle((x, y) => {
    send({
      type: "material.pointer",
      action: "pointer",
      session_id: sessionId,
      operation_id: newId(),
      payload: { x, y },
    });
  }, THROTTLE.POINTER_MS);

  const sendAnnotationPreview = throttle((annotation) => {
    send({
      type: "material.operation",
      action: "annotation_preview",
      session_id: sessionId,
      operation_id: newId(),
      payload: { annotation },
      base_version: version,
    });
  }, THROTTLE.ANNOTATION_PREVIEW_MS);

  const sendStudentViewportThrottled = throttle((payload) => {
    send({
      type: "material.student_viewport",
      action: "student_viewport",
      session_id: sessionId,
      operation_id: newId(),
      payload: payload || {},
    });
  }, THROTTLE.SCROLL_MS);

  return {
    getVersion: () => version,
    getSessionId: () => sessionId,
    isOpen: () => Boolean(socket && socket.readyState === WebSocket.OPEN),
    getDiagnostics: () => ({
      connected: Boolean(socket && socket.readyState === WebSocket.OPEN),
      sessionId,
      serverRevision: version,
      lastPingAt,
      lastPongAt,
      lastCloseCode,
      pendingOps: pendingOps.size,
      eventsLastMinute,
      peerCount: knownPeers.size,
      reconnectAttempt,
    }),
    requestSync: () => send({
      type: "material.request_sync",
      client_revision: version || 0,
      session_id: sessionId,
    }),
    openMaterial: (payload) => send({
      type: "material.open",
      ...payload,
      session_id: sessionId,
    }),
    closeMaterial: () => send({
      type: "material.close",
      session_id: sessionId,
    }),
    setPermission: ({
      mode,
      collaborativeScope,
      collaborativeUserIds,
      collaborationPermission,
      sessionId: sid,
    } = {}) => send({
      type: "material.set_permission",
      session_id: sid || sessionId,
      mode,
      collaborative_scope: collaborativeScope,
      collaborative_user_ids: collaborativeUserIds,
      collaboration_permission: collaborationPermission,
    }),
    sendFollowStatus: ({ following, materialId } = {}) => send({
      type: "material.follow_status",
      session_id: sessionId,
      payload: {
        following: Boolean(following),
        material_id: materialId || null,
      },
    }),
    sendOperation: ({ action, payload, operationId } = {}) => {
      const opId = operationId || newId();
      // Pre-register so broadcast echo is ignored.
      markSeen(opId);
      pendingOps.set(opId, { action, at: Date.now() });
      if (pendingOps.size > 200) {
        const first = pendingOps.keys().next().value;
        pendingOps.delete(first);
      }
      const ok = send({
        type: "material.operation",
        session_id: sessionId,
        operation_id: opId,
        action,
        payload: payload || {},
        base_version: version,
        client_revision: version,
      });
      return { ok, operationId: opId };
    },
    sendCursor: (x, y) => sendCursorThrottled(x, y),
    sendPointer: (x, y) => sendPointerThrottled(x, y),
    sendAnnotationPreview,
    sendStudentViewport: (payload) => sendStudentViewportThrottled(payload),
    reportScreenshare: (payload) => send({
      type: "screenshare.report",
      ...payload,
    }),
    setScreensharePermission: (participantsCanAnnotate, sessionIdValue) => send({
      type: "screenshare.set_permission",
      participantsCanAnnotate: Boolean(participantsCanAnnotate),
      sessionId: sessionIdValue,
    }),
    sendScreenshareOperation: ({ action, payload, operationId, sessionId: sid } = {}) => {
      const opId = operationId || newId();
      markSeen(opId);
      pendingOps.set(opId, { action, at: Date.now() });
      const ok = send({
        type: action === "pointer" ? "screenshare.pointer" : "screenshare.operation",
        action,
        session_id: sid,
        screenShareSessionId: sid,
        operation_id: opId,
        payload: payload || {},
      });
      return { ok, operationId: opId };
    },
    sendScreensharePointer: throttle((payload, sessionIdValue) => {
      send({
        type: "screenshare.pointer",
        action: "pointer",
        session_id: sessionIdValue,
        screenShareSessionId: sessionIdValue,
        operation_id: newId(),
        payload: payload || {},
      });
    }, THROTTLE.POINTER_MS),
    resumeNow: () => resumeIfNeeded("manual"),
    reconnectNow: () => {
      unlockResume();
      reconnectAttempt = 0;
      forceReconnect("manual");
    },
    close: () => {
      closed = true;
      unlockResume();
      clearPingAckTimer();
      clearReconnectTimer();
      stopHeartbeat();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("resume", onResume);
      window.removeEventListener("freeze", onFreeze);
      const ws = socket;
      socket = null;
      untrackSocket();
      detachSocket(ws);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** Флаг удалённого обновления — чтобы не эхоить page_changed обратно. */
export function createRemoteApplyGuard() {
  let remote = false;
  let token = 0;
  return {
    run(fn) {
      remote = true;
      const my = ++token;
      try {
        return fn();
      } finally {
        // Double rAF + microtask: covers React commit + layout scroll handlers.
        queueMicrotask(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (token === my) remote = false;
            });
          });
        });
      }
    },
    isRemote: () => remote,
  };
}
