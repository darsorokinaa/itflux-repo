import { useEffect, useRef, useState } from "react";

/**
 * Гостевая доска только в памяти вкладки.
 * tldraw сюда не подключаем: VITE_TLDRAW_LICENSE_KEY относится к кабинету,
 * а пустой ключ на публичной странице лицензию не заменяет.
 * Записей на сервере демо не создаёт.
 */

const COLORS = [
  { id: "black", value: "#050505", label: "Чёрный" },
  { id: "blue", value: "#1550D8", label: "Синий" },
  { id: "red", value: "#C0284A", label: "Красный" },
];

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function drawGrid(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "#e4e8ff";
  ctx.lineWidth = 1;
  const step = 28;
  ctx.beginPath();
  for (let x = step; x < width; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = step; y < height; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function drawStroke(ctx, stroke) {
  if (!stroke.points.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  if (stroke.points.length === 1) {
    ctx.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y + 0.1);
  } else {
    stroke.points.forEach((point) => ctx.lineTo(point.x, point.y));
  }
  ctx.stroke();
  ctx.restore();
}

export default function SeoBoardDemo() {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);
  const activeRef = useRef(null);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0].value);
  const [thin, setThin] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      drawGrid(ctx, width, height);
      strokesRef.current.forEach((stroke) => drawStroke(ctx, stroke));
    };

    paint();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  function paintActive() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const stroke = activeRef.current;
    if (!ctx || !stroke) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawStroke(ctx, stroke);
  }

  function startDraw(event) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof canvas.setPointerCapture === "function") {
      canvas.setPointerCapture(event.pointerId);
    }
    let size = 4;
    if (tool === "erase") size = 22;
    else if (thin) size = 2;
    const stroke = {
      color,
      size,
      erase: tool === "erase",
      points: [canvasPoint(event, canvas)],
    };
    activeRef.current = stroke;
    strokesRef.current.push(stroke);
    paintActive();
  }

  function moveDraw(event) {
    const canvas = canvasRef.current;
    const stroke = activeRef.current;
    if (!canvas || !stroke) return;
    stroke.points.push(canvasPoint(event, canvas));
    paintActive();
  }

  function endDraw(event) {
    const canvas = canvasRef.current;
    if (canvas && typeof canvas.hasPointerCapture === "function" && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    activeRef.current = null;
  }

  function clearBoard() {
    strokesRef.current = [];
    activeRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    drawGrid(ctx, rect.width, rect.height);
  }

  return (
    <div className="seo-board">
      <div className="seo-board__tools" role="toolbar" aria-label="Инструменты доски">
        <button type="button" className={tool === "pen" ? "is-active" : ""} aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>
          Карандаш
        </button>
        <button type="button" className={tool === "erase" ? "is-active" : ""} aria-pressed={tool === "erase"} onClick={() => setTool("erase")}>
          Ластик
        </button>
        <button type="button" aria-pressed={thin} onClick={() => setThin((value) => !value)}>
          {thin ? "Тонкая линия" : "Обычная линия"}
        </button>
        {COLORS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`seo-board__color${color === item.value ? " is-active" : ""}`}
            aria-label={item.label}
            aria-pressed={color === item.value}
            onClick={() => {
              setColor(item.value);
              setTool("pen");
            }}
          >
            <span style={{ background: item.value }} />
          </button>
        ))}
        <button type="button" onClick={clearBoard}>Очистить</button>
      </div>
      <canvas
        ref={canvasRef}
        className="seo-board__canvas"
        aria-label="Доска для рисунка"
        onPointerDown={startDraw}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
        onPointerCancel={endDraw}
      />
      <p className="seo-landing__note">
        Это демо: рисунок только на этом устройстве и стирается при обновлении. На сервер он не отправляется.
      </p>
    </div>
  );
}
