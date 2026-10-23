import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const FLOATING_MARGIN = 8;
export const FLOATING_RESIZE_EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function readFloatingLayout(raw) {
  if (!raw || typeof raw !== "object") return null;
  const layout = {};
  if (typeof raw.left === "number" && typeof raw.top === "number") {
    layout.left = raw.left;
    layout.top = raw.top;
  }
  if (typeof raw.width === "number" && typeof raw.height === "number") {
    layout.width = raw.width;
    layout.height = raw.height;
  }
  return Object.keys(layout).length ? layout : null;
}

function viewportSize() {
  return {
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  };
}

export function clampFloatingBox(box, viewport, minWidth, minHeight, margins) {
  if (!box) return box;
  const vw = viewport?.width ?? 1280;
  const vh = viewport?.height ?? 720;
  const marginTop = margins?.top ?? FLOATING_MARGIN;
  const marginRight = margins?.right ?? FLOATING_MARGIN;
  const marginBottom = margins?.bottom ?? FLOATING_MARGIN;
  const marginLeft = margins?.left ?? FLOATING_MARGIN;
  const maxW = Math.max(minWidth, vw - marginLeft - marginRight);
  const maxH = Math.max(minHeight, vh - marginTop - marginBottom);
  const next = { ...box };
  if (typeof next.width === "number") {
    next.width = Math.min(maxW, Math.max(minWidth, next.width));
  }
  if (typeof next.height === "number") {
    next.height = Math.min(maxH, Math.max(minHeight, next.height));
  }
  const width = typeof next.width === "number" ? next.width : minWidth;
  const height = typeof next.height === "number" ? next.height : minHeight;
  if (typeof next.left === "number") {
    next.left = Math.min(
      Math.max(marginLeft, next.left),
      Math.max(marginLeft, vw - width - marginRight),
    );
  }
  if (typeof next.top === "number") {
    next.top = Math.min(
      Math.max(marginTop, next.top),
      Math.max(marginTop, vh - height - marginBottom),
    );
  }
  return next;
}

export const CALL_FRAME_ASPECT = 16 / 9;

/**
 * r107: пропорция плавающего окна звонка под демонстрацию экрана собеседника.
 * Планшет в портрете (например 1600x2560) раньше показывался в окне 16:9 мелкой полоской.
 * Ограничиваем 9:16..16:9; без размеров кадра — обычные 16:9.
 */
export function callFrameAspectFor(contentWidth, contentHeight) {
  const w = Number(contentWidth) || 0;
  const h = Number(contentHeight) || 0;
  if (!(w > 0 && h > 0)) return CALL_FRAME_ASPECT;
  const ratio = w / h;
  return Math.min(CALL_FRAME_ASPECT, Math.max(9 / 16, Math.round(ratio * 100) / 100));
}

/** Полоска заголовка и кнопки под видео в плавающем окне. В пропорцию кадра не входит. */
export const FLOATING_CALL_CHROME = 64;

export function presetCallFrame(view, viewport = viewportSize(), {
  marginTop = 74,
  chromeHeight = FLOATING_CALL_CHROME,
  aspectRatio = CALL_FRAME_ASPECT,
} = {}) {
  if (view === "minimized") return null;
  const vw = viewport?.width ?? 1280;
  const vh = viewport?.height ?? 720;
  const chrome = Math.max(0, chromeHeight);
  // Jitsi при ширине <300px включает reduced UI и убирает видео-плёнку — держим ≥320.
  const maxW = Math.max(320, vw - 24);
  const maxOuter = Math.max(chrome + 120, vh - marginTop - 24);
  const maxVideo = Math.max(120, maxOuter - chrome);
  const want = view === "expanded"
    ? Math.min(960, vw - 24)
    : Math.min(vw < 900 ? 320 : 480, vw - 32);
  let width = Math.min(Math.max(320, want), maxW);
  let video = Math.round(width / aspectRatio);
  if (video > maxVideo) {
    video = Math.round(maxVideo);
    width = Math.max(320, Math.round(video * aspectRatio));
  }
  return { width, height: video + chrome };
}

