import { useCallback, useEffect, useRef, useState } from "react";
import { dropIndexFromY } from "../planEditorGrouping";

export const PLAN_DND_ACTIVATION_DELAY_MS = 180;
export const PLAN_DND_MOVE_THRESHOLD_PX = 12;
export const PLAN_DND_AUTO_SCROLL_EDGE_PX = 64;
export const PLAN_DND_AUTO_SCROLL_MAX = 18;

function getScrollParent(node) {
  let current = node?.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const canScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (canScroll && current.scrollHeight > current.clientHeight + 8) {
      return current;
    }
    current = current.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

function collectRects(listEl) {
  if (!listEl) return [];
  return Array.from(listEl.querySelectorAll("[data-plan-index]")).map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      top: rect.top,
      height: rect.height,
      topic: node.getAttribute("data-plan-topic") || "",
    };
  });
}

function autoScrollAtY(clientY, scrollParent) {
  if (!scrollParent) return 0;
  const rect = scrollParent.getBoundingClientRect
    ? scrollParent.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight };
  const top = rect.top ?? 0;
  const bottom = rect.bottom ?? window.innerHeight;
  const edge = PLAN_DND_AUTO_SCROLL_EDGE_PX;
  let delta = 0;
  if (clientY < top + edge) {
    const ratio = 1 - Math.max(0, clientY - top) / edge;
    delta = -Math.ceil(ratio * PLAN_DND_AUTO_SCROLL_MAX);
  } else if (clientY > bottom - edge) {
    const ratio = 1 - Math.max(0, bottom - clientY) / edge;
    delta = Math.ceil(ratio * PLAN_DND_AUTO_SCROLL_MAX);
  }
  if (!delta) return 0;
  scrollParent.scrollTop += delta;
  return delta;
}

export function usePlanListPointerReorder({
  enabled = true,
  itemCount,
  onReorder,
}) {
  const listRef = useRef(null);
  const overlayRef = useRef(null);
  const sessionRef = useRef(null);
  const dropIndexRef = useRef(null);
  const rafRef = useRef(0);
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  const clearTimer = () => {
    const session = sessionRef.current;
    if (session?.timerId) {
      window.clearTimeout(session.timerId);
      session.timerId = 0;
    }
  };

  const stopLoop = () => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  const reset = useCallback(() => {
    clearTimer();
    stopLoop();
    const session = sessionRef.current;
    if (session?.handle && session.pointerId != null) {
      try {
        session.handle.releasePointerCapture(session.pointerId);
      } catch {
        /* already released */
      }
    }
    sessionRef.current = null;
    dropIndexRef.current = null;
    setDraggingIndex(null);
    setDropIndex(null);
    document.body.classList.remove("cb-pe-dragging");
  }, []);

  const updateOverlay = (clientX, clientY) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.style.transform = `translate(${Math.round(clientX - 28)}px, ${Math.round(clientY - 22)}px)`;
  };

  const activateRef = useRef(null);

  useEffect(() => {
    activateRef.current = (session) => {
      if (!session || session.active) return;
      session.active = true;
      document.body.classList.add("cb-pe-dragging");
      setDraggingIndex(session.fromIndex);
      setDropIndex(session.fromIndex);
      dropIndexRef.current = session.fromIndex;
      updateOverlay(session.lastX, session.lastY);
      try {
        session.handle.setPointerCapture(session.pointerId);
      } catch {
        /* Safari may refuse capture; window listeners still work */
      }
      const loop = () => {
        const current = sessionRef.current;
        if (!current?.active) return;
        autoScrollAtY(current.lastY, current.scrollParent);
        const rects = collectRects(listRef.current);
        const nextDrop = dropIndexFromY(current.lastY, rects, current.fromIndex);
        if (nextDrop !== dropIndexRef.current) {
          dropIndexRef.current = nextDrop;
          setDropIndex(nextDrop);
        }
        rafRef.current = window.requestAnimationFrame(loop);
      };
      rafRef.current = window.requestAnimationFrame(loop);
    };
  });

  const onHandlePointerDown = useCallback((fromIndex, event) => {
    if (!enabled) return;
    if (event.button != null && event.button !== 0) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    const handle = event.currentTarget;
    const session = {
      fromIndex,
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      active: false,
      timerId: 0,
      scrollParent: getScrollParent(listRef.current || handle),
    };
    sessionRef.current = session;
    session.timerId = window.setTimeout(() => {
      if (sessionRef.current === session && !session.active) activateRef.current?.(session);
    }, PLAN_DND_ACTIVATION_DELAY_MS);
  }, [enabled]);

  useEffect(() => {
    const onMove = (event) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      session.lastX = event.clientX;
      session.lastY = event.clientY;
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;
      const dist = Math.hypot(dx, dy);
      if (!session.active) {
        if (dist >= PLAN_DND_MOVE_THRESHOLD_PX) activateRef.current?.(session);
        return;
      }
      if (event.cancelable) event.preventDefault();
      updateOverlay(event.clientX, event.clientY);
    };

    const onUp = (event) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      const wasActive = session.active;
      const fromIndex = session.fromIndex;
      const toIndex = dropIndexRef.current;
      reset();
      if (!wasActive) return;
      if (event.cancelable) event.preventDefault();
      const suppress = (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      };
      document.addEventListener("click", suppress, true);
      window.setTimeout(() => document.removeEventListener("click", suppress, true), 400);
      if (toIndex == null || fromIndex === toIndex) return;
      onReorder?.(fromIndex, toIndex);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onReorder, reset]);

  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    if (draggingIndex == null) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draggingIndex, reset]);

  return {
    listRef,
    overlayRef,
    draggingIndex,
    dropIndex,
    isDragging: draggingIndex != null,
    itemCount,
    onHandlePointerDown,
  };
}
