/** Картинки на доске: ластик не стирает и не делает их прозрачными. */

type El = {
  id?: string;
  type?: string;
  isDeleted?: boolean;
  locked?: boolean;
  opacity?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  version?: number;
  versionNonce?: number;
  updated?: number;
  [key: string]: unknown;
};

export function isEraserTool(appState: Record<string, unknown> | null | undefined): boolean {
  const tool = appState?.activeTool;
  if (!tool || typeof tool !== "object") return false;
  return String((tool as { type?: string }).type || "") === "eraser";
}

export function isBoardImageElement(el: unknown): el is El {
  if (!el || typeof el !== "object") return false;
  return (el as El).type === "image";
}

function asEl(raw: unknown): El | null {
  if (!raw || typeof raw !== "object") return null;
  const el = raw as El;
  return el.id ? el : null;
}

export function scenePointHitsBoardElement(
  el: El,
  sceneX: number,
  sceneY: number,
): boolean {
  if (el.isDeleted) return false;
  const x = Number(el.x);
  const y = Number(el.y);
  const w = Number(el.width);
  const h = Number(el.height);
  if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) return false;
  const angle = Number(el.angle) || 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = sceneX - cx;
  const dy = sceneY - cy;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/** Верхний элемент в точке: ластик по картинке глотаем, по штриху поверх — нет. */
export function topmostBoardElementAt(
  elements: readonly unknown[],
  sceneX: number,
  sceneY: number,
): El | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = asEl(elements[i]);
    if (!el) continue;
    if (scenePointHitsBoardElement(el, sceneX, sceneY)) return el;
  }
  return null;
}

export function isEraserBlockedByImage(
  appState: Record<string, unknown> | null | undefined,
  elements: readonly unknown[],
  sceneX: number,
  sceneY: number,
): boolean {
  if (!isEraserTool(appState)) return false;
  const top = topmostBoardElementAt(elements, sceneX, sceneY);
  return Boolean(top && isBoardImageElement(top));
}

function restoreImageFromPrev(el: El, prev: El): void {
  el.isDeleted = false;
  if (typeof prev.opacity === "number") el.opacity = prev.opacity;
  if (typeof prev.version === "number") el.version = prev.version;
  if (typeof prev.versionNonce === "number") el.versionNonce = prev.versionNonce;
  if (typeof prev.updated === "number") el.updated = prev.updated;
}

export function restoreImagesErasedByEraser(
  prevElements: readonly unknown[],
  nextElements: readonly unknown[],
  appState: Record<string, unknown> | null | undefined,
): { elements: unknown[]; restored: boolean } {
  if (!isEraserTool(appState) || !Array.isArray(nextElements)) {
    return { elements: nextElements as unknown[], restored: false };
  }

  const prevMap = new Map<string, El>();
  for (const raw of prevElements || []) {
    const el = asEl(raw);
    if (el) prevMap.set(String(el.id), el);
  }

  let restored = false;
  const seen = new Set<string>();
  const out: unknown[] = nextElements.map((raw) => {
    const el = asEl(raw);
    if (!el) return raw;
    const id = String(el.id);
    seen.add(id);
    if (!isBoardImageElement(el)) return raw;
    const prev = prevMap.get(id);
    if (!prev || prev.isDeleted) return raw;
    const opacityChanged = typeof prev.opacity === "number" && el.opacity !== prev.opacity;
    if (!el.isDeleted && !opacityChanged) return raw;
    restoreImageFromPrev(el, prev);
    restored = true;
    return el;
  });

  for (const [id, prev] of prevMap) {
    if (seen.has(id) || prev.isDeleted || !isBoardImageElement(prev)) continue;
    out.push({ ...prev, isDeleted: false });
    restored = true;
  }

  return { elements: out, restored };
}

/**
 * Пока выбран ластик, картинки locked — Excalidraw не кладёт их в pendingErasure
 * (полупрозрачный превью). Исходный locked возвращаем при смене инструмента.
 */
export function syncImageLocksForEraser(
  elements: readonly unknown[],
  eraserActive: boolean,
  snapshot: Map<string, boolean>,
): { elements: unknown[]; changed: boolean } {
  if (!Array.isArray(elements)) {
    return { elements: elements as unknown[], changed: false };
  }
  let changed = false;
  if (!eraserActive) {
    if (!snapshot.size) return { elements: elements as unknown[], changed: false };
    const out = elements.map((raw) => {
      const el = asEl(raw);
      if (!el || !snapshot.has(String(el.id))) return raw;
      const wasLocked = snapshot.get(String(el.id));
      if (Boolean(el.locked) === Boolean(wasLocked)) return raw;
      el.locked = wasLocked;
      changed = true;
      return el;
    });
    snapshot.clear();
    return { elements: out, changed };
  }
  const out = elements.map((raw) => {
    const el = asEl(raw);
    if (!el || !isBoardImageElement(el) || el.isDeleted) return raw;
    const id = String(el.id);
    if (!snapshot.has(id)) snapshot.set(id, Boolean(el.locked));
    if (el.locked) return raw;
    el.locked = true;
    changed = true;
    return el;
  });
  return { elements: out, changed };
}
