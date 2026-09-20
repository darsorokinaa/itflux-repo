/**
 * Сверка UI ↔ реальные media tracks / соединение.
 * Targeted recovery без reload страницы, с лимитом попыток.
 * Hard reconnect API не создаёт — только сообщает владельцу lifecycle.
 */

export const WATCHDOG_INTERVAL_MS = 10000;
export const MAX_TRACK_RECOVERIES = 2;
export const NETWORK_RECOVERY_GRACE_MS = 4000;
export const HARD_RECONNECT_BACKOFF_MS = Object.freeze([0, 3000, 8000]);
export const MAX_HARD_RECONNECT_ATTEMPTS = 3;
export const RECOVERY_STABLE_MS = 20000;
export const DEVICE_SYNC_DEBOUNCE_MS = 300;

export const WATCHDOG_STATES = Object.freeze({
  healthy: "healthy",
  media_glitch: "media_glitch",
  audio_device_lost: "audio_device_lost",
  network_failure: "network_failure",
  recovering: "recovering",
  reconnecting: "reconnecting",
  hard_reconnect_required: "hard_reconnect_required",
  exhausted: "exhausted",
});

export function shouldRecoverFromJitsiEvent(eventName) {
  if (eventName === "participantLeft") return false;
  if (eventName === "readyToClose") return false;
  return eventName === "connectionFailed"
    || eventName === "conferenceFailed"
    || eventName === "peerConnectionFailure"
    || eventName === "videoConferenceLeft"
    || eventName === "iframe_detached";
}

export function isQuietNetworkGlitch(eventName) {
  return eventName === "peerConnectionFailure";
}

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

