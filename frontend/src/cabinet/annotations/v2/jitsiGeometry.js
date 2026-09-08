/** Parent-side mapping of Jitsi iframe screen-share geometry. No chrome guesses. */

export const GEOMETRY_MESSAGE_TYPE = "itflux:screenshare-geometry";
export const GEOMETRY_REQUEST_TYPE = "itflux:screenshare-geometry-request";
export const GEOMETRY_SOURCE = "itflux-jitsi";

export const GEOMETRY_STATUS = Object.freeze({
  IDLE: "idle",
  WAITING: "waiting",
  EXACT: "exact",
  FALLBACK: "fallback",
});

export const GEOMETRY_WAIT_MS = 2500;

export function normalizeJitsiOrigin(domainOrOrigin) {
  const raw = String(domainOrOrigin || "").trim();
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).origin;
  } catch {
    return "";
  }
  return `https://${raw.replace(/\/$/, "")}`;
}

export function asClientRect(rect) {
  if (!rect) return null;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  if (width <= 1 || height <= 1) return null;
  return { left, top, width, height };
}

/**
 * childRect is getBoundingClientRect() inside the iframe (iframe CSS px).
 * iframeRect is the iframe element's getBoundingClientRect() in the parent.
 * viewport is the iframe's innerWidth/innerHeight (posted by the helper).
 */
export function mapIframeRectToParent(iframeRect, childRect, viewport) {
  const frame = asClientRect(iframeRect);
  const child = asClientRect(childRect);
  if (!frame || !child) return null;
  const vw = Number(viewport?.width) || 0;
  const vh = Number(viewport?.height) || 0;
  const scaleX = vw > 0 ? frame.width / vw : 1;
  const scaleY = vh > 0 ? frame.height / vh : 1;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return null;
  }
  return {
    left: frame.left + child.left * scaleX,
    top: frame.top + child.top * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
  };
}

export function isTrustedJitsiGeometryEvent(event, { jitsiOrigin, iframe } = {}) {
  const origin = String(jitsiOrigin || "");
  if (!event || !origin || event.origin !== origin) return false;
  if (iframe?.contentWindow && event.source && event.source !== iframe.contentWindow) return false;
  const data = event.data;
  if (!data || typeof data !== "object") return false;
  if (data.type !== GEOMETRY_MESSAGE_TYPE) return false;
  if (data.source && data.source !== GEOMETRY_SOURCE) return false;
  return true;
}

export function geometryBelongsToSession(payload, {
  shareSessionId = "",
  presenterJitsiId = "",
  epoch = 0,
} = {}) {
  const msgEpoch = Number(payload?.epoch);
  if (Number.isFinite(msgEpoch) && epoch && msgEpoch !== epoch) return false;
  const msgSession = String(payload?.shareSessionId || "");
  const currentSession = String(shareSessionId || "");
  if (msgSession && currentSession && msgSession !== currentSession) return false;
  const msgPid = String(payload?.participantId || "");
  const currentPid = String(presenterJitsiId || "");
  if (msgPid && currentPid && msgPid !== currentPid) return false;
  return true;
}

export function parentRectsFromGeometryPayload(payload, iframeRect) {
  const viewport = {
    width: Number(payload?.iframeViewportWidth) || 0,
    height: Number(payload?.iframeViewportHeight) || 0,
  };
  const video = mapIframeRectToParent(iframeRect, payload?.videoElementRect, viewport);
  const content = mapIframeRectToParent(iframeRect, payload?.contentRect, viewport);
  return { video, content, viewport };
}

export function requestJitsiGeometry(iframe, jitsiOrigin, payload = {}) {
  if (!iframe?.contentWindow || !jitsiOrigin) return false;
  try {
    iframe.contentWindow.postMessage({
      type: GEOMETRY_REQUEST_TYPE,
      ...payload,
    }, jitsiOrigin);
    return true;
  } catch {
    return false;
  }
}

export function subscribeJitsiShareGeometry({
  iframe,
  jitsiOrigin,
  shareSessionId = "",
  presenterJitsiId = "",
  epoch = 0,
  onMessage,
} = {}) {
  const origin = normalizeJitsiOrigin(jitsiOrigin);
  const handler = (event) => {
    if (!isTrustedJitsiGeometryEvent(event, { jitsiOrigin: origin, iframe })) return;
    if (!geometryBelongsToSession(event.data, { shareSessionId, presenterJitsiId, epoch })) return;
    onMessage?.(event.data);
  };
  window.addEventListener("message", handler);
  requestJitsiGeometry(iframe, origin, { shareSessionId, presenterJitsiId, epoch });
  return () => window.removeEventListener("message", handler);
}
