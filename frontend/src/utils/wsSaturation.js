/** Client handling for temporary_unavailable.

Ephemeral frames keep only the latest state. Durable frames retry the same
id after retry_after_ms and are not treated as saved until the server echoes
that id. A repeated id is one action, not a second one.
*/

const EPHEMERAL_TYPES = new Set([
  "cursor",
  "cursor_move",
  "pointer",
  "viewport",
  "viewport_update",
  "preview",
  "drag_preview",
  "annotation_preview",
  "material.cursor",
  "material.pointer",
  "material.student_viewport",
  "material.annotation_preview",
  "screenshare.pointer",
  "wb_stroke_active",
]);

const EPHEMERAL_ACTIONS = new Set([
  "cursor",
  "pointer",
  "drag_preview",
  "annotation_preview",
  "student_viewport",
  "preview",
]);

const UNTRACKED_TYPES = new Set([
  "ping",
  "pong",
  "join",
  "presence_join",
  "presence_ping",
  "viewport_request",
  "paper_request",
  "snapshot_request",
  "material.presence_ping",
  "material.request_sync",
]);

export function lessonReconnectPlan({
  ended = false,
  visibilityState = "visible",
  readyState = 3,
  attempt = 1,
} = {}) {
  if (ended) return { action: "stay", sameRoom: true };
  if (readyState === 1) return { action: "keep", sameRoom: true };
  if (visibilityState === "hidden") return { action: "wait_visible", sameRoom: true };
  const delayMs = Math.min(8000, 400 * (2 ** Math.min(attempt, 5)));
  return { action: "reconnect", delayMs, sameRoom: true, lostEphemeral: true };
}

export function isEphemeralFrame(payload) {
  const type = String(payload?.type || "");
  const action = String(payload?.action || "");
  return EPHEMERAL_TYPES.has(type) || EPHEMERAL_ACTIONS.has(action);
}

function frameId(payload) {
  return String(payload?.client_msg_id || payload?.operation_id || payload?.operationId || "");
}

export function createRealtimeOutbox({
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  clear = (timer) => clearTimeout(timer),
  send,
  maxAttempts = 5,
} = {}) {
  const durable = new Map();
  let ephemeral = null;
  let ephemeralTimer = null;
  const sentIds = [];

  function remember(payload, coalesceKey = "") {
    if (!payload || typeof payload !== "object") return { kind: "skip" };
    if (UNTRACKED_TYPES.has(String(payload.type || ""))) return { kind: "skip" };
    if (isEphemeralFrame(payload)) {
      ephemeral = payload;
      return { kind: "ephemeral" };
    }
    let id = frameId(payload);
    if (!id) {
      id = `m${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      payload.client_msg_id = id;
    }
    if (coalesceKey) {
      for (const [key, row] of durable) {
        if (row.coalesceKey === coalesceKey && key !== id) {
          if (row.timer) clear(row.timer);
          durable.delete(key);
        }
      }
    }
    const prev = durable.get(id);
    if (prev?.timer) clear(prev.timer);
    durable.set(id, {
      payload,
      attempts: prev?.attempts || 0,
      timer: null,
      coalesceKey,
    });
    return { kind: "durable", id };
  }

  function confirm(id) {
    if (!id || !durable.has(id)) return false;
    const row = durable.get(id);
    if (row?.timer) clear(row.timer);
    durable.delete(id);
    return true;
  }

  function retryLater(id, delay, onFailed) {
    const row = durable.get(id);
    if (!row) return;
    if (row.timer) clear(row.timer);
    row.attempts += 1;
    if (row.attempts > maxAttempts) {
      durable.delete(id);
      onFailed?.(row.payload);
      return;
    }
    row.timer = schedule(() => {
      row.timer = null;
      sentIds.push(id);
      send(row.payload);
    }, delay);
  }

  function onServerMessage(msg, hooks = {}) {
    if (!msg || typeof msg !== "object") return { kind: "ignore" };
    if (msg.type === "temporary_unavailable") {
      const delay = Number(msg.retry_after_ms) > 0 ? Number(msg.retry_after_ms) : 200;
      const failed = { type: msg.failed_type, action: msg.action };
      if (isEphemeralFrame(failed)) {
        if (ephemeralTimer) clear(ephemeralTimer);
        ephemeralTimer = schedule(() => {
          ephemeralTimer = null;
          if (ephemeral) send(ephemeral);
        }, delay);
        return { kind: "ephemeral_retry" };
      }
      const id = String(msg.client_msg_id || msg.operation_id || "");
      if (id && durable.has(id)) {
        retryLater(id, delay, hooks.onFailed);
        return { kind: "durable_retry", id };
      }
      for (const key of [...durable.keys()]) retryLater(key, delay, hooks.onFailed);
      return { kind: "durable_retry_all" };
    }
    const id = frameId(msg);
    if (id && confirm(id)) return { kind: "ack", id };
    return { kind: "ignore" };
  }

  return {
    remember,
    onServerMessage,
    confirm,
    pendingIds: () => [...durable.keys()],
    latestEphemeral: () => ephemeral,
    sentIds: () => sentIds.slice(),
  };
}
