/**
 * Локальное сохранение черновика по заданию (sessionStorage).
 * v2: массив штрихов; v1: legacy snapshot (PNG data URL).
 */
export function examDrawingStorageKey(level, subject, variantId, taskId) {
  const l = String(level || "").toLowerCase();
  const s = String(subject || "").toLowerCase();
  return `drawing-board-task-${l}-${s}-${variantId}-${taskId}`;
}

export function loadExamDrawingOverlay(level, subject, variantId, taskId) {
  if (taskId == null || variantId == null) return null;
  try {
    const raw = sessionStorage.getItem(examDrawingStorageKey(level, subject, variantId, taskId));
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    if (o.v === 2 && Array.isArray(o.strokes)) {
      return { strokes: o.strokes, v: 2 };
    }
    const snapshot = typeof o.snapshot === "string" ? o.snapshot : null;
    const undoStack = Array.isArray(o.undoStack) ? o.undoStack.filter((u) => typeof u === "string") : [];
    if (snapshot) return { snapshot, undoStack, v: o.v || 1 };
    return null;
  } catch {
    return null;
  }
}

/** @param {unknown[]} strokes */
export function saveExamDrawingOverlay(level, subject, variantId, taskId, strokes) {
  if (taskId == null || variantId == null) return;
  try {
    const key = examDrawingStorageKey(level, subject, variantId, taskId);
    if (!Array.isArray(strokes) || strokes.length === 0) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify({ v: 2, strokes }));
  } catch {
    /* quota */
  }
}
