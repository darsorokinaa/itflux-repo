import { useCallback, useEffect, useRef } from "react";

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

const MAX_UNDO = 35;

/**
 * Рисование на canvas с Pointer Events, DPR, сглаживание quadraticCurveTo, pressure для pen.
 */
export function useTaskDrawingCanvas({
  containerRef,
  canvasRef,
  canvasActive,
  activeTool,
  strokeColor,
  strokeWidth,
  eraserWidth,
  persistSnapshot,
  isDrawingMode,
  onCommitSnapshot,
}) {
  const ctxRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const undoStackRef = useRef([]);

  const applyDataUrl = useCallback((snap) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return Promise.resolve();
    if (canvas.width === 0 || canvas.height === 0) return Promise.resolve();
    if (!snap) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve();
      };
      img.onerror = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        resolve();
      };
      img.src = snap;
    });
  }, [canvasRef]);

  const lastPersistRef = useRef(persistSnapshot);

  const resizeToContainer = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const pixW = Math.max(1, Math.floor(container.clientWidth * dpr));
    const pixH = Math.max(1, Math.floor(container.clientHeight * dpr));
    const sizeChanged = canvas.width !== pixW || canvas.height !== pixH;
    const persistChanged = lastPersistRef.current !== persistSnapshot;
    lastPersistRef.current = persistSnapshot;

    if (!sizeChanged && !persistChanged) return;

    if (!sizeChanged && persistChanged) {
      void applyDataUrl(persistSnapshot || null);
      return;
    }

    let prev = null;
    try {
      if (canvas.width > 0 && canvas.height > 0) prev = canvas.toDataURL("image/png");
    } catch {
      prev = null;
    }

    canvas.width = pixW;
    canvas.height = pixH;
    const ctx = canvas.getContext("2d", { alpha: true });
    ctxRef.current = ctx;

    const baseline = prev && prev.length > 200 ? prev : persistSnapshot || null;
    if (baseline) {
      void applyDataUrl(baseline);
    } else if (ctx) {
      ctx.clearRect(0, 0, pixW, pixH);
    }
  }, [applyDataUrl, canvasRef, containerRef, persistSnapshot]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const ro = new ResizeObserver(() => resizeToContainer());
    ro.observe(container);
    resizeToContainer();
    return () => ro.disconnect();
  }, [resizeToContainer, containerRef]);

  const lineWidthForEvent = useCallback((e, baseW) => {
    if (e.pointerType === "pen" && typeof e.pressure === "number" && e.pressure > 0) {
      const p = clamp(e.pressure, 0, 1);
      const factor = 0.38 + 0.62 * p;
      const w = baseW * factor;
      return clamp(w, baseW * 0.42, baseW * 1.32);
    }
    return baseW;
  }, []);

  const clientToCanvas = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(rect.width, 1e-6);
    const sy = canvas.height / Math.max(rect.height, 1e-6);
    return {
      x: (clientX - rect.left) * sx,
      y: (clientY - rect.top) * sy,
    };
  }, [canvasRef]);

  const snapshotForUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return;
    try {
      const url = canvas.toDataURL("image/png");
      undoStackRef.current.push(url);
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    } catch {
      /* ignore */
    }
  }, [canvasRef]);

  const paintDot = useCallback((x, y, lw, composite, color) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = composite;
    if (composite === "destination-out") {
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.fillStyle = color;
    }
    ctx.beginPath();
    ctx.arc(x, y, lw / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, []);

  const paintSegment = useCallback((from, toX, toY, toW, composite, color) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const midX = (from.x + toX) / 2;
    const midY = (from.y + toY) / 2;
    const midW = (from.lw + toW) / 2;
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.strokeStyle = composite === "destination-out" ? "rgba(0,0,0,1)" : color;
    ctx.lineWidth = midW;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(from.x, from.y, midX, midY);
    ctx.stroke();
    ctx.restore();
  }, []);

  const pushCommit = useCallback(
    (snapshotOverride) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        if (snapshotOverride === null) {
          onCommitSnapshot?.(null, undoStackRef.current);
          return;
        }
        const url = canvas.toDataURL("image/png");
        onCommitSnapshot?.(url, undoStackRef.current);
      } catch {
        /* ignore */
      }
    },
    [onCommitSnapshot, canvasRef]
  );

  const endStroke = useCallback(() => {
    drawingRef.current = false;
    lastPointRef.current = null;
    pushCommit();
  }, [pushCommit]);

  const onPointerDown = useCallback(
    (e) => {
      if (!isDrawingMode) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      snapshotForUndo();
      const { x, y } = clientToCanvas(e.clientX, e.clientY);
      const baseW = activeTool === "eraser" ? eraserWidth : strokeWidth;
      const lw = lineWidthForEvent(e, baseW);
      const composite = activeTool === "eraser" ? "destination-out" : "source-over";
      const color = strokeColor;
      paintDot(x, y, lw, composite, color);
      lastPointRef.current = { x, y, lw };
      drawingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [
      activeTool,
      clientToCanvas,
      eraserWidth,
      isDrawingMode,
      lineWidthForEvent,
      paintDot,
      snapshotForUndo,
      strokeColor,
      strokeWidth,
    ]
  );

  const onPointerMove = useCallback(
    (e) => {
      if (!drawingRef.current || !lastPointRef.current) return;
      e.preventDefault();
      const { x, y } = clientToCanvas(e.clientX, e.clientY);
      const baseW = activeTool === "eraser" ? eraserWidth : strokeWidth;
      const lw = lineWidthForEvent(e, baseW);
      const lp = lastPointRef.current;
      const composite = activeTool === "eraser" ? "destination-out" : "source-over";
      paintSegment(lp, x, y, lw, composite, strokeColor);
      lastPointRef.current = { x, y, lw };
    },
    [activeTool, clientToCanvas, eraserWidth, lineWidthForEvent, paintSegment, strokeColor, strokeWidth]
  );

  const onPointerUpLike = useCallback(
    (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      endStroke();
    },
    [endStroke]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvasActive) return undefined;
    const opts = { passive: false };
    canvas.addEventListener("pointerdown", onPointerDown, opts);
    canvas.addEventListener("pointermove", onPointerMove, opts);
    canvas.addEventListener("pointerup", onPointerUpLike, opts);
    canvas.addEventListener("pointercancel", onPointerUpLike, opts);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUpLike);
      canvas.removeEventListener("pointercancel", onPointerUpLike);
    };
  }, [onPointerDown, onPointerMove, onPointerUpLike, canvasRef, canvasActive]);

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    void applyDataUrl(prev).then(pushCommit);
  }, [applyDataUrl, pushCommit]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (canvas && ctx) {
      snapshotForUndo();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pushCommit(null);
    }
  }, [pushCommit, snapshotForUndo, canvasRef]);

  return { resizeToContainer, undo, clearCanvas, applyDataUrl };
}
