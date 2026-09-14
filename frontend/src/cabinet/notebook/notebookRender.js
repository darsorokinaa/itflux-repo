import { annotationBounds } from "./notebookGeometry";

export function strokeColor(obj) {
  return obj?.stroke || obj?.color || "#DC2626";
}

export function strokeSize(obj) {
  return Number(obj?.strokeWidth || obj?.width || 3);
}

function drawSmoothStroke(ctx, points, { pressure = false, baseWidth = 3 } = {}) {
  if (!points || points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    ctx.lineWidth = pressure ? baseWidth * (0.4 + 0.8 * (points[1].pressure ?? 0.5)) : baseWidth;
    ctx.stroke();
    return;
  }
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  if (pressure) {
    const avg = points.reduce((sum, pt) => sum + (pt.pressure ?? 0.5), 0) / points.length;
    ctx.lineWidth = baseWidth * (0.45 + 0.9 * avg);
  } else {
    ctx.lineWidth = baseWidth;
  }
  ctx.stroke();
}

export function drawArrowHead(ctx, x1, y1, x2, y2, color, strokeWidth = 3) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = Math.max(10, strokeWidth * 3.4);
  const wing = 0.38;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - wing), y2 - size * Math.sin(angle - wing));
  ctx.lineTo(x2 - size * Math.cos(angle + wing), y2 - size * Math.sin(angle + wing));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function withRotation(ctx, obj, draw) {
  const rotation = Number(obj.rotation || 0);
  if (!rotation) {
    draw();
    return;
  }
  const box = annotationBounds(obj);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

export function drawAnnotation(ctx, obj, { hideTextId } = {}) {
  if (!obj) return;
  const color = strokeColor(obj);
  const width = strokeSize(obj);
  const opacity = obj.type === "marker" ? Number(obj.opacity ?? 0.28) : Number(obj.opacity ?? 1);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = opacity;
  withRotation(ctx, obj, () => {
    if (obj.type === "pen" || obj.type === "marker") {
      ctx.lineWidth = width;
      drawSmoothStroke(ctx, obj.points || [], {
        pressure: obj.type === "pen",
        baseWidth: width,
      });
    } else if (obj.type === "line") {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
    } else if (obj.type === "arrow") {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      drawArrowHead(ctx, obj.x1, obj.y1, obj.x2, obj.y2, color, width);
    } else if (obj.type === "rect") {
      ctx.lineWidth = width;
      ctx.strokeRect(obj.x, obj.y, obj.w || 0, obj.h || 0);
    } else if (obj.type === "ellipse") {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.ellipse(obj.cx || 0, obj.cy || 0, Math.abs(obj.rx || 0), Math.abs(obj.ry || 0), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (obj.type === "text" && obj.id !== hideTextId) {
      ctx.globalAlpha = 1;
      ctx.font = `${obj.fontSize || 24}px "SF Pro Text", "Inter", system-ui, sans-serif`;
      const lines = String(obj.text || "").split("\n");
      lines.forEach((line, index) => {
        ctx.fillText(line, obj.x || 0, (obj.y || 0) + index * (obj.fontSize || 24) * 1.25);
      });
    }
  });
  ctx.restore();
}

export function drawSelection(ctx, obj) {
  const box = annotationBounds(obj);
  const pad = 6;
  ctx.save();
  ctx.strokeStyle = "#3B82F6";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = 1.25;
  ctx.setLineDash([]);
  ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
  const handles = [
    [box.x - pad, box.y - pad],
    [box.x + box.w + pad, box.y - pad],
    [box.x - pad, box.y + box.h + pad],
    [box.x + box.w + pad, box.y + box.h + pad],
  ];
  handles.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.rect(x - 4, y - 4, 8, 8);
    ctx.fill();
    ctx.stroke();
  });
  if (obj.type === "rect" || obj.type === "ellipse" || obj.type === "text") {
    const rx = box.x + box.w / 2;
    const ry = box.y - pad - 22;
    ctx.beginPath();
    ctx.moveTo(rx, box.y - pad);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rx, ry, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawMarquee(ctx, rect) {
  if (!rect) return;
  ctx.save();
  ctx.strokeStyle = "rgba(59,130,246,0.9)";
  ctx.fillStyle = "rgba(59,130,246,0.08)";
  ctx.lineWidth = 1;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

export function drawNotebookScene(ctx, objects, {
  selectedIds = [],
  pageWidth,
  pageHeight,
  draft = null,
  marquee = null,
  hideTextId = null,
} = {}) {
  ctx.clearRect(0, 0, pageWidth, pageHeight);
  for (const obj of objects || []) {
    drawAnnotation(ctx, obj, { hideTextId });
  }
  if (draft) drawAnnotation(ctx, draft, { hideTextId });
  const selected = new Set(selectedIds);
  for (const obj of objects || []) {
    if (selected.has(obj.id)) drawSelection(ctx, obj);
  }
  if (marquee) drawMarquee(ctx, marquee);
}
