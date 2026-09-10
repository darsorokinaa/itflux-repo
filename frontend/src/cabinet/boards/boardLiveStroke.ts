/**
 * Активный freehand-жест: локальный буфер штриха без тяжёлого persist/UI.
 * Excalidraw сам рендерит in-progress element; мы не дублируем smoothing.
 */

export function isActiveFreedrawGesture(
  isDrawingGesture: boolean,
  appState: Record<string, unknown> | null | undefined,
): boolean {
  if (!isDrawingGesture) return false;
  const tool = String((appState?.activeTool as { type?: string } | undefined)?.type || "");
  if (tool === "freedraw") return true;
  const newEl = appState?.newElement as { type?: string } | null | undefined;
  return Boolean(newEl && newEl.type === "freedraw");
}

/**
 * pointerup: Excalidraw уже finalize-ит штрих, newElement исчезает.
 * Полный stamp/diff/versionSum по всей сцене на этом кадре даёт hitch после Pencil.
 */
export function isFinishingLiveFreedraw(
  liveFreedraw: boolean,
  liveStrokeOwned: boolean,
): boolean {
  return !liveFreedraw && liveStrokeOwned;
}

/** Штрих не был в elements[] во время жеста — не сканировать всю сцену на pointerup. */
export function versionSumAfterLiveStroke(
  prevSum: number,
  hot: { version?: number } | null | undefined,
): number {
  return (Number(prevSum) || 0) + (Number(hot?.version) || 0);
}

export type RafHandle = { current: number | null };

/** Один callback на кадр: persist/WS не чаще vsync, локальный stroke уже в Excalidraw. */
export function scheduleOncePerFrame(raf: RafHandle, fn: () => void): void {
  if (raf.current != null) return;
  if (typeof requestAnimationFrame !== "function") {
    fn();
    return;
  }
  raf.current = requestAnimationFrame(() => {
    raf.current = null;
    fn();
  });
}

/** Снять отложенный кадр и выполнить сразу (pointerup / teardown). */
export function flushScheduledFrame(raf: RafHandle, fn: () => void): void {
  if (raf.current != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(raf.current);
    raf.current = null;
  } else {
    raf.current = null;
  }
  fn();
}

export const LIVE_PAINT_MAX_FPS = 60;
export const LIVE_PUBLISH_INTERVAL_MS = 24;
export const LIVE_PUBLISH_LONG_INTERVAL_MS = 48;
export const LIVE_PUBLISH_LONG_POINTS = 2500;

/**
 * iPad Pro rAF = 120Hz. mutateElement→setState на каждом vsync тяжелее сцены.
 * Локальный ink остаётся на 60 кадрах — 16ms, без второго сглаживающего алгоритма.
 */
export function schedulePaintAtFps(
  raf: RafHandle,
  lastPaintAt: { current: number },
  fn: () => void,
  maxFps = LIVE_PAINT_MAX_FPS,
): void {
  if (raf.current != null) return;
  const minDelta = 1000 / Math.max(1, maxFps);
  const run = (now: number) => {
    raf.current = null;
    if (lastPaintAt.current && now - lastPaintAt.current < minDelta) {
      if (typeof requestAnimationFrame !== "function") {
        lastPaintAt.current = now;
        fn();
        return;
      }
      raf.current = requestAnimationFrame(run);
      return;
    }
    lastPaintAt.current = now;
    fn();
  };
  if (typeof requestAnimationFrame !== "function") {
    lastPaintAt.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    fn();
    return;
  }
  raf.current = requestAnimationFrame(run);
}

/** Сеть можно проредить на длинном штрихе; локальные points не трогаем. */
export function livePublishIntervalMs(hotElement?: unknown): number {
  const pts = hotElement && typeof hotElement === "object"
    ? (hotElement as { points?: unknown }).points
    : null;
  if (Array.isArray(pts) && pts.length >= LIVE_PUBLISH_LONG_POINTS) {
    return LIVE_PUBLISH_LONG_INTERVAL_MS;
  }
  return LIVE_PUBLISH_INTERVAL_MS;
}
