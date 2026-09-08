/** Stay-on-top for the live call without a second Jitsi session. */

import { reportClientEvent } from "../utils/clientTelemetry";

const PIP_STYLES = `
html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #0f172a; overflow: hidden; }
body { font-family: Inter, system-ui, sans-serif; }
.video-lesson-content--os-pip {
  position: static !important;
  inset: auto !important;
  left: auto !important;
  top: auto !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  transform: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}
`;

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
  return documentPipAvailable() || videoPipAvailable();
}

/** True only when the live Jitsi video can actually enter Picture-in-Picture. */
export function liveCallVideoPipAvailable(iframe) {
  return videoPipAvailable() && Boolean(findSameOriginCallVideo(iframe));
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

function copyStyleSheets(fromDoc, toDoc) {
  try {
    if (fromDoc.adoptedStyleSheets?.length && toDoc.adoptedStyleSheets !== undefined) {
      toDoc.adoptedStyleSheets = [...fromDoc.adoptedStyleSheets];
    }
  } catch {
    /* ignore */
  }
  try {
    for (const node of fromDoc.querySelectorAll("link[rel=\"stylesheet\"], style")) {
      try {
        toDoc.head.appendChild(node.cloneNode(true));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  try {
    const extra = toDoc.createElement("style");
    extra.textContent = PIP_STYLES;
    toDoc.head.appendChild(extra);
  } catch {
    /* ignore */
  }
}

function restoreHost(host, parent, next) {
  if (!host) return;
  host.classList.remove("video-lesson-content--os-pip");
  if (!parent) return;
  try {
    if (next && next.parentNode === parent) parent.insertBefore(host, next);
    else parent.appendChild(host);
  } catch {
    /* ignore */
  }
}

async function openDocumentCallPip(host) {
  if (!documentPipAvailable() || !host) return { ok: false, mode: "document-pip" };
  const rect = typeof host.getBoundingClientRect === "function" ? host.getBoundingClientRect() : {};
  const width = Math.max(280, Math.round(Number(rect.width) || 360));
  const height = Math.max(200, Math.round(Number(rect.height) || 280));
  const pipWindow = await window.documentPictureInPicture.requestWindow({
    width,
    height,
    disallowReturnToOpener: false,
  });
  copyStyleSheets(document, pipWindow.document);
  pipWindow.document.body.className = "video-lesson-call-pip-body";
  const parent = host.parentNode;
  const next = host.nextSibling;
  host.classList.add("video-lesson-content--os-pip");
  pipWindow.document.body.appendChild(host);
  const restore = () => restoreHost(host, parent, next);
  pipWindow.addEventListener("pagehide", restore, { once: true });
  return { ok: true, mode: "document-pip", pipWindow, restore };
}

/**
 * Open a floating call surface.
 * Prefers Document Picture-in-Picture (the mini call window above other apps).
 * Falls back to video Picture-in-Picture when the live track is same-origin.
 */
export async function requestCallStayOnTop({ iframe = null, host = null } = {}) {
  diag("pip_requested", { video: videoPipAvailable() ? 1 : 0, doc: documentPipAvailable() ? 1 : 0 });

  if (documentPipAvailable() && host) {
    try {
      const result = await openDocumentCallPip(host);
      if (result.ok) {
        diag("pip_opened", { mode: "document-pip" });
        return result;
      }
    } catch {
      diag("pip_failed", { mode: "document-pip" });
    }
  }

  if (!videoPipAvailable()) {
    diag("pip_failed", { mode: "unsupported" });
    return { ok: false, mode: "unsupported" };
  }
  const video = findSameOriginCallVideo(iframe);
  if (!video) {
    diag("pip_failed", { mode: "no-video" });
    return { ok: false, mode: "no-video" };
  }
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
    return { ok: false, mode: "video-pip" };
  }
}

export async function closeCallStayOnTop({ pipWindow = null, restore = null } = {}) {
  try {
    restore?.();
  } catch {
    /* ignore */
  }
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
