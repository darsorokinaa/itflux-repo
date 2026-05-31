import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BOARD_COLORS = [
  { hex: "#111827", label: "Чёрный" },
  { hex: "#EF4444", label: "Красный" },
  { hex: "#2196F3", label: "Синий" },
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

function newBoardId() {
  return globalThis.crypto?.randomUUID?.() ?? `b-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function distToSegment(px, py, x0, y0, x1, y1) {
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

/** Логический bbox + лёгкое наведение для инструмента выбора */
function boardObjectHit(o, x, y) {
  const pad = 12;
  if (o.type === "text") {
    const fh = o.fontPx ?? 16;
    const w = Math.max(8, (o.text?.length ?? 1) * fh * 0.55);
    const h = fh * 1.35;
    return x >= o.x - pad && x <= o.x + w + pad && y >= o.y - pad && y <= o.y + h + pad;
  }
  if (o.type !== "shape") return false;
  const { shapeKind, x0, y0, x1, y1, lineWidth } = o;
  const lw = (lineWidth ?? 4) + pad;
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  if (shapeKind === "line" || shapeKind === "arrow") {
    return distToSegment(x, y, x0, y0, x1, y1) <= lw;
  }
  if (shapeKind === "rect") {
    if (maxX - minX < 4 && maxY - minY < 4) return distToSegment(x, y, x0, y0, x1, y1) <= lw;
    return x >= minX - lw && x <= maxX + lw && y >= minY - lw && y <= maxY + lw;
  }
  if (shapeKind === "ellipse") {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = Math.abs(x1 - x0) / 2;
    const ry = Math.abs(y1 - y0) / 2;
    if (rx < 1 || ry < 1) return Math.hypot(x - cx, y - cy) <= lw;
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const d = Math.abs(Math.sqrt(nx * nx + ny * ny) - 1) * Math.min(rx, ry);
    return d <= lw;
  }
  if (shapeKind === "triangle") {
    const xm = (x0 + x1) / 2;
    const ax = xm;
    const ay = y0;
    const bx = x1;
    const by = y1;
    const cx_ = x0;
    const cy_ = y1;
    const d1 = distToSegment(x, y, ax, ay, bx, by);
    const d2 = distToSegment(x, y, bx, by, cx_, cy_);
    const d3 = distToSegment(x, y, cx_, cy_, ax, ay);
    return Math.min(d1, d2, d3) <= lw;
  }
  return false;
}

function boardObjectBBox(o) {
  if (o.type === "text") {
    const fh = o.fontPx ?? 16;
    const w = Math.max(8, (o.text?.length ?? 1) * fh * 0.55);
    const h = fh * 1.35;
    return { minX: o.x, minY: o.y, maxX: o.x + w, maxY: o.y + h };
  }
  if (o.type === "shape") {
    const pad = (o.lineWidth ?? 4) + 6;
    const minX = Math.min(o.x0, o.x1) - pad;
    const maxX = Math.max(o.x0, o.x1) + pad;
    const minY = Math.min(o.y0, o.y1) - pad;
    const maxY = Math.max(o.y0, o.y1) + pad;
    return { minX, minY, maxX, maxY };
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function scaleBoardObjects(objs, sx, sy) {
  return objs.map((o) => {
    if (o.type === "text") return { ...o, x: o.x * sx, y: o.y * sy };
    if (o.type === "shape") return { ...o, x0: o.x0 * sx, y0: o.y0 * sy, x1: o.x1 * sx, y1: o.y1 * sy };
    return o;
  });
}

function cloneObjectForDrag(o) {
  if (o.type === "text") return { ...o };
  if (o.type === "shape") return { ...o };
  return o;
}

function pickObjectAt(objs, x, y) {
  for (let i = objs.length - 1; i >= 0; i--) {
    if (boardObjectHit(objs[i], x, y)) return objs[i];
  }
  return null;
}

function translateBoardObject(o, dx, dy) {
  if (o.type === "text") return { ...o, x: o.x + dx, y: o.y + dy };
  if (o.type === "shape") return { ...o, x0: o.x0 + dx, y0: o.y0 + dy, x1: o.x1 + dx, y1: o.y1 + dy };
  return o;
}

function drawBoardObject(ctx, o) {
  if (o.type === "text") {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = o.color;
    ctx.font = `${o.fontPx}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(o.text, o.x, o.y);
    ctx.restore();
    return;
  }
  if (o.type !== "shape") return;
  const { shapeKind, x0, y0, x1, y1, color, lineWidth } = o;
  const sz = lineWidth ?? 4;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = sz;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (shapeKind === "line") {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  } else if (shapeKind === "arrow") {
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
  } else if (shapeKind === "rect") {
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  } else if (shapeKind === "ellipse") {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = Math.abs(x1 - x0) / 2;
    const ry = Math.abs(y1 - y0) / 2;
    if (rx > 0.5 && ry > 0.5) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (shapeKind === "triangle") {
    const xm = (x0 + x1) / 2;
    ctx.beginPath();
    ctx.moveTo(xm, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x0, y1);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function textFontPx(size) {
  if (size <= 2) return 12;
  if (size <= 4) return 16;
  if (size <= 8) return 22;
  return 28;
}

function shouldAddPoint(points, nextPoint, minDistance = 2) {
  const last = points[points.length - 1];
  if (!last) return true;
  const dx = nextPoint.x - last.x;
  const dy = nextPoint.y - last.y;
  return Math.sqrt(dx * dx + dy * dy) >= minDistance;
}

function drawSmoothStroke(ctx, points, options) {
  if (points.length < 2) return;
  const { color, width, alpha = 1, compositeOperation = "source-over" } = options;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = compositeOperation;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const midPoint = {
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    };
    ctx.quadraticCurveTo(points[i].x, points[i].y, midPoint.x, midPoint.y);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
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

function paintUrlOntoBg(bg, url) {
  return new Promise((resolve) => {
    if (!bg) {
      resolve();
      return;
    }
    const ctx = bg.getContext("2d");
    if (!ctx) {
      resolve();
      return;
    }
    if (!url) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bg.width, bg.height);
      resolve();
      return;
    }
    const img = new Image();
    img.onload = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bg.width, bg.height);
      ctx.drawImage(img, 0, 0, bg.width, bg.height);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}
function TbAnchorBtn({ active, expanded, onClick, label, tip, children }) {
  return (
    <div className="exam-board-tb-btn-wrap exam-board-tb-anchor-wrap">
      <button
        type="button"
        className={`exam-board-tb-anchor${active || expanded ? " exam-board-tb-anchor--on" : ""}${expanded ? " exam-board-tb-anchor--expanded" : ""}`.trim()}
        onClick={onClick}
        aria-label={label}
        aria-expanded={expanded}
        aria-haspopup="dialog"
      >
        {children}
      </button>
      <span className="exam-board-tb-tip" role="tooltip">
        {tip}
      </span>
    </div>
  );
}

export default function ExamBoardOverlay({
  open: controlledOpen,
  onOpenChange,
  hideFab = false,
  taskId,
  taskNumber,
  initialBoardPersist,
  onBoardPersist,
} = {}) {
  /** Режим варианта (FAB скрыт, доска снаружи, привязка к taskId). */
  const isEduShell = !!hideFab;
  /** Нижний bottom-sheet отключён: доска — полноэкранный оверлей поверх страницы (как обычный экзамен). */
  const useBottomSheetUi = false;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const [tool, setTool] = useState("pencil");
  const [brushSize, setBrushSize] = useState(4);
  const [color, setColor] = useState("#111827");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [strokePopoverOpen, setStrokePopoverOpen] = useState(false);
  const [shapesPopoverOpen, setShapesPopoverOpen] = useState(false);
  const [boardCollapsed, setBoardCollapsed] = useState(false);

  const setOpen = useCallback(
    (next) => {
      const val = typeof next === "function" ? next(open) : next;
      if (!val) {
        setStrokePopoverOpen(false);
        setShapesPopoverOpen(false);
        setBoardCollapsed(false);
      }
      if (isControlled) onOpenChange?.(val);
      else setUncontrolledOpen(val);
    },
    [isControlled, onOpenChange, open]
  );
  const boardCollapsedRef = useRef(false);
  useEffect(() => {
    boardCollapsedRef.current = boardCollapsed;
  }, [boardCollapsed]);
  useEffect(() => {
    if (!open) {
      /* Сброс свёрнутости при закрытии доски снаружи (controlled). */
      queueMicrotask(() => setBoardCollapsed(false));
    }
  }, [open]);
  const dockRef = useRef(null);
  const canvasMountRef = useRef(null);
  const strokePopRef = useRef(null);
  const shapesPopRef = useRef(null);

  const canvasRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const objectsRef = useRef([]);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const dprRef = useRef(1);
  const logicalRef = useRef({ w: 1, h: 1 });
  const selectDragRef = useRef(null);

  const snapshotRef = useRef(null);
  const shapeStartRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const strokePointsRef = useRef([]);
  const freehandSnapshotRef = useRef(null);
  const loadedPersistKeyRef = useRef(null);
  const persistPropRef = useRef(initialBoardPersist);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const brushRef = useRef(brushSize);

  const textInputRef = useRef(null);
  const textValueRef = useRef("");
  const textCanvasPosRef = useRef({ x: 0, y: 0 });
  const skipTextBlurRef = useRef(false);
  const [textDraft, setTextDraft] = useState({ show: false, left: 0, top: 0, canvasX: 0, canvasY: 0, value: "" });
  const [boardObjects, setBoardObjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectionBox, setSelectionBox] = useState(null);
  const [layoutTick, setLayoutTick] = useState(0);

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

  useLayoutEffect(() => {
    persistPropRef.current = initialBoardPersist;
  }, [initialBoardPersist]);

  useEffect(() => {
    if (!strokePopoverOpen && !shapesPopoverOpen) return;
    function onDocPointerDown(e) {
      const t = e.target;
      if (dockRef.current?.contains(t)) return;
      setStrokePopoverOpen(false);
      setShapesPopoverOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [strokePopoverOpen, shapesPopoverOpen]);

  useEffect(() => {
    if (open) return;
    const id = requestAnimationFrame(() => {
      setStrokePopoverOpen(false);
      setShapesPopoverOpen(false);
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const updateUndoRedoUi = useCallback(() => {
    const h = historyRef.current;
    const i = historyIndexRef.current;
    setCanUndo(i >= 0);
    setCanRedo(i < h.length - 1);
  }, []);

  const getCtx = useCallback(() => canvasRef.current?.getContext("2d", { willReadFrequently: true }) ?? null, []);

  const ensureBgCanvas = useCallback(() => {
    let bg = bgCanvasRef.current;
    if (!bg) {
      bg = document.createElement("canvas");
      bgCanvasRef.current = bg;
    }
    const dpr = dprRef.current;
    const { w, h } = logicalRef.current;
    const tw = Math.max(1, Math.round(w * dpr));
    const th = Math.max(1, Math.round(h * dpr));
    if (bg.width !== tw || bg.height !== th) {
      bg.width = tw;
      bg.height = th;
    }
    return bg;
  }, []);

  const renderComposite = useCallback(() => {
    const canvas = canvasRef.current;
    const bg = bgCanvasRef.current;
    if (!canvas || !bg) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const dpr = dprRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const o of objectsRef.current) {
      drawBoardObject(ctx, o);
    }
  }, []);

  const resizeCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !open) return;
    const prev = logicalRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w;
    let h;
    if (useBottomSheetUi && canvasMountRef.current) {
      if (boardCollapsedRef.current) return;
      const el = canvasMountRef.current;
      w = Math.max(1, Math.round(el.clientWidth));
      h = Math.max(1, Math.round(el.clientHeight));
    } else {
      w = Math.max(1, Math.round(window.innerWidth));
      h = Math.max(1, Math.round(window.innerHeight));
    }
    const sx = prev.w > 16 ? w / prev.w : 1;
    const sy = prev.h > 16 ? h / prev.h : 1;

    let prevBgUrl = null;
    const hadBg = bgCanvasRef.current && bgCanvasRef.current.width > 0 && prev.w > 16;
    if (hadBg) {
      prevBgUrl = bgCanvasRef.current.toDataURL("image/png");
    }

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    dprRef.current = dpr;
    logicalRef.current = { w, h };

    const bg = ensureBgCanvas();
    if (prevBgUrl) {
      await paintUrlOntoBg(bg, prevBgUrl);
      if (sx !== 1 || sy !== 1) {
        setBoardObjects((objs) => {
          const next = scaleBoardObjects(objs, sx, sy);
          objectsRef.current = next;
          return next;
        });
      }
    } else {
      const idx = historyIndexRef.current;
      if (idx >= 0 && historyRef.current[idx]) {
        const entry = historyRef.current[idx];
        if (typeof entry === "string") {
          await paintUrlOntoBg(bg, entry);
          objectsRef.current = [];
          setBoardObjects([]);
        } else {
          await paintUrlOntoBg(bg, entry.bg ?? null);
          const objs = structuredClone(entry.objects ?? []);
          objectsRef.current = objs;
          setBoardObjects(objs);
        }
      } else {
        const bctx = bg.getContext("2d");
        if (bctx) {
          bctx.setTransform(1, 0, 0, 1, 0, 0);
          bctx.clearRect(0, 0, bg.width, bg.height);
        }
      }
    }
    setSelectedId(null);
    setLayoutTick((t) => t + 1);
    requestAnimationFrame(() => {
      renderComposite();
    });
  }, [ensureBgCanvas, open, renderComposite, useBottomSheetUi]);

  const saveState = useCallback(() => {
    const bg = bgCanvasRef.current ?? ensureBgCanvas();
    if (!bg) return;
    const entry = { bg: bg.toDataURL("image/png"), objects: structuredClone(objectsRef.current) };
    let h = historyRef.current;
    h = h.slice(0, historyIndexRef.current + 1);
    h.push(entry);
    const max = 45;
    if (h.length > max) {
      const cut = h.length - max;
      h = h.slice(cut);
    }
    historyRef.current = h;
    historyIndexRef.current = h.length - 1;
    updateUndoRedoUi();
  }, [ensureBgCanvas, updateUndoRedoUi]);

  const restoreHistoryIndex = useCallback(
    async (idx) => {
      const bg = bgCanvasRef.current ?? ensureBgCanvas();
      if (!bg) return;
      const entry = idx < 0 ? null : historyRef.current[idx];
      if (!entry) {
        await paintUrlOntoBg(bg, null);
        objectsRef.current = [];
        setBoardObjects([]);
      } else if (typeof entry === "string") {
        await paintUrlOntoBg(bg, entry);
        objectsRef.current = [];
        setBoardObjects([]);
      } else {
        await paintUrlOntoBg(bg, entry.bg ?? null);
        const objs = structuredClone(entry.objects ?? []);
        objectsRef.current = objs;
        setBoardObjects(objs);
      }
      historyIndexRef.current = idx;
      setSelectedId(null);
      updateUndoRedoUi();
      requestAnimationFrame(() => renderComposite());
    },
    [ensureBgCanvas, renderComposite, updateUndoRedoUi]
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
    const bg = ensureBgCanvas();
    const bctx = bg.getContext("2d");
    if (bctx) {
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, bg.width, bg.height);
    }
    objectsRef.current = [];
    setBoardObjects([]);
    setSelectedId(null);
    historyRef.current = [];
    historyIndexRef.current = -1;
    updateUndoRedoUi();
    renderComposite();
  }, [ensureBgCanvas, renderComposite, updateUndoRedoUi]);

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
    if (!open || useBottomSheetUi) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, useBottomSheetUi]);

  useEffect(() => {
    if (!open) return;
    const onWinResize = () => {
      void resizeCanvas();
    };
    window.addEventListener("resize", onWinResize);
    return () => {
      window.removeEventListener("resize", onWinResize);
    };
  }, [open, resizeCanvas]);

  useEffect(() => {
    if (!open || !useBottomSheetUi) return;
    const el = canvasMountRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      void resizeCanvas();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, useBottomSheetUi, resizeCanvas]);

  useEffect(() => {
    if (!open) return;
    if (isEduShell) return;

    historyRef.current = [];
    historyIndexRef.current = -1;
    objectsRef.current = [];
    bgCanvasRef.current = null;
    updateUndoRedoUi();
    /* eslint-disable react-hooks/set-state-in-effect -- сброс React-state вместе с refs при открытии полноэкранной доски */
    setBoardObjects([]);
    setSelectedId(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    const t = requestAnimationFrame(() => {
      void resizeCanvas();
    });
    return () => {
      cancelAnimationFrame(t);
    };
  }, [open, isEduShell, updateUndoRedoUi, resizeCanvas]);

  useLayoutEffect(() => {
    if (!open || !isEduShell) return;
    const key = String(taskId ?? "default");
    if (loadedPersistKeyRef.current === key) return;

    const prevKey = loadedPersistKeyRef.current;
    if (prevKey !== null && onBoardPersist) {
      onBoardPersist({
        taskId: prevKey,
        history: structuredClone(historyRef.current),
        historyIndex: historyIndexRef.current,
      });
    }

    loadedPersistKeyRef.current = key;
    const data = persistPropRef.current;
    historyRef.current = data?.history ? structuredClone(data.history) : [];
    historyIndexRef.current = typeof data?.historyIndex === "number" ? data.historyIndex : -1;
    bgCanvasRef.current = null;

    void (async () => {
      await resizeCanvas();
      updateUndoRedoUi();
    })();
  }, [open, isEduShell, taskId, resizeCanvas, updateUndoRedoUi, onBoardPersist]);

  useEffect(() => {
    if (open) return;
    if (!isEduShell) return;
    const key = loadedPersistKeyRef.current;
    if (key !== null && onBoardPersist) {
      onBoardPersist({
        taskId: key,
        history: structuredClone(historyRef.current),
        historyIndex: historyIndexRef.current,
      });
    }
    loadedPersistKeyRef.current = null;
  }, [open, isEduShell, onBoardPersist]);

  const commitText = useCallback(() => {
    const v = String(textValueRef.current || "").trim();
    const { x: canvasX, y: canvasY } = textCanvasPosRef.current;
    setTextDraft((s) => ({ ...s, show: false, value: "" }));
    if (!v) return;
    const newObj = {
      type: "text",
      id: newBoardId(),
      x: canvasX,
      y: canvasY,
      text: v,
      color: colorRef.current,
      fontPx: textFontPx(brushRef.current),
    };
    setBoardObjects((prev) => {
      const next = [...prev, newObj];
      objectsRef.current = next;
      return next;
    });
    textValueRef.current = "";
    requestAnimationFrame(() => {
      renderComposite();
      saveState();
    });
  }, [renderComposite, saveState]);

  useLayoutEffect(() => {
    objectsRef.current = boardObjects;
  }, [boardObjects]);

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!open || !selectedId) {
        setSelectionBox(null);
        return;
      }
      const o = boardObjects.find((x) => x.id === selectedId);
      if (!o) {
        setSelectionBox(null);
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        setSelectionBox(null);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const { w, h } = logicalRef.current;
      const b = boardObjectBBox(o);
      const left = rect.left + (b.minX / w) * rect.width;
      const top = rect.top + (b.minY / h) * rect.height;
      const width = Math.max(4, ((b.maxX - b.minX) / w) * rect.width);
      const height = Math.max(4, ((b.maxY - b.minY) / h) * rect.height);
      setSelectionBox({ left, top, width, height });
    });
    return () => cancelAnimationFrame(id);
  }, [open, selectedId, boardObjects, layoutTick]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setBoardObjects((prev) => {
      const next = prev.filter((o) => o.id !== selectedId);
      objectsRef.current = next;
      return next;
    });
    setSelectedId(null);
    requestAnimationFrame(() => {
      renderComposite();
      saveState();
    });
  }, [selectedId, renderComposite, saveState]);

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return;
    const o = boardObjects.find((x) => x.id === selectedId);
    if (!o) return;
    const copy = structuredClone(o);
    copy.id = newBoardId();
    if (copy.type === "text") {
      copy.x += 14;
      copy.y += 14;
    } else if (copy.type === "shape") {
      copy.x0 += 14;
      copy.y0 += 14;
      copy.x1 += 14;
      copy.y1 += 14;
    }
    setBoardObjects((prev) => {
      const next = [...prev, copy];
      objectsRef.current = next;
      return next;
    });
    setSelectedId(copy.id);
    requestAnimationFrame(() => {
      renderComposite();
      saveState();
    });
  }, [selectedId, boardObjects, renderComposite, saveState]);

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

      if (tname === "select") {
        const picked = pickObjectAt(objectsRef.current, x, y);
        if (picked) {
          setSelectedId(picked.id);
          selectDragRef.current = {
            pointerId: e.pointerId,
            id: picked.id,
            startLogical: { x, y },
            orig: cloneObjectForDrag(picked),
            moved: false,
          };
          canvas.setPointerCapture(e.pointerId);
        } else {
          setSelectedId(null);
          selectDragRef.current = null;
        }
        e.preventDefault();
        return;
      }

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
        const bg = ensureBgCanvas();
        const bgCtx = bg.getContext("2d");
        if (bgCtx) {
          bgCtx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
          bgCtx.save();
          bgCtx.globalCompositeOperation = "destination-out";
          bgCtx.strokeStyle = "rgba(0,0,0,1)";
          bgCtx.fillStyle = "rgba(0,0,0,1)";
          bgCtx.lineWidth = Math.max(8, brushRef.current * 3);
          bgCtx.lineCap = "round";
          bgCtx.lineJoin = "round";
          bgCtx.globalAlpha = 1;
          bgCtx.beginPath();
          bgCtx.arc(x, y, bgCtx.lineWidth / 2, 0, Math.PI * 2);
          bgCtx.fill();
          bgCtx.restore();
        }
        lastPointRef.current = { x, y };
        renderComposite();
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      if (SHAPE_TOOLS.includes(tname)) {
        drawingRef.current = true;
        shapeStartRef.current = { x, y };
        renderComposite();
        try {
          snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch {
          snapshotRef.current = null;
        }
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }

      if (tname === "pencil" || tname === "marker") {
        drawingRef.current = true;
        strokePointsRef.current = [{ x, y }];
        lastPointRef.current = { x, y };
        const bg = ensureBgCanvas();
        const bgCtx = bg.getContext("2d");
        if (bgCtx) {
          bgCtx.setTransform(1, 0, 0, 1, 0, 0);
          try {
            freehandSnapshotRef.current = bgCtx.getImageData(0, 0, bg.width, bg.height);
          } catch {
            freehandSnapshotRef.current = null;
          }
        }
        renderComposite();
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    }

    function onPointerMove(e) {
      const tname = toolRef.current;
      const { x, y } = clientToCanvas(e.clientX, e.clientY);

      if (tname === "select") {
        const drag = selectDragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const dx = x - drag.startLogical.x;
        const dy = y - drag.startLogical.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) drag.moved = true;
        setBoardObjects((prev) => {
          const next = prev.map((ob) => (ob.id === drag.id ? translateBoardObject(drag.orig, dx, dy) : ob));
          objectsRef.current = next;
          return next;
        });
        renderComposite();
        e.preventDefault();
        return;
      }

      if (tname === "eraser" && drawingRef.current) {
        const bg = ensureBgCanvas();
        const bgCtx = bg.getContext("2d");
        if (bgCtx && lastPointRef.current) {
          bgCtx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
          bgCtx.save();
          bgCtx.globalCompositeOperation = "destination-out";
          bgCtx.strokeStyle = "rgba(0,0,0,1)";
          bgCtx.lineWidth = Math.max(8, brushRef.current * 3);
          bgCtx.lineCap = "round";
          bgCtx.lineJoin = "round";
          bgCtx.globalAlpha = 1;
          bgCtx.beginPath();
          bgCtx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
          bgCtx.lineTo(x, y);
          bgCtx.stroke();
          bgCtx.restore();
        }
        lastPointRef.current = { x, y };
        renderComposite();
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

      if ((tname === "pencil" || tname === "marker") && drawingRef.current) {
        const p = { x, y };
        if (shouldAddPoint(strokePointsRef.current, p)) {
          strokePointsRef.current = [...strokePointsRef.current, p];
        }
        lastPointRef.current = { x, y };
        const bg = ensureBgCanvas();
        const bgCtx = bg.getContext("2d");
        const snap = freehandSnapshotRef.current;
        const pts = strokePointsRef.current;
        if (bgCtx && snap && pts.length >= 2) {
          bgCtx.setTransform(1, 0, 0, 1, 0, 0);
          bgCtx.putImageData(snap, 0, 0);
          bgCtx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
          drawSmoothStroke(bgCtx, pts, {
            color: colorRef.current,
            width: tname === "marker" ? Math.max(10, brushRef.current * 3) : brushRef.current,
            alpha: tname === "marker" ? 0.35 : 1,
          });
        }
        renderComposite();
        e.preventDefault();
      }
    }

    function onPointerUp(e) {
      const tname = toolRef.current;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already released */
      }

      if (tname === "select") {
        const drag = selectDragRef.current;
        selectDragRef.current = null;
        if (drag && drag.pointerId === e.pointerId && drag.moved) {
          requestAnimationFrame(() => saveState());
        }
        return;
      }

      if (tname === "eraser" && drawingRef.current) {
        drawingRef.current = false;
        saveState();
        e.preventDefault();
        return;
      }

      if (SHAPE_TOOLS.includes(tname) && drawingRef.current) {
        drawingRef.current = false;
        const start = shapeStartRef.current;
        snapshotRef.current = null;
        shapeStartRef.current = null;
        if (start) {
          const { x: x0, y: y0 } = start;
          const { x: x1, y: y1 } = clientToCanvas(e.clientX, e.clientY);
          const newObj = {
            type: "shape",
            id: newBoardId(),
            shapeKind: tname,
            x0,
            y0,
            x1,
            y1,
            color: colorRef.current,
            lineWidth: brushRef.current,
          };
          setBoardObjects((prev) => {
            const next = [...prev, newObj];
            objectsRef.current = next;
            return next;
          });
          requestAnimationFrame(() => {
            renderComposite();
            saveState();
          });
        }
        e.preventDefault();
        return;
      }

      if ((tname === "pencil" || tname === "marker") && drawingRef.current) {
        drawingRef.current = false;
        const bg = ensureBgCanvas();
        const bgCtx = bg.getContext("2d");
        const snap = freehandSnapshotRef.current;
        const ptsRaw = strokePointsRef.current;
        freehandSnapshotRef.current = null;
        strokePointsRef.current = [];
        lastPointRef.current = null;
        let pts = ptsRaw;
        if (pts.length === 1 && bgCtx) {
          pts = [pts[0], { x: pts[0].x + 0.4, y: pts[0].y }];
        }
        if (bgCtx && snap && pts.length >= 2) {
          bgCtx.setTransform(1, 0, 0, 1, 0, 0);
          bgCtx.putImageData(snap, 0, 0);
          bgCtx.setTransform(dprRef.current, 0, 0, dprRef.current, 0, 0);
          drawSmoothStroke(bgCtx, pts, {
            color: colorRef.current,
            width: tname === "marker" ? Math.max(10, brushRef.current * 3) : brushRef.current,
            alpha: tname === "marker" ? 0.35 : 1,
          });
        }
        renderComposite();
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
  }, [
    open,
    clientToCanvas,
    getCtx,
    drawShapePreview,
    saveState,
    ensureBgCanvas,
    renderComposite,
  ]);

  useLayoutEffect(() => {
    if (!open) return;
    renderComposite();
  }, [open, boardObjects, renderComposite]);

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
        v: "select",
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
  }, [open, setOpen, undo, redo, textDraft.show]);

  useEffect(() => {
    if (textDraft.show) requestAnimationFrame(() => textInputRef.current?.focus());
  }, [textDraft.show]);

  const shapeActive = SHAPE_TOOLS.includes(tool);
  const brushDotPx = BRUSH_SIZES.find((b) => b.value === brushSize)?.px ?? 9;

  const cursorClass =
    tool === "select"
      ? "exam-board-canvas--cursor-default"
      : tool === "eraser"
        ? "exam-board-canvas--cursor-cell"
        : tool === "text"
          ? "exam-board-canvas--cursor-text"
          : "exam-board-canvas--cursor-crosshair";

  const openStrokePop = () => {
    setShapesPopoverOpen(false);
    setStrokePopoverOpen((o) => !o);
  };
  const openShapesPop = () => {
    setStrokePopoverOpen(false);
    setShapesPopoverOpen((o) => !o);
  };

  const pickShape = (name) => {
    setTool(name);
    setShapesPopoverOpen(false);
  };

  return (
    <>
      {!hideFab ? (
        <button
          type="button"
          className={`exam-board-fab${open ? " exam-board-fab--active" : ""}`}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <svg className="exam-board-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          </svg>
          <span>{open ? "Закрыть доску" : "Открыть доску"}</span>
        </button>
      ) : null}

      {open && (
        <>
          {!useBottomSheetUi ? (
            <>
              <div className="exam-board-frame" aria-hidden="true" />
              {isEduShell ? (
                <header className="exam-board-edu-overlay-bar">
                  <div className="exam-board-edu-overlay-bar__text">
                    <strong className="exam-board-edu-overlay-bar__title">Доска к заданию №{taskNumber ?? "—"}</strong>
                    <span className="exam-board-edu-overlay-bar__sub">Черновик сохраняется рядом с этим заданием.</span>
                  </div>
                  <div className="exam-board-edu-overlay-bar__actions">
                    <button type="button" className="exam-board-header-btn exam-board-header-btn--close" onClick={() => setOpen(false)}>
                      Закрыть
                    </button>
                  </div>
                </header>
              ) : null}
              <canvas
                ref={canvasRef}
                id="boardCanvas"
                className={`exam-board-canvas${isEduShell ? " exam-board-canvas--edu-bar" : ""} ${cursorClass}`.trim()}
              />
            </>
          ) : (
            <div className="exam-board-root exam-board-root--panel">
              <div className="exam-board-panel-backdrop" aria-hidden="true" />
              <div className="exam-board-panel-sheet" role="dialog" aria-label="Доска для черновых записей">
                {boardCollapsed ? (
                  <div className="exam-board-collapsed-strip">
                    <span className="exam-board-collapsed-strip__label">
                      Доска · задание №{taskNumber ?? "—"}
                    </span>
                    <div className="exam-board-collapsed-strip__actions">
                      <button type="button" className="exam-board-header-btn" onClick={() => setBoardCollapsed(false)}>
                        Развернуть
                      </button>
                      <button type="button" className="exam-board-header-btn exam-board-header-btn--close" onClick={() => setOpen(false)}>
                        Закрыть
                      </button>
                    </div>
                  </div>
                ) : (
                  <header className="exam-board-header">
                    <div className="exam-board-header-text">
                      <h3 className="exam-board-header-title">Доска к заданию №{taskNumber ?? "—"}</h3>
                      <p className="exam-board-header-sub">Черновик сохраняется рядом с этим заданием.</p>
                    </div>
                    <div className="exam-board-header-actions">
                      <button type="button" className="exam-board-header-btn" onClick={() => setBoardCollapsed(true)}>
                        Свернуть
                      </button>
                      <button type="button" className="exam-board-header-btn exam-board-header-btn--close" onClick={() => setOpen(false)}>
                        Закрыть
                      </button>
                    </div>
                  </header>
                )}
                <div
                  ref={canvasMountRef}
                  className={`exam-board-canvas-mount${boardCollapsed ? " exam-board-canvas-mount--collapsed" : ""}`.trim()}
                >
                  <canvas
                    ref={canvasRef}
                    id="boardCanvas"
                    className={`exam-board-canvas exam-board-canvas--panel ${cursorClass}`.trim()}
                  />
                </div>
              </div>
            </div>
          )}

          {selectionBox && selectedId ? (
            <div
              className="exam-board-selection-chrome"
              style={{
                position: "fixed",
                left: selectionBox.left,
                top: selectionBox.top,
                width: selectionBox.width,
                height: selectionBox.height,
                zIndex: 1150,
                pointerEvents: "none",
              }}
              data-board-selection-ready="true"
            >
              <div className="exam-board-selection-box">
                <span className="exam-board-selection-handle" data-handle="nw" />
                <span className="exam-board-selection-handle" data-handle="n" />
                <span className="exam-board-selection-handle" data-handle="ne" />
                <span className="exam-board-selection-handle" data-handle="e" />
                <span className="exam-board-selection-handle" data-handle="se" />
                <span className="exam-board-selection-handle" data-handle="s" />
                <span className="exam-board-selection-handle" data-handle="sw" />
                <span className="exam-board-selection-handle" data-handle="w" />
                <div className="exam-board-selection-actions" role="toolbar" aria-label="Действия с объектом">
                  <button type="button" className="exam-board-selection-action" onClick={duplicateSelected}>
                    Дублировать
                  </button>
                  <button type="button" className="exam-board-selection-action exam-board-selection-action--danger" onClick={deleteSelected}>
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          ) : null}

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

          {!(useBottomSheetUi && boardCollapsed) ? (
          <div className={`exam-board-dock${useBottomSheetUi ? " exam-board-dock--panel" : ""}`.trim()} ref={dockRef}>
            <div className="exam-board-toolbar exam-board-toolbar--modern" role="toolbar" aria-label="Инструменты доски">
              <TbBtn active={tool === "select"} onClick={() => setTool("select")} label="Выбор" tip="Выбор (V)">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                </svg>
              </TbBtn>
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
              <TbBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Ластик" tip="Ластик (E)">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                  <path d="M22 21H7" />
                </svg>
              </TbBtn>
              <TbBtn active={tool === "text"} onClick={() => setTool("text")} label="Текст" tip="Текст (T)">
                <span className="exam-board-tb-letter">T</span>
              </TbBtn>

              <div className="exam-board-tb-divider exam-board-tb-divider--compact" aria-hidden="true" />

              <TbAnchorBtn
                active={shapeActive}
                expanded={shapesPopoverOpen}
                onClick={openShapesPop}
                label="Фигуры"
                tip="Линии и фигуры"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </TbAnchorBtn>

              <TbAnchorBtn
                active={strokePopoverOpen}
                expanded={strokePopoverOpen}
                onClick={openStrokePop}
                label="Цвет и толщина"
                tip="Цвет линии и толщина"
              >
                <span
                  className="exam-board-tb-stroke-preview"
                  style={{
                    background: color,
                    width: Math.min(20, 8 + brushDotPx / 2),
                    height: Math.min(20, 8 + brushDotPx / 2),
                    boxShadow: color === "#ffffff" ? "inset 0 0 0 1px var(--board-border, #DDE3FF)" : undefined,
                  }}
                />
              </TbAnchorBtn>

              <div className="exam-board-tb-divider exam-board-tb-divider--compact" aria-hidden="true" />

              <TbBtn active={false} disabled={!canUndo} onClick={() => undo()} label="Отменить" tip="Отменить (Ctrl+Z)">
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

            {shapesPopoverOpen && (
              <div
                ref={shapesPopRef}
                className="exam-board-popover exam-board-popover--shapes"
                role="dialog"
                aria-label="Фигуры"
              >
                <div className="exam-board-popover__title">Фигуры</div>
                <div className="exam-board-popover__grid exam-board-popover__grid--shapes">
                  <button
                    type="button"
                    className={`exam-board-shape-pick${tool === "line" ? " is-active" : ""}`}
                    onClick={() => pickShape("line")}
                    aria-label="Линия"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="5" y1="19" x2="19" y2="5" />
                    </svg>
                    <span>Линия</span>
                  </button>
                  <button
                    type="button"
                    className={`exam-board-shape-pick${tool === "arrow" ? " is-active" : ""}`}
                    onClick={() => pickShape("arrow")}
                    aria-label="Стрелка"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="5" y1="19" x2="17" y2="7" />
                      <polyline points="11 7 17 7 17 13" />
                    </svg>
                    <span>Стрелка</span>
                  </button>
                  <button
                    type="button"
                    className={`exam-board-shape-pick${tool === "rect" ? " is-active" : ""}`}
                    onClick={() => pickShape("rect")}
                    aria-label="Прямоугольник"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="4" y="6" width="16" height="12" rx="1" />
                    </svg>
                    <span>Квадрат</span>
                  </button>
                  <button
                    type="button"
                    className={`exam-board-shape-pick${tool === "ellipse" ? " is-active" : ""}`}
                    onClick={() => pickShape("ellipse")}
                    aria-label="Эллипс"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <ellipse cx="12" cy="12" rx="9" ry="6" />
                    </svg>
                    <span>Эллипс</span>
                  </button>
                  <button
                    type="button"
                    className={`exam-board-shape-pick${tool === "triangle" ? " is-active" : ""}`}
                    onClick={() => pickShape("triangle")}
                    aria-label="Треугольник"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 4L4 20h16L12 4z" />
                    </svg>
                    <span>Треугольник</span>
                  </button>
                </div>
              </div>
            )}

            {strokePopoverOpen && (
              <div
                ref={strokePopRef}
                className="exam-board-popover exam-board-popover--stroke"
                role="dialog"
                aria-label="Цвет и толщина"
              >
                <div className="exam-board-popover__title">Толщина линии</div>
                <div className="exam-board-popover__sizes">
                  {BRUSH_SIZES.map(({ px, value }) => (
                    <button
                      key={value}
                      type="button"
                      className={`exam-board-pop-size${brushSize === value ? " is-active" : ""}`}
                      style={{ width: px + 16, height: px + 16 }}
                      onClick={() => setBrushSize(value)}
                      aria-label={`Толщина ${value}`}
                    >
                      <span className="exam-board-pop-size__dot" style={{ width: px, height: px }} />
                    </button>
                  ))}
                </div>
                <div className="exam-board-popover__title exam-board-popover__title--spaced">Цвет</div>
                <div className="exam-board-popover__colors">
                  {BOARD_COLORS.map(({ hex, label }) => (
                    <button
                      key={hex}
                      type="button"
                      className={`exam-board-pop-swatch${color === hex ? " is-active" : ""}`}
                      style={{ background: hex }}
                      onClick={() => setColor(hex)}
                      title={label}
                      aria-label={label}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          ) : null}
        </>
      )}
    </>
  );
}
