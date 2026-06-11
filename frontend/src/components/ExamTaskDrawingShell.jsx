import { useCallback, useEffect, useRef, useState } from "react";
import DrawingPanel, { ERASER_CURSOR_CSS, ExamTaskDrawingHeaderButton } from "./DrawingPanel";
import { loadExamDrawingOverlay, saveExamDrawingOverlay } from "../utils/examTaskDrawingStorage";
import { findHitStroke, newStrokeId, redrawAllStrokes, sanitizeStrokes } from "../utils/taskStrokeDrawing";

export { ExamTaskDrawingHeaderButton };

function useNarrowPhone() {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 479px)").matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 479px)");
    const fn = () => setNarrow(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return narrow;
}

function clientToCanvas(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / Math.max(rect.width, 1e-6);
  const sy = canvas.height / Math.max(rect.height, 1e-6);
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  };
}

/**
 * Оболочка тела карточки задания: контент + canvas (векторные штрихи) + DrawingPanel.
 */
export default function ExamTaskDrawingShell({
  enabled,
  taskId,
  level,
  subject,
  variantId,
  persistEntry,
  onDrawingPersist,
  openBoardForTaskId,
  onConsumedBoardOpenRequest,
  children,
  className = "",
}) {
  const narrowPhone = useNarrowPhone();
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const hydratedRef = useRef(false);
  const drawingPointerRef = useRef(false);
  const draftRef = useRef(null);

  const persistedStrokes = persistEntry?.overlayV1?.strokes;

  const [strokes, setStrokes] = useState(() =>
    Array.isArray(persistedStrokes) ? sanitizeStrokes(persistedStrokes) : []
  );
  const [draftStroke, setDraftStroke] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const [isBoardVisible, setBoardVisible] = useState(false);
  const [extraDrawingPad, setExtraDrawingPad] = useState(false);
  const [tool, setTool] = useState(null);
  const [shapeKind, setShapeKind] = useState("line");
  const [strokeColor, setStrokeColor] = useState("#1e293b");
  const [strokeWidth, setStrokeWidth] = useState(4.5);
  /** Отменённые штрихи для «Вернуть» (после нового штриха или ластика сбрасывается). */
  const [redoStack, setRedoStack] = useState([]);

  const showCanvasLayer = enabled && !narrowPhone && (isBoardVisible || strokes.length > 0);
  /** В режиме «Курсор» canvas не перехватывает указатель — виден обычный курсор над текстом задания. */
  const canvasInteractive =
    showCanvasLayer && tool !== null && tool !== "cursor" && isBoardVisible;

  const commitStrokes = useCallback(
    (next) => {
      setRedoStack([]);
      setStrokes(next);
      onDrawingPersist?.({
        overlayV1: {
          strokes: next,
          v: 2,
          snapshot: null,
          undoStack: [],
        },
      });
      saveExamDrawingOverlay(level, subject, variantId, taskId, next);
    },
    [level, onDrawingPersist, subject, taskId, variantId]
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    const d = draftRef.current;
    redrawAllStrokes(ctx, canvas.width, canvas.height, strokes, d, tool === "eraser" ? hoveredId : null);
  }, [strokes, hoveredId, tool]);

  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = hostRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(container.clientWidth * dpr));
    const h = Math.max(1, Math.floor(container.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctxRef.current = canvas.getContext("2d", { alpha: true });
      if (ctxRef.current) {
        // Сглаживаем штрихи и фигуры, чтобы пометки выглядели аккуратнее поверх текста.
        ctxRef.current.imageSmoothingEnabled = true;
        ctxRef.current.imageSmoothingQuality = "high";
      }
    }
    redraw();
  }, [redraw]);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return undefined;
    const ro = new ResizeObserver(() => fitCanvas());
    ro.observe(container);
    fitCanvas();
    return () => ro.disconnect();
  }, [fitCanvas]);

  useEffect(() => {
    draftRef.current = draftStroke;
    redraw();
  }, [draftStroke, redraw]);

  useEffect(() => {
    redraw();
  }, [strokes, hoveredId, tool, redraw]);

  useEffect(() => {
    if (tool !== "eraser") {
      const id = requestAnimationFrame(() => setHoveredId(null));
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [tool]);

  useEffect(() => {
    if (!enabled || hydratedRef.current || variantId == null) return;
    const fromStorage = loadExamDrawingOverlay(level, subject, variantId, taskId);
    if (fromStorage?.strokes?.length && !persistedStrokes?.length) {
      const next = sanitizeStrokes(fromStorage.strokes);
      const id = requestAnimationFrame(() => {
        setStrokes(next);
        onDrawingPersist?.({ overlayV1: { strokes: next, v: 2, snapshot: null, undoStack: [] } });
      });
      hydratedRef.current = true;
      return () => cancelAnimationFrame(id);
    }
    hydratedRef.current = true;
    return undefined;
  }, [enabled, level, onDrawingPersist, persistedStrokes?.length, subject, taskId, variantId]);

  useEffect(() => {
    setRedoStack([]);
  }, [taskId, variantId]);

  useEffect(() => {
    if (!enabled || openBoardForTaskId == null || openBoardForTaskId !== taskId) return;
    const id = requestAnimationFrame(() => {
      setBoardVisible(true);
      setTool("cursor");
      onConsumedBoardOpenRequest?.();
    });
    return () => cancelAnimationFrame(id);
  }, [enabled, onConsumedBoardOpenRequest, openBoardForTaskId, taskId]);

  useEffect(() => {
    if (!showCanvasLayer) return undefined;
    const id = requestAnimationFrame(() => fitCanvas());
    return () => cancelAnimationFrame(id);
  }, [showCanvasLayer, fitCanvas]);

  const eraseAtPoint = useCallback(
    (x, y) => {
      setStrokes((prev) => {
        const hit = findHitStroke(prev, x, y);
        if (!hit) return prev;
        setRedoStack([]);
        const next = prev.filter((s) => s.id !== hit.id);
        onDrawingPersist?.({ overlayV1: { strokes: next, v: 2, snapshot: null, undoStack: [] } });
        saveExamDrawingOverlay(level, subject, variantId, taskId, next);
        return next;
      });
    },
    [level, onDrawingPersist, subject, taskId, variantId]
  );

  const onPointerDown = useCallback(
    (e) => {
      if (!canvasInteractive || (e.pointerType === "mouse" && e.button !== 0)) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      e.preventDefault();
      const { x, y } = clientToCanvas(canvas, e.clientX, e.clientY);

      if (tool === "eraser") {
        eraseAtPoint(x, y);
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        drawingPointerRef.current = true;
        return;
      }

      if (tool === "pencil") {
        const id = newStrokeId();
        const draft = { id, tool: "pencil", color: strokeColor, size: strokeWidth, points: [{ x, y }] };
        draftRef.current = draft;
        setDraftStroke(draft);
        drawingPointerRef.current = true;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }

      if (tool === "shape") {
        const id = newStrokeId();
        const draft = {
          id,
          tool: "shape",
          shape: shapeKind,
          color: strokeColor,
          size: strokeWidth,
          points: [],
          start: { x, y },
          end: { x, y },
        };
        draftRef.current = draft;
        setDraftStroke(draft);
        drawingPointerRef.current = true;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }
    },
    [canvasInteractive, eraseAtPoint, shapeKind, strokeColor, strokeWidth, tool]
  );

  const onPointerMove = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (tool === "eraser" && canvasInteractive) {
        e.preventDefault();
        const { x, y } = clientToCanvas(canvas, e.clientX, e.clientY);
        if (drawingPointerRef.current) {
          // Ластик работает по траектории, как в Miro.
          eraseAtPoint(x, y);
        } else {
          const hit = findHitStroke(strokes, x, y);
          setHoveredId(hit?.id ?? null);
        }
        return;
      }

      if (!drawingPointerRef.current || !draftRef.current) return;
      e.preventDefault();
      const { x, y } = clientToCanvas(canvas, e.clientX, e.clientY);
      const d = draftRef.current;
      if (d.tool === "pencil") {
        const pts = d.points;
        const last = pts[pts.length - 1];
        if (last && Math.hypot(x - last.x, y - last.y) < 2) return;
        const next = { ...d, points: [...pts, { x, y }] };
        draftRef.current = next;
        setDraftStroke(next);
      } else if (d.tool === "shape") {
        const next = { ...d, end: { x, y } };
        draftRef.current = next;
        setDraftStroke(next);
      }
    },
    [canvasInteractive, eraseAtPoint, strokes, tool]
  );

  const endPointer = useCallback(
    (e) => {
      const canvas = canvasRef.current;
      if (tool === "eraser" && canvas) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        drawingPointerRef.current = false;
        setHoveredId(null);
        return;
      }

      if (!drawingPointerRef.current) return;
      drawingPointerRef.current = false;
      try {
        canvas?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      const d = draftRef.current;
      draftRef.current = null;
      setDraftStroke(null);
      if (!d) return;

      if (d.tool === "pencil" && d.points.length > 0) {
        setRedoStack([]);
        setStrokes((prev) => {
          const next = [...prev, d];
          onDrawingPersist?.({ overlayV1: { strokes: next, v: 2, snapshot: null, undoStack: [] } });
          saveExamDrawingOverlay(level, subject, variantId, taskId, next);
          return next;
        });
      } else if (d.tool === "shape" && d.start && d.end) {
        const dx = Math.abs(d.end.x - d.start.x);
        const dy = Math.abs(d.end.y - d.start.y);
        if (dx > 2 || dy > 2) {
          setRedoStack([]);
          setStrokes((prev) => {
            const next = [...prev, d];
            onDrawingPersist?.({ overlayV1: { strokes: next, v: 2, snapshot: null, undoStack: [] } });
            saveExamDrawingOverlay(level, subject, variantId, taskId, next);
            return next;
          });
        }
      }
    },
    [level, onDrawingPersist, subject, taskId, variantId, tool]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasInteractive) return undefined;
    const opts = { passive: false };
    canvas.addEventListener("pointerdown", onPointerDown, opts);
    canvas.addEventListener("pointermove", onPointerMove, opts);
    const up = (ev) => endPointer(ev);
    canvas.addEventListener("pointerup", up, opts);
    canvas.addEventListener("pointercancel", up, opts);
    // На iPad/Safari `touch-action: none` не всегда блокирует прокрутку — гасим жесты явно.
    const blockTouch = (ev) => ev.preventDefault();
    canvas.addEventListener("touchstart", blockTouch, opts);
    canvas.addEventListener("touchmove", blockTouch, opts);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("touchstart", blockTouch);
      canvas.removeEventListener("touchmove", blockTouch);
    };
  }, [canvasInteractive, endPointer, onPointerDown, onPointerMove]);

  const handleUndo = useCallback(() => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const popped = prev[prev.length - 1];
      const next = prev.slice(0, -1);
      setRedoStack((r) => [...r, popped]);
      onDrawingPersist?.({ overlayV1: { strokes: next, v: 2, snapshot: null, undoStack: [] } });
      saveExamDrawingOverlay(level, subject, variantId, taskId, next);
      return next;
    });
  }, [level, onDrawingPersist, subject, taskId, variantId]);

  const handleRedo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const stroke = r[r.length - 1];
      const nextR = r.slice(0, -1);
      setStrokes((prev) => {
        const next = [...prev, stroke];
        onDrawingPersist?.({ overlayV1: { strokes: next, v: 2, snapshot: null, undoStack: [] } });
        saveExamDrawingOverlay(level, subject, variantId, taskId, next);
        return next;
      });
      return nextR;
    });
  }, [level, onDrawingPersist, subject, taskId, variantId]);

  const handleClearAll = useCallback(() => {
    if (typeof window !== "undefined" && !window.confirm("Очистить все пометки на этом задании?")) return;
    commitStrokes([]);
  }, [commitStrokes]);

  if (!enabled) {
    return <div className={`exam-task-card__body ${className}`.trim()}>{children}</div>;
  }

  const canvasClass = `exam-task-draw-canvas${canvasInteractive ? " exam-task-draw-canvas--drawing" : ""}`;
  const canvasStyle = {
    // Чуть "чернильный" режим смешивания делает пометки визуально аккуратнее на тексте/формулах.
    mixBlendMode: "multiply",
    ...(tool === "eraser" && canvasInteractive ? { cursor: ERASER_CURSOR_CSS } : {}),
  };

  return (
    <div className={`exam-task-card__body exam-task-card__body--draw-host ${className}`.trim()}>
      {narrowPhone && (
        <p className="exam-task-draw-phone-hint">
          Черновик удобнее использовать на планшете или компьютере — здесь доступны ответ и проверка как обычно.
        </p>
      )}

      {!narrowPhone && isBoardVisible && (
        <div className="exam-task-draw-chrome">
          <DrawingPanel
            tool={tool}
            shapeKind={shapeKind}
            onToolChange={setTool}
            onShapeKindChange={setShapeKind}
            strokeColor={strokeColor}
            onStrokeColor={setStrokeColor}
            strokeWidth={strokeWidth}
            onStrokeWidth={setStrokeWidth}
            onUndo={handleUndo}
            onRedo={handleRedo}
            redoDisabled={redoStack.length === 0}
            onClearAll={handleClearAll}
            onClosePanel={() => {
              setBoardVisible(false);
              setExtraDrawingPad(false);
              setTool(null);
              setHoveredId(null);
              setRedoStack([]);
            }}
            extraDrawingPad={extraDrawingPad}
            onExtraDrawingPadChange={setExtraDrawingPad}
          />
        </div>
      )}

      <div
        ref={hostRef}
        className={`exam-task-draw-stack${canvasInteractive ? " exam-task-draw-stack--drawing" : ""}`}
      >
        <div className="exam-task-card__body-inner">{children}</div>
        {!narrowPhone && extraDrawingPad && showCanvasLayer && (
          <div className="exam-task-draw-extra-slab" aria-hidden="true">
            <span className="exam-task-draw-extra-slab__hint">Дополнительное место в клетку</span>
          </div>
        )}
        {showCanvasLayer && (
          <canvas ref={canvasRef} className={canvasClass} style={canvasStyle} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
