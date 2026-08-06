/** WebSocket-синхронизация материалов видеоурока (не доска / не вариант). */

import { THROTTLE } from "./materials/collab/constants";

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

/**
 * @param {string} meetingUuid
 * @param {object} handlers
 */
export function createMeetingMaterialCollab(meetingUuid, handlers = {}) {
  let socket = null;
  let closed = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let version = 0;
  let sessionId = null;
  const seenOperationIds = new Set();
  let lastPresenceReplyAt = 0;
  const knownPeers = new Set();
  let lastPingAt = 0;
  let lastPongAt = 0;
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
    socket.send(JSON.stringify(payload));
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
      lastPingAt = Date.now();
      send({ type: "ping", t: lastPingAt });
    }, 25000);
  };

  const connect = () => {
    if (closed) return;
    handlers.onStatus?.("connecting");
    socket = new WebSocket(wsUrl(meetingUuid));

    socket.onopen = () => {
      handlers.onStatus?.("open");
      startHeartbeat();
      send({
        type: "material.request_sync",
        client_revision: version || 0,
        session_id: sessionId,
      });
    };

    socket.onmessage = (event) => {
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
        handlers.onPong?.({ pingAt: data.t, pongAt: lastPongAt });
        return;
      }

      if (data.type === "material.sync_state" || data.type === "STATE_SNAPSHOT" || data.type === "SYNC_RESPONSE") {
        const ms = data.materialSession;
        sessionId = ms?.sessionId || sessionId;
        version = ms?.version || data.server_revision || version;
        handlers.onSyncState?.(data);
        if (data.presented !== undefined) handlers.onPresented?.(data.presented);
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
        if (data.version) version = data.version;
        const opId = data.operation_id || data.operationId;
        if (opId) pendingOps.delete(opId);
        handlers.onOperationAck?.(data);
      }
    };

    socket.onerror = () => {
      handlers.onStatus?.("error");
    };

    socket.onclose = () => {
      handlers.onStatus?.("closed");
      stopHeartbeat();
      if (closed) return;
      reconnectTimer = window.setTimeout(connect, 1500);
    };
  };

  connect();

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
      pendingOps: pendingOps.size,
      eventsLastMinute,
      peerCount: knownPeers.size,
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
    close: () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      stopHeartbeat();
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
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
