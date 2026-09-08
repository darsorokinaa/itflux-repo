/** Нормализованные координаты overlay относительно rendered screen-share content. */

export const COORD_SPACE = "screenshare_v1";

export const DEFAULT_CONTENT_WIDTH = 1920;
export const DEFAULT_CONTENT_HEIGHT = 1080;

export const OBJECT_FIT = Object.freeze({
  CONTAIN: "contain",
  COVER: "cover",
  FILL: "fill",
});

/**
 * Emergency-only Jitsi chrome estimate. NEVER used for drawing coordinates.
 * Production drawing requires the Jitsi geometry bridge (`geometryStatus: "exact"`).
 */
export const JITSI_CHROME_FALLBACK = {
  desktop: { top: 0, right: 0, bottom: 0, left: 0 },
  compact: { top: 0, right: 0, bottom: 0, left: 0 },
  mobile: { top: 0, right: 0, bottom: 0, left: 0 },
  tile: { top: 0, right: 0, bottom: 0, left: 0 },
};

/** @deprecated name kept so stray imports fail loudly in reviews — use JITSI_CHROME_FALLBACK. */
export const JITSI_CHROME = JITSI_CHROME_FALLBACK;

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function resolveObjectFit(value) {
  const fit = String(value || "").toLowerCase();
  if (fit === OBJECT_FIT.COVER) return OBJECT_FIT.COVER;
  if (fit === OBJECT_FIT.FILL) return OBJECT_FIT.FILL;
  return OBJECT_FIT.CONTAIN;
}

export function resolveChromeInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

export function intersectRects(a, b) {
  const left = Math.max(Number(a?.left) || 0, Number(b?.left) || 0);
  const top = Math.max(Number(a?.top) || 0, Number(b?.top) || 0);
  const right = Math.min(
    (Number(a?.left) || 0) + (Number(a?.width) || 0),
    (Number(b?.left) || 0) + (Number(b?.width) || 0),
  );
  const bottom = Math.min(
    (Number(a?.top) || 0) + (Number(a?.height) || 0),
    (Number(b?.top) || 0) + (Number(b?.height) || 0),
  );
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function pointInRect(x, y, rect, { epsilon = 0.5 } = {}) {
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  if (!width || !height) return false;
  return (
    x >= left - epsilon
    && y >= top - epsilon
    && x <= left + width + epsilon
    && y <= top + height + epsilon
  );
}

/**
 * object-fit rectangle of the shared video inside the stage box.
 * contain → letterbox/pillarbox; cover → crop; fill → stretch to stage.
 */
export function getFittedContentRect(stage, videoWidth, videoHeight, objectFit = OBJECT_FIT.CONTAIN) {
  const left = Number(stage?.left) || 0;
  const top = Number(stage?.top) || 0;
  const width = Number(stage?.width) || 0;
  const height = Number(stage?.height) || 0;
  let vw = Number(videoWidth) || 0;
  let vh = Number(videoHeight) || 0;
  const fit = resolveObjectFit(objectFit);
  const sourceUnknown = !vw || !vh;
  if (!width || !height) {
    return {
      left, top, width, height, offsetX: 0, offsetY: 0, scale: 1, objectFit: fit, sourceUnknown: true,
    };
  }
  if (sourceUnknown && fit !== OBJECT_FIT.FILL) {
    vw = DEFAULT_CONTENT_WIDTH;
    vh = DEFAULT_CONTENT_HEIGHT;
  }
  if (!vw || !vh || fit === OBJECT_FIT.FILL) {
    return {
      left, top, width, height, offsetX: 0, offsetY: 0, scale: 1, objectFit: fit, sourceUnknown: true,
    };
  }
  const scale = fit === OBJECT_FIT.COVER
    ? Math.max(width / vw, height / vh)
    : Math.min(width / vw, height / vh);
  const renderedWidth = vw * scale;
  const renderedHeight = vh * scale;
  const offsetX = (width - renderedWidth) / 2;
  const offsetY = (height - renderedHeight) / 2;
  return {
    left: left + offsetX,
    top: top + offsetY,
    width: renderedWidth,
    height: renderedHeight,
    offsetX,
    offsetY,
    scale,
    objectFit: fit,
    sourceUnknown,
  };
}

/** @deprecated use getFittedContentRect — contain is the Jitsi VIDEO_LAYOUT_FIT:"both" default. */
export function getContainedContentRect(stage, videoWidth, videoHeight) {
  return getFittedContentRect(stage, videoWidth, videoHeight, OBJECT_FIT.CONTAIN);
}

/**
 * Content rectangle of the demonstrated screen.
 * Primary path: exactContentRect from the Jitsi geometry bridge (parent client px).
 * Fallback path: contain-fit inside the host with no filmstrip/toolbar guesses.
 * Fallback must not be used for collaborative drawing.
 */
export function computeScreenShareContentRect({
  hostRect,
  contentWidth = 0,
  contentHeight = 0,
  compact = false,
  tileView = false,
  objectFit = OBJECT_FIT.CONTAIN,
  exactContentRect = null,
  exactVideoRect = null,
  geometryStatus = "",
} = {}) {
  const host = {
    left: Number(hostRect?.left) || 0,
    top: Number(hostRect?.top) || 0,
    width: Number(hostRect?.width) || 0,
    height: Number(hostRect?.height) || 0,
  };
  const sourceW = Number(contentWidth) || 0;
  const sourceH = Number(contentHeight) || 0;
  const exact = asExactRect(exactContentRect);
  if (exact) {
    const stage = asExactRect(exactVideoRect) || exact;
    return {
      host,
      chrome: { top: 0, right: 0, bottom: 0, left: 0 },
      stage,
      content: exact,
      visible: exact,
      objectFit: resolveObjectFit(objectFit),
      contentWidth: sourceW,
      contentHeight: sourceH,
      coordSpace: COORD_SPACE,
      geometryStatus: "exact",
      source: "jitsi-bridge",
    };
  }
  void compact;
  void tileView;
  const chrome = resolveChromeInsets();
  const stage = {
    left: host.left + chrome.left,
    top: host.top + chrome.top,
    width: Math.max(0, host.width - chrome.left - chrome.right),
    height: Math.max(0, host.height - chrome.top - chrome.bottom),
  };
  const content = getFittedContentRect(stage, sourceW, sourceH, objectFit);
  const visible = intersectRects(content, stage);
  return {
    host,
    chrome,
    stage,
    content,
    visible,
    objectFit: resolveObjectFit(objectFit),
    contentWidth: sourceW,
    contentHeight: sourceH,
    coordSpace: COORD_SPACE,
    geometryStatus: geometryStatus || "fallback",
    source: "estimated",
  };
}

function asExactRect(rect) {
  const left = Number(rect?.left);
  const top = Number(rect?.top);
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  if (width <= 1 || height <= 1) return null;
  return { left, top, width, height };
}

export function clientToNormalized(clientX, clientY, contentRect, { clamp = false } = {}) {
  const w = Number(contentRect?.width) || 0;
  const h = Number(contentRect?.height) || 0;
  if (!w || !h) return null;
  const x = (Number(clientX) - contentRect.left) / w;
  const y = (Number(clientY) - contentRect.top) / h;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    if (!clamp) return null;
    return { x: clamp01(x), y: clamp01(y) };
  }
  return { x, y };
}

