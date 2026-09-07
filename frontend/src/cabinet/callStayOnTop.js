/** Stay-on-top for the live call without a second Jitsi session. */

import { reportClientEvent } from "../utils/clientTelemetry";

export function videoPipAvailable() {
  if (typeof document === "undefined") return false;
  if (document.pictureInPictureEnabled === false) return false;
  return typeof HTMLVideoElement !== "undefined"
    && typeof HTMLVideoElement.prototype.requestPictureInPicture === "function";
}

export function documentPipAvailable() {
  return typeof window !== "undefined"
    && Boolean(window.documentPictureInPicture)
    && typeof window.documentPictureInPicture.requestWindow === "function";
}

export function callStayOnTopAvailable() {
  return videoPipAvailable() || documentPipAvailable();
}

/**
 * Same-origin Jitsi iframe only. Cross-origin access throws and returns null.
 * Never clones or moves the iframe.
 */
export function findSameOriginCallVideo(iframe) {
  if (!iframe) return null;
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return null;
    const videos = [...doc.querySelectorAll("video")];
    const usable = videos.filter((video) => {
      if (!video || video.ended) return false;
      const stream = video.srcObject;
      const hasStream = Boolean(stream && typeof stream.getTracks === "function" && stream.getTracks().length);
      return hasStream || Number(video.readyState) >= 2;
    });
    usable.sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight));
    return usable[0] || null;
  } catch {
    return null;
  }
}

function diag(event, extra = {}) {
  try {
    reportClientEvent(event, extra);
  } catch {
    /* ignore */
  }
}

/**
 * Open a floating call surface using the existing video element.
 * Does not move/copy the Jitsi iframe and does not rejoin the conference.
 */
export async function requestCallStayOnTop({ iframe = null } = {}) {
  diag("pip_requested", { video: videoPipAvailable() ? 1 : 0, doc: documentPipAvailable() ? 1 : 0 });
  if (videoPipAvailable()) {
    const video = findSameOriginCallVideo(iframe);
    if (video) {
      try {
        if (typeof document !== "undefined" && document.pictureInPictureElement === video) {
          diag("pip_opened", { mode: "video-pip", already: 1 });
          return { ok: true, mode: "video-pip", video };
        }
        await video.requestPictureInPicture();
        diag("pip_opened", { mode: "video-pip" });
        return { ok: true, mode: "video-pip", video };
      } catch {
        diag("pip_failed", { mode: "video-pip" });
      }
    } else {
      diag("pip_failed", { mode: "video-pip", reason: "no-video" });
    }
  }

  if (documentPipAvailable()) {
    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 320,
        height: 72,
        disallowReturnToOpener: false,
      });
      pipWindow.document.body.style.cssText = "margin:0;font:600 13px/1.3 Inter,system-ui,sans-serif;padding:12px 14px;background:#0f172a;color:#f8fafc;";
      pipWindow.document.body.textContent = "Звонок продолжается. Вернитесь в окно урока, чтобы увидеть участника.";
      diag("pip_opened", { mode: "document-pip" });
      return { ok: true, mode: "document-pip", pipWindow };
    } catch {
      diag("pip_failed", { mode: "document-pip" });
    }
  }

  return { ok: false, mode: "unsupported" };
}

export async function closeCallStayOnTop({ pipWindow = null } = {}) {
  try {
    if (pipWindow && !pipWindow.closed) pipWindow.close();
  } catch {
    /* ignore */
  }
  try {
    if (typeof document !== "undefined" && document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    }
  } catch {
    /* ignore */
  }
  diag("pip_closed");
}
