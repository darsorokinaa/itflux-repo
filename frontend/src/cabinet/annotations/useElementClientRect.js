import { useEffect, useRef, useState } from "react";

import { rectsClose } from "../screenshare/contentRect";

function readBox(node) {
  if (!node?.getBoundingClientRect) return null;
  const rect = node.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Live client rect of a DOM node. Tracks resize, visualViewport zoom,
 * fullscreen, scroll, and position changes (compact-call drag) via rAF.
 */
export function useElementClientRect(targetRef, { enabled = true, live = true } = {}) {
  const [box, setBox] = useState(null);
  const lastRef = useRef(null);

  useEffect(() => {
    if (!enabled) {
      lastRef.current = null;
      setBox(null);
      return undefined;
    }
    const node = targetRef?.current ?? targetRef;
    if (!node || typeof node.getBoundingClientRect !== "function") return undefined;

    const update = () => {
      const next = readBox(node);
      if (rectsClose(lastRef.current, next)) return;
      lastRef.current = next;
      setBox(next);
    };

    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    try {
      ro?.observe(node);
    } catch {
      /* ignore */
    }
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("fullscreenchange", update);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);

    let raf = 0;
    const tick = () => {
      update();
      raf = window.requestAnimationFrame(tick);
    };
    if (live) raf = window.requestAnimationFrame(tick);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("fullscreenchange", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [enabled, live, targetRef]);

  return box;
}