function roundBoxSize(width, height) {
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Keep a stored or dragged frame at width/height = aspectRatio. chromeHeight sits under the video. */
export function fitFloatingAspect(layout, aspectRatio, chromeHeight = 0) {
  if (!layout || !(aspectRatio > 0)) return layout;
  const next = { ...layout };
  const chrome = Math.max(0, chromeHeight);
  if (typeof next.width === "number") {
    next.height = Math.round(next.width / aspectRatio + chrome);
  } else if (typeof next.height === "number") {
    const video = Math.max(0, next.height - chrome);
    next.width = Math.round(video * aspectRatio);
    next.height = Math.round(next.width / aspectRatio + chrome);
  }
  return next;
}

function sizeForAspect({
  width,
  height,
  aspectRatio,
  minWidth,
  minHeight,
  maxW,
  maxH,
  driver,
  chromeHeight = 0,
}) {
  const chrome = Math.max(0, chromeHeight);
  const contentMin = Math.max(1, minHeight - chrome);
  const contentMax = Math.max(contentMin, maxH - chrome);
  const contentHeight = Math.max(0, height - chrome);
  let nextWidth = driver === "height" ? contentHeight * aspectRatio : width;
  let nextContent = driver === "height" ? contentHeight : width / aspectRatio;
  if (nextWidth < minWidth) {
    nextWidth = minWidth;
    nextContent = nextWidth / aspectRatio;
  }
  if (nextContent < contentMin) {
    nextContent = contentMin;
    nextWidth = nextContent * aspectRatio;
  }
  if (nextWidth > maxW) {
    nextWidth = maxW;
    nextContent = nextWidth / aspectRatio;
  }
  if (nextContent > contentMax) {
    nextContent = contentMax;
    nextWidth = nextContent * aspectRatio;
  }
  return roundBoxSize(nextWidth, nextContent + chrome);
}

export function applyFloatingResize({
  edge,
  origLeft,
  origTop,
  origWidth,
  origHeight,
  dx,
  dy,
  viewport,
  minWidth,
  minHeight,
  margins,
  aspectRatio = 0,
  chromeHeight = 0,
}) {
  let width = origWidth;
  let height = origHeight;
  let left = origLeft;
  let top = origTop;
  if (edge.includes("e")) width = origWidth + dx;
  if (edge.includes("s")) height = origHeight + dy;
  if (edge.includes("w")) width = origWidth - dx;
  if (edge.includes("n")) height = origHeight - dy;

  const marginTop = margins?.top ?? FLOATING_MARGIN;
  const marginRight = margins?.right ?? FLOATING_MARGIN;
  const marginBottom = margins?.bottom ?? FLOATING_MARGIN;
  const marginLeft = margins?.left ?? FLOATING_MARGIN;
  const maxW = Math.max(minWidth, (viewport?.width ?? 1280) - marginLeft - marginRight);
  const maxH = Math.max(minHeight, (viewport?.height ?? 720) - marginTop - marginBottom);

  const horizontal = edge.includes("e") || edge.includes("w");
  const vertical = edge.includes("s") || edge.includes("n");
  if (aspectRatio > 0) {
    const widthLed = Math.abs(width - origWidth) >= Math.abs(height - origHeight) * aspectRatio;
    const driver = horizontal && !vertical ? "width" : vertical && !horizontal ? "height" : widthLed ? "width" : "height";
    const sized = sizeForAspect({
      width,
      height,
      aspectRatio,
      minWidth,
      minHeight,
      maxW,
      maxH,
      driver,
      chromeHeight,
    });
    width = sized.width;
    height = sized.height;
    if (edge.includes("w")) left = origLeft + (origWidth - width);
    else left = origLeft;
    if (edge.includes("n")) top = origTop + (origHeight - height);
    else top = origTop;
    if (horizontal && !vertical) top = origTop + (origHeight - height) / 2;
    if (vertical && !horizontal) left = origLeft + (origWidth - width) / 2;
  } else {
    width = Math.min(maxW, Math.max(minWidth, width));
    height = Math.min(maxH, Math.max(minHeight, height));
    if (edge.includes("w")) left = origLeft + (origWidth - width);
    if (edge.includes("n")) top = origTop + (origHeight - height);
  }

  return clampFloatingBox(
    { left, top, width, height },
    viewport,
    minWidth,
    minHeight,
    margins,
  );
}

function notifyHostResize() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("resize"));
}

/**
 * Перетаскивание фиксированного окошка по экрану.
 * По умолчанию позиция из CSS (обычно bottom/right); после драга — left/top.
 * При resizable=true можно растягивать и уменьшать окно за края.
 */
