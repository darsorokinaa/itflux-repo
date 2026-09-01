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

export function clampFloatingBox(box, viewport, minWidth, minHeight) {
  if (!box) return box;
  const vw = viewport?.width ?? 1280;
  const vh = viewport?.height ?? 720;
  const maxW = Math.max(minWidth, vw - FLOATING_MARGIN * 2);
  const maxH = Math.max(minHeight, vh - FLOATING_MARGIN * 2);
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
      Math.max(FLOATING_MARGIN, next.left),
      Math.max(FLOATING_MARGIN, vw - width - FLOATING_MARGIN),
    );
  }
  if (typeof next.top === "number") {
    next.top = Math.min(
      Math.max(FLOATING_MARGIN, next.top),
      Math.max(FLOATING_MARGIN, vh - height - FLOATING_MARGIN),
    );
  }
  return next;
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
}) {
  let width = origWidth;
  let height = origHeight;
  let left = origLeft;
  let top = origTop;
  if (edge.includes("e")) width = origWidth + dx;
  if (edge.includes("s")) height = origHeight + dy;
  if (edge.includes("w")) width = origWidth - dx;
  if (edge.includes("n")) height = origHeight - dy;

  const maxW = Math.max(minWidth, (viewport?.width ?? 1280) - FLOATING_MARGIN * 2);
  const maxH = Math.max(minHeight, (viewport?.height ?? 720) - FLOATING_MARGIN * 2);
  width = Math.min(maxW, Math.max(minWidth, width));
  height = Math.min(maxH, Math.max(minHeight, height));

  if (edge.includes("w")) left = origLeft + (origWidth - width);
  if (edge.includes("n")) top = origTop + (origHeight - height);

  return clampFloatingBox(
    { left, top, width, height },
    viewport,
    minWidth,
    minHeight,
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
} = {}) {
  const [layout, setLayout] = useState(() => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return readFloatingLayout(parsed);
    } catch {
      return null;
    }
  });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const nodeRef = useRef(null);
  const dragStateRef = useRef(null);

  const persist = useCallback((next) => {
    if (!storageKey || !next) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

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
        });
        setLayout(next);
        return;
      }
      const maxLeft = Math.max(FLOATING_MARGIN, window.innerWidth - state.width - FLOATING_MARGIN);
      const maxTop = Math.max(FLOATING_MARGIN, window.innerHeight - state.height - FLOATING_MARGIN);
      const left = Math.min(maxLeft, Math.max(FLOATING_MARGIN, state.origLeft + (event.clientX - state.startX)));
      const top = Math.min(maxTop, Math.max(FLOATING_MARGIN, state.origTop + (event.clientY - state.startY)));
      setLayout((prev) => ({
        ...(prev || {}),
        left,
        top,
        width: prev?.width ?? state.width,
        height: prev?.height ?? state.height,
      }));
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
  }, [dragging, enabled, minHeight, minWidth, persist, resizing]);

  useEffect(() => {
    if (!layout) return undefined;
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
  }, [layout, minHeight, minWidth, persist]);

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

  return {
    nodeRef,
    style,
    dragging,
    resizing,
    positioned: typeof layout?.left === "number" && typeof layout?.top === "number",
    onPointerDown,
    onResizePointerDown,
  };
}
