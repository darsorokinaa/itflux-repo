const MAX_STROKES = 400;
const MAX_POINTS = 800;

function strokeKey(id) {
  return String(id || "");
}

function seqKey(strokeId, sequence) {
  return `${strokeId}:${sequence}`;
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

    setSourceRevision(next, { clear } = {}) {
      const value = Number(next) || 0;
      if (value === sourceRevision) return false;
      const shouldClear = clear ?? sourceRevision > 0;
      sourceRevision = value;
      if (shouldClear) {
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
        if (!id) continue;
        const rev = Number(item.sourceRevision || 0);
        if (sourceRevision && rev && rev !== sourceRevision) continue;
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
      const rev = Number(stroke.sourceRevision ?? sourceRevision);
      if (sourceRevision && rev !== sourceRevision) return false;
      strokes.set(id, {
        ...stroke,
        id,
        points: Array.isArray(stroke.points) ? stroke.points.slice(0, maxPoints) : [],
        completed: false,
      });
      trim();
      return true;
    },

    appendPoints(strokeId, points, { sequence = 0, sourceRevision: rev } = {}) {
      const id = strokeKey(strokeId);
      const stroke = strokes.get(id);
      if (!stroke) return false;
      const packetRev = Number(rev ?? stroke.sourceRevision ?? sourceRevision);
      if (sourceRevision && packetRev && packetRev !== sourceRevision) return false;
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
      const merged = stroke.points.concat(points).slice(0, maxPoints);
      stroke.points = merged;
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

    cancel(strokeId) {
      const id = strokeKey(strokeId);
      if (!strokes.has(id)) return false;
      strokes.delete(id);
      return true;
    },

    remove(strokeId) {
      return this.cancel(strokeId);
    },

    clearMine(authorId) {
      const uid = Number(authorId);
      for (const [id, stroke] of strokes) {
        if (Number(stroke.authorId) === uid) strokes.delete(id);
      }
    },

    clearAll() {
      strokes.clear();
      seenSeq.clear();
      clearVersion += 1;
    },

    lastOwnId(authorId) {
      const uid = Number(authorId);
      let last = "";
      for (const [id, stroke] of strokes) {
        if (Number(stroke.authorId) === uid) last = id;
      }
      return last;
    },

    list() {
      return [...strokes.values()];
    },

    get(id) {
      return strokes.get(strokeKey(id)) || null;
    },
  };
}
