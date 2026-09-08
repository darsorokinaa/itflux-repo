/** Detect a real Jitsi desktop/screen-share track. Camera / largeVideo is not enough. */

import { GEOMETRY_STATUS, asClientRect, geometryBelongsToSession } from "./jitsiGeometry";
import { SHARE_SURFACE_KIND } from "./jitsiDesktopSurface";

const DESKTOP_TYPES = new Set(["desktop", "screen", "window", "screenshare", "screen-share"]);

export function isDesktopVideoType(value) {
  return DESKTOP_TYPES.has(String(value || "").trim().toLowerCase());
}

export function readJitsiTrackVideoType(trackRecord) {
  if (!trackRecord || typeof trackRecord !== "object") return "";
  if (trackRecord.videoType) return trackRecord.videoType;
  const jt = trackRecord.jitsiTrack || trackRecord.track;
  if (!jt) return "";
  try {
    if (typeof jt.getVideoType === "function") return jt.getVideoType() || "";
  } catch {
    /* ignore */
  }
  return jt.videoType || "";
}

function jitsiTrackMediaEnded(trackRecord) {
  const jt = trackRecord?.jitsiTrack || trackRecord?.track;
  if (!jt) return Boolean(trackRecord?.ended);
  try {
    if (typeof jt.isEnded === "function" && jt.isEnded()) return true;
    const media = typeof jt.getTrack === "function" ? jt.getTrack() : jt.track;
    if (media && media.readyState === "ended") return true;
  } catch {
    /* ignore */
  }
  return Boolean(trackRecord?.ended);
}

function jitsiTrackMuted(trackRecord) {
  if (trackRecord?.muted) return true;
  const jt = trackRecord?.jitsiTrack || trackRecord?.track;
  if (!jt) return false;
  try {
    if (typeof jt.isMuted === "function") return Boolean(jt.isMuted());
  } catch {
    /* ignore */
  }
  return Boolean(jt.muted);
}

export function isJitsiDesktopTrack(trackRecord) {
  if (!trackRecord || typeof trackRecord !== "object") return false;
  if (jitsiTrackMuted(trackRecord) || jitsiTrackMediaEnded(trackRecord)) return false;
  const mediaType = String(trackRecord.mediaType || trackRecord.type || "").toLowerCase();
  if (mediaType === "audio") return false;
  return isDesktopVideoType(readJitsiTrackVideoType(trackRecord));
}

export function listJitsiTracks(reduxState) {
  const raw = reduxState?.["features/base/tracks"];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw);
  return [];
}

export function listJitsiDesktopTracks(reduxState) {
  return listJitsiTracks(reduxState).filter(isJitsiDesktopTrack);
}

export function desktopOwnerId(trackRecord) {
  const id = trackRecord?.participantId
    || trackRecord?.participantID
    || trackRecord?.jitsiTrack?.getParticipantId?.();
  return id == null ? "" : String(id);
}

/**
 * Only a desktop/screen-share track counts. Never large-video / active speaker.
 * If expectedPresenterId is set, the desktop owner must match; otherwise fail closed.
 */
export function selectJitsiDesktopTrack(reduxState, expectedPresenterId = "") {
  const tracks = listJitsiDesktopTracks(reduxState);
  if (!tracks.length) return null;
  const expected = String(expectedPresenterId || "");
  if (!expected) return tracks[0];
  return tracks.find((track) => desktopOwnerId(track) === expected) || null;
}

export function hasDesktopTrackMismatch(reduxState, expectedPresenterId = "") {
  const expected = String(expectedPresenterId || "");
  if (!expected) return false;
  const anyDesktop = listJitsiDesktopTracks(reduxState);
  if (!anyDesktop.length) return false;
  return !selectJitsiDesktopTrack(reduxState, expected);
}

export function isExactShareGeometryPayload(payload, session = {}) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.present !== true) return false;
  if (payload.isDesktopTrack !== true && payload.desktopTrackDetected !== true) return false;
  if (payload.stageSurfaceFound !== true && payload.surfaceKind !== SHARE_SURFACE_KIND.STAGE) return false;
  if (payload.surfaceKind && payload.surfaceKind !== SHARE_SURFACE_KIND.STAGE) return false;
  if (!geometryBelongsToSession(payload, session)) return false;
  const vw = Number(payload.videoWidth);
  const vh = Number(payload.videoHeight);
  if (!(vw > 0 && vh > 0 && Number.isFinite(vw) && Number.isFinite(vh))) return false;
  const content = asClientRect(payload.contentRect);
  if (!content) return false;
  return true;
}

/**
 * Apply one trusted, session-checked geometry message.
 * Non-exact messages revoke a previous exact status (stop-share / camera takeover).
 */
export function reduceShareGeometryMessage(prev, payload, session = {}) {
  const previous = prev || { status: GEOMETRY_STATUS.WAITING, payload: null };
  if (!geometryBelongsToSession(payload, session)) return previous;
  if (isExactShareGeometryPayload(payload, session)) {
    return { status: GEOMETRY_STATUS.EXACT, payload };
  }
  if (previous.status === GEOMETRY_STATUS.EXACT) {
    return { status: GEOMETRY_STATUS.WAITING, payload: null };
  }
  return {
    status: previous.status || GEOMETRY_STATUS.WAITING,
    payload: null,
  };
}
