/**
 * Browser Picture-in-Picture for the existing remote participant video.
 * Presentation-only: reuses Jitsi's MediaStreamTrack, never a second call.
 */

import { reportClientEvent } from "../utils/clientTelemetry";
import {
  bindTrackToPresentationStream,
  findRemoteCameraVideo,
  getLiveVideoTrack,
  participantInitials,
} from "./participantVideo";

export const PARTICIPANT_PIP_MESSAGE = "itflux:participant-pip";
export const PARTICIPANT_PIP_RESULT = "itflux:participant-pip-result";

function diag(event, extra = {}) {
  try {
    reportClientEvent(event, extra);
  } catch {
    /* ignore */
  }
}

export function videoPipAvailable() {
  if (typeof document === "undefined") return false;
  if (document.pictureInPictureEnabled === false) return false;
  return typeof HTMLVideoElement !== "undefined"
    && typeof HTMLVideoElement.prototype.requestPictureInPicture === "function";
}

export function ensureIframePictureInPictureAllow(iframe) {
  if (!iframe) return iframe;
  try {
    const current = String(iframe.allow || iframe.getAttribute?.("allow") || "");
    if (/picture-in-picture/i.test(current)) return iframe;
    const next = current ? `${current}; picture-in-picture` : "picture-in-picture";
    iframe.allow = next;
    iframe.setAttribute?.("allow", next);
  } catch {
    /* ignore */
  }
  return iframe;
}

function iframeOrigin(iframe) {
  try {
    const src = iframe?.src || iframe?.getAttribute?.("src") || "";
    if (!src) return "";
    return new URL(src, typeof window !== "undefined" ? window.location.href : "https://localhost").origin;
  } catch {
    return "";
  }
}

export function requestIframeParticipantPip(iframe, payload = {}) {
  if (!iframe?.contentWindow) return false;
  const origin = iframeOrigin(iframe) || "*";
  try {
    iframe.contentWindow.postMessage({
      type: PARTICIPANT_PIP_MESSAGE,
      ...payload,
    }, origin);
    return true;
  } catch {
    return false;
  }
}

