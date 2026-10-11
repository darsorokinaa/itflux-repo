/**
 * Каноническая conference identity и безопасная телеметрия Jitsi.
 * MeetingAttendance сюда не пишется.
 */

import { reportVideoMeetingTechnicalEvent as postTechnicalEvent } from "../utils/cabinetAuth";

const SECRET_KEYS = new Set([
  "jwt",
  "token",
  "password",
  "email",
  "secret",
  "authorization",
  "cookie",
]);

export function canonicalJitsiRoomName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let local = raw.split("@")[0];
  if (local.includes("/")) local = local.split("/").pop() || local;
  return local.trim().toLowerCase();
}

export function jitsiRoomsMatch(configured, eventRoom) {
  const left = canonicalJitsiRoomName(configured);
  const right = canonicalJitsiRoomName(eventRoom);
  if (!left || !right) return true;
  return left === right;
}

export function sanitizeTelemetryMetadata(value, depth = 0) {
  if (depth > 4 || value == null) return value == null ? undefined : null;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeTelemetryMetadata(item, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const lower = String(key).toLowerCase();
      if (SECRET_KEYS.has(lower) || lower.includes("secret") || lower.includes("password")) {
        continue;
      }
      const nested = sanitizeTelemetryMetadata(item, depth + 1);
      if (nested !== undefined) out[String(key).slice(0, 64)] = nested;
      if (Object.keys(out).length >= 24) break;
    }
    return out;
  }
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 200);
}

export function classifyConferencePresence({
  conferenceJoined = false,
  remoteCount = null,
  participantCount = null,
  mediaFailed = false,
  mediaUp = false,
  reconnecting = false,
  isTeacher = false,
} = {}) {
  const count = typeof participantCount === "number" ? participantCount : ((Number(remoteCount) || 0) + (conferenceJoined ? 1 : 0));
  const remotesFromCount = Math.max(0, count - (conferenceJoined ? 1 : 0));
  // `remoteCount: 0` must not hide a live peer when Jitsi already reports 2+ in-room.
  const remotes = remoteCount == null
    ? remotesFromCount
    : Math.max(Number(remoteCount) || 0, remotesFromCount);
  const peerInRoom = remotes >= 1;
  if (mediaUp) {
    mediaFailed = false;
    reconnecting = false;
  }
  if (mediaFailed && conferenceJoined && peerInRoom) {
    return {
      scenario: "B",
      code: "media_failed",
      label: "Не удалось установить медиасоединение. Попробуйте переподключиться.",
    };
  }
  if (reconnecting) {
    return {
      scenario: "",
      code: "reconnecting",
      label: "Соединение восстанавливается…",
    };
  }
  if (!conferenceJoined) {
    return {
      scenario: "",
      code: "connecting",
      label: "Подключение к комнате…",
    };
  }
  if (!peerInRoom) {
    return {
      scenario: "A",
      code: "waiting_peer",
      label: isTeacher ? "Ждём ученика" : "Ждём учителя",
    };
  }
  if (mediaFailed) {
    return {
      scenario: "B",
      code: "media_failed",
      label: "Не удалось установить медиасоединение. Попробуйте переподключиться.",
    };
  }
  if (mediaUp) {
    return {
      scenario: "B",
      code: "in_call",
      label: "",
    };
  }
  return {
    scenario: "B-pending",
    code: "peer_connecting_media",
    label: isTeacher ? "Ученик подключается…" : "Учитель подключается…",
  };
}

const lastSent = new Map();

/** Типы, которые backend реально сохраняет. Остальные он молча отбрасывает. */
const STORED_EVENT_TYPES = new Set([
  "conference_joined",
  "conference_left",
  "participant_joined",
  "participant_left",
  "conference_failed",
  "connection_failed",
  "peer_connection_failure",
  "ready_to_close",
  "room_mismatch",
  "connection_reconnecting",
  "connection_restored",
  "participant_count",
  "join_config_issued",
]);

const EVENT_ALIASES = {
  jitsi_hard_reconnect_started: { eventType: "connection_reconnecting", reason: "hard_reconnect" },
  jitsi_hard_reconnect_succeeded: { eventType: "connection_restored", reason: "hard_reconnect" },
  jitsi_hard_reconnect_failed: { eventType: "connection_failed", reason: "hard_reconnect_failed" },
  media_recovery_started: { eventType: "connection_reconnecting", reason: "media_recovery" },
  media_recovery_succeeded: { eventType: "connection_restored", reason: "media_recovery" },
  media_recovery_failed: { eventType: "peer_connection_failure", reason: "media_recovery_failed" },
  audio_device_lost: { eventType: "connection_failed", reason: "audio_device_lost" },
  audio_device_recovered: { eventType: "connection_restored", reason: "audio_device_recovered" },
  mic_error: { eventType: "connection_failed", reason: "mic_error" },
  camera_error: { eventType: "connection_failed", reason: "camera_error" },
  call_stage: { eventType: "connection_failed", reason: "call_stage" },
};

export function toPersistableTechnicalEvent(eventType, reason = "") {
  const raw = String(eventType || "").trim();
  const alias = EVENT_ALIASES[raw];
  if (alias) {
    return {
      eventType: alias.eventType,
      reason: String(reason || alias.reason || "").slice(0, 128),
      clientEvent: raw,
    };
  }
  if (STORED_EVENT_TYPES.has(raw)) {
    return { eventType: raw, reason: String(reason || "").slice(0, 128), clientEvent: raw };
  }
  return {
    eventType: "connection_failed",
    reason: String(reason || raw || "unmapped").slice(0, 128),
    clientEvent: raw || "unmapped",
  };
}

/** Повторный вход обязан остаться в комнате этого урока. */
export function roomGuardDecision(lockedRoom, nextRoom) {
  const locked = String(lockedRoom || "").trim();
  const next = String(nextRoom || "").trim();
  if (!locked) return { ok: Boolean(next), lock: next, reason: next ? "" : "room_missing" };
  if (!next) return { ok: false, lock: locked, reason: "room_missing" };
  if (!jitsiRoomsMatch(locked, next)) return { ok: false, lock: locked, reason: "room_changed" };
  return { ok: true, lock: locked, reason: "" };
}

export function reportMeetingTechnicalEvent(meetingUuid, payload = {}) {
  if (!meetingUuid) return Promise.resolve(null);
  const mapped = toPersistableTechnicalEvent(
    payload.eventType || payload.event_type,
    payload.reason || payload.code || "",
  );
  if (!mapped.eventType) return Promise.resolve(null);
  const metadata = sanitizeTelemetryMetadata({
    ...(payload.metadata || {}),
    clientEvent: mapped.clientEvent,
  });
  const body = {
    eventType: mapped.eventType,
    role: String(payload.role || "").slice(0, 32),
    reason: mapped.reason,
    jitsiParticipantId: String(payload.jitsiParticipantId || payload.jitsi_participant_id || "").slice(0, 255),
    browserTabSessionId: String(payload.browserTabSessionId || payload.browser_tab_session_id || "").slice(0, 64),
    callSessionId: String(payload.callSessionId || payload.call_session_id || "").slice(0, 64),
    metadata,
  };
  const key = `${meetingUuid}:${body.eventType}:${body.reason}:${body.jitsiParticipantId}:${body.metadata?.participantCount ?? ""}`;
  const now = Date.now();
  const prev = lastSent.get(key) || 0;
  if (now - prev < 1500 && body.eventType === "participant_count") {
    return Promise.resolve(null);
  }
  lastSent.set(key, now);
  return postTechnicalEvent(meetingUuid, body);
}
