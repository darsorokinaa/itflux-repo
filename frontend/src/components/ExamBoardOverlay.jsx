import { useCallback, useEffect, useRef, useState } from "react";

const BOARD_COLORS = [
  { hex: "#111827", label: "Чёрный" },
  { hex: "#EF4444", label: "Красный" },
  { hex: "#3B82F6", label: "Синий" },
  { hex: "#22C55E", label: "Зелёный" },
  { hex: "#F59E0B", label: "Жёлтый" },
  { hex: "#8B5CF6", label: "Фиолетовый" },
  { hex: "#ffffff", label: "Белый" },
];

const BRUSH_SIZES = [
  { px: 6, value: 2 },
  { px: 9, value: 4 },
  { px: 13, value: 8 },
  { px: 18, value: 16 },
];

const SHAPE_TOOLS = ["line", "arrow", "rect", "ellipse", "triangle"];

function textFontPx(size) {
  if (size <= 2) return 12;
  if (size <= 4) return 16;
  if (size <= 8) return 22;
  return 28;
}

function TbBtn({ active, disabled, onClick, label, tip, children, danger }) {
  return (
    <div className="exam-board-tb-btn-wrap">
      <button
        type="button"
        className={`exam-board-tb-btn${active ? " exam-board-tb-btn--active" : ""}${danger ? " exam-board-tb-btn--danger" : ""}${disabled ? " exam-board-tb-btn--disabled" : ""}`.trim()}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
      >
        {children}
      </button>
      <span className="exam-board-tb-tip" role="tooltip">
        {tip}
      </span>
    </div>
  );
}

function TbGroupLabel({ children }) {
  return <div className="exam-board-tb-group-label">{children}</div>;
}

function TbDivider() {
  return <div className="exam-board-tb-divider" aria-hidden="true" />;
}

