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
