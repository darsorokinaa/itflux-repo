export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414;

export function clientToPage(event, canvas, page) {
  const rect = canvas.getBoundingClientRect();
  const width = page?.width || PAGE_WIDTH;
  const height = page?.height || PAGE_HEIGHT;
  const x = ((event.clientX - rect.left) / rect.width) * width;
  const y = ((event.clientY - rect.top) / rect.height) * height;
  return {
    x: Math.max(0, Math.min(width, x)),
    y: Math.max(0, Math.min(height, y)),
  };
}

export function newObjectId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `obj-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyPageState() {
  return { version: 1, objects: [] };
}

export function hitTest(obj, point, pad = 8) {
  if (!obj || !point) return false;
  const type = obj.type;
  if (type === "text") {
    const w = Math.max(40, String(obj.text || "").length * (obj.fontSize || 24) * 0.55);
    const h = (obj.fontSize || 24) + 8;
    return point.x >= obj.x - pad && point.x <= obj.x + w + pad && point.y >= obj.y - h && point.y <= obj.y + pad;
  }
  if (type === "rect" || type === "rectangle") {
    const x = Math.min(obj.x, obj.x + (obj.w || 0));
    const y = Math.min(obj.y, obj.y + (obj.h || 0));
    const w = Math.abs(obj.w || 0);
    const h = Math.abs(obj.h || 0);
    return point.x >= x - pad && point.x <= x + w + pad && point.y >= y - pad && point.y <= y + h + pad;
  }
  if (type === "ellipse" || type === "circle") {
    const dx = (point.x - (obj.cx || obj.x || 0)) / Math.max(1, obj.rx || obj.w || 20);
    const dy = (point.y - (obj.cy || obj.y || 0)) / Math.max(1, obj.ry || obj.h || 20);
    return dx * dx + dy * dy <= 1.2;
  }
  if (type === "line" || type === "arrow") {
    const x1 = obj.x1 || 0;
    const y1 = obj.y1 || 0;
    const x2 = obj.x2 || 0;
    const y2 = obj.y2 || 0;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / (len * len)));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    return Math.hypot(point.x - px, point.y - py) <= pad + (obj.width || 3);
  }
  if (Array.isArray(obj.points)) {
    return obj.points.some((pt) => Math.hypot((pt.x || 0) - point.x, (pt.y || 0) - point.y) <= pad + (obj.width || 3));
  }
  return false;
}

export function moveObject(obj, dx, dy) {
  const next = { ...obj };
  if (next.points) {
    next.points = next.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
  }
  if (next.x != null) next.x += dx;
  if (next.y != null) next.y += dy;
  if (next.x1 != null) {
    next.x1 += dx;
    next.y1 += dy;
    next.x2 += dx;
    next.y2 += dy;
  }
  if (next.cx != null) {
    next.cx += dx;
    next.cy += dy;
  }
  return next;
}
