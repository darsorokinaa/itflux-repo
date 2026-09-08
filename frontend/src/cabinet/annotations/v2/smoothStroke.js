/** Densify and smooth freehand points in normalized 0..1 space. */

export function densifySegment(prev, next, maxGap = 0.006) {
  if (!next) return [];
  if (!prev) return [next];
  const dx = Number(next.x) - Number(prev.x);
  const dy = Number(next.y) - Number(prev.y);
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist <= maxGap) return [next];
  const steps = Math.min(12, Math.ceil(dist / maxGap));
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    out.push({
      x: Number(prev.x) + dx * t,
      y: Number(prev.y) + dy * t,
      t: next.t,
      pressure: next.pressure,
    });
  }
  return out;
}

/** Skip interpolation after the pointer left the content rect (prevents letterbox diagonals). */
export function continueStrokeSegment(prev, next, { gap = false } = {}) {
  if (!next) return [];
  if (!prev) return [next];
  if (gap) return [{ ...next, gap: true }];
  return densifySegment(prev, next);
}

export function densifyPoints(points, maxGap = 0.006) {
  if (!Array.isArray(points) || points.length < 2) return points || [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    out.push(...densifySegment(points[i - 1], points[i], maxGap));
  }
  return out;
}

/** Chaikin corner-cutting — visually smooth without turning handwriting into splines. */
export function chaikinSmooth(points, iterations = 1) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  let current = points;
  for (let n = 0; n < iterations; n += 1) {
    if (current.length < 3) break;
    const next = [current[0]];
    for (let i = 0; i < current.length - 1; i += 1) {
      const a = current[i];
      const b = current[i + 1];
      next.push(
        { x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y, t: a.t, pressure: a.pressure },
        { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y, t: b.t, pressure: b.pressure },
      );
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

export function translatePoints(points, dx, dy) {
  return (points || []).map((p) => {
    const x = clamp01(p.x + dx);
    const y = clamp01(p.y + dy);
    if (x == null || y == null) return p;
    return { ...p, x, y };
  });
}

export function scalePoints(points, origin, sx, sy) {
  return (points || []).map((p) => {
    const x = clamp01(origin.x + (p.x - origin.x) * sx);
    const y = clamp01(origin.y + (p.y - origin.y) * sy);
    if (x == null || y == null) return p;
    return { ...p, x, y };
  });
}

export function strokeBounds(points) {
  const pts = points || [];
  if (!pts.length) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    x: minX,
    y: minY,
    w: Math.max(0.008, maxX - minX),
    h: Math.max(0.008, maxY - minY),
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}
