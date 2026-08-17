/**
 * Предсказуемые переходы состояния видеозвонка.
 * Не набор противоречивых boolean (isLoading && isConnected && isReconnecting).
 */

export const CALL_STATES = Object.freeze({
  idle: "idle",
  initializing: "initializing",
  connecting: "connecting",
  joined: "joined",
  degraded: "degraded",
  reconnecting: "reconnecting",
  leaving: "leaving",
  ended: "ended",
  failed: "failed",
});

const ALLOWED = Object.freeze({
  [CALL_STATES.idle]: [CALL_STATES.initializing, CALL_STATES.failed, CALL_STATES.ended],
  [CALL_STATES.connecting]: [
    CALL_STATES.joined,
    CALL_STATES.failed,
    CALL_STATES.ended,
    CALL_STATES.reconnecting,
  ],
  [CALL_STATES.initializing]: [
    CALL_STATES.connecting,
    CALL_STATES.failed,
    CALL_STATES.ended,
  ],
  [CALL_STATES.joined]: [
    CALL_STATES.degraded,
    CALL_STATES.reconnecting,
    CALL_STATES.leaving,
    CALL_STATES.ended,
  ],
  [CALL_STATES.degraded]: [
    CALL_STATES.joined,
    CALL_STATES.reconnecting,
    CALL_STATES.leaving,
    CALL_STATES.ended,
  ],
  [CALL_STATES.reconnecting]: [
    CALL_STATES.joined,
    CALL_STATES.degraded,
    CALL_STATES.failed,
    CALL_STATES.ended,
  ],
  [CALL_STATES.leaving]: [CALL_STATES.ended],
  [CALL_STATES.ended]: [CALL_STATES.initializing, CALL_STATES.idle],
  [CALL_STATES.failed]: [CALL_STATES.initializing, CALL_STATES.idle],
});

export function canTransitionCallState(from, to) {
  if (from === to) return true;
  return (ALLOWED[from] || []).includes(to);
}

export function createCallStateMachine({ onChange, diagnostics = {} } = {}) {
  let state = CALL_STATES.idle;
  let reason = "";
  let reconnectCount = 0;

  const snapshot = () => ({
    state,
    reason,
    reconnectCount,
  });

  const log = (next, why) => {
    try {
      console.info(
        `[JITSI_CALL_STATE] ${state}->${next} reason=${why || ""} `
        + `reconnects=${reconnectCount} meeting=${diagnostics.meetingUuid || ""} `
        + `room=${diagnostics.roomName || ""} call=${diagnostics.callSessionId || ""}`,
      );
    } catch {
      /* ignore */
    }
  };

  return {
    get state() {
      return state;
    },
    snapshot,
    transition(next, why = "") {
      if (!canTransitionCallState(state, next)) {
        log(next, `rejected:${why || "illegal"}`);
        return snapshot();
      }
      if (next === CALL_STATES.reconnecting && state !== CALL_STATES.reconnecting) {
        reconnectCount += 1;
      }
      if (next === CALL_STATES.initializing || next === CALL_STATES.idle) {
        reconnectCount = 0;
      }
      const prev = state;
      state = next;
      reason = why || "";
      if (prev !== next) log(next, why);
      onChange?.(snapshot(), prev);
      return snapshot();
    },
  };
}

export function jwtRemainingSeconds(isoOrUnix) {
  if (isoOrUnix == null || isoOrUnix === "") return null;
  const numeric = Number(isoOrUnix);
  const ms = Number.isFinite(numeric) && numeric > 1e9
    ? (numeric > 1e12 ? numeric : numeric * 1000)
    : Date.parse(String(isoOrUnix));
  if (!Number.isFinite(ms)) return null;
  return Math.floor((ms - Date.now()) / 1000);
}

export function jwtNeedsAttention(isoOrUnix, { warnSeconds = 15 * 60 } = {}) {
  const left = jwtRemainingSeconds(isoOrUnix);
  if (left == null) return false;
  return left < warnSeconds;
}

export function createCallSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
