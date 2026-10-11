/**
 * Этап, на котором остановился звонок.
 * Браузер не отдаёт код DNS отдельно от обрыва HTTPS/TCP: оба выглядят как сбой загрузки.
 * Наличие iframe и videoConferenceJoined не считаются работающим медиа.
 */

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
  if (
    normalized === "jitsi_script"
    || normalized === "jitsi_script_timeout"
    || (!scriptLoaded && !iframeCreated && !conferenceJoined)
  ) {
    return { ...base, stage: "script", failureClass: "dns_or_https", eventType: "connection_failed" };
  }
  if (!iframeCreated && !conferenceJoined) {
    return { ...base, stage: "iframe", failureClass: "iframe", eventType: "connection_failed" };
  }
  const signaling = normalized === "connectionFailed"
    || normalized === "jitsi_connection_failed"
    || normalized === "jitsi_join_timeout"
    || normalized === "join_timeout";
  const ice = normalized === "peerConnectionFailure"
    || normalized === "jitsi_conference_failed"
    || normalized === "conferenceFailed";
  if (signaling) {
    return {
      ...base,
      stage: conferenceJoined || mediaChannelOpen ? "interrupted" : "signaling",
      failureClass: "signaling",
      eventType: "connection_failed",
    };
  }
  if (ice) {
    return {
      ...base,
      stage: mediaChannelOpen ? "interrupted" : "ice",
      failureClass: "ice",
      eventType: "peer_connection_failure",
      mediaConfirmed: false,
    };
  }
  if (conferenceJoined && !mediaChannelOpen) {
    return { ...base, stage: "no_media", failureClass: "no_media", eventType: "peer_connection_failure" };
  }
  if (normalized === "permission_denied") {
    return { ...base, stage: "device", failureClass: "device", eventType: "connection_failed" };
  }
  return { ...base, stage: "unknown", failureClass: "unknown", eventType: "connection_failed" };
}