export function useFloatingDrag({
  enabled = true,
  storageKey = null,
  handleSelector = null,
  resizable = false,
  minWidth = 160,
  minHeight = 120,
  marginTop = FLOATING_MARGIN,
  aspectRatio = 0,
  chromeHeight = 0,
  sizeToken = "",
  frameSize = null,
} = {}) {
  const [layout, setLayout] = useState(() => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return fitFloatingAspect(readFloatingLayout(parsed), aspectRatio);
    } catch {
      return null;
    }
  });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const nodeRef = useRef(null);
  const dragStateRef = useRef(null);
  const layoutKeyRef = useRef(storageKey);
  const frameSizeRef = useRef(frameSize);
  frameSizeRef.current = frameSize;
  const metricsRef = useRef({ minWidth, minHeight, marginTop });
  metricsRef.current = { minWidth, minHeight, marginTop };

  const persist = useCallback((next) => {
    if (!storageKey || !next) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!storageKey || typeof window === "undefined") {
      setLayout(null);
      return undefined;
    }
    const { minWidth: minW, minHeight: minH, marginTop: top } = metricsRef.current;
    let stored = null;
    try {
      stored = readFloatingLayout(JSON.parse(sessionStorage.getItem(storageKey) || "null"));
    } catch {
      stored = null;
    }
    const position = typeof stored?.left === "number" && typeof stored?.top === "number"
      ? { left: stored.left, top: stored.top }
      : {};
    const size = frameSizeRef.current;
    if (!size) {
      setLayout(Object.keys(position).length ? position : null);
      return undefined;
    }
    const next = clampFloatingBox(
      { ...position, width: size.width, height: size.height },
      viewportSize(),
      minW,
      minH,
      { top },
    );
    setLayout(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    return undefined;
  }, [enabled, sizeToken, storageKey]);

  const beginPointer = useCallback((event, extra) => {
    const el = nodeRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      width: rect.width,
      height: rect.height,
      ...extra,
    };
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }, []);

  const onPointerDown = useCallback((event) => {
    if (!enabled) return;
    if (event.button != null && event.button !== 0) return;
    const interactive = event.target.closest?.("button, a, input, select, textarea, label, [data-resize]");
    if (interactive) return;
    if (handleSelector) {
      const handle = event.target.closest?.(handleSelector);
      if (!handle) return;
    }
    if (!beginPointer(event, { mode: "drag" })) return;
    setDragging(true);
  }, [beginPointer, enabled, handleSelector]);

  const onResizePointerDown = useCallback((event, edge) => {
    if (!enabled || !resizable) return;
    if (event.button != null && event.button !== 0) return;
    if (!FLOATING_RESIZE_EDGES.includes(edge)) return;
    if (!beginPointer(event, { mode: "resize", edge })) return;
    setResizing(true);
  }, [beginPointer, enabled, resizable]);

  useEffect(() => {
    if (!enabled || (!dragging && !resizing)) return undefined;

    const onMove = (event) => {
      const state = dragStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      if (state.mode === "resize") {
        const next = applyFloatingResize({
          edge: state.edge,
          origLeft: state.origLeft,
          origTop: state.origTop,
          origWidth: state.width,
          origHeight: state.height,
          dx: event.clientX - state.startX,
          dy: event.clientY - state.startY,
          viewport: viewportSize(),
          minWidth,
          minHeight,
          margins: { top: marginTop },
          aspectRatio,
          chromeHeight,
        });
        setLayout(next);
        return;
      }
      const maxLeft = Math.max(FLOATING_MARGIN, window.innerWidth - state.width - FLOATING_MARGIN);
      const maxTop = Math.max(marginTop, window.innerHeight - state.height - FLOATING_MARGIN);
      const left = Math.min(maxLeft, Math.max(FLOATING_MARGIN, state.origLeft + (event.clientX - state.startX)));
      const top = Math.min(maxTop, Math.max(marginTop, state.origTop + (event.clientY - state.startY)));
      setLayout((prev) => {
        if (!(aspectRatio > 0)) return { left, top };
        return {
          ...(prev || {}),
          left,
          top,
          width: prev?.width ?? state.width,
          height: prev?.height ?? state.height,
        };
      });
    };

    const endDrag = (event) => {
      const state = dragStateRef.current;
      if (!state || (event?.pointerId != null && event.pointerId !== state.pointerId)) return;
      const wasResize = state.mode === "resize";
      dragStateRef.current = null;
      setDragging(false);
      setResizing(false);
      setLayout((prev) => {
        if (prev) persist(prev);
        return prev;
      });
      if (wasResize) notifyHostResize();
      const el = nodeRef.current;
      if (el && event?.pointerId != null) {
        try {
          el.releasePointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [aspectRatio, chromeHeight, dragging, enabled, marginTop, minHeight, minWidth, persist, resizing]);

  useEffect(() => {
    if (!layout) return undefined;
    if (layoutKeyRef.current !== storageKey) {
      layoutKeyRef.current = storageKey;
      return undefined;
    }
    const clamp = () => {
      setLayout((prev) => {
        if (!prev) return prev;
        const el = nodeRef.current;
        const next = clampFloatingBox(
          {
            ...prev,
            width: prev.width ?? el?.offsetWidth,
            height: prev.height ?? el?.offsetHeight,
          },
          viewportSize(),
          minWidth,
          minHeight,
          { top: marginTop },
        );
        if (
          next.left === prev.left
          && next.top === prev.top
          && next.width === prev.width
          && next.height === prev.height
        ) {
          return prev;
        }
        persist(next);
        return next;
      });
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [layout, marginTop, minHeight, minWidth, persist, storageKey]);

  const style = useMemo(() => {
    if (!layout) return undefined;
    const next = {};
    if (typeof layout.left === "number" && typeof layout.top === "number") {
      next.left = layout.left;
      next.top = layout.top;
      next.right = "auto";
      next.bottom = "auto";
    }
    if (typeof layout.width === "number" && typeof layout.height === "number") {
      next.width = layout.width;
      next.height = layout.height;
    }
    return Object.keys(next).length ? next : undefined;
  }, [layout]);

  const reset = useCallback(() => {
    setLayout(null);
    if (!storageKey) return;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return {
    nodeRef,
    style,
    dragging,
    resizing,
    positioned: typeof layout?.left === "number" && typeof layout?.top === "number",
    onPointerDown,
    onResizePointerDown,
    reset,
  };
}
