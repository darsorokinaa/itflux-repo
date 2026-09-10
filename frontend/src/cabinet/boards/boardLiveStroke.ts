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
