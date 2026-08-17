/** Captured-surface coordinate space: 0..1 of the demonstrated image, not the viewer tile. */

export const COORD_SPACE_CAPTURED_V1 = "captured_surface_v1";

export function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function sourceAspect(sourceWidth, sourceHeight) {
  const w = Number(sourceWidth) || 0;
  const h = Number(sourceHeight) || 0;
  if (!w || !h) return null;
  return w / h;
}

/**
 * object-fit: contain (default for Jitsi VIDEO_LAYOUT_FIT "both") or cover/fill.
 * Returns the rendered image rect in the same coordinate space as `container`.
 */
export function computeContentRect({
  container,
  sourceWidth,
  sourceHeight,
  objectFit = "contain",
} = {}) {
  const left = Number(container?.left) || 0;
  const top = Number(container?.top) || 0;
  const width = Number(container?.width) || 0;
  const height = Number(container?.height) || 0;
  const sw = Number(sourceWidth) || 0;
  const sh = Number(sourceHeight) || 0;
  const fit = String(objectFit || "contain").toLowerCase();
  if (!width || !height) {
    return {
      left, top, width, height, offsetX: 0, offsetY: 0, scale: 1, objectFit: fit, sourceUnknown: true,
    };
  }
  if (!sw || !sh || fit === "fill") {
    return {
      left, top, width, height, offsetX: 0, offsetY: 0, scale: 1, objectFit: fit, sourceUnknown: !sw || !sh,
    };
  }
  const scale = fit === "cover"
    ? Math.max(width / sw, height / sh)
    : Math.min(width / sw, height / sh);
  const renderWidth = sw * scale;
  const renderHeight = sh * scale;
  const offsetX = (width - renderWidth) / 2;
  const offsetY = (height - renderHeight) / 2;
  return {
    left: left + offsetX,
    top: top + offsetY,
    width: renderWidth,
    height: renderHeight,
    offsetX,
    offsetY,
    scale,
    objectFit: fit,
    sourceUnknown: false,
  };
}

export function pointInContentRect(clientX, clientY, contentRect, { epsilon = 0.5 } = {}) {
  const left = Number(contentRect?.left) || 0;
  const top = Number(contentRect?.top) || 0;
  const width = Number(contentRect?.width) || 0;
  const height = Number(contentRect?.height) || 0;
  if (!width || !height) return false;
  return (
    clientX >= left - epsilon
    && clientY >= top - epsilon
    && clientX <= left + width + epsilon
    && clientY <= top + height + epsilon
  );
}

/** Pointer (CSS px) → captured-surface normalized. Outside content → null. */
export function pointerToNormalized(clientX, clientY, contentRect, { clamp = false } = {}) {
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

/** Viewport of a captured browser tab → normalized captured-surface coords. */
export function viewportPointerToNormalized(clientX, clientY, viewport, { clamp = false } = {}) {
  return pointerToNormalized(clientX, clientY, {
    left: Number(viewport?.left) || 0,
    top: Number(viewport?.top) || 0,
    width: Number(viewport?.width) || Number(viewport?.innerWidth) || 0,
    height: Number(viewport?.height) || Number(viewport?.innerHeight) || 0,
  }, { clamp });
}

export function normalizedToClient(nx, ny, contentRect) {
  if (!contentRect) return null;
  return {
    x: contentRect.left + clamp01(nx) * contentRect.width,
    y: contentRect.top + clamp01(ny) * contentRect.height,
  };
}

export function pxWidthToNormalized(px, sourceWidth) {
  const w = Number(sourceWidth) || 0;
  if (!w) return 0.003;
  return Math.max(0.0005, Number(px) / w);
}

export function normalizedWidthToPx(widthNormalized, renderWidth, fallbackPx = 3) {
  const wn = Number(widthNormalized);
  if (Number.isFinite(wn) && wn > 0 && wn < 1) {
    return Math.max(1.25, wn * (Number(renderWidth) || 1));
  }
  const legacy = Number(fallbackPx);
  const rw = Number(renderWidth) || 960;
  return Math.max(1.25, (Number.isFinite(legacy) && legacy > 0 ? legacy : 3) * (rw / 960));
}

export function dimensionsChanged(prev, next, { aspectEpsilon = 0.012 } = {}) {
  const pw = Number(prev?.width) || 0;
  const ph = Number(prev?.height) || 0;
  const nw = Number(next?.width) || 0;
  const nh = Number(next?.height) || 0;
  if (!pw || !ph) return Boolean(nw && nh);
  if (!nw || !nh) return true;
  const prevAspect = pw / ph;
  const nextAspect = nw / nh;
  return Math.abs(prevAspect - nextAspect) > aspectEpsilon
    || Math.abs(pw - nw) / pw > 0.04
    || Math.abs(ph - nh) / ph > 0.04;
}
