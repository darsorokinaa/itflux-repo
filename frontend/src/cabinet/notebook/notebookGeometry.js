export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414;

export function newObjectId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `obj-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyPageState() {
  return { version: 1, objects: [] };
}

export function clientToPage(event, canvas, page, { clamp = true } = {}) {
  const rect = canvas.getBoundingClientRect();
  const width = page?.width || PAGE_WIDTH;
  const height = page?.height || PAGE_HEIGHT;
  const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
  const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * height;
  if (!clamp) return { x, y };
  return {
    x: Math.max(0, Math.min(width, x)),
    y: Math.max(0, Math.min(height, y)),
  };
}

export function pointerEventSamples(event) {
  const native = event?.nativeEvent || event;
  try {
    const extra = (typeof event?.getCoalescedEvents === "function" && event.getCoalescedEvents())
      || (typeof native?.getCoalescedEvents === "function" && native.getCoalescedEvents());
    if (extra && extra.length) return extra;
  } catch {
    /* ignore */
  }
  return event ? [event] : [];
}

export function pointerPressure(event, fallback = 0.5) {
  if (event?.pointerType === "pen") {
    const value = Number(event.pressure);
    if (Number.isFinite(value) && value > 0) return Math.min(1, value);
  }
  return fallback;
}

export function isStylusPointer(event) {
  return event?.pointerType === "pen";
}

export function smoothStroke(points, iterations = 1) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  let current = points;
  for (let i = 0; i < iterations; i += 1) {
    const next = [current[0]];
    for (let j = 0; j < current.length - 1; j += 1) {
      const a = current[j];
      const b = current[j + 1];
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
        pressure: a.pressure ?? 0.5,
      });
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
        pressure: b.pressure ?? 0.5,
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

export function constrainLine(start, end, shift) {
  if (!shift) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return {
    x: start.x + Math.cos(snapped) * len,
    y: start.y + Math.sin(snapped) * len,
  };
}

export function constrainBox(start, end, { shift = false, alt = false } = {}) {
  let x1 = start.x;
  let y1 = start.y;
  let x2 = end.x;
  let y2 = end.y;
  if (alt) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    x1 = start.x - dx;
    y1 = start.y - dy;
    x2 = start.x + dx;
    y2 = start.y + dy;
  }
  let w = x2 - x1;
  let h = y2 - y1;
  if (shift) {
    const size = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * size;
    h = Math.sign(h || 1) * size;
  }
  return { x: x1, y: y1, w, h };
}

export function annotationBounds(obj) {
  if (!obj) return { x: 0, y: 0, w: 0, h: 0 };
  if (obj.type === "text") {
    const w = Math.max(obj.w || 80, String(obj.text || "").split("\n").reduce((max, line) => (
      Math.max(max, line.length * (obj.fontSize || 24) * 0.56)
    ), 80));
    const lines = String(obj.text || " ").split("\n").length;
    return { x: obj.x, y: obj.y - (obj.fontSize || 24), w, h: lines * (obj.fontSize || 24) * 1.25 };
  }
  if (obj.type === "rect" || obj.type === "rectangle") {
    const x = Math.min(obj.x, obj.x + (obj.w || 0));
    const y = Math.min(obj.y, obj.y + (obj.h || 0));
    return { x, y, w: Math.abs(obj.w || 0), h: Math.abs(obj.h || 0) };
  }
  if (obj.type === "ellipse" || obj.type === "circle") {
    return {
      x: (obj.cx || 0) - Math.abs(obj.rx || 0),
      y: (obj.cy || 0) - Math.abs(obj.ry || 0),
      w: Math.abs(obj.rx || 0) * 2,
      h: Math.abs(obj.ry || 0) * 2,
    };
  }
  if (obj.type === "line" || obj.type === "arrow") {
    const x = Math.min(obj.x1, obj.x2);
    const y = Math.min(obj.y1, obj.y2);
    return { x, y, w: Math.abs(obj.x2 - obj.x1), h: Math.abs(obj.y2 - obj.y1) };
  }
  if (Array.isArray(obj.points) && obj.points.length) {
    const xs = obj.points.map((pt) => pt.x);
    const ys = obj.points.map((pt) => pt.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

export function hitTest(obj, point, pad = 8) {
  if (!obj || !point) return false;
  const type = obj.type;
  if (type === "text") {
    const box = annotationBounds(obj);
    return point.x >= box.x - pad && point.x <= box.x + box.w + pad
      && point.y >= box.y - pad && point.y <= box.y + box.h + pad;
  }
  if (type === "rect" || type === "rectangle") {
    const box = annotationBounds(obj);
    return point.x >= box.x - pad && point.x <= box.x + box.w + pad
      && point.y >= box.y - pad && point.y <= box.y + box.h + pad;
  }
  if (type === "ellipse" || type === "circle") {
    const dx = (point.x - (obj.cx || 0)) / Math.max(1, obj.rx || 20);
    const dy = (point.y - (obj.cy || 0)) / Math.max(1, obj.ry || 20);
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
    return Math.hypot(point.x - px, point.y - py) <= pad + (obj.strokeWidth || obj.width || 3);
  }
  if (Array.isArray(obj.points)) {
    const threshold = pad + (obj.strokeWidth || obj.width || 3);
    const pts = obj.points;
    for (let i = 0; i < pts.length; i += 1) {
      const pt = pts[i];
      if (Math.hypot((pt.x || 0) - point.x, (pt.y || 0) - point.y) <= threshold) return true;
      if (i === 0) continue;
      const prev = pts[i - 1];
      const dx = (pt.x || 0) - (prev.x || 0);
      const dy = (pt.y || 0) - (prev.y || 0);
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((point.x - (prev.x || 0)) * dx + (point.y - (prev.y || 0)) * dy) / (len * len)));
      const px = (prev.x || 0) + t * dx;
      const py = (prev.y || 0) + t * dy;
      if (Math.hypot(point.x - px, point.y - py) <= threshold) return true;
    }
    return false;
  }
  return false;
}

export function moveObject(obj, dx, dy) {
  const next = { ...obj, updatedAt: new Date().toISOString() };
  if (next.points) next.points = next.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy }));
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

export function scaleAnnotation(obj, handle, pointer, origin) {
  const box = annotationBounds(obj);
  const next = { ...obj, updatedAt: new Date().toISOString() };
  let { x, y, w, h } = box;
  if (handle.includes("e")) w = pointer.x - x;
  if (handle.includes("s")) h = pointer.y - y;
  if (handle.includes("w")) {
    w = x + w - pointer.x;
    x = pointer.x;
  }
  if (handle.includes("n")) {
    h = y + h - pointer.y;
    y = pointer.y;
  }
  if (origin?.shift) {
    const size = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * size;
    h = Math.sign(h || 1) * size;
  }
  if (next.type === "rect") {
    next.x = x;
    next.y = y;
    next.w = w;
    next.h = h;
  } else if (next.type === "ellipse") {
    next.cx = x + w / 2;
    next.cy = y + h / 2;
    next.rx = Math.abs(w) / 2;
    next.ry = Math.abs(h) / 2;
  } else if (next.type === "text") {
    next.x = x;
    next.y = y + (next.fontSize || 24);
    next.w = Math.abs(w);
  } else if (next.type === "line" || next.type === "arrow") {
    if (handle.includes("w") || handle.includes("n")) {
      next.x1 = pointer.x;
      next.y1 = pointer.y;
    } else {
      next.x2 = pointer.x;
      next.y2 = pointer.y;
    }
  }
  return next;
}

export function rotateHandlePoint(box, pad = 6) {
  return { x: box.x + box.w / 2, y: box.y - pad - 22 };
}

export function hitRotateHandle(box, point, size = 10) {
  const handle = rotateHandlePoint(box);
  return Math.hypot(handle.x - point.x, handle.y - point.y) <= size;
}

export function handleAtPoint(box, point, size = 10) {
  const handles = {
    nw: { x: box.x, y: box.y },
    ne: { x: box.x + box.w, y: box.y },
    sw: { x: box.x, y: box.y + box.h },
    se: { x: box.x + box.w, y: box.y + box.h },
  };
  return Object.entries(handles).find(([, pos]) => (
    Math.hypot(pos.x - point.x, pos.y - point.y) <= size
  ))?.[0] || null;
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
