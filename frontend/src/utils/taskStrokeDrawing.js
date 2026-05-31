/** @typedef {{ id: string, tool: 'pencil' | 'shape', shape?: 'line' | 'rect' | 'circle' | 'arrow', color: string, size: number, points: {x:number,y:number}[], start?: {x:number,y:number}, end?: {x:number,y:number} }} TaskStroke */

export function newStrokeId() {
  return globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function sanitizeStrokes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const id = typeof s.id === "string" ? s.id : newStrokeId();
    const tool = s.tool === "shape" ? "shape" : s.tool === "pencil" ? "pencil" : null;
    if (!tool) continue;
    const color = typeof s.color === "string" ? s.color : "#1e293b";
    const size = typeof s.size === "number" && s.size > 0 ? s.size : 3;
    const points = Array.isArray(s.points)
      ? s.points.filter((p) => p && typeof p.x === "number" && typeof p.y === "number")
      : [];
    if (tool === "pencil" && points.length === 0) continue;
    if (tool === "shape") {
      const sh = ["line", "rect", "circle", "arrow"].includes(s.shape) ? s.shape : null;
      if (!sh) continue;
      const start =
        s.start && typeof s.start.x === "number" && typeof s.start.y === "number" ? { ...s.start } : null;
      const end = s.end && typeof s.end.x === "number" && typeof s.end.y === "number" ? { ...s.end } : null;
      if (!start || !end) continue;
      out.push({ id, tool: "shape", shape: sh, color, size, points: [], start, end });
    } else {
      out.push({ id, tool: "pencil", color, size, points });
    }
  }
  return out;
}

export function distPointToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x0 + t * dx;
  const qy = y0 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

/** @param {TaskStroke} stroke */
export function hitPencil(stroke, x, y) {
  const pad = stroke.size + 6;
  const pts = stroke.points || [];
  if (pts.length === 0) return false;
  for (let i = 0; i < pts.length; i++) {
    if (Math.hypot(x - pts[i].x, y - pts[i].y) <= pad) return true;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    if (distPointToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= pad) return true;
  }
  return false;
}

/** @param {TaskStroke} stroke */
export function hitRectStroke(stroke, x, y) {
  const pad = stroke.size + 6;
  const { start, end } = stroke;
  if (!start || !end) return false;
  const x0 = Math.min(start.x, end.x) - pad;
  const x1 = Math.max(start.x, end.x) + pad;
  const y0 = Math.min(start.y, end.y) - pad;
  const y1 = Math.max(start.y, end.y) + pad;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** @param {TaskStroke} stroke */
export function hitCircleStroke(stroke, x, y) {
  const pad = stroke.size + 6;
  const { start, end } = stroke;
  if (!start || !end) return false;
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;
  const r = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
  const d = Math.hypot(x - cx, y - cy);
  return d <= r + pad;
}

/** @param {TaskStroke} stroke */
export function hitLineArrowStroke(stroke, x, y) {
  const pad = stroke.size + 6;
  const { start, end } = stroke;
  if (!start || !end) return false;
  return distPointToSegment(x, y, start.x, start.y, end.x, end.y) <= pad;
}

/** @param {TaskStroke[]} strokes */
export function findHitStroke(strokes, x, y) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.tool === "pencil") {
      if (hitPencil(s, x, y)) return s;
    } else if (s.tool === "shape" && s.shape) {
      if (s.shape === "rect" && hitRectStroke(s, x, y)) return s;
      if (s.shape === "circle" && hitCircleStroke(s, x, y)) return s;
      if ((s.shape === "line" || s.shape === "arrow") && hitLineArrowStroke(s, x, y)) return s;
    }
  }
  return null;
}

function drawPencilPath(ctx, points, size, color) {
  if (points.length < 2) {
    if (points.length === 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function drawArrowHead(ctx, x0, y0, x1, y1, sz) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(12, sz * 3);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

/** @param {CanvasRenderingContext2D} ctx @param {TaskStroke} stroke @param {number} alpha */
export function drawStroke(ctx, stroke, alpha = 1) {
  const { tool, color, size } = stroke;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (tool === "pencil") {
    drawPencilPath(ctx, stroke.points, size, color);
    ctx.restore();
    return;
  }
  if (tool === "shape" && stroke.start && stroke.end) {
    const x0 = stroke.start.x;
    const y0 = stroke.start.y;
    const x1 = stroke.end.x;
    const y1 = stroke.end.y;
    const sh = stroke.shape;
    if (sh === "line") {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    } else if (sh === "arrow") {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      drawArrowHead(ctx, x0, y0, x1, y1, size);
    } else if (sh === "rect") {
      const l = Math.min(x0, x1);
      const t = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      ctx.strokeRect(l, t, w, h);
    } else if (sh === "circle") {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const r = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2;
      if (r > 0.5) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {TaskStroke[]} strokes @param {TaskStroke | null} draft @param {string | null} hoveredId */
export function redrawAllStrokes(ctx, width, height, strokes, draft, hoveredId) {
  ctx.clearRect(0, 0, width, height);
  for (const s of strokes) {
    const alpha = s.id === hoveredId ? 0.4 : 1;
    drawStroke(ctx, s, alpha);
  }
  if (draft) drawStroke(ctx, draft, 0.45);
}
