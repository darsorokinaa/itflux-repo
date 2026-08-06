/** Viewport учителя для режима «Следовать за учителем» (не путать с курсором). */

export type TeacherViewport = {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width?: number;
  height?: number;
  seq: number;
  clientId: string;
  userId?: number | null;
  role?: string;
  updatedAt: number;
};

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
  return {
    scrollX,
    scrollY,
    zoom,
    width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : undefined,
    height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : undefined,
    seq: Number.isFinite(seq) ? seq : 0,
    clientId,
    userId: userId ?? null,
    role: role || (typeof raw.role === "string" ? raw.role : undefined),
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

export function viewportAppStatePatch(vp: TeacherViewport): Record<string, unknown> {
  return {
    scrollX: vp.scrollX,
    scrollY: vp.scrollY,
    zoom: { value: vp.zoom },
  };
}

/**
 * Ручной pan/zoom ученика: отклонение от целевого viewport учителя.
 * Не используем для отключения сразу после нашего же apply.
 */
export function viewportDriftTooFar(
  local: { scrollX?: unknown; scrollY?: unknown; zoom?: unknown },
  target: TeacherViewport,
  opts: { scrollPx?: number; zoomRatio?: number } = {},
): boolean {
  const scrollTol = opts.scrollPx ?? 48;
  const zoomTol = opts.zoomRatio ?? 0.04;
  const sx = Number(local.scrollX) || 0;
  const sy = Number(local.scrollY) || 0;
  const z = zoomValueOf(local.zoom);
  if (Math.abs(sx - target.scrollX) > scrollTol) return true;
  if (Math.abs(sy - target.scrollY) > scrollTol) return true;
  if (Math.abs(z - target.zoom) / Math.max(target.zoom, 0.01) > zoomTol) return true;
  return false;
}
