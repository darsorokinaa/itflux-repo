/** Labels and grace timing for collaboration connection UI. */

export const COLLAB_STATUS_GRACE_MS = 1200;

export const COLLAB_UI = Object.freeze({
  CONNECTING: "connecting",
  CONNECTED: "connected",
  COLLAB_ACTIVE: "collab_active",
  RECONNECTING: "reconnecting",
  OFFLINE: "offline",
  ERROR: "error",
});

const LABELS = {
  [COLLAB_UI.CONNECTING]: "Подключение...",
  [COLLAB_UI.CONNECTED]: "Подключено",
  [COLLAB_UI.COLLAB_ACTIVE]: "Совместное редактирование активно",
  [COLLAB_UI.RECONNECTING]: "Переподключение...",
  [COLLAB_UI.OFFLINE]: "Нет соединения",
  [COLLAB_UI.ERROR]: "Не удалось восстановить совместное редактирование. Попробовать снова",
};

export function collabUiLabel(kind) {
  return LABELS[kind] || LABELS[COLLAB_UI.CONNECTED];
}

/**
 * Map transport + roster to a panel state.
 * peerCount is remote participants only (not self).
 */
export function classifyCollabConnection({
  transport = "open",
  peerCount = 0,
  collaborative = false,
  online = true,
  reconnectElapsedMs = 0,
} = {}) {
  const peers = Math.max(0, Number(peerCount) || 0);
  if (!online) {
    return { kind: COLLAB_UI.OFFLINE, label: collabUiLabel(COLLAB_UI.OFFLINE), showRetry: false };
  }
  if (transport === "failed" || transport === "error") {
    return { kind: COLLAB_UI.ERROR, label: collabUiLabel(COLLAB_UI.ERROR), showRetry: true };
  }
  if (transport === "connecting" || transport === "closed" || transport === "reconnecting") {
    if (reconnectElapsedMs < COLLAB_STATUS_GRACE_MS) {
      return {
        kind: COLLAB_UI.CONNECTED,
        label: collabUiLabel(COLLAB_UI.CONNECTED),
        showRetry: false,
        hold: true,
      };
    }
    return { kind: COLLAB_UI.RECONNECTING, label: collabUiLabel(COLLAB_UI.RECONNECTING), showRetry: false };
  }
  if (transport === "connecting_initial" || transport === "off") {
    return { kind: COLLAB_UI.CONNECTING, label: collabUiLabel(COLLAB_UI.CONNECTING), showRetry: false };
  }
  if (collaborative && peers > 0) {
    return { kind: COLLAB_UI.COLLAB_ACTIVE, label: collabUiLabel(COLLAB_UI.COLLAB_ACTIVE), showRetry: false };
  }
  return { kind: COLLAB_UI.CONNECTED, label: collabUiLabel(COLLAB_UI.CONNECTED), showRetry: false };
}

export function presenceCountLabel(totalPeople) {
  const n = Math.max(0, Number(totalPeople) || 0);
  if (n <= 0) return "";
  if (n === 1) return "1 участник";
  if (n >= 2 && n <= 4) return `${n} участника`;
  return `${n} участников`;
}
