/**
 * Viewport участника для follow / «перейти».
 * centerX/centerY — центр видимой области в координатах сцены Excalidraw.
 * scrollX/scrollY оставляем для совместимости; на приёмнике их не копируем 1:1.
 */

export type TeacherViewport = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  centerX: number;
  centerY: number;
  width?: number;
  height?: number;
  seq: number;
  clientId: string;
  userId?: number | null;
  role?: string;
  displayName?: string;
  updatedAt: number;
};

export function sceneCenterX(scrollX: number, zoom: number, cssWidth: number): number {
  const z = zoom > 0 ? zoom : 1;
  return -scrollX + cssWidth / (2 * z);
}

export function sceneCenterY(scrollY: number, zoom: number, cssHeight: number): number {
  const z = zoom > 0 ? zoom : 1;
  return -scrollY + cssHeight / (2 * z);
}

export function scrollForSceneCenter(center: number, zoom: number, cssSize: number): number {
  const z = zoom > 0 ? zoom : 1;
  return -center + cssSize / (2 * z);
}

export function zoomValueOf(zoom: unknown): number {
  if (typeof zoom === "number" && zoom > 0) return zoom;
  if (zoom && typeof zoom === "object" && typeof (zoom as { value?: number }).value === "number") {
    const v = (zoom as { value: number }).value;
    return v > 0 ? v : 1;
  }
  return 1;
}

export function normalizeViewportPayload(
  raw: Record<string, unknown> | null | undefined,
  clientId: string,
  userId?: number | null,
  role?: string,
): TeacherViewport | null {
  if (!raw || typeof raw !== "object") return null;
  const scrollX = Number(raw.scrollX);
  const scrollY = Number(raw.scrollY);
  const zoom = zoomValueOf(raw.zoom);
  if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY) || !(zoom > 0)) return null;
  const seq = Number(raw.seq);
  const width = Number.isFinite(Number(raw.width)) ? Number(raw.width) : undefined;
  const height = Number.isFinite(Number(raw.height)) ? Number(raw.height) : undefined;
  const rawCenterX = Number(raw.centerX);
  const rawCenterY = Number(raw.centerY);
  const centerX = Number.isFinite(rawCenterX)
    ? rawCenterX
    : (width && width > 0 ? sceneCenterX(scrollX, zoom, width) : -scrollX);
  const centerY = Number.isFinite(rawCenterY)
    ? rawCenterY
    : (height && height > 0 ? sceneCenterY(scrollY, zoom, height) : -scrollY);
  const displayName = typeof raw.displayName === "string"
    ? raw.displayName
    : (typeof raw.display_name === "string" ? raw.display_name : undefined);
  return {
    scrollX,
    scrollY,
    zoom,
    centerX,
    centerY,
    width,
    height,
    seq: Number.isFinite(seq) ? seq : 0,
    clientId,
    userId: userId ?? null,
    role: role || (typeof raw.role === "string" ? raw.role : undefined),
    displayName,
    updatedAt: Date.now(),
  };
}

/** True, если next новее prev (seq → updatedAt). */
export function isNewerViewport(prev: TeacherViewport | null, next: TeacherViewport): boolean {
  if (!prev) return true;
  if (next.clientId && prev.clientId && next.clientId !== prev.clientId) {
    // Сменился учитель-клиент — принимаем.
    return true;
  }
  if (next.seq !== prev.seq) return next.seq > prev.seq;
  return next.updatedAt >= prev.updatedAt;
}

export function viewportAppStatePatch(
  vp: TeacherViewport,
  receiver?: { width?: number; height?: number } | null,
): Record<string, unknown> {
  const zoom = vp.zoom > 0 ? vp.zoom : 1;
  const rw = Number(receiver?.width);
  const rh = Number(receiver?.height);
  if (rw > 8 && rh > 8 && Number.isFinite(vp.centerX) && Number.isFinite(vp.centerY)) {
    return {
      scrollX: scrollForSceneCenter(vp.centerX, zoom, rw),
      scrollY: scrollForSceneCenter(vp.centerY, zoom, rh),
      zoom: { value: zoom },
    };
  }
  return {
    scrollX: vp.scrollX,
    scrollY: vp.scrollY,
    zoom: { value: zoom },
  };
}

/**
 * Ручной pan/zoom: отклонение центра сцены от цели follow.
 * Не сравниваем scrollX 1:1 — у устройств разный размер viewport.
 */