function drawAvatarFrame(canvas, { name = "", initials = "?" } = {}) {
  if (!canvas) return;
  const width = canvas.width || 640;
  const height = canvas.height || 360;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, width, height);
  const radius = Math.round(Math.min(width, height) * 0.18);
  ctx.beginPath();
  ctx.arc(width / 2, height * 0.42, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#334155";
  ctx.fill();
  ctx.fillStyle = "#f8fafc";
  ctx.font = `600 ${Math.round(radius * 0.9)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(initials || "?").slice(0, 2), width / 2, height * 0.42);
  ctx.font = `500 ${Math.round(height * 0.07)}px Inter, system-ui, sans-serif`;
  ctx.fillText(String(name || "Участник").slice(0, 28), width / 2, height * 0.72);
}

function emptySnapshot() {
  return {
    mode: "idle",
    supported: videoPipAvailable(),
    active: false,
    needsGesture: false,
    reason: "",
    participantId: "",
  };
}

/**
 * One session per lesson page. Safe across share → stop → share.
 * Does not stop remote MediaStreamTracks.
 */
export function createParticipantPipController({ onState } = {}) {
  let disposed = false;
  let presentationVideo = null;
  let presentationStream = null;
  let avatarCanvas = null;
  let avatarRaf = 0;
  let usingAvatar = false;
  let openedForScreenShare = false;
  let userKeptPip = false;
  let screenShareActive = false;
  let needsGesture = false;
  let lastParticipantId = "";
  let lastIframe = null;
  let boundTrack = null;
  const listeners = [];

  const emit = (extra = {}) => {
    if (disposed) return emptySnapshot();
    const active = isPipActive();
    const snap = {
      mode: active ? "pip" : "idle",
      supported: videoPipAvailable(),
      active,
      needsGesture,
      reason: extra.reason || "",
      participantId: lastParticipantId,
      screenShareActive,
    };
    onState?.(snap);
    return snap;
  };

  const addListener = (target, eventName, handler, options) => {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(eventName, handler, options);
    listeners.push(() => {
      try {
        target.removeEventListener(eventName, handler, options);
      } catch {
        /* ignore */
      }
    });
  };

  const playPresentation = () => {
    try {
      const playing = presentationVideo?.play?.();
      if (playing && typeof playing.catch === "function") {
        void playing.catch(() => {});
      }
    } catch {
      /* ignore */
    }
  };

  const isPipActive = () => {
    if (typeof document === "undefined") return false;
    if (presentationVideo && document.pictureInPictureElement === presentationVideo) return true;
    return Boolean(document.pictureInPictureElement);
  };

  const stopAvatarLoop = () => {
    if (avatarRaf) {
      window.cancelAnimationFrame(avatarRaf);
      avatarRaf = 0;
    }
  };

  const releaseBoundTrack = ({ stopIfOwned = false } = {}) => {
    if (!presentationStream || !boundTrack) {
      boundTrack = null;
      return;
    }
    const track = boundTrack;
    try {
      presentationStream.removeTrack(track);
    } catch {
      /* ignore */
    }
    if (stopIfOwned && usingAvatar) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    boundTrack = null;
  };

  const ensurePresentationVideo = () => {
    if (presentationVideo) return presentationVideo;
    presentationVideo = document.createElement("video");
    presentationVideo.setAttribute("playsinline", "true");
    presentationVideo.setAttribute("webkit-playsinline", "true");
    presentationVideo.muted = true;
    presentationVideo.autoplay = true;
    presentationVideo.playsInline = true;
    presentationVideo.disablePictureInPicture = false;
    presentationVideo.setAttribute("aria-hidden", "true");
    presentationVideo.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0;z-index:-1";
    if ("autoPictureInPicture" in presentationVideo) {
      try {
        presentationVideo.autoPictureInPicture = true;
      } catch {
        /* ignore */
      }
    }
    presentationStream = new MediaStream();
    presentationVideo.srcObject = presentationStream;
    document.body.appendChild(presentationVideo);
    addListener(presentationVideo, "enterpictureinpicture", () => {
      needsGesture = false;
      emit({ reason: "enterpictureinpicture" });
    });
    addListener(presentationVideo, "leavepictureinpicture", () => {
      emit({ reason: "leavepictureinpicture" });
    });
    playPresentation();
    return presentationVideo;
  };

  const ensureAvatarCanvas = () => {
    if (avatarCanvas) return avatarCanvas;
    avatarCanvas = document.createElement("canvas");
    avatarCanvas.width = 640;
    avatarCanvas.height = 360;
    return avatarCanvas;
  };

  const bindCameraTrack = (track) => {
    ensurePresentationVideo();
    if (usingAvatar) releaseBoundTrack({ stopIfOwned: true });
    usingAvatar = false;
    stopAvatarLoop();
    bindTrackToPresentationStream(presentationStream, track);
    boundTrack = track || null;
    playPresentation();
  };

  const bindAvatar = (participant) => {
    ensurePresentationVideo();
    const canvas = ensureAvatarCanvas();
    const name = participant?.displayName || "Участник";
    const initials = participantInitials(name);
    drawAvatarFrame(canvas, { name, initials });
    let avatarTrack = null;
    try {
      avatarTrack = canvas.captureStream?.(1)?.getVideoTracks?.()?.[0] || null;
    } catch {
      avatarTrack = null;
    }
    if (!avatarTrack) return false;
    if (boundTrack && boundTrack !== avatarTrack) {
      releaseBoundTrack({ stopIfOwned: usingAvatar });
    }
    usingAvatar = true;
    bindTrackToPresentationStream(presentationStream, avatarTrack);
    boundTrack = avatarTrack;
    playPresentation();
    return true;
  };

  const syncPresentation = ({ iframe, participant, localId } = {}) => {
    if (disposed) return { video: null, track: null, cameraOff: false, sameOrigin: false };
    if (iframe) lastIframe = iframe;
    lastParticipantId = participant?.id || "";
    const cameraOff = Boolean(participant) && participant.videoMuted === true;
    const remoteVideo = findRemoteCameraVideo(iframe, {
      localId,
      participantId: participant?.id || "",
    });
    const track = getLiveVideoTrack(remoteVideo);
    if (track && !cameraOff) {
      if (boundTrack !== track || usingAvatar) bindCameraTrack(track);
      return {
        video: presentationVideo,
        sourceVideo: remoteVideo,
        track,
        cameraOff: false,
        sameOrigin: true,
      };
    }
    if (cameraOff || !participant) {
      bindAvatar(participant || { displayName: "Участник" });
      return {
        video: presentationVideo,
        sourceVideo: remoteVideo,
        track: null,
        cameraOff: true,
        sameOrigin: Boolean(remoteVideo),
      };
    }
    return {
      video: presentationVideo,
      sourceVideo: remoteVideo,
      track: null,
      cameraOff: false,
      sameOrigin: Boolean(remoteVideo),
    };
  };

  const requestLocalPip = async (video) => {
    if (!videoPipAvailable() || !video) {
      return { ok: false, reason: videoPipAvailable() ? "no-video" : "unsupported" };
    }
    if (video.disablePictureInPicture) {
      return { ok: false, reason: "disabled" };
    }
    try {
      if (typeof document !== "undefined" && document.pictureInPictureElement === video) {
        needsGesture = false;
        return { ok: true, already: true };
      }
      await video.requestPictureInPicture();
      needsGesture = false;
      diag("pip_opened", { mode: "video-pip" });
      return { ok: true };
    } catch (error) {
      const name = error?.name || "";
      const reason = name === "NotAllowedError" ? "blocked" : "video-pip";
      diag("pip_failed", { mode: "video-pip", reason });
      return { ok: false, reason };
    }
  };

  const requestCrossOriginPip = (iframe, participantId) => {
    if (!iframe) return false;
    return requestIframeParticipantPip(iframe, {
      action: "request",
      participantId: participantId || "",
    });
  };

  const onWindowMessage = (event) => {
    const data = event?.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== PARTICIPANT_PIP_RESULT) return;
    if (data.action === "left") {
      emit({ reason: "iframe-left" });
      return;
    }
    if (data.ok) {
      needsGesture = false;
      emit({ reason: "iframe-entered" });
      return;
    }
    if (data.reason === "blocked") needsGesture = true;
    emit({ reason: data.reason || "iframe-failed" });
  };

  if (typeof window !== "undefined") {
    addListener(window, "message", onWindowMessage);
  }

  const requestPip = async ({
    iframe = null,
    participant = null,
    localId = "",
    userGesture = false,
    forScreenShare = false,
  } = {}) => {
    if (disposed) return { ok: false, reason: "disposed" };
    diag("pip_requested", { video: videoPipAvailable() ? 1 : 0 });
    if (userGesture) userKeptPip = true;
    if (forScreenShare && !isPipActive()) openedForScreenShare = true;

    if (!videoPipAvailable()) {
      needsGesture = false;
      emit({ reason: "unsupported" });
      return { ok: false, reason: "unsupported" };
    }

    const synced = syncPresentation({ iframe, participant, localId });
    if (!synced.sameOrigin && !synced.cameraOff) {
      const posted = requestCrossOriginPip(iframe, participant?.id || "");
      if (posted) {
        needsGesture = !userGesture;
        emit({ reason: "iframe-requested" });
        return { ok: false, reason: "iframe-requested", pending: true };
      }
    }

    const localResult = await requestLocalPip(synced.video);
    if (localResult.ok) {
      emit({ reason: localResult.already ? "already" : "opened" });
      return localResult;
    }

    if (!synced.sameOrigin) {
      const posted = requestCrossOriginPip(iframe, participant?.id || "");
      if (posted) {
        needsGesture = localResult.reason === "blocked";
        emit({ reason: "iframe-requested" });
        return { ok: false, reason: "iframe-requested", pending: true };
      }
    }

    if (localResult.reason === "blocked" || localResult.reason === "no-video") {
      needsGesture = true;
    }
    emit({ reason: localResult.reason });
    return localResult;
  };

  const exitPip = async ({ force = false } = {}) => {
    if (disposed) return;
    if (!force && userKeptPip && !openedForScreenShare) return;
    try {
      if (typeof document !== "undefined" && document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
    } catch {
      /* ignore */
    }
    try {
      requestIframeParticipantPip(lastIframe, { action: "exit" });
    } catch {
      /* ignore */
    }
    emit({ reason: "exit" });
  };

  return {
    snapshot: () => emit(),
    isActive: isPipActive,
    syncPresentation,
    async onScreenShareChanged(active, context = {}) {
      const wasActive = screenShareActive;
      screenShareActive = Boolean(active);
      if (screenShareActive && !wasActive) {
        if (!isPipActive()) {
          openedForScreenShare = true;
          userKeptPip = false;
          needsGesture = false;
        }
        const result = await requestPip({ ...context, forScreenShare: true });
        if (!result.ok && result.reason === "blocked") needsGesture = true;
        if (!result.ok && result.reason === "unsupported") needsGesture = false;
        emit({ reason: result.reason || "share-start" });
        return result;
      }
      if (!screenShareActive && wasActive) {
        if (openedForScreenShare && !userKeptPip) {
          await exitPip({ force: true });
        }
        openedForScreenShare = false;
        needsGesture = false;
        emit({ reason: "share-stop" });
      }
      return emit();
    },
    requestPip,
    async toggle(context = {}) {
      if (isPipActive()) {
        userKeptPip = false;
        openedForScreenShare = false;
        await exitPip({ force: true });
        return { ok: true, closed: true };
      }
      return requestPip({ ...context, userGesture: true });
    },
    markUserKept() {
      userKeptPip = true;
    },
    async onParticipantLeft() {
      lastParticipantId = "";
      boundTrack = null;
      if (isPipActive()) await exitPip({ force: true });
      emit({ reason: "participant-left" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopAvatarLoop();
      try {
        if (typeof document !== "undefined" && presentationVideo && document.pictureInPictureElement === presentationVideo) {
          void document.exitPictureInPicture();
        }
      } catch {
        /* ignore */
      }
      for (const remove of listeners) remove();
      listeners.length = 0;
      if (presentationStream) {
        releaseBoundTrack({ stopIfOwned: usingAvatar });
        for (const track of presentationStream.getTracks()) {
          try {
            presentationStream.removeTrack(track);
          } catch {
            /* ignore */
          }
        }
      }
      if (presentationVideo?.parentNode) {
        try {
          presentationVideo.srcObject = null;
        } catch {
          /* ignore */
        }
        try {
          presentationVideo.parentNode.removeChild(presentationVideo);
        } catch {
          /* ignore */
        }
      }
      presentationVideo = null;
      presentationStream = null;
      avatarCanvas = null;
      boundTrack = null;
      onState?.(emptySnapshot());
    },
  };
}
