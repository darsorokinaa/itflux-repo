import { MAX_ANNOTATIONS, MAX_POINTS_PER_STROKE, MAX_TEXT_LEN } from "./constants";

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function normalizePoint(raw) {
  if (Array.isArray(raw) && raw.length >= 2) {
    return { x: clamp01(raw[0]), y: clamp01(raw[1]) };
  }
  if (raw && typeof raw === "object") {
    return { x: clamp01(raw.x), y: clamp01(raw.y) };
  }
  return null;
}

export function normalizePoints(raw, { limit = MAX_POINTS_PER_STROKE } = {}) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw.slice(0, limit)) {
    const point = normalizePoint(item);
    if (point) out.push(point);
  }
  return out;
}

export function annotationsFromList(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    if (!item?.id) continue;
    map.set(String(item.id), {
      ...item,
      id: String(item.id),
      points: normalizePoints(item.points),
      text: String(item.text || "").slice(0, MAX_TEXT_LEN),
    });
  }
  return map;
}

export function applyScreenshareOperation(map, op) {
  const next = new Map(map);
  const action = op?.action || "";
  const payload = op?.payload || {};
  if (action === "stroke_start" || action === "stroke_update" || action === "stroke_end" || action === "object_upsert") {
    const ann = payload.annotation || payload;
    if (!ann?.id) return next;
    const id = String(ann.id);
    const prev = next.get(id);
    if (action === "stroke_update" && prev) {
      const extra = normalizePoints(ann.points);
      const merged = [...(prev.points || []), ...extra].slice(0, MAX_POINTS_PER_STROKE);
      next.set(id, { ...prev, ...ann, id, points: merged, authorId: prev.authorId });
    } else if (action === "stroke_end" && prev) {
      const extra = normalizePoints(ann.points);
      const merged = extra.length
        ? [...(prev.points || []), ...extra].slice(0, MAX_POINTS_PER_STROKE)
        : prev.points;
      next.set(id, { ...prev, ...ann, id, points: merged, completed: true, authorId: prev.authorId });
    } else {
      next.set(id, {
        ...prev,
        ...ann,
        id,
        points: normalizePoints(ann.points?.length ? ann.points : prev?.points),
        authorId: ann.authorId ?? op.authorId ?? op.author_id ?? prev?.authorId,
        displayName: ann.displayName || op.displayName || op.display_name || prev?.displayName,
        coordSpace: ann.coordSpace || ann.coord_space || prev?.coordSpace || "screenshare_v1",
      });
    }
  } else if (action === "annotation_deleted") {
    const id = String(payload.id || payload.annotation_id || payload.annotationId || "");
    if (id) next.delete(id);
  } else if (action === "clear_mine") {
    const authorId = Number(op.authorId ?? op.author_id);
    for (const [id, ann] of next) {
      if (Number(ann.authorId) === authorId) next.delete(id);
    }
  } else if (action === "clear_all") {
    next.clear();
  }
  if (next.size > MAX_ANNOTATIONS) {
    const extra = next.size - MAX_ANNOTATIONS;
    const keys = [...next.keys()].slice(0, extra);
    for (const key of keys) next.delete(key);
  }
  return next;
}

export function lastOwnAnnotationId(map, authorId) {
  const uid = Number(authorId);
  let last = "";
  for (const [id, ann] of map) {
    if (Number(ann.authorId) === uid) last = id;
  }
  return last;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTestAnnotation(ann, x, y, threshold = 0.024) {
  if (!ann) return false;
  const pts = normalizePoints(ann.points);
  const tool = String(ann.tool || "pen");
  if (tool === "text" && pts[0]) {
    return Math.abs(pts[0].x - x) < 0.08 && Math.abs(pts[0].y - y) < 0.05;
  }
  if ((tool === "rect" || tool === "ellipse") && pts.length >= 2) {
    const x1 = Math.min(pts[0].x, pts[1].x);
    const y1 = Math.min(pts[0].y, pts[1].y);
    const x2 = Math.max(pts[0].x, pts[1].x);
    const y2 = Math.max(pts[0].y, pts[1].y);
    const pad = threshold;
    return x >= x1 - pad && x <= x2 + pad && y >= y1 - pad && y <= y2 + pad;
  }
  if (pts.length === 1) {
    return Math.hypot(pts[0].x - x, pts[0].y - y) <= threshold * 2;
  }
  for (let i = 1; i < pts.length; i += 1) {
    if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= threshold) {
      return true;
    }
  }
  return false;
}

export function findAnnotationAt(map, x, y) {
  const items = [...map.values()].reverse();
  for (const ann of items) {
    if (hitTestAnnotation(ann, x, y)) return ann;
  }
  return null;
}
