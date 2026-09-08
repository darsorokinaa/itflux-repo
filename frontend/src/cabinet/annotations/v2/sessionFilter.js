/** Bind realtime ops and snapshots to the current share session. */

export function operationSessionId(op) {
  return String(
    op?.session_id
    || op?.sessionId
    || op?.screenShareSessionId
    || op?.payload?.screenShareSessionId
    || op?.payload?.sessionId
    || "",
  );
}

export function operationBelongsToSession(op, sessionId) {
  const sid = operationSessionId(op);
  const current = String(sessionId || "");
  if (!current || !sid) return true;
  return sid === current;
}

/** Hydrate an engine only when it already belongs to the incoming session (or has none yet). */
export function shouldHydrateEngineSnapshot(engineSessionId, incomingSessionId) {
  const incoming = String(incomingSessionId || "");
  if (!incoming) return false;
  const engine = String(engineSessionId || "");
  if (!engine) return true;
  return engine === incoming;
}
