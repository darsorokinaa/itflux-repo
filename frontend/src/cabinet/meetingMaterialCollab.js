/** WebSocket-синхронизация материалов видеоурока (не доска / не вариант). */

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
 * @param {{
 *   onSyncState?: (payload: any) => void,
 *   onOpened?: (payload: any) => void,
 *   onClosed?: (payload: any) => void,
 *   onPermissionChanged?: (payload: any) => void,
 *   onOperation?: (payload: any) => void,
 *   onCursor?: (payload: any) => void,
 *   onError?: (payload: any) => void,
 *   onStatus?: (status: 'connecting'|'open'|'closed'|'error') => void,
 * }} handlers
 */
export function createMeetingMaterialCollab(meetingUuid, handlers = {}) {
  let socket = null;
  let closed = false;
  let reconnectTimer = null;
  let version = 0;
  let sessionId = null;

  const send = (payload) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  };

  const connect = () => {
    if (closed) return;
    handlers.onStatus?.("connecting");
    socket = new WebSocket(wsUrl(meetingUuid));

    socket.onopen = () => {
      handlers.onStatus?.("open");
      send({ type: "material.request_sync" });
    };

    socket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!data || typeof data !== "object") return;

      if (data.type === "material.sync_state") {
        const ms = data.materialSession;
        sessionId = ms?.sessionId || null;
        version = ms?.version || 0;
        handlers.onSyncState?.(data);
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
      if (data.type === "material.permission_changed") {
        if (data.materialSession?.version) version = data.materialSession.version;
        handlers.onPermissionChanged?.(data);
        return;
      }
      if (data.type === "material.operation") {
        if (data.version) version = data.version;
        handlers.onOperation?.(data);
        return;
      }
      if (data.type === "material.cursor" || data.type === "material.pointer") {
        handlers.onCursor?.(data);
        return;
      }
      if (data.type === "material.error") {
        handlers.onError?.(data);
        return;
      }
      if (data.type === "material.operation_ack" && data.version) {
        version = data.version;
      }
    };

    socket.onerror = () => {
      handlers.onStatus?.("error");
    };

    socket.onclose = () => {
      handlers.onStatus?.("closed");
      if (closed) return;
      reconnectTimer = window.setTimeout(connect, 1500);
    };
  };

  connect();

  const sendCursor = throttle((x, y, pointer = false) => {
    send({
      type: pointer ? "material.pointer" : "material.cursor",
      action: pointer ? "pointer" : "cursor",
      session_id: sessionId,
      operation_id: newId(),
      payload: { x, y },
    });
  }, 50);

  return {
    getVersion: () => version,
    getSessionId: () => sessionId,
    isOpen: () => Boolean(socket && socket.readyState === WebSocket.OPEN),
    requestSync: () => send({ type: "material.request_sync" }),
    openMaterial: (payload) => send({
      type: "material.open",
      ...payload,
      session_id: sessionId,
    }),
    closeMaterial: () => send({
      type: "material.close",
      session_id: sessionId,
    }),
    setPermission: ({ mode, collaborativeScope, collaborativeUserIds, sessionId: sid } = {}) => send({
      type: "material.set_permission",
      session_id: sid || sessionId,
      mode,
      collaborative_scope: collaborativeScope,
      collaborative_user_ids: collaborativeUserIds,
    }),
    sendOperation: ({ action, payload, operationId } = {}) => {
      const opId = operationId || newId();
      const ok = send({
        type: "material.operation",
        session_id: sessionId,
        operation_id: opId,
        action,
        payload: payload || {},
        base_version: version,
      });
      return { ok, operationId: opId };
    },
    sendCursor: (x, y) => sendCursor(x, y, false),
    sendPointer: (x, y) => sendCursor(x, y, true),
    close: () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
    },
  };
}
