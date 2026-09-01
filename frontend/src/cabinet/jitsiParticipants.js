/**
 * Живое присутствие в Jitsi: snapshot + события, без локального count++/--.
 * Источник истины — фактический roster External API, не посещаемость в БД.
 */

import { jitsiRoomsMatch } from "./jitsiTelemetry";

export const PRESENCE_RECONCILE_INTERVAL_MS = 8000;
export const JOIN_SNAPSHOT_RETRY_MS = [0, 250, 1000];
const ROOMS_INFO_TIMEOUT_MS = 600;

export function createBrowserTabSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeStr(value) {
  return String(value || "").trim();
}

export function logJitsiPresence(tag, fields = {}) {
  const lesson = fields.lessonId ?? "";
  const meeting = fields.meetingUuid ?? fields.meetingId ?? "";
  const room = fields.roomName ?? "";
  const user = fields.userId ?? "";
  const role = fields.role ?? "";
  const participantId = fields.participantId ?? "";
  const tab = fields.browserTabSessionId ?? "";
  const count = fields.count;
  const ids = Array.isArray(fields.ids) ? fields.ids.join(",") : "";
  const reason = fields.reason ?? "";
  const line = [
    `[${tag}]`,
    `lesson=${lesson}`,
    `meeting=${meeting}`,
    `room=${room}`,
    `user=${user}`,
    `role=${role}`,
    `participantId=${participantId}`,
    tab ? `tab=${tab}` : "",
    count != null ? `count=${count}` : "",
    ids ? `ids=${ids}` : "",
    reason ? `reason=${reason}` : "",
  ].filter(Boolean).join(" ");
  try {
    console.info(line);
  } catch {
    /* ignore */
  }
}

const BOT_DISPLAY_NAMES = /^(focus|jicofo|jibri|recorder|transcriber)$/i;

export function isHiddenOrBotParticipant(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.hidden === true || raw.isHidden === true) return true;
  if (safeStr(raw.botType || raw.bot_type)) return true;
  const name = safeStr(raw.displayName || raw.formattedDisplayName || raw.name);
  return BOT_DISPLAY_NAMES.test(name);
}

export function normalizeParticipant(raw, { localId = "" } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const id = safeStr(
    raw.participantId
    || raw.id
    || raw.jid
    || raw.occupantJid,
  );
  if (!id) return null;
  const local = Boolean(localId) && id === localId;
  if (!local && isHiddenOrBotParticipant(raw)) return null;
  const displayName = safeStr(
    raw.displayName
    || raw.formattedDisplayName
    || raw.name,
  );
  return {
    id,
    displayName,
    role: safeStr(raw.role),
    local,
  };
}

export function extractParticipantsFromInfo(info, { localId = "" } = {}) {
  if (!Array.isArray(info)) return [];
  const byId = new Map();
  for (const raw of info) {
    const participant = normalizeParticipant(raw, { localId });
    if (!participant) continue;
    byId.set(participant.id, participant);
  }
  return [...byId.values()];
}

export function extractParticipantsFromRoomsInfo(roomsInfo, { localId = "" } = {}) {
  const rooms = Array.isArray(roomsInfo)
    ? roomsInfo
    : (roomsInfo?.rooms || roomsInfo?.members || []);
  if (!Array.isArray(rooms)) return [];
  const byId = new Map();
  for (const room of rooms) {
    const people = room?.participants || room?.members || [];
    if (!Array.isArray(people)) continue;
    for (const raw of people) {
      const participant = normalizeParticipant(raw, { localId });
      if (!participant) continue;
      byId.set(participant.id, participant);
    }
  }
  return [...byId.values()];
}