export function viewportDriftTooFar(
  local: { scrollX?: unknown; scrollY?: unknown; zoom?: unknown; width?: unknown; height?: unknown },
  target: TeacherViewport,
  opts: { scenePx?: number; zoomRatio?: number } = {},
): boolean {
  const sceneTol = opts.scenePx ?? 80;
  const zoomTol = opts.zoomRatio ?? 0.06;
  const localCenter = sceneCenterFromAppState(local);
  if (Math.abs(localCenter.centerX - target.centerX) > sceneTol) return true;
  if (Math.abs(localCenter.centerY - target.centerY) > sceneTol) return true;
  if (Math.abs(localCenter.zoom - target.zoom) / Math.max(target.zoom, 0.01) > zoomTol) return true;
  return false;
}

export type SceneViewportRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  sceneWidth: number;
  sceneHeight: number;
  cssWidth: number;
  cssHeight: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
};

/**
 * Видимая область холста в координатах сцены Excalidraw.
 * sceneX = cssX / zoom - scrollX (как pointer → scene в BoardExcalidrawCanvas).
 * Если appState.width/height ещё 0 после file picker — берём fallbackSize.
 */
export function sceneViewportRect(
  appState: Record<string, unknown> | null | undefined,
  fallbackSize?: { width?: number; height?: number } | null,
): SceneViewportRect {
  const zoom = zoomValueOf(appState?.zoom);
  const scrollX = Number(appState?.scrollX);
  const scrollY = Number(appState?.scrollY);
  const sx = Number.isFinite(scrollX) ? scrollX : 0;
  const sy = Number.isFinite(scrollY) ? scrollY : 0;
  const stateW = Number(appState?.width);
  const stateH = Number(appState?.height);
  const cssWidth = stateW > 8 ? stateW : (Number(fallbackSize?.width) || 0);
  const cssHeight = stateH > 8 ? stateH : (Number(fallbackSize?.height) || 0);
  const sceneWidth = zoom > 0 ? cssWidth / zoom : cssWidth;
  const sceneHeight = zoom > 0 ? cssHeight / zoom : cssHeight;
  const minX = -sx;
  const minY = -sy;
  return {
    minX,
    minY,
    maxX: minX + sceneWidth,
    maxY: minY + sceneHeight,
    sceneWidth,
    sceneHeight,
    cssWidth,
    cssHeight,
    scrollX: sx,
    scrollY: sy,
    zoom,
  };
}

export function sceneCenterFromAppState(
  appState: Record<string, unknown> | null | undefined,
  fallbackSize?: { width?: number; height?: number } | null,
): {
  centerX: number;
  centerY: number;
  zoom: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
} {
  const rect = sceneViewportRect(appState, fallbackSize);
  return {
    centerX: rect.minX + rect.sceneWidth / 2,
    centerY: rect.minY + rect.sceneHeight / 2,
    zoom: rect.zoom,
    width: rect.cssWidth,
    height: rect.cssHeight,
    scrollX: rect.scrollX,
    scrollY: rect.scrollY,
  };
}

export function imageRectAtViewportCenter(
  appState: Record<string, unknown> | null | undefined,
  naturalWidth: number,
  naturalHeight: number,
  fallbackSize?: { width?: number; height?: number } | null,
  coverRatio = 0.72,
): { x: number; y: number; width: number; height: number } {
  const vp = sceneViewportRect(appState, fallbackSize);
  const nw = Number(naturalWidth);
  const nh = Number(naturalHeight);
  const safeW = Number.isFinite(nw) && nw > 0 ? nw : 1;
  const safeH = Number.isFinite(nh) && nh > 0 ? nh : 1;
  const maxW = vp.sceneWidth > 0 ? vp.sceneWidth * coverRatio : safeW;
  const maxH = vp.sceneHeight > 0 ? vp.sceneHeight * coverRatio : safeH;
  const scale = Math.min(1, maxW / safeW, maxH / safeH);
  const width = Math.max(1, safeW * scale);
  const height = Math.max(1, safeH * scale);
  return {
    x: vp.minX + (vp.sceneWidth - width) / 2,
    y: vp.minY + (vp.sceneHeight - height) / 2,
    width,
    height,
  };
}

export function imageIntersectsViewport(
  el: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null | undefined,
  appState: Record<string, unknown> | null | undefined,
  fallbackSize?: { width?: number; height?: number } | null,
): boolean {
  if (!el) return false;
  const x = Number(el.x);
  const y = Number(el.y);
  const w = Number(el.width);
  const h = Number(el.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return false;
  const vp = sceneViewportRect(appState, fallbackSize);
  if (!(vp.cssWidth > 8 && vp.cssHeight > 8)) return false;
  return x < vp.maxX && x + w > vp.minX && y < vp.maxY && y + h > vp.minY;
}
