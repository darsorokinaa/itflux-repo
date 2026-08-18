/**
 * Сверка UI ↔ реальные media tracks / соединение.
 * Targeted recovery без reload страницы, с лимитом попыток.
 */

export const WATCHDOG_INTERVAL_MS = 10000;
export const MAX_TRACK_RECOVERIES = 2;

function blobOf(event) {
  return [event?.type, event?.name, event?.message, event?.error, event?.code]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function classifyMediaError(event, kind = "media") {
  const blob = blobOf(event);
  const label = kind === "mic" ? "микрофон" : kind === "camera" ? "камера" : "устройство";
  if (
    blob.includes("notallowed")
    || blob.includes("permission")
    || blob.includes("denied")
    || blob.includes("security")
  ) {
    return {
      code: "permission_denied",
      message: kind === "mic"
        ? "Нет разрешения на микрофон"
        : "Нет разрешения на камеру",
    };
  }
  if (blob.includes("notfound") || blob.includes("devicesnotfound") || blob.includes("overconstrained")) {
    return {
      code: "device_missing",
      message: kind === "mic" ? "Микрофон не найден" : "Камера не найдена",
    };
  }
  if (
    blob.includes("notreadable")
    || blob.includes("trackstart")
    || blob.includes("in use")
    || blob.includes("busy")
    || blob.includes("aborterror")
    || blob.includes("could not start")
  ) {
    return {
      code: "device_busy",
      message: kind === "mic"
        ? "Микрофон используется другой программой"
        : "Камера занята другой программой",
    };
  }
  if (blob.includes("ended") || blob.includes("disconnected")) {
    return {
      code: "track_ended",
      message: kind === "mic"
        ? "Соединение с микрофоном потеряно"
        : "Соединение с камерой потеряно",
    };
  }
  return {
    code: "media_error",
    message: event?.message || event?.error || `Проблема с ${label}`,
  };
}

export function detectImpossibleMediaState({
  intendedMicOn = false,
  intendedCamOn = false,
  audioMuted = null,
  videoMuted = null,
  screenSharing = false,
  screenTrackActive = null,
} = {}) {
  const issues = [];
  if (intendedMicOn && audioMuted === true) {
    issues.push({
      code: "mic_ui_mismatch",
      message: "Микрофон должен быть включён, но аудиодорожка выключена",
    });
  }
  if (intendedCamOn && videoMuted === true) {
    issues.push({
      code: "camera_ui_mismatch",
      message: "Камера должна быть включена, но видеотрек отсутствует",
    });
  }
  if (screenSharing && screenTrackActive === false) {
    issues.push({
      code: "screenshare_stale",
      message: "Демонстрация экрана остановилась",
    });
  }
  return issues;
}

function listen(api, eventName, handler, bucket) {
  if (!api || typeof api.addListener !== "function") return;
  try {
    api.addListener(eventName, handler);
    bucket.push([eventName, handler]);
  } catch {
    /* event may be missing */
  }
}

export function attachMediaWatchdog(api, {
  diagnostics = {},
  getIntended = () => ({ micOn: false, camOn: false, screenSharing: false }),
  onWarning,
  onHint,
  onConnectionState,
  onAudioMuteStatusChanged,
  onVideoMuteStatusChanged,
} = {}) {
  const listeners = [];
  let disposed = false;
  let timer = null;
  let audioMuted = null;
  let videoMuted = null;
  let audioRecoveries = 0;
  let videoRecoveries = 0;
  let lastHintAt = 0;

  const log = (tag, extra = {}) => {
    try {
      console.info(
        `[${tag}] meeting=${diagnostics.meetingUuid || ""} room=${diagnostics.roomName || ""} `
        + `call=${diagnostics.callSessionId || ""} `
        + Object.entries(extra).map(([k, v]) => `${k}=${v}`).join(" "),
      );
    } catch {
      /* ignore */
    }
  };

  const hint = (message) => {
    const now = Date.now();
    if (now - lastHintAt < 4000) return;
    lastHintAt = now;
    onHint?.(message);
  };

  const recoverTrack = (kind) => {
    const intended = getIntended() || {};
    if (kind === "audio") {
      if (!intended.micOn || audioRecoveries >= MAX_TRACK_RECOVERIES) return;
      audioRecoveries += 1;
      log("JITSI_MEDIA_RECOVER", { kind: "audio", attempt: audioRecoveries });
      try {
        api.executeCommand("toggleAudio");
      } catch {
        /* ignore */
      }
      return;
    }
    if (!intended.camOn || videoRecoveries >= MAX_TRACK_RECOVERIES) return;
    videoRecoveries += 1;
    log("JITSI_MEDIA_RECOVER", { kind: "video", attempt: videoRecoveries });
    try {
      api.executeCommand("toggleVideo");
    } catch {
      /* ignore */
    }
  };

  const tick = () => {
    if (disposed) return;
    const intended = getIntended() || {};
    const issues = detectImpossibleMediaState({
      intendedMicOn: intended.micOn,
      intendedCamOn: intended.camOn,
      audioMuted,
      videoMuted,
      screenSharing: intended.screenSharing,
      screenTrackActive: intended.screenTrackActive,
    });
    for (const issue of issues) {
      log("JITSI_WATCHDOG", { code: issue.code });
      if (issue.code === "mic_ui_mismatch") recoverTrack("audio");
      if (issue.code === "camera_ui_mismatch") recoverTrack("video");
      if (issue.code === "screenshare_stale") {
        onWarning?.(issue.message);
      }
    }
  };

  listen(api, "audioMuteStatusChanged", (event) => {
    audioMuted = Boolean(event?.muted);
    onAudioMuteStatusChanged?.(event);
    log("JITSI_AUDIO", { muted: audioMuted });
  }, listeners);

  listen(api, "videoMuteStatusChanged", (event) => {
    videoMuted = Boolean(event?.muted);
    onVideoMuteStatusChanged?.(event);
    log("JITSI_VIDEO", { muted: videoMuted });
  }, listeners);

  listen(api, "cameraError", (event) => {
    const classified = classifyMediaError(event, "camera");
    log("JITSI_CAMERA_ERROR", { code: classified.code });
    onWarning?.(classified.message);
    if (classified.code === "track_ended" || classified.code === "device_busy") {
      recoverTrack("video");
    }
  }, listeners);

  listen(api, "micError", (event) => {
    const classified = classifyMediaError(event, "mic");
    log("JITSI_MIC_ERROR", { code: classified.code });
    onWarning?.(classified.message);
    if (classified.code === "track_ended" || classified.code === "device_busy") {
      recoverTrack("audio");
    }
  }, listeners);

  listen(api, "deviceListChanged", () => {
    log("JITSI_DEVICES", { event: "changed" });
    tick();
  }, listeners);

  listen(api, "connectionFailed", (event) => {
    log("JITSI_CONNECTION_FAILED", { error: event?.error || event?.message || "" });
    onConnectionState?.("reconnecting", "connectionFailed");
    hint("Соединение нестабильно. Восстанавливаем связь…");
  }, listeners);

  listen(api, "conferenceFailed", (event) => {
    log("JITSI_CONFERENCE_FAILED", { error: event?.error || event?.message || "" });
    onConnectionState?.("reconnecting", "conferenceFailed");
    hint("Связь с конференцией прервалась. Восстанавливаем…");
  }, listeners);

  listen(api, "peerConnectionFailure", () => {
    onConnectionState?.("degraded", "peerConnectionFailure");
    hint("Качество видео снижено для сохранения звука");
  }, listeners);

  listen(api, "videoConferenceJoined", () => {
    onConnectionState?.("joined", "videoConferenceJoined");
  }, listeners);

  listen(api, "dataChannelOpened", () => {
    onConnectionState?.("joined", "dataChannelOpened");
  }, listeners);

  timer = setInterval(tick, WATCHDOG_INTERVAL_MS);

  return {
    inspect: tick,
    snapshot: () => ({ audioMuted, videoMuted, audioRecoveries, videoRecoveries }),
    dispose() {
      disposed = true;
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      for (const [eventName, handler] of listeners) {
        try {
          api.removeListener?.(eventName, handler);
        } catch {
          /* ignore */
        }
      }
      listeners.length = 0;
    },
  };
}