export function createParticipantStore() {
  const byId = new Map();
  let localId = "";

  const upsert = (raw) => {
    const participant = normalizeParticipant(raw, { localId });
    if (!participant) return null;
    const prev = byId.get(participant.id) || {};
    const next = {
      ...prev,
      ...participant,
      local: participant.id === localId || participant.local,
    };
    byId.set(next.id, next);
    return next;
  };

  return {
    get localId() {
      return localId;
    },
    setLocalId(id) {
      localId = safeStr(id);
      if (localId && byId.has(localId)) {
        const current = byId.get(localId);
        byId.set(localId, { ...current, local: true });
      }
    },
    upsert,
    remove(id) {
      const key = safeStr(id);
      if (!key) return false;
      return byId.delete(key);
    },
    applySnapshot(list, { replace = false } = {}) {
      const incoming = extractParticipantsFromInfo(list, { localId });
      if (!incoming.length && !replace) return;
      const seen = new Set();
      for (const participant of incoming) {
        seen.add(participant.id);
        upsert(participant);
      }
      if (replace && incoming.length) {
        for (const id of [...byId.keys()]) {
          if (seen.has(id)) continue;
          if (id === localId) continue;
          byId.delete(id);
        }
      }
    },
    snapshot() {
      const all = [...byId.values()];
      const localParticipant = localId
        ? (byId.get(localId) || { id: localId, displayName: "", local: true })
        : null;
      const remoteParticipants = all.filter((item) => item.id !== localId);
      return {
        localParticipant,
        remoteParticipants,
        count: byId.size,
        ids: all.map((item) => item.id),
      };
    },
    clear() {
      byId.clear();
    },
  };
}

function withTimeout(promise, ms) {
  if (!promise || typeof promise.then !== "function") {
    return Promise.resolve(promise);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        finish(value);
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
    );
  });
}

export function readParticipantsFromApi(api, { localId = "" } = {}) {
  if (!api) return [];
  try {
    const info = api.getParticipantsInfo?.();
    return extractParticipantsFromInfo(info, { localId });
  } catch {
    return [];
  }
}

export async function readParticipantsFromRoomsInfo(api, { localId = "" } = {}) {
  if (!api || typeof api.getRoomsInfo !== "function") return [];
  try {
    const rooms = await withTimeout(api.getRoomsInfo(), ROOMS_INFO_TIMEOUT_MS);
    return extractParticipantsFromRoomsInfo(rooms, { localId });
  } catch {
    return [];
  }
}

function rosterLooksComplete(list, store) {
  if (!list.length) return false;
  if (store.localId && !list.some((item) => item.id === store.localId)) {
    return false;
  }
  // Один local в snapshot при уже известных remote — типичный неполный roster
  // сразу после join. Нельзя вычищать тех, кого уже дали события.
  if (list.length === 1 && store.snapshot().count > 1) {
    return false;
  }
  return true;
}

export async function reconcileConferenceParticipants(api, store, { reason = "manual" } = {}) {
  const localId = store.localId;
  const fromInfo = readParticipantsFromApi(api, { localId });
  if (fromInfo.length) {
    store.applySnapshot(fromInfo, { replace: false });
  }
  const fromRooms = await readParticipantsFromRoomsInfo(api, { localId });
  if (fromRooms.length) {
    store.applySnapshot(fromRooms, { replace: rosterLooksComplete(fromRooms, store) });
  } else if (fromInfo.length && rosterLooksComplete(fromInfo, store)) {
    store.applySnapshot(fromInfo, { replace: true });
  }
  if (localId) {
    store.upsert({ id: localId, local: true });
  }
  return { ...store.snapshot(), reason };
}

