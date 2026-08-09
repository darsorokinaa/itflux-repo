/** Content-space viewport transform for material annotations (resolution-independent). */

export const COORD_SPACE_CONTENT_V1 = "content_v1";

export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Letterboxed media rect for object-fit: contain inside a container client rect.
 * @param {{ left: number, top: number, width: number, height: number }} containerRect
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 */
export function getContainedMediaRect(containerRect, naturalWidth, naturalHeight) {
  const cw = Number(containerRect?.width) || 0;
  const ch = Number(containerRect?.height) || 0;
  const nw = Number(naturalWidth) || 0;
  const nh = Number(naturalHeight) || 0;
  if (!cw || !ch || !nw || !nh) {
    return {
      left: Number(containerRect?.left) || 0,
      top: Number(containerRect?.top) || 0,
      width: cw,
      height: ch,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      contentWidth: nw || cw,
      contentHeight: nh || ch,
    };
  }
  const scale = Math.min(cw / nw, ch / nh);
  const renderedWidth = nw * scale;
  const renderedHeight = nh * scale;
  const offsetX = (cw - renderedWidth) / 2;
  const offsetY = (ch - renderedHeight) / 2;
  return {
    left: (Number(containerRect.left) || 0) + offsetX,
    top: (Number(containerRect.top) || 0) + offsetY,
    width: renderedWidth,
    height: renderedHeight,
    offsetX,
    offsetY,
    scale,
    contentWidth: nw,
    contentHeight: nh,
  };
}

/**
 * Build transform describing the material content box in client coordinates.
 * Prefer measuring the surface (overlay parent). For images still using object-fit
 * letterboxing inside mediaEl, pass kind: "image" + mediaEl with natural sizes.
 *
 * @returns {null | {
 *   contentWidth: number,
 *   contentHeight: number,
 *   renderedWidth: number,
 *   renderedHeight: number,
 *   offsetX: number,
 *   offsetY: number,
 *   scaleX: number,
 *   scaleY: number,
 *   zoom: number,
 *   rect: { left: number, top: number, width: number, height: number },
 *   surfaceRect: { left: number, top: number, width: number, height: number },
 * }}
 */
export function getMaterialViewportTransform({
  surfaceEl = null,
  mediaEl = null,
  kind = "generic",
  zoom = 1,
} = {}) {
  const surfaceRectRaw = surfaceEl?.getBoundingClientRect?.();
  if (!surfaceRectRaw || !surfaceRectRaw.width || !surfaceRectRaw.height) {
    return null;
  }
  const surfaceRect = {
    left: surfaceRectRaw.left,
    top: surfaceRectRaw.top,
    width: surfaceRectRaw.width,
    height: surfaceRectRaw.height,
  };
  const z = Number(zoom) > 0 ? Number(zoom) : 1;

  let rect = { ...surfaceRect };
  let contentWidth = surfaceRect.width;
  let contentHeight = surfaceRect.height;

  if (kind === "image" && mediaEl) {
    const mediaRectRaw = mediaEl.getBoundingClientRect?.();
    const nw = Number(mediaEl.naturalWidth) || 0;
    const nh = Number(mediaEl.naturalHeight) || 0;
    if (mediaRectRaw && mediaRectRaw.width && mediaRectRaw.height) {
      if (nw && nh) {
        const contained = getContainedMediaRect(
          {
            left: mediaRectRaw.left,
            top: mediaRectRaw.top,
            width: mediaRectRaw.width,
            height: mediaRectRaw.height,
          },
          nw,
          nh,
        );
        // If the img element already hugs the bitmap (no internal letterbox),
        // contained ≈ mediaRect; otherwise use the inner media box.
        const hugsBitmap = Math.abs(contained.width - mediaRectRaw.width) < 1
          && Math.abs(contained.height - mediaRectRaw.height) < 1;
        rect = hugsBitmap
          ? {
            left: mediaRectRaw.left,
            top: mediaRectRaw.top,
            width: mediaRectRaw.width,
            height: mediaRectRaw.height,
          }
          : {
            left: contained.left,
            top: contained.top,
            width: contained.width,
            height: contained.height,
          };
        contentWidth = nw;
        contentHeight = nh;
      } else {
        rect = {
          left: mediaRectRaw.left,
          top: mediaRectRaw.top,
          width: mediaRectRaw.width,
          height: mediaRectRaw.height,
        };
        contentWidth = mediaRectRaw.width;
        contentHeight = mediaRectRaw.height;
      }
    }
  } else if (mediaEl?.getBoundingClientRect) {
    const mediaRectRaw = mediaEl.getBoundingClientRect();
    if (mediaRectRaw.width && mediaRectRaw.height) {
      rect = {
        left: mediaRectRaw.left,
        top: mediaRectRaw.top,
        width: mediaRectRaw.width,
        height: mediaRectRaw.height,
      };
      contentWidth = mediaRectRaw.width;
      contentHeight = mediaRectRaw.height;
    }
  }

  return {
    contentWidth,
    contentHeight,
    renderedWidth: rect.width,
    renderedHeight: rect.height,
    offsetX: rect.left - surfaceRect.left,
    offsetY: rect.top - surfaceRect.top,
    scaleX: contentWidth ? rect.width / contentWidth : 1,
    scaleY: contentHeight ? rect.height / contentHeight : 1,
    zoom: z,
    rect,
    surfaceRect,
  };
}

