import { normalizedWidthToPx } from "./coordinateMapper";
import { VANISHING_TTL_MS } from "../../screenshare/constants";

function toCanvasPoint(nx, ny, contentRect) {
  const x = clamp(nx);
  const y = clamp(ny);
  if (x == null || y == null) return null;
  return {
    x: x * contentRect.width,
    y: y * contentRect.height,
  };
}

function clamp(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

function shouldBreak(prev, next) {
  if (!prev || !next) return false;
  if (next.gap || prev.gap) return true;
  const dt = Number(next.t) - Number(prev.t);
  return Number.isFinite(dt) && dt > 280;
}

function drawSmoothStroke(ctx, points, contentRect) {
  if (!points?.length) return;
  const pts = [];
  const raw = [];
  for (const p of points) {
    const mapped = toCanvasPoint(p.x, p.y, contentRect);
    if (!mapped) continue;
    pts.push(mapped);
    raw.push(p);
  }
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, Math.max(0.4, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (pts.length === 2) {
    if (shouldBreak(raw[0], raw[1])) {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pts[1].x, pts[1].y);
      ctx.arc(pts[1].x, pts[1].y, Math.max(0.4, ctx.lineWidth / 2), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.stroke();
    return;
  }
  for (let i = 1; i < pts.length - 1; i += 1) {
    if (shouldBreak(raw[i - 1], raw[i])) {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      continue;
    }
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function drawArrowHead(ctx, ax, ay, bx, by, size) {
  const angle = Math.atan2(by - ay, bx - ax);
  const len = size;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - len * Math.cos(angle - 0.4), by - len * Math.sin(angle - 0.4));
  ctx.lineTo(bx - len * Math.cos(angle + 0.4), by - len * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

function drawShape(ctx, stroke, contentRect) {
  const pts = stroke.points || [];
  if (pts.length < 1) return;
  const a = toCanvasPoint(pts[0].x, pts[0].y, contentRect);
  const b = pts.length > 1
    ? toCanvasPoint(pts[pts.length - 1].x, pts[pts.length - 1].y, contentRect)
    : a;
  if (!a || !b) return;
  const tool = stroke.tool || "pen";
  ctx.beginPath();
  if (tool === "rect") {
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
    return;
  }
  if (tool === "ellipse") {
    ctx.ellipse(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      Math.abs(b.x - a.x) / 2,
      Math.abs(b.y - a.y) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    return;
  }
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  if (tool === "arrow") {
    drawArrowHead(ctx, a.x, a.y, b.x, b.y, Math.max(10, ctx.lineWidth * 3));
  }
}

function drawStamp(ctx, stroke, contentRect) {
  const p = stroke.points?.[0];
  if (!p) return;
  const c = toCanvasPoint(p.x, p.y, contentRect);
  if (!c) return;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.strokeStyle = stroke.color || "#ef4444";
  ctx.fillStyle = stroke.color || "#ef4444";
  const size = Math.max(16, Number(stroke.fontSize) || 22);
  ctx.lineWidth = Math.max(2, size / 10);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const kind = String(stroke.stamp || stroke.text || "star");
  if (kind === "check") {
    ctx.beginPath();
    ctx.moveTo(-size * 0.35, 0);
    ctx.lineTo(-size * 0.08, size * 0.28);
    ctx.lineTo(size * 0.38, -size * 0.32);
    ctx.stroke();
  } else if (kind === "cross") {
    ctx.beginPath();
    ctx.moveTo(-size * 0.28, -size * 0.28);
    ctx.lineTo(size * 0.28, size * 0.28);
    ctx.moveTo(size * 0.28, -size * 0.28);
    ctx.lineTo(-size * 0.28, size * 0.28);
    ctx.stroke();
  } else if (kind === "heart") {
    ctx.beginPath();
    ctx.moveTo(0, size * 0.32);
    ctx.bezierCurveTo(-size * 0.55, -size * 0.05, -size * 0.22, -size * 0.45, 0, -size * 0.18);
    ctx.bezierCurveTo(size * 0.22, -size * 0.45, size * 0.55, -size * 0.05, 0, size * 0.32);
    ctx.fill();
  } else if (kind === "arrow") {
    ctx.beginPath();
    ctx.moveTo(-size * 0.28, size * 0.12);
    ctx.lineTo(size * 0.12, size * 0.12);
    ctx.lineTo(size * 0.12, size * 0.32);
    ctx.lineTo(size * 0.42, 0);
    ctx.lineTo(size * 0.12, -size * 0.32);
    ctx.lineTo(size * 0.12, -size * 0.12);
    ctx.lineTo(-size * 0.28, -size * 0.12);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const r = i % 2 === 0 ? size * 0.42 : size * 0.18;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawNamedArrow(ctx, stroke, contentRect) {
  const p = stroke.points?.[0];
  if (!p) return;
  const c = toCanvasPoint(p.x, p.y, contentRect);
  if (!c) return;
  const color = stroke.color || "#ef4444";
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + 18, c.y + 28);
  ctx.lineTo(c.x + 8, c.y + 26);
  ctx.lineTo(c.x + 14, c.y + 42);
  ctx.lineTo(c.x + 8, c.y + 44);
  ctx.lineTo(c.x + 2, c.y + 28);
  ctx.lineTo(c.x - 8, c.y + 34);
  ctx.closePath();
  ctx.fill();
  const name = String(stroke.displayName || "").trim();
  if (name) {
    ctx.font = "650 11px Inter, system-ui, sans-serif";
    const w = ctx.measureText(name).width + 10;
    ctx.fillStyle = "rgba(15,23,42,0.82)";
    ctx.fillRect(c.x + 16, c.y - 6, w, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(name, c.x + 21, c.y + 6);
  }
  ctx.restore();
}

function strokeWidth(stroke, contentRect) {
  return normalizedWidthToPx(
    stroke.widthNormalized,
    contentRect.width,
    stroke.width,
  );
}

function vanishingAlpha(stroke, now) {
  const start = Number(stroke.createdAt) || now;
  const age = now - start;
  if (age < 0) return 1;
  if (age >= VANISHING_TTL_MS) return 0;
  return Math.max(0, 1 - age / VANISHING_TTL_MS);
}

function drawSelection(ctx, stroke, contentRect) {
  const pts = stroke.points || [];
  if (!pts.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    const c = toCanvasPoint(p.x, p.y, contentRect);
    if (!c) continue;
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  const pad = 8;
  ctx.save();
  ctx.strokeStyle = "#38bdf8";
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  ctx.setLineDash([]);
  ctx.fillStyle = "#38bdf8";
  const handles = [
    [minX - pad, minY - pad],
    [maxX + pad, minY - pad],
    [minX - pad, maxY + pad],
    [maxX + pad, maxY + pad],
  ];
  for (const [x, y] of handles) {
    ctx.fillRect(x - 3, y - 3, 6, 6);
  }
  ctx.restore();
}

/**
 * Imperative canvas renderer. React must not own the point arrays.
 * DPR is applied only to the backing store — never to network coords.
 */
export function createAnnotationRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;
  let contentRect = { left: 0, top: 0, width: 0, height: 0 };
  let strokes = [];
  let localStroke = null;
  let lasers = [];
  let selectedId = "";
  let nameLabels = [];
  let raf = 0;
  let loop = 0;
  let dirty = false;

  const paint = () => {
    raf = 0;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const now = Date.now();
    const all = localStroke ? strokes.filter((s) => s.id !== localStroke.id).concat(localStroke) : strokes;
    let needsLoop = false;
    for (const stroke of all) {
      const tool = stroke.tool || "pen";
      if (tool === "vanishing") {
        const alpha = vanishingAlpha(stroke, now);
        if (alpha <= 0) continue;
        needsLoop = true;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = stroke.color || "#ef4444";
        ctx.fillStyle = stroke.color || "#ef4444";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = strokeWidth(stroke, contentRect);
        drawSmoothStroke(ctx, stroke.points, contentRect);
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.strokeStyle = stroke.color || "#ef4444";
      ctx.fillStyle = stroke.color || "#ef4444";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const highlighter = tool === "highlighter" || tool === "marker";
      const opacity = highlighter
        ? (Number(stroke.opacity) > 0 ? Number(stroke.opacity) : 0.38)
        : 1;
      ctx.globalAlpha = opacity;
      const widthPx = strokeWidth(stroke, contentRect);
      ctx.lineWidth = highlighter ? widthPx * 2.4 : widthPx;
      if (tool === "stamp") {
        ctx.globalAlpha = 1;
        drawStamp(ctx, stroke, contentRect);
      } else if (tool === "arrow_pointer") {
        ctx.globalAlpha = 1;
        drawNamedArrow(ctx, stroke, contentRect);
      } else if (tool === "text" && stroke.text && stroke.points?.[0]) {
        const p = toCanvasPoint(stroke.points[0].x, stroke.points[0].y, contentRect);
        if (!p) {
          ctx.restore();
          continue;
        }
        ctx.globalAlpha = 1;
        const size = Number(stroke.fontSize) || Math.max(14, widthPx * 4);
        const weight = Number(stroke.fontWeight) || 650;
        ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
        ctx.fillText(String(stroke.text), p.x, p.y);
      } else if (tool === "line" || tool === "arrow" || tool === "rect" || tool === "ellipse") {
        drawShape(ctx, stroke, contentRect);
      } else if (tool !== "select") {
        drawSmoothStroke(ctx, stroke.points, contentRect);
      }
      ctx.restore();
      if (selectedId && stroke.id === selectedId) drawSelection(ctx, stroke, contentRect);
    }
    for (const laser of lasers) {
      if (now - (laser.at || 0) > 2500) continue;
      const p = toCanvasPoint(laser.x, laser.y, contentRect);
      if (!p) continue;
      const spotlight = laser.kind === "spotlight" || laser.tool === "spotlight";
      ctx.beginPath();
      ctx.fillStyle = laser.color || "#ef4444";
      ctx.globalAlpha = spotlight ? 0.28 : 0.85;
      ctx.arc(p.x, p.y, spotlight ? 22 : 7, 0, Math.PI * 2);
      ctx.fill();
      if (spotlight) {
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (laser.displayName) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.font = "650 11px Inter, system-ui, sans-serif";
        ctx.fillText(laser.displayName, p.x + 10, p.y - 8);
      }
    }
    for (const label of nameLabels) {
      if (now - (label.at || 0) > 2200) continue;
      needsLoop = true;
      const p = toCanvasPoint(label.x, label.y, contentRect);
      if (!p) continue;
      ctx.globalAlpha = 0.92;
      ctx.font = "650 11px Inter, system-ui, sans-serif";
      const text = String(label.displayName || "");
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = "rgba(15,23,42,0.78)";
      ctx.fillRect(p.x + 8, p.y - 18, w, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, p.x + 13, p.y - 6);
    }
    if (needsLoop && !loop) {
      loop = window.requestAnimationFrame(() => {
        loop = 0;
        schedule();
      });
    }
  };

  const schedule = () => {
    if (raf) return;
    dirty = true;
    raf = window.requestAnimationFrame(() => {
      if (!dirty) {
        raf = 0;
        return;
      }
      dirty = false;
      paint();
    });
  };

  return {
    resize(nextCssWidth, nextCssHeight, nextDpr = window.devicePixelRatio || 1) {
      cssWidth = Math.max(0, Math.round(nextCssWidth));
      cssHeight = Math.max(0, Math.round(nextCssHeight));
      dpr = Math.max(1, Number(nextDpr) || 1);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0);
      schedule();
    },
    setContentRect(rect) {
      contentRect = rect || contentRect;
    },
    setStrokes(next) {
      strokes = Array.isArray(next) ? next : [];
      schedule();
    },
    setLocalStroke(stroke) {
      localStroke = stroke || null;
      schedule();
    },
    setLasers(next) {
      lasers = Array.isArray(next) ? next : [];
      schedule();
    },
    setSelectedId(id) {
      selectedId = String(id || "");
      schedule();
    },
    setNameLabels(next) {
      nameLabels = Array.isArray(next) ? next : [];
      schedule();
    },
    redraw() {
      schedule();
    },
    dispose() {
      if (raf) window.cancelAnimationFrame(raf);
      if (loop) window.cancelAnimationFrame(loop);
      raf = 0;
      loop = 0;
      strokes = [];
      localStroke = null;
      lasers = [];
      nameLabels = [];
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
