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
  const remotes = remoteCount == null
    ? Math.max(0, count - (conferenceJoined ? 1 : 0))
    : Math.max(0, Number(remoteCount) || 0);
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

export function reportMeetingTechnicalEvent(meetingUuid, payload = {}) {
  if (!meetingUuid) return Promise.resolve(null);
  const eventType = String(payload.eventType || payload.event_type || "").trim();
  if (!eventType) return Promise.resolve(null);
  const body = {
    eventType,
    role: String(payload.role || "").slice(0, 32),
    reason: String(payload.reason || payload.code || "").slice(0, 128),
    jitsiParticipantId: String(payload.jitsiParticipantId || payload.jitsi_participant_id || "").slice(0, 255),
    browserTabSessionId: String(payload.browserTabSessionId || payload.browser_tab_session_id || "").slice(0, 64),
    callSessionId: String(payload.callSessionId || payload.call_session_id || "").slice(0, 64),
    metadata: sanitizeTelemetryMetadata(payload.metadata || {}),
  };
  const key = `${meetingUuid}:${eventType}:${body.reason}:${body.jitsiParticipantId}:${body.metadata?.participantCount ?? ""}`;
  const now = Date.now();
  const prev = lastSent.get(key) || 0;
  if (now - prev < 1500 && eventType === "participant_count") {
    return Promise.resolve(null);
  }
  lastSent.set(key, now);
  return postTechnicalEvent(meetingUuid, body);
}
