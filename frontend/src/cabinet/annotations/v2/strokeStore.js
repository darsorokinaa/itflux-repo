const MAX_STROKES = 400;
const MAX_POINTS = 800;
const EPHEMERAL_TOOLS = new Set(["vanishing", "spotlight", "laser"]);

function strokeKey(id) {
  return String(id || "");
}

function seqKey(strokeId, sequence) {
  return `${strokeId}:${sequence}`;
}

function cloneStroke(stroke) {
  if (!stroke) return null;
  return {
    ...stroke,
    points: Array.isArray(stroke.points) ? stroke.points.map((p) => ({ ...p })) : [],
  };
}

export function isPersistentStroke(stroke) {
  const tool = String(stroke?.tool || "");
  if (EPHEMERAL_TOOLS.has(tool)) return false;
  if (stroke?.ephemeral) return false;
  return true;
}

export function createStrokeStore({
  maxStrokes = MAX_STROKES,
  maxPoints = MAX_POINTS,
} = {}) {
  const strokes = new Map();
  const seenSeq = new Set();
  let sourceRevision = 0;
  let clearVersion = 0;

  const trim = () => {
    while (strokes.size > maxStrokes) {
      const first = strokes.keys().next().value;
      strokes.delete(first);
    }
  };

  return {
    get sourceRevision() { return sourceRevision; },
    get clearVersion() { return clearVersion; },
    size() { return strokes.size; },

    setSourceRevision(next, { clear = false } = {}) {
      const value = Number(next) || 0;
      if (value === sourceRevision) return false;
      sourceRevision = value;
      // Zoom: paging PPT / Excel inside the same share must keep drawings.
      if (clear) {
        strokes.clear();
        seenSeq.clear();
      }
      return true;
    },

    loadSnapshot(list, { revision = sourceRevision, clearVer = clearVersion } = {}) {
      strokes.clear();
      seenSeq.clear();
      sourceRevision = Number(revision) || 0;
      clearVersion = Number(clearVer) || 0;
      if (!Array.isArray(list)) return;
      for (const item of list) {
        const id = strokeKey(item?.id);
        if (!id || !isPersistentStroke(item)) continue;
        strokes.set(id, {
          ...item,
          id,
          points: Array.isArray(item.points) ? item.points.slice(0, maxPoints) : [],
        });
      }
      trim();
    },

    start(stroke) {
      const id = strokeKey(stroke?.id);
      if (!id) return false;
      const points = Array.isArray(stroke.points) ? stroke.points.slice(0, maxPoints) : [];
      const existing = strokes.get(id);
      if (existing && existing.points.length > points.length) {
        return true;
      }
      strokes.set(id, {
        ...stroke,
        id,
        points,
        completed: Boolean(stroke.completed),
      });
      trim();
      return true;
    },

    appendPoints(strokeId, points, { sequence = 0 } = {}) {
      const id = strokeKey(strokeId);
      const stroke = strokes.get(id);
      if (!stroke) return false;
      const key = seqKey(id, sequence);
      if (sequence && seenSeq.has(key)) return false;
      if (sequence) {
        seenSeq.add(key);
        if (seenSeq.size > 4000) {
          const first = seenSeq.values().next().value;
          seenSeq.delete(first);
        }
      }
      if (!Array.isArray(points) || !points.length) return true;
      const clean = [];
      for (const item of points) {
        const x = Number(item?.x);
        const y = Number(item?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) continue;
        clean.push({
          ...item,
          x: Math.min(1, Math.max(0, x)),
          y: Math.min(1, Math.max(0, y)),
        });
      }
      if (!clean.length) return true;
      stroke.points = stroke.points.concat(clean).slice(0, maxPoints);
      stroke.sequence = Math.max(Number(stroke.sequence) || 0, Number(sequence) || 0);
      return true;
    },

    end(strokeId, extraPoints = []) {
      const id = strokeKey(strokeId);
      const stroke = strokes.get(id);
      if (!stroke) return false;
      if (extraPoints.length) this.appendPoints(id, extraPoints);
      stroke.completed = true;
      return true;
    },

    update(strokeId, patch) {
      const id = strokeKey(strokeId);
      const stroke = strokes.get(id);
      if (!stroke) return false;
      const next = { ...stroke, ...patch, id };
      if (Array.isArray(patch?.points)) {
        next.points = patch.points.slice(0, maxPoints);
      }
      strokes.set(id, next);
      return true;
    },

    replaceAuthorTool(authorId, tool, stroke) {
      const uid = Number(authorId);
      const kind = String(tool || "");
      for (const [id, item] of [...strokes]) {
        if (Number(item.authorId) === uid && String(item.tool) === kind) strokes.delete(id);
      }
      if (stroke) this.start(stroke);
    },

    cancel(strokeId) {
      const id = strokeKey(strokeId);
      if (!strokes.has(id)) return false;
      strokes.delete(id);
      return true;
    },

    remove(strokeId) {
      return this.cancel(strokeId);
    },

    getClone(strokeId) {
      return cloneStroke(strokes.get(strokeKey(strokeId)));
    },

    clearMine(authorId) {
      const uid = Number(authorId);
      const removed = [];
      for (const [id, stroke] of [...strokes]) {
        if (Number(stroke.authorId) === uid) {
          removed.push(cloneStroke(stroke));
          strokes.delete(id);
        }
      }
      return removed;
    },

    clearViewers(presenterId) {
      const uid = Number(presenterId);
      const removed = [];
      for (const [id, stroke] of [...strokes]) {
        if (Number(stroke.authorId) !== uid) {
          removed.push(cloneStroke(stroke));
          strokes.delete(id);
        }
      }
      return removed;
    },

    clearAll() {
      const removed = this.list().map(cloneStroke);
      strokes.clear();
      seenSeq.clear();
      clearVersion += 1;
      return removed;
    },

    lastOwnId(authorId) {
      const uid = Number(authorId);
      let last = "";
      for (const [id, stroke] of strokes) {
        if (Number(stroke.authorId) === uid && isPersistentStroke(stroke)) last = id;
      }
      return last;
    },

    list() {
      return [...strokes.values()];
    },

    persistentList() {
      return [...strokes.values()].filter(isPersistentStroke);
    },

    get(id) {
      return strokes.get(strokeKey(id)) || null;
    },
  };
}
