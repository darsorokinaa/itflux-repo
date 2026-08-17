export const POINTER_STATES = Object.freeze({
  IDLE: "IDLE",
  DRAWING: "DRAWING",
});

function isPrimaryDrawButton(event) {
  if (event.isPrimary === false) return false;
  const type = event.pointerType || "mouse";
  if (type === "mouse" && event.button !== 0) return false;
  if (type === "pen") {
    if (event.buttons === 0) return false;
    if (event.button !== 0 && event.button !== -1) return false;
  }
  return true;
}

function buttonHeld(event) {
  const type = event.pointerType || "mouse";
  if (type === "mouse" || type === "pen") return (event.buttons & 1) === 1;
  return true;
}

/**
 * Pointer lifecycle for one drawing surface.
 * Never starts a stroke from move. Never joins strokes across pointer ids
 * or sourceRevision changes.
 */
export function createPointerMachine({
  onStart,
  onPoint,
  onEnd,
  onCancel,
} = {}) {
  let state = POINTER_STATES.IDLE;
  let activePointerId = null;
  let strokeId = null;
  let sourceRevision = 0;
  let sequence = 0;
  let startedAt = 0;

  const reset = () => {
    state = POINTER_STATES.IDLE;
    activePointerId = null;
    strokeId = null;
    sequence = 0;
    startedAt = 0;
  };

  const endStroke = (reason, point = null) => {
    if (state !== POINTER_STATES.DRAWING) {
      reset();
      return;
    }
    const payload = {
      strokeId,
      pointerId: activePointerId,
      sourceRevision,
      sequence,
      point,
      reason,
      startedAt,
    };
    reset();
    if (reason === "cancel") onCancel?.(payload);
    else onEnd?.(payload);
  };

  return {
    get state() { return state; },
    get activePointerId() { return activePointerId; },
    get strokeId() { return strokeId; },
    get sourceRevision() { return sourceRevision; },
    get sequence() { return sequence; },

    setSourceRevision(next) {
      const value = Number(next) || 0;
      if (value === sourceRevision) return;
      if (state === POINTER_STATES.DRAWING) endStroke("source-change");
      sourceRevision = value;
    },

    pointerdown(event, point, meta = {}) {
      if (state === POINTER_STATES.DRAWING) endStroke("replaced");
      if (!isPrimaryDrawButton(event)) return null;
      if (!point) return null;
      const id = String(meta.strokeId || "");
      if (!id) return null;
      state = POINTER_STATES.DRAWING;
      activePointerId = event.pointerId;
      strokeId = id;
      sequence = 0;
      startedAt = Date.now();
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      onStart?.({
        strokeId,
        pointerId: activePointerId,
        sourceRevision,
        sequence,
        point,
        pointerType: event.pointerType || "mouse",
        pressure: Number(event.pressure) || 0,
        timestamp: startedAt,
      });
      return strokeId;
    },

    pointermove(event, point) {
      if (state !== POINTER_STATES.DRAWING) return;
      if (event.pointerId !== activePointerId) return;
      if (!buttonHeld(event)) {
        endStroke("buttons-up", point || null);
        return;
      }
      if (!point) return;
      sequence += 1;
      const coalesced = typeof event.getCoalescedEvents === "function"
        ? event.getCoalescedEvents()
        : null;
      onPoint?.({
        strokeId,
        pointerId: activePointerId,
        sourceRevision,
        sequence,
        point,
        coalesced,
        pressure: Number(event.pressure) || 0,
        timestamp: Date.now(),
      });
    },

    pointerup(event, point) {
      if (state !== POINTER_STATES.DRAWING) return;
      if (event.pointerId !== activePointerId) return;
      try {
        event.currentTarget?.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
      endStroke("up", point || null);
    },

    pointercancel(event) {
      if (state !== POINTER_STATES.DRAWING) return;
      if (event && event.pointerId !== activePointerId) return;
      endStroke("cancel");
    },

    lostpointercapture(event) {
      if (state !== POINTER_STATES.DRAWING) return;
      if (event && event.pointerId !== activePointerId) return;
      endStroke("lostcapture");
    },

    blur() {
      if (state === POINTER_STATES.DRAWING) endStroke("blur");
    },

    disable() {
      if (state === POINTER_STATES.DRAWING) endStroke("disable");
    },

    dispose() {
      if (state === POINTER_STATES.DRAWING) endStroke("dispose");
      reset();
    },
  };
}