export function createHardReconnectPolicy({
  maxAttempts = MAX_HARD_RECONNECT_ATTEMPTS,
  backoffMs = HARD_RECONNECT_BACKOFF_MS,
  stableMs = RECOVERY_STABLE_MS,
  setTimeoutFn = (fn, ms) => (typeof window !== "undefined" ? window.setTimeout(fn, ms) : setTimeout(fn, ms)),
  clearTimeoutFn = (id) => (typeof window !== "undefined" ? window.clearTimeout(id) : clearTimeout(id)),
} = {}) {
  let attempts = 0;
  let inFlight = false;
  let stableTimer = null;
  const delays = Array.isArray(backoffMs) && backoffMs.length ? backoffMs : HARD_RECONNECT_BACKOFF_MS;

  const clearStable = () => {
    if (stableTimer != null) {
      clearTimeoutFn(stableTimer);
      stableTimer = null;
    }
  };

  return {
    snapshot() {
      return {
        attempts,
        inFlight,
        exhausted: attempts >= maxAttempts && !inFlight,
        nextDelayMs: delays[Math.min(attempts, delays.length - 1)] ?? 0,
      };
    },
    reset() {
      attempts = 0;
      inFlight = false;
      clearStable();
    },
    dispose() {
      clearStable();
    },
    canAttempt() {
      return !inFlight && attempts < maxAttempts;
    },
    consumeAttempt() {
      if (inFlight || attempts >= maxAttempts) return null;
      clearStable();
      const delayMs = delays[attempts] ?? delays[delays.length - 1] ?? 0;
      attempts += 1;
      inFlight = true;
      return { attempt: attempts, delayMs };
    },
    markSuccess() {
      inFlight = false;
      clearStable();
      if (stableMs > 0) {
        stableTimer = setTimeoutFn(() => {
          attempts = 0;
          stableTimer = null;
        }, stableMs);
      }
    },
    markAttemptFailed() {
      inFlight = false;
    },
  };
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

function listenDom(target, eventName, handler, bucket) {
  if (!target || typeof target.addEventListener !== "function") return;
  try {
    target.addEventListener(eventName, handler);
    bucket.push([target, eventName, handler]);
  } catch {
    /* ignore */
  }
}

export function deviceIdOf(entry) {
  if (entry == null) return "";
  if (typeof entry === "string") return entry.trim();
  return String(entry.deviceId || entry.id || "").trim();
}

function asDevice(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  return value;
}

function listDeviceIds(list) {
  if (!Array.isArray(list)) return [];
  return list.map(deviceIdOf).filter(Boolean);
}

export function audioDeviceStillPresent(selected, availableList) {
  const selectedId = deviceIdOf(selected);
  if (!selectedId) return true;
  const ids = listDeviceIds(availableList);
  if (!ids.length) return true;
  return ids.includes(selectedId);
}

export function pickReplacementDevice(availableList, selected) {
  const selectedId = deviceIdOf(selected);
  const list = Array.isArray(availableList) ? availableList : [];
  if (!list.length) return null;
  if (selectedId && listDeviceIds(list).includes(selectedId)) return null;
  return list.find((item) => deviceIdOf(item) === "default") || list[0] || null;
}

async function readMaybePromise(value) {
  try {
    return await value;
  } catch {
    return null;
  }
}

function setAudioInput(api, device) {
  if (typeof api.setAudioInputDevice !== "function") return false;
  const id = deviceIdOf(device);
  if (!id) return false;
  const label = device && typeof device === "object" ? String(device.label || "") : "";
  try {
    api.setAudioInputDevice(label, id);
    return true;
  } catch {
    try {
      api.setAudioInputDevice(id);
      return true;
    } catch {
      return false;
    }
  }
}

function setAudioOutput(api, device) {
  if (typeof api.setAudioOutputDevice !== "function") return false;
  const id = deviceIdOf(device);
  if (!id) return false;
  const label = device && typeof device === "object" ? String(device.label || "") : "";
  try {
    api.setAudioOutputDevice(label, id);
    return true;
  } catch {
    try {
      api.setAudioOutputDevice(id);
      return true;
    } catch {
      return false;
    }
  }
}

async function outputChangeAvailable(api) {
  if (typeof api.setAudioOutputDevice !== "function") return false;
  if (typeof api.isDeviceChangeAvailable !== "function") return true;
  try {
    return Boolean(await api.isDeviceChangeAvailable("output"));
  } catch {
    return false;
  }
}

export async function syncJitsiAudioDevices(api) {
  const result = {
    inputAction: "none",
    outputAction: "none",
  };
  if (!api || typeof api.getCurrentDevices !== "function" || typeof api.getAvailableDevices !== "function") {
    result.unsupported = true;
    return result;
  }

  const current = await readMaybePromise(api.getCurrentDevices());
  const available = await readMaybePromise(api.getAvailableDevices());
  if (!current || !available) {
    result.readFailed = true;
    return result;
  }

  const selectedInput = asDevice(current.audioInput || current.audioinput);
  const selectedOutput = asDevice(current.audioOutput || current.audiooutput);
  const inputs = available.audioInput || available.audioinput || [];
  const outputs = available.audioOutput || available.audiooutput || [];

  if (!audioDeviceStillPresent(selectedInput, inputs)) {
    const next = pickReplacementDevice(inputs, selectedInput);
    if (next && typeof api.setAudioInputDevice === "function") {
      result.inputAction = setAudioInput(api, next) ? "switched" : "failed";
    } else {
      result.inputAction = "lost";
    }
  }

  if (!audioDeviceStillPresent(selectedOutput, outputs)) {
    const canOutput = await outputChangeAvailable(api);
    if (!canOutput) {
      result.outputAction = "unsupported";
    } else {
      const next = pickReplacementDevice(outputs, selectedOutput);
      if (next) {
        result.outputAction = setAudioOutput(api, next) ? "switched" : "failed";
      } else {
        result.outputAction = "lost";
      }
    }
  }

  return result;
}

function readOnline() {
  try {
    return typeof navigator === "undefined" ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
}

function readVisibility() {
  try {
    return typeof document !== "undefined" ? document.visibilityState : "visible";
  } catch {
    return "visible";
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
  onReconnectRequired,
  onRecoveryStarted,
  onTelemetry,
  shouldReconnect = () => true,
} = {}) {
  const listeners = [];
  const domListeners = [];
  let disposed = false;
  let intentionalClose = false;
  let joinedOnce = false;
  let localParticipantId = "";
  let timer = null;
  let graceTimer = null;
  let deviceTimer = null;
  let audioMuted = null;
  let videoMuted = null;
  let audioRecoveries = 0;
  let videoRecoveries = 0;
  let lastHintAt = 0;
  let state = WATCHDOG_STATES.healthy;
  let cycleOpen = false;
  let hardRequestedThisCycle = false;
  let lastNetworkReason = "";
  let quietCycle = false;
  let recoveryTelemetrySent = false;

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

  const telemetry = (eventType, extra = {}) => {
    try {
      const intended = getIntended() || {};
      onTelemetry?.(eventType, {
        reason: extra.reason || lastNetworkReason || "",
        attempt: extra.attempt,
        callSessionId: diagnostics.callSessionId || "",
        intendedMicOn: Boolean(intended.micOn),
        intendedCamOn: Boolean(intended.camOn),
        visibilityState: readVisibility(),
        online: readOnline(),
        jitsiParticipantId: extra.jitsiParticipantId || localParticipantId || "",
      });
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

  const clearGrace = () => {
    if (graceTimer != null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };

  const clearDeviceTimer = () => {
    if (deviceTimer != null) {
      clearTimeout(deviceTimer);
      deviceTimer = null;
    }
  };

  const iframeConnected = () => {
    try {
      const iframe = api.getIFrame?.();
      if (!iframe) return true;
      return iframe.isConnected !== false;
    } catch {
      return true;
    }
  };

  const markRecovered = (why = "recovered") => {
    if (disposed) return;
    const hadCycle = cycleOpen;
    clearGrace();
    cycleOpen = false;
    hardRequestedThisCycle = false;
    quietCycle = false;
    lastNetworkReason = "";
    state = WATCHDOG_STATES.healthy;
    if (hadCycle && recoveryTelemetrySent) {
      telemetry("media_recovery_succeeded", { reason: why, jitsiParticipantId: localParticipantId });
    }
    recoveryTelemetrySent = false;
    onConnectionState?.("joined", why);
  };

  const requestHardReconnect = (reason) => {
    if (disposed || intentionalClose || hardRequestedThisCycle) return;
    if (typeof shouldReconnect === "function" && !shouldReconnect()) return;
    hardRequestedThisCycle = true;
    state = WATCHDOG_STATES.hard_reconnect_required;
    telemetry("media_recovery_failed", { reason, jitsiParticipantId: localParticipantId });
    onReconnectRequired?.({
      reason,
      preserveMediaState: true,
    });
  };

  const finishGrace = () => {
    graceTimer = null;
    if (disposed || intentionalClose || !cycleOpen) return;
    if (quietCycle && (lastNetworkReason === "peerConnectionFailure") && iframeConnected()) {
      const hadCycle = cycleOpen;
      cycleOpen = false;
      quietCycle = false;
      lastNetworkReason = "";
      state = WATCHDOG_STATES.healthy;
      if (hadCycle && recoveryTelemetrySent) {
        telemetry("media_recovery_succeeded", { reason: "peer_glitch_settled" });
      }
      recoveryTelemetrySent = false;
      return;
    }
    if (quietCycle && !recoveryTelemetrySent) {
      recoveryTelemetrySent = true;
      telemetry("media_recovery_started", {
        reason: lastNetworkReason || "peerConnectionFailure",
        jitsiParticipantId: localParticipantId,
      });
    }
    requestHardReconnect(lastNetworkReason || "network_timeout");
  };

  const beginLoudRecovery = (reason) => {
    quietCycle = false;
    lastNetworkReason = reason;
    state = WATCHDOG_STATES.reconnecting;
    if (!recoveryTelemetrySent) {
      recoveryTelemetrySent = true;
      telemetry("media_recovery_started", { reason, jitsiParticipantId: localParticipantId });
    }
    onRecoveryStarted?.({ reason });
    onConnectionState?.("reconnecting", reason);
    hint("Соединение восстанавливается…");
  };

  const startNetworkRecovery = (reason, { quiet = false } = {}) => {
    if (disposed || intentionalClose) return;
    if (!shouldRecoverFromJitsiEvent(reason)) return;
    if (reason === "videoConferenceLeft" && !joinedOnce) return;
    const nextQuiet = quiet || isQuietNetworkGlitch(reason);
    if (cycleOpen) {
      if (quietCycle && !nextQuiet) {
        beginLoudRecovery(reason);
        clearGrace();
        graceTimer = setTimeout(finishGrace, NETWORK_RECOVERY_GRACE_MS);
      }
      return;
    }
    cycleOpen = true;
    hardRequestedThisCycle = false;
    quietCycle = nextQuiet;
    lastNetworkReason = reason;
    state = quietCycle ? WATCHDOG_STATES.media_glitch : WATCHDOG_STATES.reconnecting;
    if (!quietCycle) beginLoudRecovery(reason);
    clearGrace();
    graceTimer = setTimeout(finishGrace, NETWORK_RECOVERY_GRACE_MS);
  };

  const resolveAudioMuted = async () => {
    if (audioMuted !== null) return audioMuted;
    if (typeof api.isAudioMuted !== "function") return null;
    try {
      const muted = await api.isAudioMuted();
      if (disposed) return null;
      audioMuted = Boolean(muted);
      return audioMuted;
    } catch {
      return null;
    }
  };

  const resolveVideoMuted = async () => {
    if (videoMuted !== null) return videoMuted;
    if (typeof api.isVideoMuted !== "function") return null;
    try {
      const muted = await api.isVideoMuted();
      if (disposed) return null;
      videoMuted = Boolean(muted);
      return videoMuted;
    } catch {
      return null;
    }
  };

  const recoverTrack = async (kind) => {
    if (disposed || intentionalClose) return;
    const intended = getIntended() || {};
    if (kind === "audio") {
      if (!intended.micOn || audioRecoveries >= MAX_TRACK_RECOVERIES) return;
      const muted = await resolveAudioMuted();
      if (muted !== true) return;
      audioRecoveries += 1;
      state = WATCHDOG_STATES.media_glitch;
      log("JITSI_MEDIA_RECOVER", { kind: "audio", attempt: audioRecoveries });
      try {
        api.executeCommand("toggleAudio");
      } catch {
        /* ignore */
      }
      return;
    }
    if (!intended.camOn || videoRecoveries >= MAX_TRACK_RECOVERIES) return;
    const muted = await resolveVideoMuted();
    if (muted !== true) return;
    videoRecoveries += 1;
    state = WATCHDOG_STATES.media_glitch;
    log("JITSI_MEDIA_RECOVER", { kind: "video", attempt: videoRecoveries });
    try {
      api.executeCommand("toggleVideo");
    } catch {
      /* ignore */
    }
  };

  const runDeviceSync = async (source = "deviceListChanged") => {
    if (disposed || intentionalClose) return;
    const result = await syncJitsiAudioDevices(api);
    if (disposed) return;
    if (result.inputAction === "switched" || result.inputAction === "lost") {
      state = WATCHDOG_STATES.audio_device_lost;
      telemetry("audio_device_lost", { reason: source, jitsiParticipantId: localParticipantId });
      onWarning?.("Микрофон отключён. Переключаемся на доступное устройство…");
    }
    if (result.inputAction === "switched") {
      telemetry("audio_device_recovered", { reason: source, jitsiParticipantId: localParticipantId });
      const intended = getIntended() || {};
      if (intended.micOn && audioMuted === true) {
        void recoverTrack("audio");
      }
    }
    if (result.outputAction === "unsupported" || result.outputAction === "failed") {
      /* output switch is best-effort; missing browser API is not an error */
    }
  };

  const scheduleDeviceSync = (source) => {
    if (disposed) return;
    clearDeviceTimer();
    deviceTimer = setTimeout(() => {
      deviceTimer = null;
      void runDeviceSync(source);
    }, DEVICE_SYNC_DEBOUNCE_MS);
  };

  const tick = () => {
    if (disposed || intentionalClose) return;
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
      if (issue.code === "mic_ui_mismatch") void recoverTrack("audio");
      if (issue.code === "camera_ui_mismatch") void recoverTrack("video");
      if (issue.code === "screenshare_stale") {
        onWarning?.(issue.message);
      }
    }
  };

  const handleLifecycleEvent = (reason = "visibilitychange") => {
    if (disposed || intentionalClose) return;
    if (reason === "visibilitychange" && readVisibility() !== "visible") return;
    tick();
    if (!iframeConnected()) {
      startNetworkRecovery("iframe_detached");
      return;
    }
    if (state === WATCHDOG_STATES.healthy || !cycleOpen) return;
  };

  listen(api, "audioMuteStatusChanged", (event) => {
    if (disposed) return;
    audioMuted = Boolean(event?.muted);
    onAudioMuteStatusChanged?.(event);
    log("JITSI_AUDIO", { muted: audioMuted });
  }, listeners);

  listen(api, "videoMuteStatusChanged", (event) => {
    if (disposed) return;
    videoMuted = Boolean(event?.muted);
    onVideoMuteStatusChanged?.(event);
    log("JITSI_VIDEO", { muted: videoMuted });
  }, listeners);

  listen(api, "cameraError", (event) => {
    if (disposed) return;
    const classified = classifyMediaError(event, "camera");
    log("JITSI_CAMERA_ERROR", { code: classified.code });
    onWarning?.(classified.message);
    if (classified.code === "track_ended" || classified.code === "device_busy") {
      void recoverTrack("video");
    }
  }, listeners);

  listen(api, "micError", (event) => {
    if (disposed) return;
    const classified = classifyMediaError(event, "mic");
    log("JITSI_MIC_ERROR", { code: classified.code });
    onWarning?.(classified.message);
    if (classified.code === "device_missing" || classified.code === "track_ended") {
      scheduleDeviceSync("micError");
    }
    if (classified.code === "track_ended" || classified.code === "device_busy") {
      void recoverTrack("audio");
    }
  }, listeners);

  listen(api, "deviceListChanged", () => {
    if (disposed) return;
    log("JITSI_DEVICES", { event: "changed" });
    scheduleDeviceSync("deviceListChanged");
    tick();
  }, listeners);

  listen(api, "connectionFailed", (event) => {
    if (disposed) return;
    log("JITSI_CONNECTION_FAILED", { error: event?.error || event?.message || "" });
    startNetworkRecovery("connectionFailed");
  }, listeners);

  listen(api, "conferenceFailed", (event) => {
    if (disposed) return;
    log("JITSI_CONFERENCE_FAILED", { error: event?.error || event?.message || "" });
    startNetworkRecovery("conferenceFailed");
  }, listeners);

  listen(api, "peerConnectionFailure", () => {
    if (disposed) return;
    // One ICE peer connection can fail while the room still works
    // (p2p disabled, extra PCs). Do not flash a lost-connection banner.
    log("JITSI_PEER_CONNECTION_FAILURE", {});
    onConnectionState?.("peer_glitch", "peerConnectionFailure");
    startNetworkRecovery("peerConnectionFailure", { quiet: true });
  }, listeners);

  listen(api, "videoConferenceJoined", (event) => {
    if (disposed) return;
    joinedOnce = true;
    localParticipantId = String(event?.id || "").trim();
    markRecovered("videoConferenceJoined");
  }, listeners);

  listen(api, "dataChannelOpened", () => {
    if (disposed) return;
    onConnectionState?.("joined", "dataChannelOpened");
    if (cycleOpen) markRecovered("dataChannelOpened");
  }, listeners);

  listen(api, "videoConferenceLeft", () => {
    if (disposed || intentionalClose) return;
    startNetworkRecovery("videoConferenceLeft");
  }, listeners);

  listen(api, "readyToClose", () => {
    intentionalClose = true;
    clearGrace();
    cycleOpen = false;
    hardRequestedThisCycle = false;
  }, listeners);

  if (typeof document !== "undefined") {
    listenDom(document, "visibilitychange", () => handleLifecycleEvent("visibilitychange"), domListeners);
  }
  if (typeof window !== "undefined") {
    listenDom(window, "pageshow", () => handleLifecycleEvent("pageshow"), domListeners);
    listenDom(window, "online", () => handleLifecycleEvent("online"), domListeners);
  }

  timer = setInterval(tick, WATCHDOG_INTERVAL_MS);

  return {
    inspect: tick,
    handleLifecycleEvent,
    snapshot: () => ({
      audioMuted,
      videoMuted,
      audioRecoveries,
      videoRecoveries,
      state,
      cycleOpen,
      hardRequestedThisCycle,
      joinedOnce,
      intentionalClose,
      disposed,
    }),
    dispose() {
      disposed = true;
      intentionalClose = true;
      cycleOpen = false;
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      clearGrace();
      clearDeviceTimer();
      for (const [eventName, handler] of listeners) {
        try {
          api.removeListener?.(eventName, handler);
        } catch {
          /* ignore */
        }
      }
      listeners.length = 0;
      for (const [target, eventName, handler] of domListeners) {
        try {
          target.removeEventListener?.(eventName, handler);
        } catch {
          /* ignore */
        }
      }
      domListeners.length = 0;
    },
  };
}
