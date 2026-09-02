/** Картинки на доске: ластик не стирает, перетаскивание остаётся. */

type El = {
  id?: string;
  type?: string;
  isDeleted?: boolean;
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
    if (!isBoardImageElement(el) || !el.isDeleted) return raw;
    const prev = prevMap.get(id);
    if (!prev || prev.isDeleted) return raw;
    // Возвращаем как было: без bump версии, чтобы не триггерить persist.
    el.isDeleted = false;
    if (typeof prev.version === "number") el.version = prev.version;
    if (typeof prev.versionNonce === "number") el.versionNonce = prev.versionNonce;
    if (typeof prev.updated === "number") el.updated = prev.updated;
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
