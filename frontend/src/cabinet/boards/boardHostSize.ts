/** Single source of host size: ResizeObserver on the board container. */

export const BOARD_HOST_MIN_PX = 8;

export function boardHostSizeIsUsable(
  width: number,
  height: number,
  minPx = BOARD_HOST_MIN_PX,
): boolean {
  return width >= minPx && height >= minPx;
}

export type BoardHostSize = { width: number; height: number };

/**
 * Observe the board host box. Fires only when the usable size actually changes.
 * Does not poll, does not listen to window/visualViewport, does not use timers.
 * visibilitychange is kept so a 0×0 iframe that becomes visible is measured
 * even if the browser skipped a ResizeObserver notification.
 */
export function observeBoardHostSize(
  host: Element,
  opts: {
    onUsableSize: (size: BoardHostSize) => void;
  },
): () => void {
  let lastW = 0;
  let lastH = 0;

  const notifyIfUsable = (width: number, height: number) => {
    if (!boardHostSizeIsUsable(width, height)) return;
    if (Math.abs(width - lastW) < 0.5 && Math.abs(height - lastH) < 0.5) return;
    lastW = width;
    lastH = height;
    opts.onUsableSize({ width, height });
  };

  const fromElement = () => {
    notifyIfUsable((host as HTMLElement).clientWidth, (host as HTMLElement).clientHeight);
  };

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) notifyIfUsable(box.width, box.height);
      else fromElement();
    });
    ro.observe(host);
  }

  const onVis = () => {
    if (document.visibilityState === "visible") fromElement();
  };
  document.addEventListener("visibilitychange", onVis);
  fromElement();

  return () => {
    ro?.disconnect();
    document.removeEventListener("visibilitychange", onVis);
  };
}