/** Map pointer client coords → normalized content coords [0,1]. */
export function clientToContentNorm(clientX, clientY, transform) {
  const w = transform?.rect?.width;
  const h = transform?.rect?.height;
  if (!w || !h) return null;
  return {
    x: clamp01((Number(clientX) - transform.rect.left) / w),
    y: clamp01((Number(clientY) - transform.rect.top) / h),
  };
}

/** Map normalized content coords → client coords. */
export function contentNormToClient(nx, ny, transform) {
  if (!transform?.rect) return null;
  return {
    x: transform.rect.left + clamp01(nx) * transform.rect.width,
    y: transform.rect.top + clamp01(ny) * transform.rect.height,
  };
}

/**
 * Visible stage viewport as a normalized content rectangle (0..1 of material surface).
 * Uses intersection of stage client rect with surface client rect.
 */
export function getVisibleContentViewport(stageEl, surfaceEl) {
  const stageRect = stageEl?.getBoundingClientRect?.();
  const surfaceRect = surfaceEl?.getBoundingClientRect?.();
  if (!stageRect?.width || !stageRect?.height || !surfaceRect?.width || !surfaceRect?.height) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  const left = Math.max(stageRect.left, surfaceRect.left);
  const top = Math.max(stageRect.top, surfaceRect.top);
  const right = Math.min(stageRect.right, surfaceRect.right);
  const bottom = Math.min(stageRect.bottom, surfaceRect.bottom);
  if (right <= left || bottom <= top) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  return {
    left: clamp01((left - surfaceRect.left) / surfaceRect.width),
    top: clamp01((top - surfaceRect.top) / surfaceRect.height),
    width: clamp01((right - left) / surfaceRect.width),
    height: clamp01((bottom - top) / surfaceRect.height),
  };
}

export function pxWidthToNorm(px, contentWidth) {
  const w = Number(contentWidth) || 1;
  return Math.max(0.0005, Number(px) / w);
}

export function normWidthToPx(normWidth, renderedWidth, { minPx = 1.5 } = {}) {
  return Math.max(minPx, Number(normWidth) * (Number(renderedWidth) || 1));
}

export function isContentCoordSpace(ann) {
  return ann?.coordSpace === COORD_SPACE_CONTENT_V1 || ann?.coord_space === COORD_SPACE_CONTENT_V1;
}

/** Resolve stroke width to CSS pixels for the current rendered material width. */
export function resolveStrokeWidthPx(ann, renderedWidth) {
  const w = Number(ann?.width);
  if (isContentCoordSpace(ann) && Number.isFinite(w) && w > 0 && w < 1) {
    return normWidthToPx(w, renderedWidth);
  }
  // Legacy screen-ish pixel widths (2, 3, 5, 8, …).
  return Math.max(2, w || 3);
}
