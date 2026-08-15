/** Mobile/tablet shell helpers for the board editor. Does not touch scene data. */

export const BOARD_PHONE_MQ = "(max-width: 768px)";
export const BOARD_TOUCH_MQ = "(max-width: 1024px) and (pointer: coarse)";

export function isBoardEmbeddedInIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isBoardCompactShell(win: Window = window): boolean {
  if (typeof win.matchMedia !== "function") return false;
  return win.matchMedia(BOARD_PHONE_MQ).matches;
}

export function isBoardTouchShell(win: Window = window): boolean {
  if (typeof win.matchMedia !== "function") return false;
  return win.matchMedia(BOARD_PHONE_MQ).matches || win.matchMedia(BOARD_TOUCH_MQ).matches;
}

/**
 * Locks page rubber-band scroll while the board is open.
 * Restores previous overflow on release. Does not change Excalidraw scene.
 */
export function lockBoardPageScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  const html = document.documentElement;
  const body = document.body;
  const prevHtmlOverflow = html.style.overflow;
  const prevBodyOverflow = body.style.overflow;
  const prevHtmlOverscroll = html.style.overscrollBehavior;
  const prevBodyOverscroll = body.style.overscrollBehavior;
  html.classList.add("cb-board-editor-open");
  if (isBoardEmbeddedInIframe()) html.classList.add("cb-board-editor-iframe");
  html.style.overflow = "hidden";
  body.style.overflow = "hidden";
  html.style.overscrollBehavior = "none";
  body.style.overscrollBehavior = "none";
  return () => {
    html.style.overflow = prevHtmlOverflow;
    body.style.overflow = prevBodyOverflow;
    html.style.overscrollBehavior = prevHtmlOverscroll;
    body.style.overscrollBehavior = prevBodyOverscroll;
    html.classList.remove("cb-board-editor-open", "cb-board-editor-iframe");
  };
}

type ViewportTarget = {
  style: CSSStyleDeclaration;
};

/**
 * Fits the board shell to visualViewport on phones (keyboard / URL bar).
 * Skipped inside iframes: 100dvh/visualViewport there is the parent window.
 */
export function bindBoardVisualViewport(
  getTarget: () => ViewportTarget | null,
  onResize?: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const vv = window.visualViewport;
  const clearInline = () => {
    const el = getTarget();
    if (!el) return;
    el.style.height = "";
    el.style.top = "";
    el.style.width = "";
    el.style.left = "";
  };

  const apply = () => {
    const el = getTarget();
    if (!el) return;
    if (isBoardEmbeddedInIframe() || !isBoardTouchShell()) {
      clearInline();
      onResize?.();
      return;
    }
    if (!vv) {
      onResize?.();
      return;
    }
    el.style.height = `${Math.round(vv.height)}px`;
    el.style.top = `${Math.round(vv.offsetTop)}px`;
    el.style.width = `${Math.round(vv.width)}px`;
    el.style.left = `${Math.round(vv.offsetLeft)}px`;
    onResize?.();
  };

  apply();
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("orientationchange", apply);
  window.addEventListener("resize", apply);
  return () => {
    vv?.removeEventListener("resize", apply);
    vv?.removeEventListener("scroll", apply);
    window.removeEventListener("orientationchange", apply);
    window.removeEventListener("resize", apply);
    clearInline();
  };
}
