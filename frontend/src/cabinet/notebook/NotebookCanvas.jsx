import { useEffect, useRef } from "react";
import { clientToPage, hitTest, newObjectId } from "./notebookGeometry";

function drawArrowHead(ctx, x1, y1, x2, y2, color) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 14;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - 0.4), y2 - size * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - size * Math.cos(angle + 0.4), y2 - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawNotebookObjects(ctx, objects, { selectedId, pageWidth, pageHeight } = {}) {
  ctx.clearRect(0, 0, pageWidth, pageHeight);
  for (const obj of objects || []) {
    const color = obj.color || "#d32f2f";
    const width = obj.width || obj.strokeWidth || 3;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = obj.type === "marker" ? 0.35 : (obj.opacity || 1);
    if (obj.type === "pen" || obj.type === "marker" || obj.type === "eraser") {
      const pts = obj.points || [];
      if (pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y));
        ctx.stroke();
      }
    } else if (obj.type === "line") {
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
    } else if (obj.type === "arrow") {
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
      drawArrowHead(ctx, obj.x1, obj.y1, obj.x2, obj.y2, color);
    } else if (obj.type === "rect" || obj.type === "rectangle") {
      ctx.strokeRect(obj.x, obj.y, obj.w || 0, obj.h || 0);
    } else if (obj.type === "ellipse" || obj.type === "circle") {
      ctx.beginPath();
      ctx.ellipse(obj.cx || obj.x || 0, obj.cy || obj.y || 0, Math.abs(obj.rx || obj.w || 20), Math.abs(obj.ry || obj.h || 20), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (obj.type === "text") {
      ctx.globalAlpha = 1;
      ctx.font = `${obj.fontSize || 24}px sans-serif`;
      ctx.fillText(obj.text || "", obj.x || 0, obj.y || 0);
    }
    if (selectedId && obj.id === selectedId) {
      ctx.globalAlpha = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1.5;
      ctx.strokeRect((obj.x ?? obj.x1 ?? (obj.cx || 0) - 20) - 6, (obj.y ?? obj.y1 ?? (obj.cy || 0) - 20) - 18, 80, 40);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

export default function NotebookCanvas({
  page,
  objects,
  tool,
  color,
  strokeWidth,
  fontSize,
  selectedId,
  onChangeObjects,
  onSelect,
  readOnly,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    drawNotebookObjects(ctx, objects, {
      selectedId,
      pageWidth: page?.width || 1000,
      pageHeight: page?.height || 1414,
    });
  }, [objects, selectedId, page]);

  const pointerDown = (event) => {
    if (readOnly) return;
    const canvas = canvasRef.current;
    canvas?.setPointerCapture?.(event.pointerId);
    const point = clientToPage(event, canvas, page);
    if (tool === "select") {
      const hit = [...(objects || [])].reverse().find((obj) => hitTest(obj, point));
      onSelect?.(hit?.id || null);
      drawingRef.current = hit ? { mode: "move", id: hit.id, last: point } : null;
      return;
    }
    if (tool === "eraser") {
      const next = (objects || []).filter((obj) => !hitTest(obj, point, 16));
      onChangeObjects(next);
      return;
    }
    if (tool === "text") {
      const text = window.prompt("Текст", "");
      if (!text) return;
      onChangeObjects([
        ...(objects || []),
        {
          id: newObjectId(),
          type: "text",
          text,
          x: point.x,
          y: point.y,
          color,
          fontSize,
        },
      ]);
      return;
    }
    drawingRef.current = { mode: tool, start: point, points: [point] };
  };

  const pointerMove = (event) => {
    const draft = drawingRef.current;
    if (!draft || readOnly) return;
    const canvas = canvasRef.current;
    const point = clientToPage(event, canvas, page);
    if (draft.mode === "move" && draft.id) {
      const dx = point.x - draft.last.x;
      const dy = point.y - draft.last.y;
      draft.last = point;
      onChangeObjects((objects || []).map((obj) => {
        if (obj.id !== draft.id) return obj;
        const moved = { ...obj };
        if (moved.points) moved.points = moved.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
        if (moved.x != null) moved.x += dx;
        if (moved.y != null) moved.y += dy;
        if (moved.x1 != null) {
          moved.x1 += dx; moved.y1 += dy; moved.x2 += dx; moved.y2 += dy;
        }
        if (moved.cx != null) { moved.cx += dx; moved.cy += dy; }
        return moved;
      }));
      return;
    }
    if (draft.mode === "pen" || draft.mode === "marker") {
      draft.points = [...draft.points, point];
      const preview = {
        id: "draft",
        type: draft.mode,
        points: draft.points,
        color,
        width: strokeWidth,
      };
      const ctx = canvas.getContext("2d");
      drawNotebookObjects(ctx, [...(objects || []), preview], {
        pageWidth: page.width,
        pageHeight: page.height,
      });
    }
  };

  const pointerUp = (event) => {
    const draft = drawingRef.current;
    drawingRef.current = null;
    if (!draft || readOnly || draft.mode === "move") return;
    const canvas = canvasRef.current;
    const point = clientToPage(event, canvas, page);
    const start = draft.start || point;
    let created = null;
    if (draft.mode === "pen" || draft.mode === "marker") {
      created = {
        id: newObjectId(),
        type: draft.mode,
        points: [...(draft.points || []), point],
        color,
        width: strokeWidth,
      };
    } else if (draft.mode === "line" || draft.mode === "arrow") {
      created = {
        id: newObjectId(),
        type: draft.mode,
        x1: start.x,
        y1: start.y,
        x2: point.x,
        y2: point.y,
        color,
        width: strokeWidth,
      };
    } else if (draft.mode === "rect") {
      created = {
        id: newObjectId(),
        type: "rect",
        x: start.x,
        y: start.y,
        w: point.x - start.x,
        h: point.y - start.y,
        color,
        width: strokeWidth,
      };
    } else if (draft.mode === "ellipse") {
      created = {
        id: newObjectId(),
        type: "ellipse",
        cx: (start.x + point.x) / 2,
        cy: (start.y + point.y) / 2,
        rx: Math.abs(point.x - start.x) / 2,
        ry: Math.abs(point.y - start.y) / 2,
        color,
        width: strokeWidth,
      };
    }
    if (created) onChangeObjects([...(objects || []), created]);
  };

  return (
    <canvas
      ref={canvasRef}
      className="hw-notebook-canvas"
      width={page?.width || 1000}
      height={page?.height || 1414}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerLeave={pointerUp}
    />
  );
}
