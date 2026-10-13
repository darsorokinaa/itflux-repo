/**
 * Этап, на котором остановился звонок.
 * Браузер не отдаёт код DNS отдельно от обрыва HTTPS/TCP: оба выглядят как сбой загрузки скрипта.
 * Таймаут, обрыв XMPP, ICE и отказ Safari запросить камеру этим классом не являются.
 * Наличие iframe и videoConferenceJoined не считаются работающим медиа.
 */

const SIGNALING_CODES = new Set([
  "connectionFailed",
  "jitsi_connection_failed",
  "jitsi_join_timeout",
  "join_timeout",
]);

const ICE_CODES = new Set([
  "peerConnectionFailure",
  "jitsi_conference_failed",
  "conferenceFailed",
]);

const DEVICE_CODES = new Set([
  "permission_denied",
  "NotAllowedError",
  "NotFoundError",
  "InvalidStateError",
]);

function isCaptureGestureFailure(value) {
  return /user gesture handler|Activating capture/i.test(String(value || ""));
}

export function joinMediaIntent({
  storedMic = null,
  storedCam = null,
  recovering = false,
  intendedMicOn = false,
  intendedCamOn = false,
} = {}) {
  const micOn = storedMic === true || (recovering && intendedMicOn === true);
  const camOn = storedCam === true || (recovering && intendedCamOn === true);
  return {
    micOn,
    camOn,
    startWithAudioMuted: !micOn,
    startWithVideoMuted: !camOn,
  };
}

export function classifyJoinStop({
  online = true,
  scriptLoaded = false,
  iframeCreated = false,
  conferenceJoined = false,
  mediaChannelOpen = false,
  code = "",
  eventName = "",
} = {}) {
  const base = {
    mediaConfirmed: false,
    dnsSeparated: false,
    httpsSeparated: false,
  };
  if (!online) {
    return { ...base, stage: "offline", failureClass: "offline", eventType: "connection_failed" };
  }
  const normalized = String(code || eventName || "");
  if (normalized === "jitsi_auth" || normalized === "jwt_missing" || normalized === "jwt_config") {
    return { ...base, stage: "auth", failureClass: "auth", eventType: "connection_failed" };
  }
  if (normalized === "jitsi_script_timeout" || normalized === "script_timeout") {
    return { ...base, stage: "script", failureClass: "script_timeout", eventType: "connection_failed" };
  }
  if (DEVICE_CODES.has(normalized) || isCaptureGestureFailure(normalized) || isCaptureGestureFailure(eventName)) {
    return { ...base, stage: "device", failureClass: "device", eventType: "connection_failed" };
  }
  if (SIGNALING_CODES.has(normalized)) {
    return {
      ...base,
      stage: conferenceJoined || mediaChannelOpen ? "interrupted" : "signaling",
      failureClass: "signaling",
      eventType: "connection_failed",
    };
  }
  if (ICE_CODES.has(normalized)) {
    return {
      ...base,
      stage: mediaChannelOpen ? "interrupted" : "ice",
      failureClass: "ice",
      eventType: "peer_connection_failure",
      mediaConfirmed: false,
    };
  }
  if (
    normalized === "jitsi_script"
    || (!normalized && !scriptLoaded && !iframeCreated && !conferenceJoined)
  ) {
    return { ...base, stage: "script", failureClass: "dns_or_https", eventType: "connection_failed" };
  }
  if (!iframeCreated && !conferenceJoined) {
    return { ...base, stage: "iframe", failureClass: "iframe", eventType: "connection_failed" };
  }
  if (conferenceJoined && !mediaChannelOpen) {
    return { ...base, stage: "no_media", failureClass: "no_media", eventType: "peer_connection_failure" };
  }
  return { ...base, stage: "unknown", failureClass: "unknown", eventType: "connection_failed" };
}
