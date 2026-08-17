/**
 * Pointer-session helpers for annotation strokes.
 * One active pointer → one stroke id. Never reuse lastPoint across strokes.
 */

export function shouldIgnorePointerDown(event) {
  if (!event) return true;
  if (event.isPrimary === false) return true;
  const type = event.pointerType || "mouse";
  if (type === "mouse" && event.button !== 0) return true;
  if (type === "pen") {
    if (event.buttons === 0) return true;
    if (event.button !== 0 && event.button !== -1) return true;
  }
  return false;
}

export function isMatchingActivePointer(event, activePointerId) {
  if (activePointerId == null || event?.pointerId !== activePointerId) return false;
  return true;
}

/** Mouse/pen must keep the primary button down; touch stays active while captured. */
export function isStrokePointerHeld(event, activePointerId) {
  if (!isMatchingActivePointer(event, activePointerId)) return false;
  const type = event.pointerType || "mouse";
  if (type === "mouse" || type === "pen") {
    return (event.buttons & 1) === 1;
  }
  return true;
}

export function createStroke({
  id,
  tool,
  color,
  width,
  point,
  authorId = null,
  displayName = "",
  coordSpace = "screenshare_v1",
} = {}) {
  return {
    id,
    tool,
    color,
    width,
    points: point ? [point] : [],
    authorId,
    displayName,
    coordSpace,
    completed: false,
    createdAt: Date.now(),
  };
}

export function appendStrokePoint(stroke, point, { maxPoints = 800 } = {}) {
  if (!stroke || !point) return stroke;
  const points = stroke.points || [];
  const last = points[points.length - 1];
  if (last && last.x === point.x && last.y === point.y) return stroke;
  if (points.length >= maxPoints) return stroke;
  points.push(point);
  return stroke;
}
