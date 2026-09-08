/** Per-user undo/redo. Never undoes another participant's action. */

export function createAnnotationHistory({ max = 80 } = {}) {
  const undo = [];
  const redo = [];

  return {
    push(entry) {
      if (!entry) return;
      undo.push(entry);
      redo.length = 0;
      if (undo.length > max) undo.shift();
    },
    popUndo() {
      const entry = undo.pop();
      if (entry) redo.push(entry);
      return entry || null;
    },
    popRedo() {
      const entry = redo.pop();
      if (entry) undo.push(entry);
      return entry || null;
    },
    canUndo() {
      return undo.length > 0;
    },
    canRedo() {
      return redo.length > 0;
    },
    clear() {
      undo.length = 0;
      redo.length = 0;
    },
  };
}

export function invertHistoryEntry(entry) {
  if (!entry) return null;
  if (entry.type === "create") return { type: "delete", annotation: entry.annotation };
  if (entry.type === "delete") return { type: "create", annotation: entry.annotation };
  if (entry.type === "update") {
    return { type: "update", annotation: entry.before, before: entry.after, after: entry.before };
  }
  if (entry.type === "clear") {
    return { type: "restore", annotations: entry.annotations };
  }
  return null;
}
