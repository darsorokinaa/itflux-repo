/**
 * Короткая диагностика одного входа в конференцию.
 * Идентификатор — уже существующий callSessionId, без JWT и паролей.
 */

const SECRET_KEY = /jwt|token|password|authorization|secret/i;

export function describeConferenceClient() {
  if (typeof navigator === "undefined") {
    return { browser: "unknown", form: "unknown" };
  }
  const ua = String(navigator.userAgent || "");
  let browser = "other";
  if (/yabrowser/i.test(ua)) browser = "yandex";
  else if (/edg\//i.test(ua)) browser = "edge";
  else if (/crios|chrome/i.test(ua)) browser = "chrome";
  else if (/fxios|firefox/i.test(ua)) browser = "firefox";
  else if (/safari/i.test(ua)) browser = "safari";
  let form = "desktop";
  if (/ipad/i.test(ua)) form = "tablet";
  else if (/iphone|android.+mobile|mobile/i.test(ua)) form = "phone";
  else if (/android/i.test(ua)) form = "tablet";
  return { browser, form };
}

export function isMobileConferenceClient() {
  const client = describeConferenceClient();
  return client.form === "phone" || client.form === "tablet";
}

export function classifyConferenceFault({
  code = "",
  status = 0,
  online = true,
  name = "",
} = {}) {
  const value = String(code || name || "");
  if (online === false || value === "offline") return "network";
  if (
    value === "jwt_missing"
    || value === "jwt_config"
    || value === "jitsi_auth"
    || value === "forbidden"
    || status === 401
    || status === 403
  ) return "auth";
  if (
    value === "jitsi_script"
    || value === "jitsi_script_timeout"
    || value === "jitsi_public_blocked"
  ) return "script";
  if (
    value === "config"
    || value === "not_found"
    || value === "room_mismatch"
    || value === "livekit_config"
    || status >= 500
  ) return "backend";
  if (
    value === "permission_denied"
    || value === "NotAllowedError"
    || value === "SecurityError"
  ) return "permission";
  if (
    value === "device_missing"
    || value === "device_busy"
    || value === "track_ended"
    || value === "capture_aborted"
    || value === "camera_error"
    || value === "mic_error"
  ) return "device";
  if (
    value === "jitsi_connection_failed"
    || value === "jitsi_conference_failed"
    || value === "jitsi_join_timeout"
    || value === "join_timeout"
    || value === "connectionFailed"
    || value === "conferenceFailed"
    || value === "peerConnectionFailure"
  ) return "network";
  return "unknown";
}

function sanitizeDetails(details) {
  const safe = {};
  if (!details || typeof details !== "object") return safe;
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof value === "string") {
      if (SECRET_KEY.test(value)) continue;
      safe[key] = value.slice(0, 160);
    } else if (typeof value === "number" || typeof value === "boolean" || value == null) {
      safe[key] = value;
    }
  }
  return safe;
}

export function logConferenceStage(stage, details = {}) {
  const entry = {
    stage: String(stage || "unknown").slice(0, 48),
    ...sanitizeDetails(details),
  };
  try {
    console.info("[conference]", entry.stage, entry);
  } catch {
    /* ignore */
  }
  return entry;
}

export function conferenceStatusView({
  connectionHint = "",
  mediaWarning = "",
  callReconnectNeeded = false,
  joinState = "",
  online = true,
} = {}) {
  const warning = String(mediaWarning || "");
  const lower = warning.toLowerCase();
  if (
    lower.includes("разрешен")
    || lower.includes("нет доступа")
    || lower.includes("не найден")
    || lower.includes("занят")
    || lower.includes("используется другой")
  ) {
    return { phase: "permission", title: warning };
  }
  if (callReconnectNeeded) {
    return { phase: "failed", title: "Не удалось восстановить соединение." };
  }
  if (online === false) {
    return { phase: "reconnecting", title: "Восстанавливаем соединение" };
  }
  const hint = String(connectionHint || "");
  if (hint.includes("восстанавлива")) {
    return { phase: "reconnecting", title: "Восстанавливаем соединение" };
  }
  if (hint.includes("медиасоединение")) {
    return { phase: "failed", title: hint };
  }
  if (
    hint === "Ждём ученика"
    || hint === "Ждём учителя"
    || hint.includes("подключается")
  ) {
    return { phase: "info", title: hint };
  }
  const joined = joinState === "joined" || joinState === "embedded";
  if (!joined && (hint.includes("Подключа") || hint.includes("занимает больше"))) {
    return { phase: "connecting", title: "Подключаемся к занятию" };
  }
  if (hint && !joined) {
    return { phase: "info", title: hint };
  }
  return { phase: "", title: "" };
}
