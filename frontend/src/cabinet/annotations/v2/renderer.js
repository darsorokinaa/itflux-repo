import { normalizedToClient, normalizedWidthToPx } from "./coordinateMapper";

function toCanvasPoint(nx, ny, contentRect) {
  return {
    x: clamp(nx) * contentRect.width,
    y: clamp(ny) * contentRect.height,
  };
}

function clamp(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function shouldBreak(prev, next) {
  if (!prev || !next) return false;
  if (prev.sourceRevision != null && next.sourceRevision != null && prev.sourceRevision !== next.sourceRevision) {
    return true;
  }
  const dt = Number(next.t) - Number(prev.t);
  return Number.isFinite(dt) && dt > 280;
}

function drawSmoothStroke(ctx, points, contentRect) {
  if (!points?.length) return;
  const pts = points.map((p) => ({ ...toCanvasPoint(p.x, p.y, contentRect), raw: p }));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    ctx.stroke();
    return;
  }
  for (let i = 1; i < pts.length; i += 1) {
    if (shouldBreak(points[i - 1], points[i])) {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      continue;
    }
    if (i === pts.length - 1 || shouldBreak(points[i], points[i + 1])) {
      ctx.lineTo(pts[i].x, pts[i].y);
    } else {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
  }
  ctx.stroke();
}

function drawShape(ctx, stroke, contentRect) {
  const pts = stroke.points || [];
  if (pts.length < 1) return;
  const a = toCanvasPoint(pts[0].x, pts[0].y, contentRect);
  const b = pts.length > 1
    ? toCanvasPoint(pts[pts.length - 1].x, pts[pts.length - 1].y, contentRect)
    : a;
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
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const len = 12;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - len * Math.cos(angle - 0.4), b.y - len * Math.sin(angle - 0.4));
    ctx.lineTo(b.x - len * Math.cos(angle + 0.4), b.y - len * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }
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
  let raf = 0;
  let dirty = false;

  const paint = () => {
    raf = 0;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const all = localStroke ? strokes.filter((s) => s.id !== localStroke.id).concat(localStroke) : strokes;
    for (const stroke of all) {
      const tool = stroke.tool || "pen";
      const highlighter = tool === "highlighter" || tool === "marker";
      ctx.save();
      ctx.strokeStyle = stroke.color || "#ef4444";
      ctx.fillStyle = stroke.color || "#ef4444";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = highlighter ? 0.38 : 1;
      const widthPx = normalizedWidthToPx(
        stroke.widthNormalized,
        contentRect.width,
        stroke.width,
      );
      ctx.lineWidth = highlighter ? widthPx * 2.4 : widthPx;
      if (tool === "text" && stroke.text && stroke.points?.[0]) {
        const p = toCanvasPoint(stroke.points[0].x, stroke.points[0].y, contentRect);
        ctx.globalAlpha = 1;
        ctx.font = `650 ${Math.max(14, widthPx * 4)}px Inter, system-ui, sans-serif`;
        ctx.fillText(String(stroke.text), p.x, p.y);
      } else if (tool === "line" || tool === "arrow" || tool === "rect" || tool === "ellipse") {
        drawShape(ctx, stroke, contentRect);
      } else {
        drawSmoothStroke(ctx, stroke.points, contentRect);
      }
      ctx.restore();
    }
    const now = Date.now();
    for (const laser of lasers) {
      if (now - (laser.at || 0) > 2500) continue;
      const p = toCanvasPoint(laser.x, laser.y, contentRect);
      ctx.beginPath();
      ctx.fillStyle = laser.color || "#ef4444";
      ctx.globalAlpha = 0.85;
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
      if (laser.displayName) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.font = "650 11px Inter, system-ui, sans-serif";
        ctx.fillText(laser.displayName, p.x + 10, p.y - 8);
      }
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
    redraw() {
      schedule();
    },
    dispose() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      strokes = [];
      localStroke = null;
      lasers = [];
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

export { normalizedToClient };