export function attachConferencePresence(api, {
  onPresence,
  onParticipantCount,
  onJoined,
  onLeft,
  onHangup,
  onBecameModerator,
  onMediaWarning,
  diagnostics = {},
  subject,
} = {}) {
  const store = createParticipantStore();
  const retryTimers = [];
  let intervalId = null;
  let disposed = false;
  let joinedOnce = false;

  const emit = (reason) => {
    if (disposed) return store.snapshot();
    const snap = store.snapshot();
    onPresence?.(snap, reason);
    if (typeof snap.count === "number") {
      onParticipantCount?.(snap.count);
    }
    logJitsiPresence("JITSI_SNAPSHOT", {
      ...diagnostics,
      count: snap.count,
      ids: snap.ids,
      participantId: store.localId,
      reason,
    });
    return snap;
  };

  const reconcile = async (reason) => {
    if (disposed) return store.snapshot();
    const snap = await reconcileConferenceParticipants(api, store, { reason });
    return emit(snap.reason || reason);
  };

  const scheduleJoinRetries = () => {
    for (const delay of JOIN_SNAPSHOT_RETRY_MS) {
      const timer = setTimeout(() => {
        void reconcile(delay === 0 ? "joined-snapshot" : `joined-retry-${delay}`);
      }, delay);
      retryTimers.push(timer);
    }
  };

  const startInterval = () => {
    if (intervalId != null) return;
    intervalId = setInterval(() => {
      void reconcile("interval");
    }, PRESENCE_RECONCILE_INTERVAL_MS);
  };

  const applySubject = () => {
    const title = safeStr(subject);
    if (!title) return;
    try {
      api.executeCommand("subject", title);
    } catch {
      /* ignore */
    }
  };

  api.addListener("videoConferenceJoined", (event) => {
    const participantId = safeStr(event?.id);
    store.setLocalId(participantId);
    if (participantId) {
      store.upsert({
        id: participantId,
        displayName: event?.displayName,
        local: true,
      });
    }
    joinedOnce = true;
    logJitsiPresence("JITSI_JOINED", {
      ...diagnostics,
      participantId,
      eventRoomName: event?.roomName || "",
      roomName: diagnostics.roomName,
    });
    if (event?.roomName && diagnostics.roomName && !jitsiRoomsMatch(diagnostics.roomName, event.roomName)) {
      onMediaWarning?.(
        "Комната Jitsi не совпадает с каноническим roomName урока. Обновите страницу.",
      );
    }
    applySubject();
    onJoined?.(event);
    emit("videoConferenceJoined");
    scheduleJoinRetries();
    startInterval();
  });

  api.addListener("participantJoined", (event) => {
    store.upsert(event);
    logJitsiPresence("JITSI_PARTICIPANT_JOINED", {
      ...diagnostics,
      participantId: event?.id,
    });
    emit("participantJoined");
    void reconcile("participantJoined");
  });

  api.addListener("participantLeft", (event) => {
    store.remove(event?.id);
    logJitsiPresence("JITSI_PARTICIPANT_LEFT", {
      ...diagnostics,
      participantId: event?.id,
    });
    emit("participantLeft");
    void reconcile("participantLeft");
  });

  api.addListener("participantRoleChanged", (event) => {
    if (safeStr(event?.role).toLowerCase() === "moderator") {
      onBecameModerator?.();
    }
    void reconcile("participantRoleChanged");
  });

  api.addListener("videoConferenceLeft", () => {
    logJitsiPresence("JITSI_LEFT", {
      ...diagnostics,
      participantId: store.localId,
    });
    if (!disposed && joinedOnce) {
      onLeft?.({ id: store.localId, source: "videoConferenceLeft" });
      void reconcile("videoConferenceLeft");
    }
  });

  api.addListener("readyToClose", () => {
    logJitsiPresence("JITSI_READY_TO_CLOSE", {
      ...diagnostics,
      participantId: store.localId,
    });
    if (!disposed && joinedOnce) {
      onHangup?.({ id: store.localId, source: "readyToClose" });
    }
  });

  return {
    reconcile,
    snapshot: () => store.snapshot(),
    dispose() {
      disposed = true;
      for (const timer of retryTimers) {
        clearTimeout(timer);
      }
      retryTimers.length = 0;
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      store.clear();
    },
  };
}

export function isJitsiAuthJoinFailure(event) {
  const parts = [];
  const walk = (value, depth = 0) => {
    if (value == null || depth > 3) return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (typeof value !== "object") return;
    for (const key of ["error", "message", "name", "type", "reason", "code"]) {
      if (key in value) walk(value[key], depth + 1);
    }
  };
  walk(event);
  const blob = parts.join(" ").toLowerCase();
  if (!blob) return false;
  // passwordRequired на пустой комнате — штатный первый вход учителя (ждёт ученика),
  // не отказ JWT. Режем только явный not-allowed / authentication failed.
  return (
    blob.includes("not-allowed")
    || blob.includes("not allowed")
    || blob.includes("accessdenied")
    || blob.includes("access denied")
    || blob.includes("authentication failed")
    || blob.includes("not-authorized")
    || blob.includes("tokenauth")
    || blob.includes("invalid token")
  );
}

export function shouldFallbackToIframe(error, config, { forceIframe = false } = {}) {
  if (forceIframe) return true;
  if (config?.authMode === "jwt") return false;
  const code = error?.code || error?.category;
  if (code === "jitsi_auth") return false;
  return code === "jitsi_join_timeout"
    || code === "jitsi_script"
    || code === "jitsi_script_timeout"
    || error?.message === "Не удалось загрузить Jitsi Meet";
}
