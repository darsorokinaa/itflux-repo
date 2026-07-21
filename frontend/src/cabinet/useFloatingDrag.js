import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Перетаскивание фиксированного окошка по экрану.
 * По умолчанию позиция из CSS (обычно bottom/right); после драга — left/top.
 */
export function useFloatingDrag({
  enabled = true,
  storageKey = null,
  handleSelector = null,
} = {}) {
  const [offset, setOffset] = useState(() => {
    if (!storageKey || typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.left === "number" && typeof parsed?.top === "number") {
        return parsed;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  const [dragging, setDragging] = useState(false);
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

  const onPointerDown = useCallback((event) => {
    if (!enabled) return;
    if (event.button != null && event.button !== 0) return;
    const interactive = event.target.closest?.("button, a, input, select, textarea, label");
    if (interactive) return;
    if (handleSelector) {
      const handle = event.target.closest?.(handleSelector);
      if (!handle) return;
    }
    const el = nodeRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    setDragging(true);
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    event.preventDefault();
  }, [enabled, handleSelector]);

  useEffect(() => {
    if (!enabled || !dragging) return undefined;

    const onMove = (event) => {
      const state = dragStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const maxLeft = Math.max(8, window.innerWidth - state.width - 8);
      const maxTop = Math.max(8, window.innerHeight - state.height - 8);
      const left = Math.min(maxLeft, Math.max(8, state.origLeft + (event.clientX - state.startX)));
      const top = Math.min(maxTop, Math.max(8, state.origTop + (event.clientY - state.startY)));
      setOffset({ left, top });
    };

    const endDrag = (event) => {
      const state = dragStateRef.current;
      if (!state || (event?.pointerId != null && event.pointerId !== state.pointerId)) return;
      dragStateRef.current = null;
      setDragging(false);
      setOffset((prev) => {
        if (prev) persist(prev);
        return prev;
      });
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
  }, [dragging, enabled, persist]);

  // Удерживаем окошко в пределах экрана при ресайзе.
  useEffect(() => {
    if (!offset) return undefined;
    const clamp = () => {
      setOffset((prev) => {
        if (!prev) return prev;
        const el = nodeRef.current;
        const width = el?.offsetWidth || 360;
        const height = el?.offsetHeight || 220;
        const left = Math.min(Math.max(8, prev.left), Math.max(8, window.innerWidth - width - 8));
        const top = Math.min(Math.max(8, prev.top), Math.max(8, window.innerHeight - height - 8));
        if (left === prev.left && top === prev.top) return prev;
        const next = { left, top };
        persist(next);
        return next;
      });
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [offset, persist]);

  const style = offset
    ? {
      left: offset.left,
      top: offset.top,
      right: "auto",
      bottom: "auto",
    }
    : undefined;

  return {
    nodeRef,
    style,
    dragging,
    positioned: Boolean(offset),
    onPointerDown,
  };
}
