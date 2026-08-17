/** Нормализованные координаты overlay относительно rendered screen-share content. */

export const COORD_SPACE = "screenshare_v1";

export const DEFAULT_CONTENT_WIDTH = 1920;
export const DEFAULT_CONTENT_HEIGHT = 1080;

/** Оценка chrome Jitsi вокруг large video. Не DOM iframe — только inset контейнера. */
export const JITSI_CHROME = {
  desktop: { top: 0, right: 128, bottom: 76, left: 0 },
  compact: { top: 0, right: 0, bottom: 0, left: 0 },
  mobile: { top: 0, right: 0, bottom: 64, left: 0 },
};

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function resolveChromeInsets(containerWidth, containerHeight, { compact = false } = {}) {
  if (compact || containerWidth < 420 || containerHeight < 260) {
    return { ...JITSI_CHROME.compact };
  }
  if (containerWidth < 720) {
    return { ...JITSI_CHROME.mobile };
  }
  const chrome = { ...JITSI_CHROME.desktop };
  if (containerWidth - chrome.right < 240) chrome.right = 0;
  if (containerHeight - chrome.bottom < 160) chrome.bottom = 0;
  return chrome;
}

/**
 * object-fit: contain rectangle of the shared video inside the stage box.
 */
export function getContainedContentRect(stage, videoWidth, videoHeight) {
  const left = Number(stage?.left) || 0;
  const top = Number(stage?.top) || 0;
  const width = Number(stage?.width) || 0;
  const height = Number(stage?.height) || 0;
  const vw = Number(videoWidth) || 0;
  const vh = Number(videoHeight) || 0;
  if (!width || !height) {
    return { left, top, width, height, offsetX: 0, offsetY: 0 };
  }
  if (!vw || !vh) {
    return { left, top, width, height, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(width / vw, height / vh);
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
  };
}

/**
 * Content rectangle of the demonstrated screen inside the host overlay.
 * 1) subtract estimated Jitsi chrome (filmstrip/toolbar)
 * 2) contain-fit the shared video aspect inside the remaining stage
 */
export function computeScreenShareContentRect({
  hostRect,
  contentWidth = DEFAULT_CONTENT_WIDTH,
  contentHeight = DEFAULT_CONTENT_HEIGHT,
  compact = false,
} = {}) {
  const host = {
    left: Number(hostRect?.left) || 0,
    top: Number(hostRect?.top) || 0,
    width: Number(hostRect?.width) || 0,
    height: Number(hostRect?.height) || 0,
  };
  const chrome = resolveChromeInsets(host.width, host.height, { compact });
  const stage = {
    left: host.left + chrome.left,
    top: host.top + chrome.top,
    width: Math.max(0, host.width - chrome.left - chrome.right),
    height: Math.max(0, host.height - chrome.top - chrome.bottom),
  };
  const content = getContainedContentRect(stage, contentWidth, contentHeight);
  return {
    host,
    chrome,
    stage,
    content,
    contentWidth: Number(contentWidth) || DEFAULT_CONTENT_WIDTH,
    contentHeight: Number(contentHeight) || DEFAULT_CONTENT_HEIGHT,
  };
}

export function clientToNormalized(clientX, clientY, contentRect) {
  const w = Number(contentRect?.width) || 0;
  const h = Number(contentRect?.height) || 0;
  if (!w || !h) return null;
  return {
    x: clamp01((Number(clientX) - contentRect.left) / w),
    y: clamp01((Number(clientY) - contentRect.top) / h),
  };
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

export function strokeWidthPx(width, renderedWidth) {
  const w = Number(width);
  const rw = Number(renderedWidth) || 960;
  if (!Number.isFinite(w) || w <= 0) return 3;
  return Math.max(1.5, w * (rw / 960));
}
