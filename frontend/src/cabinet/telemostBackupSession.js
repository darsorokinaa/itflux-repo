const EMPTY = {
  meetingUuid: "",
  available: false,
  open: false,
  canCreate: false,
};

let state = { ...EMPTY };
const listeners = new Set();

export function getTelemostBackupState() {
  return state;
}

export function setTelemostBackupState(partial) {
  const next = { ...state, ...partial };
  if (
    next.meetingUuid === state.meetingUuid
    && next.available === state.available
    && next.open === state.open
    && next.canCreate === state.canCreate
  ) {
    return state;
  }
  state = next;
  listeners.forEach((fn) => fn(state));
  return state;
}

export function clearTelemostBackupState() {
  return setTelemostBackupState({ ...EMPTY });
}

export function subscribeTelemostBackup(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