function paintUrlOntoCanvas(canvas, url, w, h, dpr) {
  return new Promise((resolve) => {
    if (!url) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
      }
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve();
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}

export default function ExamBoardOverlay() {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState("pencil");
  const [brushSize, setBrushSize] = useState(4);
  const [color, setColor] = useState("#111827");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const canvasRef = useRef(null);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const dprRef = useRef(1);
  const logicalRef = useRef({ w: 1, h: 1 });

  const snapshotRef = useRef(null);
  const shapeStartRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const brushRef = useRef(brushSize);

  const textInputRef = useRef(null);
  const textValueRef = useRef("");
  const textCanvasPosRef = useRef({ x: 0, y: 0 });
  const skipTextBlurRef = useRef(false);
  const [textDraft, setTextDraft] = useState({ show: false, left: 0, top: 0, canvasX: 0, canvasY: 0, value: "" });

  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    brushRef.current = brushSize;
  }, [brushSize]);
  useEffect(() => {
    textValueRef.current = textDraft.value;
  }, [textDraft.value]);

  const updateUndoRedoUi = useCallback(() => {
    const h = historyRef.current;
    const i = historyIndexRef.current;
    setCanUndo(i >= 0);
    setCanRedo(i < h.length - 1);
  }, []);

  const getCtx = useCallback(() => canvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !open) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(window.innerWidth));
    const h = Math.max(1, Math.round(window.innerHeight));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    dprRef.current = dpr;
    logicalRef.current = { w, h };
    const lastUrl = historyRef.current[historyIndexRef.current];
    paintUrlOntoCanvas(canvas, lastUrl, w, h, dpr);
  }, [open]);

  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    let h = historyRef.current;
    h = h.slice(0, historyIndexRef.current + 1);
    h.push(url);
    const max = 45;
    if (h.length > max) {
      const cut = h.length - max;
      h = h.slice(cut);
    }
    historyRef.current = h;
    historyIndexRef.current = h.length - 1;
    updateUndoRedoUi();
  }, [updateUndoRedoUi]);

  const restoreHistoryIndex = useCallback(
    async (idx) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { w, h } = logicalRef.current;
      const dpr = dprRef.current;
      const url = idx < 0 ? null : historyRef.current[idx];
      await paintUrlOntoCanvas(canvas, url, w, h, dpr);
      historyIndexRef.current = idx;
      updateUndoRedoUi();
    },
    [updateUndoRedoUi]
  );

  const undo = useCallback(() => {
    const i = historyIndexRef.current;
    if (i < 0) return;
    void restoreHistoryIndex(i - 1);
  }, [restoreHistoryIndex]);

  const redo = useCallback(() => {
    const i = historyIndexRef.current;
    if (i >= historyRef.current.length - 1) return;
    void restoreHistoryIndex(i + 1);
  }, [restoreHistoryIndex]);

  const clearAll = useCallback(() => {
    if (!window.confirm("Очистить всю доску?")) return;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    const { w, h } = logicalRef.current;
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    ctx.clearRect(0, 0, w, h);
    historyRef.current = [];
    historyIndexRef.current = -1;
    updateUndoRedoUi();
  }, [getCtx, updateUndoRedoUi]);

  const clientToCanvas = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { w, h } = logicalRef.current;
    const rw = rect.width || 1;
    const rh = rect.height || 1;
    return {
      x: ((clientX - rect.left) / rw) * w,
      y: ((clientY - rect.top) / rh) * h,
    };
  }, []);

  const applyStrokeStyle = useCallback((ctx, forMarker) => {
    const sz = brushRef.current;
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = forMarker ? sz * 3 : sz;
    ctx.lineCap = forMarker ? "square" : "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = forMarker ? 0.35 : 1;
  }, []);

  const drawShapePreview = useCallback((ctx, kind, x0, y0, x1, y1) => {
    const sz = brushRef.current;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = sz;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (kind === "line") {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    } else if (kind === "arrow") {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
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
    } else if (kind === "rect") {
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    } else if (kind === "ellipse") {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      if (rx > 0.5 && ry > 0.5) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (kind === "triangle") {
      const xm = (x0 + x1) / 2;
      ctx.beginPath();
      ctx.moveTo(xm, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    historyRef.current = [];
    historyIndexRef.current = -1;
    updateUndoRedoUi();
    const t = requestAnimationFrame(() => {
      resizeCanvas();
    });
    window.addEventListener("resize", resizeCanvas);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [open, resizeCanvas, updateUndoRedoUi]);

  const commitText = useCallback(() => {
    const v = String(textValueRef.current || "").trim();
    const { x: canvasX, y: canvasY } = textCanvasPosRef.current;
    setTextDraft((s) => ({ ...s, show: false, value: "" }));
    if (!v) return;
    const ctx = getCtx();
    if (!ctx) return;
    ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colorRef.current;
    ctx.font = `${textFontPx(brushRef.current)}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(v, canvasX, canvasY);
    textValueRef.current = "";
    saveState();
  }, [getCtx, saveState]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = getCtx();
    if (!ctx) return;

    function onPointerDown(e) {
      if (e.button !== 0) return;
      const tname = toolRef.current;
      const { x, y } = clientToCanvas(e.clientX, e.clientY);

      if (tname === "text") {
        textValueRef.current = "";
        textCanvasPosRef.current = { x, y };
        setTextDraft({
          show: true,
          left: e.clientX,
          top: e.clientY,
          canvasX: x,
          canvasY: y,
          value: "",
        });
        e.preventDefault();
        return;
      }

      if (tname === "eraser") {
        drawingRef.current = true;
        const r = brushRef.current * 3;
        ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
        ctx.clearRect(x - r, y - r, r * 2, r * 2);
        lastPointRef.current = { x, y };
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      if (SHAPE_TOOLS.includes(tname)) {
        drawingRef.current = true;
        shapeStartRef.current = { x, y };
        try {
          snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (_) {
          snapshotRef.current = null;
        }
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      if (tname === "pencil" || tname === "marker") {
        drawingRef.current = true;
        lastPointRef.current = { x, y };
        ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
        applyStrokeStyle(ctx, tname === "marker");
        ctx.beginPath();
        ctx.moveTo(x, y);
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    }

    function onPointerMove(e) {
      const tname = toolRef.current;
      const { x, y } = clientToCanvas(e.clientX, e.clientY);

      if (tname === "eraser" && drawingRef.current) {
        const r = brushRef.current * 3;
        ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
        ctx.clearRect(x - r, y - r, r * 2, r * 2);
        e.preventDefault();
        return;
      }

      if (SHAPE_TOOLS.includes(tname) && drawingRef.current && snapshotRef.current && shapeStartRef.current) {
        const { x: x0, y: y0 } = shapeStartRef.current;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.putImageData(snapshotRef.current, 0, 0);
        ctx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
        drawShapePreview(ctx, tname, x0, y0, x, y);
        e.preventDefault();
        return;
      }

      if ((tname === "pencil" || tname === "marker") && drawingRef.current && lastPointRef.current) {
        const lp = lastPointRef.current;
        applyStrokeStyle(ctx, tname === "marker");
        ctx.beginPath();
        ctx.moveTo(lp.x, lp.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        lastPointRef.current = { x, y };
        ctx.globalAlpha = 1;
        e.preventDefault();
      }
    }

    function onPointerUp(e) {
      const tname = toolRef.current;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}

      if (tname === "eraser" && drawingRef.current) {
        drawingRef.current = false;
        saveState();
        e.preventDefault();
        return;
      }

      if (SHAPE_TOOLS.includes(tname) && drawingRef.current) {
        drawingRef.current = false;
        snapshotRef.current = null;
        shapeStartRef.current = null;
        saveState();
        e.preventDefault();
        return;
      }

      if ((tname === "pencil" || tname === "marker") && drawingRef.current) {
        drawingRef.current = false;
        lastPointRef.current = null;
        ctx.globalAlpha = 1;
        saveState();
        e.preventDefault();
      }
    }

    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", onPointerUp, { passive: false });
    canvas.addEventListener("pointercancel", onPointerUp, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, [open, clientToCanvas, getCtx, applyStrokeStyle, drawShapePreview, saveState]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (textDraft.show) {
        if (e.key === "Escape" && document.activeElement === textInputRef.current) {
          setTextDraft((s) => ({ ...s, show: false, value: "" }));
          e.preventDefault();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" || e.key === "Z") {
          if (!e.shiftKey) {
            e.preventDefault();
            undo();
          } else {
            e.preventDefault();
            redo();
          }
          return;
        }
        if (e.key === "y" || e.key === "Y") {
          e.preventDefault();
          redo();
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const map = {
        p: "pencil",
        m: "marker",
        t: "text",
        e: "eraser",
        l: "line",
        a: "arrow",
        r: "rect",
        o: "ellipse",
      };
      const ch = e.key.length === 1 ? e.key.toLowerCase() : "";
      if (map[ch]) setTool(map[ch]);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, undo, redo, textDraft.show]);

  useEffect(() => {
    if (textDraft.show) requestAnimationFrame(() => textInputRef.current?.focus());
  }, [textDraft.show]);

  const cursorClass =
    tool === "eraser"
      ? "exam-board-canvas--cursor-cell"
      : tool === "text"
        ? "exam-board-canvas--cursor-text"
        : "exam-board-canvas--cursor-crosshair";

  return (
    <>
      <button
        type="button"
        className={`exam-board-fab${open ? " exam-board-fab--active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <svg className="exam-board-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        </svg>
        <span>{open ? "Закрыть доску" : "Открыть доску"}</span>
      </button>

      {open && (
        <>
          <div className="exam-board-frame" aria-hidden="true" />
          <canvas ref={canvasRef} id="boardCanvas" className={`exam-board-canvas ${cursorClass}`.trim()} />

          {textDraft.show && (
            <input
              ref={textInputRef}
              type="text"
              className="exam-board-text-input"
              style={{
                position: "fixed",
                left: textDraft.left,
                top: textDraft.top,
                fontSize: textFontPx(brushSize),
              }}
              value={textDraft.value}
              onChange={(e) => {
                textValueRef.current = e.target.value;
                setTextDraft((s) => ({ ...s, value: e.target.value }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  skipTextBlurRef.current = true;
                  commitText();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  textValueRef.current = "";
                  setTextDraft((s) => ({ ...s, show: false, value: "" }));
                }
              }}
              onBlur={() => {
                if (skipTextBlurRef.current) {
                  skipTextBlurRef.current = false;
                  return;
                }
                const v = String(textValueRef.current || "").trim();
                if (v) commitText();
                else setTextDraft((s) => ({ ...s, show: false, value: "" }));
              }}
            />
          )}

          <div className="exam-board-toolbar" role="toolbar" aria-label="Инструменты доски">
            <TbGroupLabel>Рисование</TbGroupLabel>
            <TbBtn active={tool === "pencil"} onClick={() => setTool("pencil")} label="Карандаш" tip="Карандаш (P)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              </svg>
            </TbBtn>
            <TbBtn active={tool === "marker"} onClick={() => setTool("marker")} label="Маркер" tip="Маркер (M)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 20h16" />
                <path d="M6 16l10-10" />
              </svg>
            </TbBtn>
            <TbBtn active={tool === "text"} onClick={() => setTool("text")} label="Текст" tip="Текст (T)">
              <span className="exam-board-tb-letter">T</span>
            </TbBtn>
            <TbBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Ластик" tip="Ластик (E)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                <path d="M22 21H7" />
              </svg>
            </TbBtn>

            <TbDivider />
            <TbGroupLabel>Фигуры</TbGroupLabel>
            <TbBtn active={tool === "line"} onClick={() => setTool("line")} label="Линия" tip="Линия (L)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="19" x2="19" y2="5" />
              </svg>
            </TbBtn>
            <TbBtn active={tool === "arrow"} onClick={() => setTool("arrow")} label="Стрелка" tip="Стрелка (A)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="19" x2="17" y2="7" />
                <polyline points="11 7 17 7 17 13" />
              </svg>
            </TbBtn>
            <TbBtn active={tool === "rect"} onClick={() => setTool("rect")} label="Прямоугольник" tip="Прямоугольник (R)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="6" width="16" height="12" rx="1" />
              </svg>
            </TbBtn>
            <TbBtn active={tool === "ellipse"} onClick={() => setTool("ellipse")} label="Эллипс" tip="Эллипс (O)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <ellipse cx="12" cy="12" rx="9" ry="6" />
              </svg>
            </TbBtn>
            <TbBtn active={tool === "triangle"} onClick={() => setTool("triangle")} label="Треугольник" tip="Треугольник">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 4L4 20h16L12 4z" />
              </svg>
            </TbBtn>

            <TbDivider />
            <TbGroupLabel>Размер</TbGroupLabel>
            <div className="exam-board-size-row">
              {BRUSH_SIZES.map(({ px, value }) => (
                <button
                  key={value}
                  type="button"
                  className={`exam-board-size-dot${brushSize === value ? " exam-board-size-dot--active" : ""}`}
                  style={{ width: px, height: px }}
                  onClick={() => setBrushSize(value)}
                  aria-label={`Размер ${value}`}
                />
              ))}
            </div>

            <TbDivider />
            <TbGroupLabel>Цвет</TbGroupLabel>
            <div
              className="exam-board-color-current"
              style={{
                background: color,
                boxShadow: `0 0 0 1.5px ${color}, inset 0 0 0 2px #fff`,
              }}
              aria-hidden
            />
            <div className="exam-board-color-grid">
              {BOARD_COLORS.map(({ hex, label }) => (
                <button
                  key={hex}
                  type="button"
                  className={`exam-board-color-swatch${color === hex ? " exam-board-color-swatch--active" : ""}`}
                  style={{ background: hex }}
                  onClick={() => setColor(hex)}
                  title={label}
                  aria-label={label}
                />
              ))}
            </div>

            <div className="exam-board-tb-spacer" />
            <TbDivider />
            <TbGroupLabel>История</TbGroupLabel>
            <TbBtn
              active={false}
              disabled={!canUndo}
              onClick={() => undo()}
              label="Отменить"
              tip="Отменить (Ctrl+Z)"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 10h10a5 5 0 0 1 5 5v2" />
                <path d="M3 10l4-4" />
                <path d="M3 10l4 4" />
              </svg>
            </TbBtn>
            <TbBtn active={false} disabled={!canRedo} onClick={() => redo()} label="Вернуть" tip="Вернуть (Ctrl+Y)">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10h-10a5 5 0 0 0-5 5v2" />
                <path d="M21 10l-4-4" />
                <path d="M21 10l-4 4" />
              </svg>
            </TbBtn>
            <TbBtn danger active={false} onClick={clearAll} label="Очистить" tip="Очистить доску">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </TbBtn>
          </div>
        </>
      )}
    </>
  );
}