export function pointerToNormalized(clientX, clientY, layout) {
  const visible = layout?.visible || layout?.content;
  if (!pointInRect(clientX, clientY, visible)) return null;
  return clientToNormalized(clientX, clientY, layout?.content);
}

export function normalizedToClient(x, y, contentRect) {
  if (!contentRect) return null;
  return {
    x: contentRect.left + clamp01(x) * contentRect.width,
    y: contentRect.top + clamp01(y) * contentRect.height,
  };
}

export function normalizedToOverlay(x, y, contentRect, hostRect) {
  const client = normalizedToClient(x, y, contentRect);
  if (!client || !hostRect) return null;
  return {
    x: client.x - hostRect.left,
    y: client.y - hostRect.top,
  };
}

/** Map normalized content point into a visible overlay box (cover crop / letterbox). */
export function normalizedToVisible(x, y, contentRect, visibleRect) {
  const client = normalizedToClient(x, y, contentRect);
  if (!client || !visibleRect) return null;
  return {
    x: client.x - visibleRect.left,
    y: client.y - visibleRect.top,
  };
}

export function strokeWidthPx(width, renderedWidth) {
  const w = Number(width);
  const rw = Number(renderedWidth) || 960;
  if (!Number.isFinite(w) || w <= 0) return 3;
  return Math.max(1.5, w * (rw / 960));
}

export function rectsClose(a, b, epsilon = 0.5) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs((a.left || 0) - (b.left || 0)) < epsilon
    && Math.abs((a.top || 0) - (b.top || 0)) < epsilon
    && Math.abs((a.width || 0) - (b.width || 0)) < epsilon
    && Math.abs((a.height || 0) - (b.height || 0)) < epsilon
  );
}
